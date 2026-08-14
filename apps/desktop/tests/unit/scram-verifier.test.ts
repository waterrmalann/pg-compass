import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildScramSha256Verifier } from "@/main/scram-verifier";

const VERIFIER_PATTERN =
  /^SCRAM-SHA-256\$4096:([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

describe("buildScramSha256Verifier", () => {
  it("matches a verifier PostgreSQL produced for the same password and salt", () => {
    // Stored by PostgreSQL (PGlite) for CREATE ROLE ... PASSWORD 'pencil'.
    const postgresVerifier =
      "SCRAM-SHA-256$4096:SP/oA7SvwUu6S6k4+HwXeQ==$ziMBItOgBqxtSECaOKOFhdolcdkvNeqbqNpTRfzgI4g=:uQDVTY5dD+B2n6Ll66EaTbomN9Oe7L3DULbXEAszuH8=";
    const salt = Buffer.from("SP/oA7SvwUu6S6k4+HwXeQ==", "base64");

    expect(buildScramSha256Verifier("pencil", salt)).toBe(postgresVerifier);
  });

  it("derives StoredKey and ServerKey per RFC 5802 with a random 16-byte salt", () => {
    const verifier = buildScramSha256Verifier("correct horse");
    const match = VERIFIER_PATTERN.exec(verifier);
    expect(match).not.toBeNull();

    const salt = Buffer.from(match![1]!, "base64");
    expect(salt).toHaveLength(16);

    const saltedPassword = pbkdf2Sync(
      "correct horse",
      salt,
      4096,
      32,
      "sha256",
    );
    const clientKey = createHmac("sha256", saltedPassword)
      .update("Client Key")
      .digest();
    const expectedStoredKey = createHash("sha256")
      .update(clientKey)
      .digest("base64");
    const expectedServerKey = createHmac("sha256", saltedPassword)
      .update("Server Key")
      .digest("base64");
    expect(match![2]).toBe(expectedStoredKey);
    expect(match![3]).toBe(expectedServerKey);
  });

  it("applies SASLprep like PostgreSQL so non-ASCII passwords still log in", () => {
    const salt = Buffer.alloc(16, 7);
    const verifierFor = (password: string) =>
      buildScramSha256Verifier(password, salt);

    // NFKC, non-ASCII space to space, and "mapped to nothing" removal.
    expect(verifierFor("\uFB01sh")).toBe(verifierFor("fish"));
    expect(verifierFor("cafe\u0301")).toBe(verifierFor("caf\u00E9"));
    expect(verifierFor("pass\u00A0word")).toBe(verifierFor("pass word"));
    expect(verifierFor("a\u00ADb")).toBe(verifierFor("ab"));
    // Prohibited output falls back to the raw password, as the server does.
    expect(verifierFor("\uE000abc")).not.toBe(verifierFor("abc"));
  });

  it("never embeds the plaintext and salts each call differently", () => {
    const first = buildScramSha256Verifier("hunter2-secret");
    const second = buildScramSha256Verifier("hunter2-secret");
    expect(first).not.toContain("hunter2-secret");
    expect(first).not.toBe(second);
  });
});
