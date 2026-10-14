import { describe, expect, it } from "vitest";
import {
  tryParsePostgresUrl,
  validateConnectionInput,
} from "@/components/connections/connection-form-dialog";

describe("ConnectionFormDialog helpers", () => {
  it("parses postgres URLs pasted into the host field", () => {
    expect(
      tryParsePostgresUrl(
        "postgresql://postgres:secret@localhost:5433/pg_compass",
      ),
    ).toEqual({
      host: "localhost",
      port: 5433,
      database: "pg_compass",
      user: "postgres",
      password: "secret",
    });
  });

  it("decodes percent-encoded user, password and database in pasted URLs", () => {
    expect(
      tryParsePostgresUrl("postgresql://app%40corp:p%40ss@db.local/app%20db"),
    ).toEqual({
      host: "db.local",
      port: 5432,
      database: "app db",
      user: "app@corp",
      password: "p@ss",
    });
  });

  it("returns no errors for a valid URI or complete fields", () => {
    expect(
      validateConnectionInput("uri", "postgres://localhost/app", {
        host: "",
        port: 0,
        database: "",
        user: "",
        password: "",
      }),
    ).toEqual({});

    expect(
      validateConnectionInput("fields", "", {
        host: "localhost",
        port: 5432,
        database: "app",
        user: "postgres",
        password: "",
      }),
    ).toEqual({});
  });

  it("rejects a URI without a postgres scheme", () => {
    expect(
      validateConnectionInput("uri", "mysql://localhost/app", {
        host: "localhost",
        port: 5432,
        database: "app",
        user: "postgres",
        password: "",
      }),
    ).toEqual({ uri: "URI must start with postgres:// or postgresql://" });
  });

  it("validates both URI and individual-field modes", () => {
    expect(
      validateConnectionInput("uri", "", {
        host: "",
        port: 5432,
        database: "",
        user: "",
        password: "",
      }),
    ).toEqual({ uri: "Connection URI is required." });

    expect(
      validateConnectionInput("fields", "", {
        host: "",
        port: 70000,
        database: "",
        user: "",
        password: "",
      }),
    ).toEqual({
      host: "Host is required.",
      database: "Database name is required.",
      port: "Port must be a number between 1 and 65535.",
    });
  });
});
