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

  it("uses a fresh random 16-byte salt for every verifier", () => {
    // The derivation itself is pinned by the PostgreSQL-produced verifier
    // above; this covers the salt the production path generates.
    const first = VERIFIER_PATTERN.exec(buildScramSha256Verifier("same"));
    const second = VERIFIER_PATTERN.exec(buildScramSha256Verifier("same"));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    expect(Buffer.from(first![1]!, "base64")).toHaveLength(16);
    expect(first![1]).not.toBe(second![1]);
    expect(first![2]).not.toBe(second![2]);
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
