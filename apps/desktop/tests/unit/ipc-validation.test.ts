import { describe, expect, it } from "vitest";
import {
  validateBackupCancelInput,
  validateBackupCreateInput,
  validateBackupRestoreInput,
  validateConnectionInput,
  validateCreateRoleInput,
  validateDropRoleInput,
  validateExportDataParams,
  validateGetRowsParams,
  validateImportDataParams,
  validateImportOpenDialogOptions,
  validateInsertRowParams,
  validateMembershipInput,
  validateRolesSnapshotInput,
  validateSetDbAccessLevelInput,
  validateSetTriggerEnabledInput,
  validateSettingsPatch,
  validateTableRestrictionInput,
  validateUpdateRowParams,
} from "@/main/ipc-validation";

describe("IPC runtime validation", () => {
  it("accepts a valid connection and rejects an invalid port", () => {
    const connection = {
      label: "Local",
      favourite: false,
      mode: "fields" as const,
      fields: {
        host: "localhost",
        port: 5432,
        database: "postgres",
        user: "postgres",
        password: "",
      },
    };

    expect(validateConnectionInput(connection)).toBe(connection);
    expect(() =>
      validateConnectionInput({
        ...connection,
        fields: { ...connection.fields, port: 70_000 },
      }),
    ).toThrow(/port/);

    expect(() =>
      validateConnectionInput({ ...connection, unexpected: true }),
    ).toThrow(/unexpected/);
  });

  it("rejects payloads for the inactive connection mode", () => {
    expect(() =>
      validateConnectionInput({
        label: "URI",
        favourite: false,
        mode: "uri",
        uri: "postgres://localhost/postgres",
        fields: { arbitrary: "payload" },
      }),
    ).toThrow(/fields is not allowed/);

    expect(() =>
      validateConnectionInput({
        label: "Fields",
        favourite: false,
        mode: "fields",
        uri: "postgres://unexpected",
        fields: {
          host: "localhost",
          port: 5432,
          database: "postgres",
          user: "postgres",
          password: "",
        },
      }),
    ).toThrow(/uri is not allowed/);
  });

  it("bounds pagination values", () => {
    expect(() =>
      validateGetRowsParams({
        connectionId: "connection",
        schema: "public",
        table: "users",
        page: 1,
        pageSize: 101,
      }),
    ).toThrow(/pageSize/);
  });

  it("requires export source fields to be mutually exclusive", () => {
    expect(() =>
      validateExportDataParams({
        connectionId: "connection",
        format: "csv",
        filePath: "export.csv",
        schema: "public",
        table: "users",
        sql: "SELECT * FROM users",
      }),
    ).toThrow(/either sql or both schema and table/);

    expect(() =>
      validateExportDataParams({
        connectionId: "connection",
        format: "csv",
        filePath: "export.csv",
        table: "users",
        sql: "SELECT * FROM users",
      }),
    ).toThrow(/either sql or both schema and table/);
  });

  it("requires primary-key columns and values to align", () => {
    expect(() =>
      validateUpdateRowParams({
        connectionId: "connection",
        schema: "public",
        table: "users",
        pkColumns: ["id"],
        pkValues: [],
        changes: [
          {
            column: "name",
            pgCast: "text",
            newValue: "Ada",
            setNull: false,
          },
        ],
      }),
    ).toThrow(/pkValues/);

    expect(() =>
      validateUpdateRowParams({
        connectionId: "connection",
        schema: "public",
        table: "users",
        pkColumns: [],
        pkValues: [],
        changes: [
          {
            column: "name",
            pgCast: "text",
            newValue: "Ada",
            setNull: false,
          },
        ],
      }),
    ).toThrow(/pkColumns/);
  });

  it("validates import params and the open-file dialog options", () => {
    const importParams = {
      connectionId: "connection",
      schema: "app",
      table: "users",
      filePath: "/tmp/data.csv",
      format: "csv" as const,
      operationId: "import-1",
    };
    expect(validateImportDataParams(importParams)).toBe(importParams);
    expect(() =>
      validateImportDataParams({ ...importParams, format: "xml" }),
    ).toThrow(/format/);

    const openOptions = { purpose: "import" as const, title: "Import" };
    expect(validateImportOpenDialogOptions(openOptions)).toBe(openOptions);
    expect(() =>
      validateImportOpenDialogOptions({ purpose: "export" }),
    ).toThrow(/purpose/);
  });

  it("validates insert-row params (allows empty changes, rejects bad shapes)", () => {
    const base = {
      connectionId: "connection",
      schema: "app",
      table: "users",
    };
    expect(validateInsertRowParams({ ...base, changes: [] })).toEqual({
      ...base,
      changes: [],
    });
    expect(
      validateInsertRowParams({
        ...base,
        changes: [
          { column: "email", pgCast: "text", newValue: "a", setNull: false },
        ],
      }),
    ).toBeTruthy();
    expect(() =>
      validateInsertRowParams({
        ...base,
        changes: [{ column: "email", pgCast: "text", setNull: "no" }],
      }),
    ).toThrow(/setNull/);
    expect(() =>
      validateInsertRowParams({ ...base, changes: [{ column: 1 }] }),
    ).toThrow(/column/);
  });

  it("rejects malformed settings patches", () => {
    expect(() =>
      validateSettingsPatch({
        general: { readOnlyMode: "yes" },
      }),
    ).toThrow(/readOnlyMode/);

    expect(() =>
      validateSettingsPatch({
        general: { readOnlyMode: true, unexpected: "persist me" },
      }),
    ).toThrow(/unexpected/);

    expect(
      validateSettingsPatch({ general: { psqlPath: "/usr/bin/psql" } }),
    ).toEqual({ general: { psqlPath: "/usr/bin/psql" } });
    expect(validateSettingsPatch({ general: { psqlPath: "" } })).toEqual({
      general: { psqlPath: "" },
    });
    expect(() => validateSettingsPatch({ general: { psqlPath: 42 } })).toThrow(
      /psqlPath/,
    );
  });

  describe("roles / RBAC", () => {
    it("accepts a snapshot request", () => {
      expect(
        validateRolesSnapshotInput({
          connectionId: "c1",
          targetUser: "reader",
        }),
      ).toEqual({ connectionId: "c1", targetUser: "reader" });
    });

    it("accepts any identifier quoteIdent can carry, up to 63 bytes", () => {
      const unusualNames = ["bad-name!", "Mixed Case", 'quote"d', "ünïcødé"];
      for (const name of unusualNames) {
        expect(
          validateCreateRoleInput({ connectionId: "c1", name, login: true })
            .name,
        ).toBe(name);
      }
      expect(
        validateDropRoleInput({ connectionId: "c1", name: "a".repeat(63) })
          .name,
      ).toHaveLength(63);
    });

    it("rejects empty, NUL-containing, and over-63-byte identifiers", () => {
      expect(() =>
        validateCreateRoleInput({ connectionId: "c1", name: "", login: true }),
      ).toThrow(/non-empty/);
      expect(() =>
        validateCreateRoleInput({
          connectionId: "c1",
          name: "a\u0000b",
          login: true,
        }),
      ).toThrow(/NUL/);
      // 32 two-byte characters = 64 bytes, although only 32 characters.
      expect(() =>
        validateDropRoleInput({ connectionId: "c1", name: "é".repeat(32) }),
      ).toThrow(/63-byte/);
    });

    it("rejects unexpected keys in membership input", () => {
      expect(() =>
        validateMembershipInput({
          connectionId: "c1",
          memberName: "reader",
          parentRoleName: "admins",
          extra: true,
        }),
      ).toThrow(/extra/);
    });

    it("drops the removed restrictedTables option from db access input", () => {
      const input = {
        connectionId: "c1",
        userName: "reader",
        databaseName: "my-app db",
        level: "readonly",
        applyToFutureTables: true,
      };
      expect(validateSetDbAccessLevelInput(input)).toEqual(input);
      expect(() =>
        validateSetDbAccessLevelInput({ ...input, restrictedTables: ["t"] }),
      ).toThrow(/restrictedTables/);
      expect(() =>
        validateSetDbAccessLevelInput({ ...input, level: "owner" }),
      ).toThrow(/none\/readonly\/readwrite/);
    });

    it("validates per-table restriction entries", () => {
      const input = {
        connectionId: "c1",
        userName: "reader",
        databaseName: "app",
        tables: [
          { schema: "Sales Data", name: "orders-2024", level: "readonly" },
        ],
      };
      expect(validateTableRestrictionInput(input)).toEqual(input);
      expect(() =>
        validateTableRestrictionInput({
          ...input,
          tables: [{ schema: "", name: "orders", level: "readonly" }],
        }),
      ).toThrow(/tables\[0\]\.schema/);
    });

    it("validates trigger toggles", () => {
      const input = {
        connectionId: "c1",
        databaseName: "app",
        schemaName: "public",
        tableName: "orders",
        triggerName: "orders audit",
        enabled: false,
      };
      expect(validateSetTriggerEnabledInput(input)).toEqual(input);
      expect(() =>
        validateSetTriggerEnabledInput({ ...input, enabled: "no" }),
      ).toThrow(/enabled/);
    });

    it("drops unknown keys from drop-role payloads", () => {
      expect(() =>
        validateDropRoleInput({
          connectionId: "c1",
          name: "reader",
          force: true,
        }),
      ).toThrow(/force/);
    });
  });

  describe("backup / restore", () => {
    const target = { connectionId: "c1", database: "app" };

    it("accepts a restore with production confirmation", () => {
      const input = {
        runId: "run-12345678",
        target,
        backupPath: "/tmp/app.dump",
        backupTarget: true,
        confirmProduction: true,
      };
      expect(validateBackupRestoreInput(input)).toEqual(input);
    });

    it("rejects a non-boolean production confirmation and unknown keys", () => {
      const input = { runId: "run-12345678", target, backupPath: "/a.dump" };
      expect(() =>
        validateBackupRestoreInput({ ...input, confirmProduction: "yes" }),
      ).toThrow(/confirmProduction/);
      expect(() =>
        validateBackupRestoreInput({ ...input, mode: "row-sync" }),
      ).toThrow(/mode/);
    });

    it("validates run identifiers and endpoint database names", () => {
      expect(() => validateBackupCancelInput({ runId: "short" })).toThrow(
        /run identifier/,
      );
      expect(
        validateBackupCreateInput({
          runId: "run-12345678",
          source: { connectionId: "c1", database: "host=evil dbname=x" },
        }).source.database,
      ).toBe("host=evil dbname=x");
      expect(() =>
        validateBackupCreateInput({
          runId: "run-12345678",
          source: { connectionId: "c1", database: "" },
        }),
      ).toThrow(/database/);
    });

    it("rejects oversized payloads", () => {
      expect(() =>
        validateBackupRestoreInput({
          runId: "run-12345678",
          target,
          backupPath: "x".repeat(3_000_000),
        }),
      ).toThrow(/payload limit/);
    });
  });
});
