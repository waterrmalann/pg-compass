import { describe, expect, it } from "vitest";
import { parseEnvBlock } from "@/components/connections/parse-env-block";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

describe("parseEnvBlock", () => {
  it("reads POSTGRES_* fields", () => {
    const parsed = parseEnvBlock(
      [
        "POSTGRES_HOST=db.local",
        "POSTGRES_PORT=6543",
        "POSTGRES_DB=app",
        "POSTGRES_USER=admin",
        "POSTGRES_PASSWORD=secret",
      ].join("\n"),
    );

    expect(parsed).toEqual({
      fields: {
        host: "db.local",
        port: 6543,
        database: "app",
        user: "admin",
        password: "secret",
      },
    });
  });

  it("reads libpq PG* variables with CRLF line endings and export prefixes", () => {
    const parsed = parseEnvBlock(
      "export PGHOST=pg.internal\r\nexport PGPORT=5432\r\nPGDATABASE=reports\r\nPGUSER=reader\r\nPGPASSWORD=pw",
    );

    expect(parsed.fields).toEqual({
      host: "pg.internal",
      port: 5432,
      database: "reports",
      user: "reader",
      password: "pw",
    });
  });

  it("reads DATABASE_* and DB_* aliases (e.g. Laravel's DB_DATABASE/DB_USERNAME)", () => {
    const parsed = parseEnvBlock(
      [
        "DB_HOST=127.0.0.1",
        "DB_PORT=5433",
        "DB_DATABASE=shop",
        "DB_USERNAME=shop_user",
        "DATABASE_PASSWORD=shop_pw",
      ].join("\n"),
    );

    expect(parsed.fields).toEqual({
      host: "127.0.0.1",
      port: 5433,
      database: "shop",
      user: "shop_user",
      password: "shop_pw",
    });
  });

  it("prefers POSTGRES_* over PG* over DATABASE_* over DB_*", () => {
    const parsed = parseEnvBlock(
      ["DB_HOST=d", "DATABASE_HOST=c", "PGHOST=b", "POSTGRES_HOST=a"].join(
        "\n",
      ),
    );

    expect(parsed.fields.host).toBe("a");
  });

  it("ignores generic keys that usually belong to other services", () => {
    const parsed = parseEnvBlock(
      [
        "HOST=0.0.0.0",
        "PORT=3000",
        "USER=deploy",
        "USERNAME=deploy",
        "PASSWORD=smtp-secret",
        "DATABASE=unrelated",
        "SSL_CA=-----BEGIN CERTIFICATE-----",
        "CA_CERT=-----BEGIN CERTIFICATE-----",
      ].join("\n"),
    );

    expect(parsed).toEqual({ fields: {} });
  });

  it("ignores commented-out lines instead of un-commenting them", () => {
    const parsed = parseEnvBlock(
      [
        "# POSTGRES_HOST=old-host",
        "#POSTGRES_PASSWORD=old-secret",
        "  # DATABASE_URL=postgres://old",
        "POSTGRES_USER=current",
      ].join("\n"),
    );

    expect(parsed).toEqual({ fields: { user: "current" } });
  });

  it("strips quotes and trailing inline comments", () => {
    const parsed = parseEnvBlock(
      [
        'POSTGRES_PASSWORD="p#ss word"',
        "POSTGRES_USER='quoted user'",
        "POSTGRES_DB=app # the main database",
      ].join("\n"),
    );

    expect(parsed.fields).toEqual({
      password: "p#ss word",
      user: "quoted user",
      database: "app",
    });
  });

  it("drops a non-numeric port", () => {
    expect(parseEnvBlock("PGPORT=not-a-port").fields.port).toBeUndefined();
  });

  it("returns a postgres URI from DATABASE_URL", () => {
    const parsed = parseEnvBlock(
      "DATABASE_URL=postgresql://u:p@localhost:5432/app",
    );

    expect(parsed.uri).toBe("postgresql://u:p@localhost:5432/app");
  });

  it("ignores URIs for other databases", () => {
    const parsed = parseEnvBlock("DATABASE_URL=mysql://u:p@localhost/app");

    expect(parsed.uri).toBeUndefined();
  });

  it("uses PGSSLROOTCERT only when it holds certificate content", () => {
    expect(parseEnvBlock("PGSSLROOTCERT=/etc/ssl/root.crt").ca).toBeUndefined();

    const escaped = PEM.replaceAll("\n", String.raw`\n`);
    expect(parseEnvBlock(`PGSSLROOTCERT="${escaped}"`).ca).toBe(PEM);
  });

  it("never treats the PGSSLCERT client certificate as a CA", () => {
    const escaped = PEM.replaceAll("\n", String.raw`\n`);
    expect(parseEnvBlock(`PGSSLCERT="${escaped}"`).ca).toBeUndefined();
  });

  it("accepts a base64-encoded PEM CA", () => {
    const base64Pem = btoa(PEM);
    expect(base64Pem.startsWith("LS0t")).toBe(true);

    expect(parseEnvBlock(`POSTGRES_SSL_CA=${base64Pem}`).ca).toBe(base64Pem);
  });

  it("skips a CA key holding a path and falls through to the next one", () => {
    const escaped = PEM.replaceAll("\n", String.raw`\n`);
    const parsed = parseEnvBlock(
      [`POSTGRES_SSL_CA=./certs/ca.pem`, `DB_SSL_CA="${escaped}"`].join("\n"),
    );

    expect(parsed.ca).toBe(PEM);
  });
});
