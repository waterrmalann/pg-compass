import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import { createTempDir } from "../support/store";
import { buildConnectionFromUrl } from "../support/postgres";
import {
  hasColumn,
  hasExtension,
  tracksTableLocks,
} from "../support/capabilities";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

interface SeededDatabase {
  connectionUrl: string;
  cleanup: () => Promise<void>;
}

const INJECTION_COLUMN = 'evil"col; DROP TABLE x; --';
const NO_QUERY = { filter: "", projection: "", sort: "", skip: "", limit: "" };

export function runTableDataIntegrationSuite(
  label: string,
  createDatabase: () => Promise<SeededDatabase>,
) {
  describe(`main-process database modules (${label})`, () => {
    let cleanup: (() => Promise<void>) | undefined;
    let connectionId = "";

    beforeAll(async () => {
      process.env.PG_COMPASS_STORE_DIR = createTempDir(
        `pg-compass-${label}-store-`,
      );

      const seeded = await createDatabase();
      cleanup = seeded.cleanup;

      const connection = buildConnectionFromUrl(seeded.connectionUrl, {
        label: `${label} integration database`,
      });

      const { createConnection } = await import("@/main/connection-store");
      const created = createConnection({
        label: connection.label,
        favourite: connection.favourite,
        color: connection.color,
        mode: "fields",
        fields: connection.fields,
      });

      connectionId = created.id;
    });

    afterAll(async () => {
      const { destroyAllPools } = await import("@/main/pg-utils");
      await destroyAllPools();
      await cleanup?.();
    });

    // -----------------------------------------------------------------------
    // Existing coverage (unchanged)
    // -----------------------------------------------------------------------

    it("fetches paginated rows and query results", async () => {
      const { getRows, executeQuery } = await import("@/main/table-data-rows");

      const rows = await getRows({
        connectionId,
        schema: "app",
        table: "users",
        page: 2,
        pageSize: 25,
        query: NO_QUERY,
      });
      expect(rows.totalCount).toBe(120);
      expect(rows.rows).toHaveLength(25);
      expect(
        rows.columns.find((column) => column.name === "display_name")
          ?.isNullable,
      ).toBe(false);
      expect(
        rows.columns.find((column) => column.name === "profile_note")
          ?.isNullable,
      ).toBe(true);

      const query = await executeQuery({
        connectionId,
        queryId: "integration-query-1",
        sql: "SELECT id, email FROM app.users ORDER BY id LIMIT 10",
        page: 1,
        pageSize: 5,
      });
      expect(query.totalCount).toBe(10);
      expect(query.rows[0]).toMatchObject({ id: 1 });
    });

    it.runIf(label === "postgres")(
      "cancels only the targeted slow query and treats repeated cancellation as idempotent",
      async () => {
        const { cancelQuery, executeQuery } =
          await import("@/main/table-data-rows");
        const queryId = "integration-slow-query";
        const running = executeQuery({
          connectionId,
          queryId,
          sql: "SELECT pg_sleep(10)",
          page: 1,
          pageSize: 1,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        await expect(cancelQuery(connectionId, queryId)).resolves.toBe(
          "cancel-requested",
        );
        await expect(cancelQuery(connectionId, queryId)).resolves.toBe(
          "cancel-requested",
        );
        await expect(running).rejects.toThrow("Query cancelled.");
        await expect(cancelQuery(connectionId, queryId)).resolves.toBe(
          "already-finished",
        );
      },
    );

    it("fetches structure, indexes, constraints, and types", async () => {
      const { getStructure, getIndexes, getConstraints, getTypes } =
        await import("@/main/table-data-meta");

      const structure = await getStructure({
        connectionId,
        schema: "app",
        table: "users",
      });
      expect(
        structure.find((column) => column.name === "profile")?.udtName,
      ).toBe("jsonb");

      const indexes = await getIndexes({
        connectionId,
        schema: "app",
        table: "orders",
      });
      expect(indexes.some((index) => index.name === "orders_user_id_idx")).toBe(
        true,
      );

      const constraints = await getConstraints({
        connectionId,
        schema: "app",
        table: "orders",
      });
      expect(
        constraints.some((constraint) => constraint.type === "FOREIGN KEY"),
      ).toBe(true);

      const types = await getTypes({
        connectionId,
        schema: "app",
        table: "users",
      });
      const enumType = types.find((type) => type.name === "user_role");
      expect(enumType).toMatchObject({
        schema: "app",
        kind: "ENUM",
        enumLabels: ["admin", "editor", "viewer"],
      });
      expect(enumType?.usedByColumns).toEqual([
        { name: "role", isArray: false },
        { name: "role_history", isArray: true },
      ]);

      const domainType = types.find((type) => type.name === "email_text");
      expect(domainType).toMatchObject({
        schema: "app",
        kind: "DOMAIN",
        domainBaseType: "text",
      });
      expect(domainType?.domainConstraints[0]).toContain("CHECK");

      const compositeType = types.find(
        (type) => type.name === "mailing_address",
      );
      expect(compositeType).toMatchObject({
        schema: "app",
        kind: "COMPOSITE",
      });
      expect(
        compositeType?.compositeAttributes.map((attr) => attr.name),
      ).toEqual(["street", "city", "postcode"]);
    });

    it("fetches triggers and toggles them safely", async () => {
      const { withPoolClient } = await import("@/main/pg-utils");
      await withPoolClient(connectionId, async (client) => {
        await client.query(`
          CREATE OR REPLACE FUNCTION app.users_updated_trigger_fn()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN NEW;
          END
          $$;
        `);
        await client.query(`
          DROP TRIGGER IF EXISTS users_updated_trigger ON app.users;
          CREATE TRIGGER users_updated_trigger
          BEFORE UPDATE ON app.users
          FOR EACH ROW
          EXECUTE FUNCTION app.users_updated_trigger_fn();
        `);
      });

      const { getTriggers, toggleTrigger } =
        await import("@/main/table-data-meta");

      const triggers = await getTriggers({
        connectionId,
        schema: "app",
        table: "users",
      });
      const trigger = triggers.find(
        (item) => item.name === "users_updated_trigger",
      );

      expect(trigger).toMatchObject({
        enabled: true,
        enabledMode: "ORIGIN",
        timing: "BEFORE",
        events: ["UPDATE"],
        functionName: "app.users_updated_trigger_fn",
      });

      const disabledTriggers = await toggleTrigger({
        connectionId,
        schema: "app",
        table: "users",
        trigger: "users_updated_trigger",
        enabled: false,
      });
      expect(
        disabledTriggers.find((item) => item.name === "users_updated_trigger")
          ?.enabled,
      ).toBe(false);

      const enabledTriggers = await toggleTrigger({
        connectionId,
        schema: "app",
        table: "users",
        trigger: "users_updated_trigger",
        enabled: true,
      });
      expect(
        enabledTriggers.find((item) => item.name === "users_updated_trigger")
          ?.enabled,
      ).toBe(true);
    });

    it("includes database views in the schema tree", async () => {
      const { getSchemaTree } = await import("@/main/connection-ipc");

      const schemas = await getSchemaTree(connectionId);
      const appSchema = schemas.find((schema) => schema.name === "app");

      expect(appSchema?.tables).toEqual(
        expect.arrayContaining(["users", "orders"]),
      );
      expect(appSchema?.views).toContainEqual({
        name: "active_users",
        definition: expect.stringContaining("FROM app.users"),
      });
    });

    it("fetches view data and metadata without edit primary-key state", async () => {
      const { getRows } = await import("@/main/table-data-rows");
      const { getStructure, getIndexes, getConstraints } =
        await import("@/main/table-data-meta");

      const rows = await getRows({
        connectionId,
        schema: "app",
        table: "active_users",
        page: 1,
        pageSize: 10,
        query: NO_QUERY,
      });

      expect(rows.primaryKey).toBeNull();
      expect(rows.totalCount).toBeGreaterThan(0);
      expect(rows.columns.map((column) => column.name)).toEqual([
        "id",
        "email",
        "display_name",
      ]);

      const structure = await getStructure({
        connectionId,
        schema: "app",
        table: "active_users",
      });
      expect(structure.map((column) => column.name)).toEqual([
        "id",
        "email",
        "display_name",
      ]);

      await expect(
        getIndexes({
          connectionId,
          schema: "app",
          table: "active_users",
        }),
      ).resolves.toEqual([]);
      await expect(
        getConstraints({
          connectionId,
          schema: "app",
          table: "active_users",
        }),
      ).resolves.toEqual([]);
    });

    // -----------------------------------------------------------------------
    // primaryKey resolution
    // -----------------------------------------------------------------------

    describe("primaryKey resolution", () => {
      it("returns the primary-key columns for a real table", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "users",
          page: 1,
          pageSize: 1,
          query: NO_QUERY,
        });
        expect(result.primaryKey).toEqual(["id"]);
      });

      it("returns the composite primary-key in declaration order", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "order_items",
          page: 1,
          pageSize: 1,
          query: NO_QUERY,
        });
        expect(result.primaryKey).toEqual(["order_id", "line_number"]);
      });

      it("returns null for a table without a primary key", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "notes",
          page: 1,
          pageSize: 1,
          query: NO_QUERY,
        });
        expect(result.primaryKey).toBeNull();
      });

      it("returns null for a view", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "active_users",
          page: 1,
          pageSize: 1,
          query: NO_QUERY,
        });
        expect(result.primaryKey).toBeNull();
      });

      it("returns null for executeQuery results (no single source relation)", async () => {
        const { executeQuery } = await import("@/main/table-data-rows");
        const result = await executeQuery({
          connectionId,
          queryId: "integration-query-2",
          sql: "SELECT id, email FROM app.users ORDER BY id LIMIT 10",
          page: 1,
          pageSize: 5,
        });
        expect(result.primaryKey).toBeNull();
      });
    });

    // -----------------------------------------------------------------------
    // updateCell — happy paths
    // -----------------------------------------------------------------------

    describe("updateCell", () => {
      it("updates a text column and returns the new row", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [1],
          column: "display_name",
          pgCast: "text",
          newValue: "Renamed User",
          setNull: false,
        });
        expect(result.row["display_name"]).toBe("Renamed User");
        expect(result.row["id"]).toBe(1);
      });

      it("updates an int4 column", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [2],
          column: "login_count",
          pgCast: "int4",
          newValue: 42,
          setNull: false,
        });
        expect(result.row["login_count"]).toBe(42);
      });

      it("updates a bool column", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [3],
          column: "is_verified",
          pgCast: "bool",
          newValue: true,
          setNull: false,
        });
        expect(result.row["is_verified"]).toBe(true);
      });

      it("updates a jsonb column with a nested object", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const nested = { deep: { count: 9, tags: ["a", "b"] } };
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [4],
          column: "profile",
          pgCast: "jsonb",
          newValue: JSON.stringify(nested),
          setNull: false,
        });
        expect(result.row["profile"]).toEqual(nested);
      });

      it("updates a text[] array column", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [5],
          column: "tags",
          pgCast: "_text",
          newValue: ["alpha", "beta"],
          setNull: false,
        });
        expect(result.row["tags"]).toEqual(["alpha", "beta"]);
      });

      it("updates a uuid column", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const uuid = "11111111-2222-3333-4444-555555555555";
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [6],
          column: "external_id",
          pgCast: "uuid",
          newValue: uuid,
          setNull: false,
        });
        expect(result.row["external_id"]).toBe(uuid);
      });

      it("updates a timestamptz column from an ISO string", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const iso = "2026-01-15T12:30:00.000Z";
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [7],
          column: "created_at",
          pgCast: "timestamptz",
          newValue: iso,
          setNull: false,
        });
        const returned = result.row["created_at"];
        // pg returns a JS Date for timestamptz
        expect(returned).toBeInstanceOf(Date);
        expect((returned as Date).toISOString()).toBe(iso);
      });

      it("updates a numeric column (sent as string to preserve precision)", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [8],
          column: "score",
          pgCast: "numeric",
          newValue: "12345.67",
          setNull: false,
        });
        expect(result.row["score"]).toBe("12345.67");
      });

      it("updates a row with a composite primary key", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "order_items",
          pkColumns: ["order_id", "line_number"],
          pkValues: [1, 1],
          column: "sku",
          pgCast: "text",
          newValue: "SKU-RENAMED",
          setNull: false,
        });
        expect(result.row["sku"]).toBe("SKU-RENAMED");
      });

      it("sets a nullable column to NULL when setNull is true", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [9],
          column: "profile_note",
          pgCast: "text",
          newValue: "ignored",
          setNull: true,
        });
        expect(result.row["profile_note"]).toBeNull();
      });

      it("handles a column with special characters in its identifier", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "injection_target",
          pkColumns: ["id"],
          pkValues: [1],
          column: INJECTION_COLUMN,
          pgCast: "text",
          newValue: "parameterised",
          setNull: false,
        });
        expect(result.row[INJECTION_COLUMN]).toBe("parameterised");
      });

      it("sees preceding updates on the same row via RETURNING", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [10],
          column: "display_name",
          pgCast: "text",
          newValue: "first",
          setNull: false,
        });
        const second = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [10],
          column: "display_name",
          pgCast: "text",
          newValue: "second",
          setNull: false,
        });
        expect(second.row["display_name"]).toBe("second");
      });
    });

    // -----------------------------------------------------------------------
    // updateCell — failures
    // -----------------------------------------------------------------------

    describe("updateCell failures", () => {
      it("rejects writes when read-only mode is on", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const { updateSettings } = await import("@/main/settings-store");
        updateSettings({ general: { readOnlyMode: true } });

        try {
          await expect(
            updateCell({
              connectionId,
              schema: "app",
              table: "users",
              pkColumns: ["id"],
              pkValues: [11],
              column: "display_name",
              pgCast: "text",
              newValue: "should-not-apply",
              setNull: false,
            }),
          ).rejects.toThrow(/read-only/i);
        } finally {
          updateSettings({ general: { readOnlyMode: false } });
        }
      });

      it("rejects when pkColumns is empty", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "notes",
            pkColumns: [],
            pkValues: [],
            column: "body",
            pgCast: "text",
            newValue: "nope",
            setNull: false,
          }),
        ).rejects.toThrow(/primary key/i);
      });

      it("rejects when pkColumns and pkValues lengths differ", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "order_items",
            pkColumns: ["order_id", "line_number"],
            pkValues: [1],
            column: "sku",
            pgCast: "text",
            newValue: "x",
            setNull: false,
          }),
        ).rejects.toThrow(/pk/i);
      });

      it("rejects an unknown pgCast (allowlist)", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [12],
            column: "display_name",
            pgCast: "unknown_type",
            newValue: "nope",
            setNull: false,
          }),
        ).rejects.toThrow(/cast/i);
      });

      it("rejects a pgCast that contains SQL syntax", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [13],
            column: "display_name",
            pgCast: "text; DROP TABLE app.users; --",
            newValue: "nope",
            setNull: false,
          }),
        ).rejects.toThrow(/cast/i);
      });

      it("errors when no row matches the primary key", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [999_999],
            column: "display_name",
            pgCast: "text",
            newValue: "nope",
            setNull: false,
          }),
        ).rejects.toThrow(/not found|no rows/i);
      });

      it("surfaces NOT NULL violations", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [14],
            column: "display_name",
            pgCast: "text",
            newValue: "anything",
            setNull: true,
          }),
        ).rejects.toThrow(/null|not-null|violates/i);
      });

      it("surfaces CHECK constraint violations", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [15],
            column: "status",
            pgCast: "text",
            newValue: "banana",
            setNull: false,
          }),
        ).rejects.toThrow(/check|constraint|violates/i);
      });

      it("surfaces FOREIGN KEY violations", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "orders",
            pkColumns: ["id"],
            pkValues: [1],
            column: "user_id",
            pgCast: "int4",
            newValue: 999_999,
            setNull: false,
          }),
        ).rejects.toThrow(/foreign key|violates/i);
      });

      it("leaves the injection_target table intact after an identifier-injection attempt", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const { withPoolClient } = await import("@/main/pg-utils");

        // A malicious column name that would break unquoted SQL.
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "injection_target",
            pkColumns: ["id"],
            pkValues: [2],
            column: '"; DROP TABLE app.injection_target; --',
            pgCast: "text",
            newValue: "whatever",
            setNull: false,
          }),
        ).rejects.toThrow();

        const stillExists = await withPoolClient(connectionId, async (c) => {
          const r = await c.query<{ count: string }>(
            "SELECT count(*) AS count FROM app.injection_target",
          );
          return Number.parseInt(r.rows[0]!.count, 10);
        });
        expect(stillExists).toBe(3);
      });
    });

    // -----------------------------------------------------------------------
    // Enum support — metadata + updateCell
    // -----------------------------------------------------------------------

    describe("enum columns", () => {
      it("returns enumLabels on the enum column and omits it on non-enum columns", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "users",
          page: 1,
          pageSize: 1,
          query: NO_QUERY,
        });
        const roleCol = result.columns.find((c) => c.name === "role");
        expect(roleCol).toBeDefined();
        expect(roleCol?.enumLabels).toEqual(["admin", "editor", "viewer"]);
        expect(roleCol?.enumPgCast).toBe('"app"."user_role"');

        const statusCol = result.columns.find((c) => c.name === "status");
        expect(statusCol).toBeDefined();
        expect(statusCol?.enumLabels).toBeUndefined();
        expect(statusCol?.enumPgCast).toBeUndefined();
      });

      it("populates enumLabels on executeQuery results too", async () => {
        const { executeQuery } = await import("@/main/table-data-rows");
        const result = await executeQuery({
          connectionId,
          queryId: "integration-query-3",
          sql: "SELECT id, role FROM app.users ORDER BY id LIMIT 5",
          page: 1,
          pageSize: 5,
        });
        const roleCol = result.columns.find((c) => c.name === "role");
        expect(roleCol?.enumLabels).toEqual(["admin", "editor", "viewer"]);
        expect(roleCol?.enumPgCast).toBe('"app"."user_role"');
      });

      it("updates an enum column using the schema-qualified enum pgCast", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [30],
          column: "role",
          pgCast: '"app"."user_role"',
          newValue: "admin",
          setNull: false,
        });
        expect(result.row["role"]).toBe("admin");
      });

      it("rejects an enum-shaped cast that does not name a real enum", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [31],
            column: "role",
            pgCast: "nonexistent_enum",
            newValue: "admin",
            setNull: false,
          }),
        ).rejects.toThrow(/cast/i);
      });

      it("rejects an enum cast name that fails the shape check", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [32],
            column: "role",
            pgCast: "UserRole",
            newValue: "admin",
            setNull: false,
          }),
        ).rejects.toThrow(/cast/i);
      });

      it("surfaces invalid-enum-value errors from Postgres", async () => {
        const { updateCell } = await import("@/main/table-data-write");
        await expect(
          updateCell({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [33],
            column: "role",
            pgCast: '"app"."user_role"',
            newValue: "banana",
            setNull: false,
          }),
        ).rejects.toThrow(/invalid|enum/i);
      });
    });

    // -----------------------------------------------------------------------
    // Extension-gated updateCell cases (PostGIS, pgvector)
    // -----------------------------------------------------------------------

    describe("updateCell (extension-gated)", () => {
      it("updates a PostGIS geometry column from WKT", async () => {
        const postgis = await hasExtension(connectionId, "postgis");
        const hasLocation = await hasColumn(
          connectionId,
          "app",
          "users",
          "location",
        );
        if (!postgis || !hasLocation) {
          return;
        }

        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [20],
          column: "location",
          pgCast: "geometry",
          newValue: "SRID=4326;POINT(13.405 52.52)",
          setNull: false,
        });
        // PostGIS returns hex-encoded EWKB in pg's default type parser.
        expect(typeof result.row["location"]).toBe("string");
        expect(String(result.row["location"]).length).toBeGreaterThan(0);
      });

      it("updates a pgvector column", async () => {
        const pgvector = await hasExtension(connectionId, "vector");
        const hasEmbedding = await hasColumn(
          connectionId,
          "app",
          "users",
          "embedding",
        );
        if (!pgvector || !hasEmbedding) {
          return;
        }

        const { updateCell } = await import("@/main/table-data-write");
        const result = await updateCell({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [21],
          column: "embedding",
          pgCast: "vector",
          newValue: "[0.1,0.2,0.3]",
          setNull: false,
        });
        expect(String(result.row["embedding"])).toContain("0.1");
      });
    });

    // -----------------------------------------------------------------------
    // updateRow — atomic multi-column UPDATE
    // -----------------------------------------------------------------------

    describe("updateRow", () => {
      it("applies multiple field changes in a single atomic UPDATE", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        const result = await updateRow({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [50],
          changes: [
            {
              column: "display_name",
              pgCast: "text",
              newValue: "Multi A",
              setNull: false,
            },
            {
              column: "login_count",
              pgCast: "int4",
              newValue: 77,
              setNull: false,
            },
          ],
        });
        expect(result.row["display_name"]).toBe("Multi A");
        expect(result.row["login_count"]).toBe(77);
        expect(result.row["id"]).toBe(50);
      });

      it("mixes a value change with setNull in one call", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        const result = await updateRow({
          connectionId,
          schema: "app",
          table: "users",
          pkColumns: ["id"],
          pkValues: [51],
          changes: [
            {
              column: "display_name",
              pgCast: "text",
              newValue: "Mixed",
              setNull: false,
            },
            {
              column: "profile_note",
              pgCast: "text",
              newValue: null,
              setNull: true,
            },
          ],
        });
        expect(result.row["display_name"]).toBe("Mixed");
        expect(result.row["profile_note"]).toBeNull();
      });

      it("rolls back ALL changes when one column fails (CHECK violation)", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        const { withPoolClient } = await import("@/main/pg-utils");

        const before = await withPoolClient(connectionId, async (c) => {
          const r = await c.query(
            "SELECT display_name FROM app.users WHERE id = 52",
          );
          return r.rows[0]!.display_name as string;
        });

        await expect(
          updateRow({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [52],
            changes: [
              {
                column: "display_name",
                pgCast: "text",
                newValue: "Should Not Land",
                setNull: false,
              },
              {
                column: "status",
                pgCast: "text",
                newValue: "banana",
                setNull: false,
              },
            ],
          }),
        ).rejects.toThrow(/check|constraint|violates/i);

        const after = await withPoolClient(connectionId, async (c) => {
          const r = await c.query(
            "SELECT display_name FROM app.users WHERE id = 52",
          );
          return r.rows[0]!.display_name as string;
        });
        expect(after).toBe(before);
      });

      it("supports composite primary keys", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        const result = await updateRow({
          connectionId,
          schema: "app",
          table: "order_items",
          pkColumns: ["order_id", "line_number"],
          pkValues: [1, 2],
          changes: [
            {
              column: "sku",
              pgCast: "text",
              newValue: "SKU-MULTI",
              setNull: false,
            },
          ],
        });
        expect(result.row["sku"]).toBe("SKU-MULTI");
      });

      it("rejects when read-only mode is on", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        const { updateSettings } = await import("@/main/settings-store");
        updateSettings({ general: { readOnlyMode: true } });
        try {
          await expect(
            updateRow({
              connectionId,
              schema: "app",
              table: "users",
              pkColumns: ["id"],
              pkValues: [53],
              changes: [
                {
                  column: "display_name",
                  pgCast: "text",
                  newValue: "x",
                  setNull: false,
                },
              ],
            }),
          ).rejects.toThrow(/read-only/i);
        } finally {
          updateSettings({ general: { readOnlyMode: false } });
        }
      });

      it("rejects when pkColumns is empty", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        await expect(
          updateRow({
            connectionId,
            schema: "app",
            table: "notes",
            pkColumns: [],
            pkValues: [],
            changes: [
              { column: "body", pgCast: "text", newValue: "x", setNull: false },
            ],
          }),
        ).rejects.toThrow(/primary key/i);
      });

      it("rejects an empty changes array", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        await expect(
          updateRow({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [54],
            changes: [],
          }),
        ).rejects.toThrow(/no changes/i);
      });

      it("rejects duplicate columns in the changes array", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        await expect(
          updateRow({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [55],
            changes: [
              {
                column: "display_name",
                pgCast: "text",
                newValue: "a",
                setNull: false,
              },
              {
                column: "display_name",
                pgCast: "text",
                newValue: "b",
                setNull: false,
              },
            ],
          }),
        ).rejects.toThrow(/duplicate/i);
      });

      it("rejects an unknown pgCast in any change", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        await expect(
          updateRow({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [56],
            changes: [
              {
                column: "display_name",
                pgCast: "text",
                newValue: "ok",
                setNull: false,
              },
              {
                column: "login_count",
                pgCast: "totally_made_up",
                newValue: 1,
                setNull: false,
              },
            ],
          }),
        ).rejects.toThrow(/cast/i);
      });

      it("rejects when pkColumns and pkValues lengths differ", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        await expect(
          updateRow({
            connectionId,
            schema: "app",
            table: "order_items",
            pkColumns: ["order_id", "line_number"],
            pkValues: [1],
            changes: [
              { column: "sku", pgCast: "text", newValue: "x", setNull: false },
            ],
          }),
        ).rejects.toThrow(/pk/i);
      });

      it("errors when no row matches the primary key", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        await expect(
          updateRow({
            connectionId,
            schema: "app",
            table: "users",
            pkColumns: ["id"],
            pkValues: [999_999],
            changes: [
              {
                column: "display_name",
                pgCast: "text",
                newValue: "x",
                setNull: false,
              },
            ],
          }),
        ).rejects.toThrow(/not found|no rows/i);
      });

      it("handles a column with special characters in its identifier", async () => {
        const { updateRow } = await import("@/main/table-data-write");
        const result = await updateRow({
          connectionId,
          schema: "app",
          table: "injection_target",
          pkColumns: ["id"],
          pkValues: [3],
          changes: [
            {
              column: INJECTION_COLUMN,
              pgCast: "text",
              newValue: "atomic",
              setNull: false,
            },
          ],
        });
        expect(result.row[INJECTION_COLUMN]).toBe("atomic");
      });
    });

    // -----------------------------------------------------------------------
    // deleteRows
    // -----------------------------------------------------------------------

    async function resetDeleteTarget(): Promise<void> {
      const { withPoolClient } = await import("@/main/pg-utils");
      await withPoolClient(connectionId, async (client) => {
        await client.query("DROP TABLE IF EXISTS app.delete_target");
        await client.query(
          "CREATE TABLE app.delete_target (id SERIAL PRIMARY KEY, category TEXT NOT NULL)",
        );
        await client.query(
          "INSERT INTO app.delete_target (category) VALUES ('old'), ('old'), ('old'), ('keep'), ('keep')",
        );
      });
    }

    async function countDeleteTarget(where = "TRUE"): Promise<number> {
      const { withPoolClient } = await import("@/main/pg-utils");
      return withPoolClient(connectionId, async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT count(*) AS count FROM app.delete_target WHERE ${where}`,
        );
        return Number.parseInt(result.rows[0]!.count, 10);
      });
    }

    describe("deleteRows", () => {
      it("rejects stacked statements in a data filter", async () => {
        await resetDeleteTarget();
        const { getRows } = await import("@/main/table-data-rows");

        await expect(
          getRows({
            connectionId,
            schema: "app",
            table: "delete_target",
            page: 1,
            pageSize: 25,
            query: {
              ...NO_QUERY,
              filter: "TRUE; COMMIT; DROP TABLE app.delete_target; --",
            },
          }),
        ).rejects.toThrow();
        expect(await countDeleteTarget()).toBe(5);
      });

      it("deletes rows matching the current filter and returns the deleted count", async () => {
        await resetDeleteTarget();
        const { deleteRows } = await import("@/main/table-data-write");

        const result = await deleteRows({
          connectionId,
          schema: "app",
          table: "delete_target",
          filter: "category = 'old'",
        });

        expect(result.deletedCount).toBe(3);
        expect(await countDeleteTarget()).toBe(2);
        expect(await countDeleteTarget("category = 'keep'")).toBe(2);
      });

      it("rejects function calls in a delete filter before touching rows", async () => {
        await resetDeleteTarget();
        const { deleteRows } = await import("@/main/table-data-write");

        await expect(
          deleteRows({
            connectionId,
            schema: "app",
            table: "delete_target",
            filter: "category = 'old' AND pg_sleep(1) IS NULL",
          }),
        ).rejects.toThrow(/functions are not supported/i);
        expect(await countDeleteTarget()).toBe(5);
      });

      it("returns zero when the current filter matches no rows", async () => {
        await resetDeleteTarget();
        const { deleteRows } = await import("@/main/table-data-write");

        const result = await deleteRows({
          connectionId,
          schema: "app",
          table: "delete_target",
          filter: "category = 'missing'",
        });

        expect(result.deletedCount).toBe(0);
        expect(await countDeleteTarget()).toBe(5);
      });

      it("rejects stacked statements in a delete filter", async () => {
        await resetDeleteTarget();
        const { deleteRows } = await import("@/main/table-data-write");

        await expect(
          deleteRows({
            connectionId,
            schema: "app",
            table: "delete_target",
            filter: "TRUE; DROP TABLE app.delete_target; --",
          }),
        ).rejects.toThrow();
        expect(await countDeleteTarget()).toBe(5);
      });

      it("pages rows in primary-key order after an update moves a row", async () => {
        await resetDeleteTarget();
        const { withPoolClient } = await import("@/main/pg-utils");
        const { getRows } = await import("@/main/table-data-rows");
        // An UPDATE writes a new tuple version after the others, so an
        // unordered scan would no longer return id 1 first.
        await withPoolClient(connectionId, (client) =>
          client.query(
            "UPDATE app.delete_target SET category = category WHERE id = 1",
          ),
        );

        const rows = await getRows({
          connectionId,
          schema: "app",
          table: "delete_target",
          page: 1,
          pageSize: 25,
          query: NO_QUERY,
        });

        expect(rows.rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);
      });

      it("deletes all rows when no filter is provided", async () => {
        await resetDeleteTarget();
        const { deleteRows } = await import("@/main/table-data-write");

        const result = await deleteRows({
          connectionId,
          schema: "app",
          table: "delete_target",
          filter: "",
        });

        expect(result.deletedCount).toBe(5);
        expect(await countDeleteTarget()).toBe(0);
      });

      it("rejects deletes when read-only mode is on", async () => {
        await resetDeleteTarget();
        const { deleteRows } = await import("@/main/table-data-write");
        const { updateSettings } = await import("@/main/settings-store");
        updateSettings({ general: { readOnlyMode: true } });

        try {
          await expect(
            deleteRows({
              connectionId,
              schema: "app",
              table: "delete_target",
              filter: "category = 'old'",
            }),
          ).rejects.toThrow(/read-only/i);
        } finally {
          updateSettings({ general: { readOnlyMode: false } });
        }

        expect(await countDeleteTarget()).toBe(5);
      });
    });

    // -----------------------------------------------------------------------
    // Data-tab query DSL
    // -----------------------------------------------------------------------

    describe("query DSL", () => {
      async function usersQuery(
        query: Partial<typeof NO_QUERY>,
        page = 1,
        pageSize = 25,
      ) {
        const { getRows } = await import("@/main/table-data-rows");
        return getRows({
          connectionId,
          schema: "app",
          table: "users",
          page,
          pageSize,
          query: { ...NO_QUERY, ...query },
        });
      }

      async function expectDslFailure(
        promise: Promise<unknown>,
        expected: { field: string; code: string },
      ) {
        const { QueryDslFailure } = await import("@/main/query-dsl/prepare");
        const error = await promise.then(
          () => null,
          (err: unknown) => err,
        );
        expect(error).toBeInstanceOf(QueryDslFailure);
        expect(
          (error as InstanceType<typeof QueryDslFailure>).errors[0],
        ).toMatchObject(expected);
      }

      it("combines filter, projection and sort with aliases, count and pages", async () => {
        const query = {
          filter: "status = 'active' AND id >= 60",
          projection: "id, display_name AS name",
          sort: "login_count DESC",
        };
        const first = await usersQuery(query, 1, 5);
        const second = await usersQuery(query, 2, 5);

        // 60..120 minus the 9 multiples of 7 marked inactive.
        expect(first.totalCount).toBe(52);
        expect(first.columns.map((column) => column.name)).toEqual([
          "id",
          "name",
        ]);
        expect(first.rows[0]).toEqual({ id: 120, name: "User 120" });
        expect(first.rows.map((row) => row.id)).toEqual([
          120, 118, 117, 116, 115,
        ]);
        expect(second.rows.map((row) => row.id)).toEqual([
          114, 113, 111, 110, 109,
        ]);
        expect(first.primaryKey).toBeNull();
        expect(first.columns[1]).not.toHaveProperty("isNullable");
      });

      it("keeps edit identity and metadata for filter- and sort-only results", async () => {
        const result = await usersQuery({
          filter: "role = 'admin'",
          sort: "id -1",
        });

        expect(result.primaryKey).toEqual(["id"]);
        expect(result.totalCount).toBe(40);
        expect(result.rows[0]?.id).toBe(120);
        const role = result.columns.find((column) => column.name === "role");
        expect(role?.enumLabels).toEqual(["admin", "editor", "viewer"]);
        expect(
          result.columns.find((column) => column.name === "email")?.isNullable,
        ).toBe(false);
      });

      it("matches the unfiltered default when every field is empty", async () => {
        const result = await usersQuery({}, 1, 3);
        expect(result.totalCount).toBe(120);
        expect(result.rows.map((row) => row.id)).toEqual([1, 2, 3]);
        expect(result.primaryKey).toEqual(["id"]);
      });

      // Rows 61..120 are never modified by earlier write tests.
      it.each([
        ["is_verified = TRUE", 20],
        ["is_verified IN (true, false)", 60],
        ["score > 11.5", 5],
        ["score >= 1.15e1", 6],
        ["balance_cents = 120000", 1],
        ["balance_cents >= -1", 60],
        ["login_count NOT IN (61, 62, 63)", 57],
        ["created_at >= '2000-01-01'", 60],
        ["external_id = '00000000-0000-0000-0000-000000000077'", 1],
        ["role IN ('admin')", 20],
        ["role > 'editor'", 20],
        [`profile = '{"rank": 61, "tags": ["seed", "user"]}'`, 1],
        ["contact_email LIKE '%@%'", 0],
        ["tags IS NOT NULL", 60],
        ["profile_note IS NULL", 12],
        ["display_name ILIKE 'user 1%'", 21],
      ])("filters %s", async (filter, expectedCount) => {
        const result = await usersQuery({ filter: `id > 60 AND (${filter})` });
        expect(result.totalCount).toBe(expectedCount);
      });

      it("applies AND before OR, and parentheses override it", async () => {
        const withoutParens = await usersQuery({
          filter: "id = 1 OR id = 2 AND status = 'inactive'",
        });
        const withParens = await usersQuery({
          filter: "(id = 1 OR id = 2) AND status = 'inactive'",
        });
        expect(withoutParens.totalCount).toBe(1);
        expect(withParens.totalCount).toBe(0);
      });

      it("rejects operators a type family does not support before querying", async () => {
        await expectDslFailure(usersQuery({ filter: "tags = 'seed'" }), {
          field: "filter",
          code: "operator-not-supported",
        });
        await expectDslFailure(
          usersQuery({ filter: "login_count LIKE '1%'" }),
          {
            field: "filter",
            code: "operator-not-supported",
          },
        );
        await expectDslFailure(usersQuery({ filter: "login_count = '1'" }), {
          field: "filter",
          code: "literal-type-mismatch",
        });
      });

      it("reports unknown columns in projection and sort with suggestions", async () => {
        const { QueryDslFailure } = await import("@/main/query-dsl/prepare");
        const error = await usersQuery({
          projection: "id, display_nam",
          sort: "created DESC",
        }).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(QueryDslFailure);
        const errors = (error as InstanceType<typeof QueryDslFailure>).errors;
        expect(errors).toEqual([
          expect.objectContaining({
            field: "projection",
            code: "unknown-column",
            from: 4,
            to: 15,
            message: expect.stringContaining("display_name"),
          }),
          expect.objectContaining({ field: "sort", code: "unknown-column" }),
        ]);
      });

      it("rolls back and stays usable after a database conversion error", async () => {
        await expect(
          usersQuery({ filter: "external_id = 'not-a-uuid'" }),
        ).rejects.toThrow(/uuid/i);
        const result = await usersQuery({ filter: "id = 1" });
        expect(result.totalCount).toBe(1);
      });

      it("applies Skip and Limit to the count and the pages", async () => {
        const query = {
          filter: "id > 60",
          sort: "id",
          skip: "5",
          limit: "12",
        };
        const first = await usersQuery(query, 1, 5);
        const third = await usersQuery(query, 3, 5);
        const past = await usersQuery(query, 4, 5);

        expect(first.totalCount).toBe(12);
        expect(first.rows.map((row) => row.id)).toEqual([66, 67, 68, 69, 70]);
        expect(third.rows.map((row) => row.id)).toEqual([76, 77]);
        expect(past.rows).toEqual([]);
        expect(past.columns.length).toBeGreaterThan(0);

        const beyond = await usersQuery({ filter: "id > 60", skip: "500" });
        expect(beyond.totalCount).toBe(0);
        expect(beyond.rows).toEqual([]);
      });

      it("returns every column except the excluded ones", async () => {
        const result = await usersQuery({
          filter: "id = 61",
          projection: "-profile, -tags, -role_history",
        });
        const names = result.columns.map((column) => column.name);
        expect(names).not.toContain("profile");
        expect(names).not.toContain("tags");
        expect(names).toContain("display_name");
        expect(names[0]).toBe("id");
        expect(result.rows[0]).not.toHaveProperty("profile");
        expect(result.primaryKey).toBeNull();
      });

      it("previews the export SQL with Skip/Limit parameters and no execution", async () => {
        const { previewQuerySql } = await import("@/main/table-data-export");
        const preview = await previewQuerySql({
          connectionId,
          schema: "app",
          table: "users",
          query: {
            ...NO_QUERY,
            filter: "role = 'admin'",
            projection: "id, display_name AS name",
            sort: "id DESC",
            skip: "2",
            limit: "3",
          },
        });
        expect(preview).toEqual({
          sql: [
            'SELECT "id", "display_name" AS "name"',
            'FROM "app"."users"',
            'WHERE "role" = $1',
            'ORDER BY "app"."users"."id" DESC',
            "OFFSET $2",
            "LIMIT $3",
          ].join("\n"),
          values: ["admin", 2, 3],
        });
      });

      it("locks the relation before reading its catalog", async (context) => {
        if (!(await tracksTableLocks(connectionId))) context.skip();
        const { withPoolClient } = await import("@/main/pg-utils");
        const { bindAndCompile, parseDataQueryOrThrow } =
          await import("@/main/query-dsl/prepare");
        const ast = parseDataQueryOrThrow({ ...NO_QUERY, filter: "id = 1" });
        const modes = await withPoolClient(connectionId, async (client) => {
          await client.query("BEGIN");
          try {
            await bindAndCompile(client, "app", "users", ast, "ROW EXCLUSIVE");
            const locks = await client.query<{ mode: string }>(
              `SELECT mode FROM pg_locks
               WHERE relation = 'app.users'::regclass
                 AND pid = pg_backend_pid()`,
            );
            return locks.rows.map((row) => row.mode);
          } finally {
            await client.query("ROLLBACK");
          }
        });
        expect(modes).toContain("RowExclusiveLock");
      });

      it("sorts by source columns even when an alias shares their name", async () => {
        const { withPoolClient } = await import("@/main/pg-utils");
        const { getRows } = await import("@/main/table-data-rows");
        await withPoolClient(connectionId, async (client) => {
          await client.query("DROP TABLE IF EXISTS app.alias_shadow");
          await client.query(
            "CREATE TABLE app.alias_shadow (id INT PRIMARY KEY, name TEXT, label TEXT)",
          );
          await client.query(
            "INSERT INTO app.alias_shadow VALUES (1, 'b', 'z'), (2, 'a', 'y'), (3, 'c', 'x')",
          );
        });

        const result = await getRows({
          connectionId,
          schema: "app",
          table: "alias_shadow",
          page: 1,
          pageSize: 25,
          // "name" and "id" are aliases of other columns here; Sort and the
          // primary-key tie-breaker must still use the table's columns.
          query: {
            ...NO_QUERY,
            projection: "label AS name, name AS id",
            sort: "name",
          },
        });
        expect(result.rows).toEqual([
          { name: "y", id: "a" },
          { name: "z", id: "b" },
          { name: "x", id: "c" },
        ]);
      });

      it("breaks sort ties with composite primary-key columns", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "order_items",
          page: 1,
          pageSize: 4,
          query: { ...NO_QUERY, sort: "quantity DESC" },
        });
        // quantity = (gs % 5) + 1 is 5 for gs = 4, 9, 14, 19 …; ties fall
        // back to (order_id, line_number) ascending.
        expect(
          result.rows.map((row) => [row.order_id, row.line_number]),
        ).toEqual([
          [4, 1],
          [4, 2],
          [9, 1],
          [9, 2],
        ]);
      });

      it("handles quoted, mixed-case and reserved identifiers", async () => {
        const { withPoolClient } = await import("@/main/pg-utils");
        const { getRows } = await import("@/main/table-data-rows");
        await withPoolClient(connectionId, async (client) => {
          await client.query('DROP TABLE IF EXISTS app."MixedCase"');
          await client.query(
            'CREATE TABLE app."MixedCase" (id SERIAL PRIMARY KEY, "CreatedAt" DATE NOT NULL, "select" TEXT, "quote""col" TEXT)',
          );
          await client.query(
            `INSERT INTO app."MixedCase" ("CreatedAt", "select", "quote""col") VALUES ('2025-12-31', 'a', 'x'), ('2026-01-02', 'b', 'y'), ('2026-03-01', 'b', 'z')`,
          );
        });

        const result = await getRows({
          connectionId,
          schema: "app",
          table: "MixedCase",
          page: 1,
          pageSize: 25,
          query: {
            ...NO_QUERY,
            filter: `"CreatedAt" >= '2026-01-01' AND "select" = 'b'`,
            projection: `"quote""col" AS "Quote", "CreatedAt"`,
            sort: `"CreatedAt" DESC`,
          },
        });
        expect(result.totalCount).toBe(2);
        expect(result.rows.map((row) => row.Quote)).toEqual(["z", "y"]);
        expect(result.columns.map((column) => column.name)).toEqual([
          "Quote",
          "CreatedAt",
        ]);

        await expectDslFailure(
          getRows({
            connectionId,
            schema: "app",
            table: "MixedCase",
            page: 1,
            pageSize: 25,
            query: { ...NO_QUERY, sort: "createdat" },
          }),
          { field: "sort", code: "case-mismatch" },
        );
      });

      it("queries views without edit identity", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "active_users",
          page: 1,
          pageSize: 3,
          query: { ...NO_QUERY, filter: "id < 10", sort: "id DESC" },
        });
        expect(result.totalCount).toBe(8);
        expect(result.rows.map((row) => row.id)).toEqual([9, 8, 6]);
        expect(result.primaryKey).toBeNull();
      });

      it("returns catalog columns with type families for completion", async () => {
        const { getQueryColumns } = await import("@/main/table-data-rows");
        const columns = await getQueryColumns({
          connectionId,
          schema: "app",
          table: "users",
        });
        const families = Object.fromEntries(
          columns.map((column) => [column.name, column.family]),
        );
        expect(families).toMatchObject({
          id: "numeric",
          email: "text",
          role: "enum",
          role_history: "other",
          contact_email: "text",
          mailing_address: "other",
          is_verified: "boolean",
          score: "numeric",
          profile: "jsonb",
          tags: "other",
          external_id: "uuid",
          created_at: "temporal",
        });
        expect(
          columns.find((column) => column.name === "contact_email")?.typeName,
        ).toBe("email_text");
      });

      it("exports the active filter, projection and sort without pagination", async () => {
        const { exportData } = await import("@/main/table-data-export");
        const directory = createTempDir("pg-compass-dsl-export-");
        const filePath = path.join(directory, "users.csv");
        const sender = { send: () => undefined } as unknown as WebContents;

        const result = await exportData(
          {
            connectionId,
            format: "csv",
            filePath,
            schema: "app",
            table: "users",
            query: {
              ...NO_QUERY,
              filter: "role = 'admin' AND id <= 30",
              projection: "id, display_name AS name",
              sort: "id DESC",
            },
          },
          sender,
        );

        expect(result.rowCount).toBe(10);
        const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
        expect(lines[0]).toBe("id,name");
        expect(lines[1]).toBe("30,User 30");
        expect(lines).toHaveLength(11);
      });

      it("exports only the Skip/Limit window, with excluded columns dropped", async () => {
        const { exportData } = await import("@/main/table-data-export");
        const directory = createTempDir("pg-compass-dsl-export-");
        const filePath = path.join(directory, "users.json");
        const sender = { send: () => undefined } as unknown as WebContents;

        const result = await exportData(
          {
            connectionId,
            format: "json",
            filePath,
            schema: "app",
            table: "users",
            query: {
              ...NO_QUERY,
              filter: "id > 60",
              projection: "-profile",
              sort: "id",
              skip: "10",
              limit: "3",
            },
          },
          sender,
        );

        expect(result.rowCount).toBe(3);
        const exported = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
          id: number;
        }[];
        expect(exported.map((row) => row.id)).toEqual([71, 72, 73]);
        expect(exported[0]).not.toHaveProperty("profile");
      });

      it("rejects an invalid export query without writing a file", async () => {
        const { exportData } = await import("@/main/table-data-export");
        const directory = createTempDir("pg-compass-dsl-export-");
        const filePath = path.join(directory, "users.csv");
        const sender = { send: () => undefined } as unknown as WebContents;

        await expectDslFailure(
          exportData(
            {
              connectionId,
              format: "csv",
              filePath,
              schema: "app",
              table: "users",
              query: { ...NO_QUERY, projection: "id, missing" },
            },
            sender,
          ),
          { field: "projection", code: "unknown-column" },
        );
        expect(fs.readdirSync(directory)).toEqual([]);
      });

      it("fails closed when the filtered column was dropped after preview", async () => {
        await resetDeleteTarget();
        const { withPoolClient } = await import("@/main/pg-utils");
        const { deleteRows } = await import("@/main/table-data-write");
        await withPoolClient(connectionId, async (client) => {
          await client.query(
            "ALTER TABLE app.delete_target ADD COLUMN flag BOOLEAN",
          );
          await client.query("ALTER TABLE app.delete_target DROP COLUMN flag");
        });

        await expectDslFailure(
          deleteRows({
            connectionId,
            schema: "app",
            table: "delete_target",
            filter: "flag = TRUE",
          }),
          { field: "filter", code: "unknown-column" },
        );
        expect(await countDeleteTarget()).toBe(5);
      });

      it("refuses to delete from a view", async () => {
        const { deleteRows } = await import("@/main/table-data-write");
        await expect(
          deleteRows({
            connectionId,
            schema: "app",
            table: "active_users",
            filter: "id = 1",
          }),
        ).rejects.toThrow(/only tables/i);
        const users = await usersQuery({ filter: "id = 1" });
        expect(users.totalCount).toBe(1);
      });

      it.each([
        "'; DROP TABLE users; --",
        "1 OR TRUE",
        "name); DELETE FROM users; --",
        `"name""; DROP TABLE users; --"`,
        "pg_sleep(10)",
        "(SELECT secret FROM credentials)",
      ])(
        "treats %s as a DSL error or a parameter in every field",
        async (payload) => {
          await resetDeleteTarget();
          const { getRows } = await import("@/main/table-data-rows");
          const { deleteRows } = await import("@/main/table-data-write");
          const attempts = [
            { ...NO_QUERY, filter: payload },
            { ...NO_QUERY, filter: `category = ${payload}` },
            {
              ...NO_QUERY,
              filter: `category = '${payload.replaceAll("'", "''")}'`,
            },
            { ...NO_QUERY, projection: payload },
            { ...NO_QUERY, sort: payload },
          ];
          for (const query of attempts) {
            const outcome = await getRows({
              connectionId,
              schema: "app",
              table: "delete_target",
              page: 1,
              pageSize: 25,
              query,
            }).then(
              (result) => result,
              (err: unknown) => err as Error,
            );
            if (!(outcome instanceof Error)) {
              // Only the quoted-value attempt may succeed: the payload was a value.
              expect(outcome.totalCount).toBe(0);
            }
          }
          await deleteRows({
            connectionId,
            schema: "app",
            table: "delete_target",
            filter: `category = '${payload.replaceAll("'", "''")}'`,
          });
          await deleteRows({
            connectionId,
            schema: "app",
            table: "delete_target",
            filter: payload,
          }).catch(() => undefined);
          expect(await countDeleteTarget()).toBe(5);
        },
      );
    });

    // -----------------------------------------------------------------------
    // Foreign-key metadata + searchForeignKey
    // -----------------------------------------------------------------------

    describe("foreign-key metadata", () => {
      it("attaches a single-column FK ref to the child column with a label heuristic match", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "orders",
          page: 1,
          pageSize: 1,
          query: NO_QUERY,
        });
        const userIdCol = result.columns.find((c) => c.name === "user_id");
        expect(userIdCol?.foreignKey).toEqual({
          schema: "app",
          table: "users",
          column: "id",
          labelColumn: "display_name",
          valuePgCast: "int4",
        });
      });

      it("returns labelColumn = null when no candidate matches the heuristic", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "order_items",
          page: 1,
          pageSize: 1,
          query: NO_QUERY,
        });
        const fkCol = result.columns.find((c) => c.name === "order_id");
        expect(fkCol?.foreignKey).toEqual({
          schema: "app",
          table: "orders",
          column: "id",
          labelColumn: null,
          valuePgCast: "int4",
        });
      });

      it("does not attach FK metadata to non-FK columns", async () => {
        const { getRows } = await import("@/main/table-data-rows");
        const result = await getRows({
          connectionId,
          schema: "app",
          table: "users",
          page: 1,
          pageSize: 1,
          query: NO_QUERY,
        });
        for (const col of result.columns) {
          expect(col.foreignKey).toBeUndefined();
        }
      });
    });

    describe("searchForeignKey", () => {
      it("returns options with both value and label when a label column is set", async () => {
        const { searchForeignKey } = await import("@/main/table-data-fk");
        const result = await searchForeignKey({
          connectionId,
          schema: "app",
          table: "users",
          valueColumn: "id",
          labelColumn: "display_name",
          query: "",
          limit: 10,
        });
        expect(result.options.length).toBe(10);
        expect(result.options[0]).toMatchObject({
          value: expect.any(Number),
          label: expect.any(String),
        });
        expect(result.hasMore).toBe(true);
      });

      it("filters by label column substring when a query is provided", async () => {
        const { searchForeignKey } = await import("@/main/table-data-fk");
        const result = await searchForeignKey({
          connectionId,
          schema: "app",
          table: "users",
          valueColumn: "id",
          labelColumn: "display_name",
          query: "User 12",
          limit: 50,
        });
        // Matches: "User 12", "User 120", "User 121"... but seeds stop at 120,
        // so { 12, 120 } — only label-substring matches that include "User 12".
        const labels = result.options.map((o) => o.label);
        expect(labels).toEqual(expect.arrayContaining(["User 12", "User 120"]));
        for (const opt of result.options) {
          expect(String(opt.label)).toContain("User 12");
        }
      });

      it("also matches the value column as text when query is non-empty", async () => {
        const { searchForeignKey } = await import("@/main/table-data-fk");
        const result = await searchForeignKey({
          connectionId,
          schema: "app",
          table: "users",
          valueColumn: "id",
          labelColumn: "display_name",
          query: "42",
          limit: 50,
        });
        const values = result.options.map((o) => Number(o.value));
        expect(values).toContain(42);
      });

      it("returns label = null when no label column is provided", async () => {
        const { searchForeignKey } = await import("@/main/table-data-fk");
        const result = await searchForeignKey({
          connectionId,
          schema: "app",
          table: "users",
          valueColumn: "id",
          labelColumn: null,
          query: "",
          limit: 5,
        });
        expect(result.options.every((o) => o.label === null)).toBe(true);
        expect(result.options.length).toBe(5);
      });

      it("clamps limit to at most 200 (reads limit + 1 to detect more)", async () => {
        const { searchForeignKey } = await import("@/main/table-data-fk");
        const result = await searchForeignKey({
          connectionId,
          schema: "app",
          table: "users",
          valueColumn: "id",
          labelColumn: null,
          query: "",
          limit: 999_999,
        });
        // With 120 rows and a clamp at 200, we see all 120 and hasMore = false.
        expect(result.options.length).toBe(120);
        expect(result.hasMore).toBe(false);
      });

      it("rejects identifier injection through the schema/table/column", async () => {
        const { searchForeignKey } = await import("@/main/table-data-fk");
        await expect(
          searchForeignKey({
            connectionId,
            schema: "app",
            table: 'users"; DROP TABLE app.users; --',
            valueColumn: "id",
            labelColumn: null,
            query: "",
            limit: 5,
          }),
        ).rejects.toThrow();

        // Original table still intact.
        const { getRows } = await import("@/main/table-data-rows");
        const rows = await getRows({
          connectionId,
          schema: "app",
          table: "users",
          page: 1,
          pageSize: 1,
          query: NO_QUERY,
        });
        expect(rows.totalCount).toBeGreaterThan(0);
      });
    });

    // -----------------------------------------------------------------------
    // insertRow
    // -----------------------------------------------------------------------

    describe("insertRow", () => {
      async function countRows(schema: string, table: string): Promise<number> {
        const { withPoolClient } = await import("@/main/pg-utils");
        const { quoteIdent } = await import("@/main/pg-utils");
        return withPoolClient(connectionId, async (c) => {
          const r = await c.query<{ count: string }>(
            `SELECT count(*) AS count FROM ${quoteIdent(schema)}.${quoteIdent(table)}`,
          );
          return Number.parseInt(r.rows[0]!.count, 10);
        });
      }

      it("inserts a row and returns it via RETURNING *", async () => {
        const { insertRow } = await import("@/main/table-data-write");
        const before = await countRows("app", "notes");
        const result = await insertRow({
          connectionId,
          schema: "app",
          table: "notes",
          changes: [
            {
              column: "body",
              pgCast: "text",
              newValue: "integration insert",
              setNull: false,
            },
          ],
        });
        expect(result.row["body"]).toBe("integration insert");
        expect(result.row["created_at"]).toBeDefined();
        expect(await countRows("app", "notes")).toBe(before + 1);
      });

      it("omits untouched columns so defaults and serials apply", async () => {
        const { insertRow } = await import("@/main/table-data-write");
        const result = await insertRow({
          connectionId,
          schema: "app",
          table: "users",
          changes: [
            {
              column: "email",
              pgCast: "text",
              newValue: "insert-defaults@example.com",
              setNull: false,
            },
            {
              column: "display_name",
              pgCast: "text",
              newValue: "Inserted User",
              setNull: false,
            },
          ],
        });
        expect(typeof result.row["id"]).toBe("number");
        expect(result.row["status"]).toBe("active"); // column default
        expect(result.row["role"]).toBe("viewer"); // column default
      });

      it("emits DEFAULT VALUES for an empty change set (surfaces NOT NULL)", async () => {
        const { insertRow } = await import("@/main/table-data-write");
        // app.notes.body is NOT NULL without a default, so DEFAULT VALUES must
        // reach Postgres and fail there — proving the branch runs.
        await expect(
          insertRow({
            connectionId,
            schema: "app",
            table: "notes",
            changes: [],
          }),
        ).rejects.toThrow(/null|violates/i);
      });

      it("rejects a duplicate column in the change set", async () => {
        const { insertRow } = await import("@/main/table-data-write");
        await expect(
          insertRow({
            connectionId,
            schema: "app",
            table: "notes",
            changes: [
              { column: "body", pgCast: "text", newValue: "a", setNull: false },
              { column: "body", pgCast: "text", newValue: "b", setNull: false },
            ],
          }),
        ).rejects.toThrow(/duplicate/i);
      });

      it("rejects inserts when read-only mode is on", async () => {
        const { insertRow } = await import("@/main/table-data-write");
        const { updateSettings } = await import("@/main/settings-store");
        updateSettings({ general: { readOnlyMode: true } });
        try {
          await expect(
            insertRow({
              connectionId,
              schema: "app",
              table: "notes",
              changes: [
                {
                  column: "body",
                  pgCast: "text",
                  newValue: "nope",
                  setNull: false,
                },
              ],
            }),
          ).rejects.toThrow(/read-only/i);
        } finally {
          updateSettings({ general: { readOnlyMode: false } });
        }
      });

      it("surfaces a UNIQUE violation", async () => {
        const { insertRow } = await import("@/main/table-data-write");
        await insertRow({
          connectionId,
          schema: "app",
          table: "users",
          changes: [
            {
              column: "email",
              pgCast: "text",
              newValue: "dup-insert@example.com",
              setNull: false,
            },
            {
              column: "display_name",
              pgCast: "text",
              newValue: "First",
              setNull: false,
            },
          ],
        });
        await expect(
          insertRow({
            connectionId,
            schema: "app",
            table: "users",
            changes: [
              {
                column: "email",
                pgCast: "text",
                newValue: "dup-insert@example.com",
                setNull: false,
              },
              {
                column: "display_name",
                pgCast: "text",
                newValue: "Second",
                setNull: false,
              },
            ],
          }),
        ).rejects.toThrow(/unique|duplicate key|violates/i);
      });

      it("quotes a hostile column name and leaves the table intact", async () => {
        const { insertRow } = await import("@/main/table-data-write");
        const before = await countRows("app", "injection_target");
        const result = await insertRow({
          connectionId,
          schema: "app",
          table: "injection_target",
          changes: [
            {
              column: 'evil"col; DROP TABLE x; --',
              pgCast: "text",
              newValue: "safe-value",
              setNull: false,
            },
          ],
        });
        expect(result.row['evil"col; DROP TABLE x; --']).toBe("safe-value");
        expect(await countRows("app", "injection_target")).toBe(before + 1);
      });
    });

    // -----------------------------------------------------------------------
    // importData (CSV / JSON → INSERT, one transaction)
    // -----------------------------------------------------------------------

    describe("importData", () => {
      const noopSender = { send: () => undefined } as unknown as WebContents;
      let importDir = "";

      function writeImportFile(name: string, content: string): string {
        importDir ||= createTempDir(`pg-compass-${label}-import-`);
        const filePath = path.join(importDir, name);
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
      }

      async function countRows(schema: string, table: string): Promise<number> {
        const { withPoolClient, quoteIdent } = await import("@/main/pg-utils");
        return withPoolClient(connectionId, async (c) => {
          const r = await c.query<{ count: string }>(
            `SELECT count(*) AS count FROM ${quoteIdent(schema)}.${quoteIdent(table)}`,
          );
          return Number.parseInt(r.rows[0]!.count, 10);
        });
      }

      it("imports a CSV file into a table", async () => {
        const { importData } = await import("@/main/table-data-import");
        const before = await countRows("app", "notes");
        const filePath = writeImportFile(
          "notes.csv",
          'body\n"first, with comma"\n"second\nwith newline"\n',
        );
        const result = await importData(
          {
            connectionId,
            schema: "app",
            table: "notes",
            filePath,
            format: "csv",
            operationId: "csv-happy",
          },
          noopSender,
        );
        expect(result.insertedCount).toBe(2);
        expect(await countRows("app", "notes")).toBe(before + 2);
      });

      it("imports a JSON array of objects", async () => {
        const { importData } = await import("@/main/table-data-import");
        const before = await countRows("app", "notes");
        const filePath = writeImportFile(
          "notes.json",
          JSON.stringify([{ body: "json-a" }, { body: "json-b" }]),
        );
        const result = await importData(
          {
            connectionId,
            schema: "app",
            table: "notes",
            filePath,
            format: "json",
            operationId: "json-happy",
          },
          noopSender,
        );
        expect(result.insertedCount).toBe(2);
        expect(await countRows("app", "notes")).toBe(before + 2);
      });

      it("imports a single top-level JSON object", async () => {
        const { importData } = await import("@/main/table-data-import");
        const before = await countRows("app", "notes");
        const filePath = writeImportFile(
          "single-note.json",
          JSON.stringify({ body: "single-json-row" }),
        );
        const result = await importData(
          {
            connectionId,
            schema: "app",
            table: "notes",
            filePath,
            format: "json",
            operationId: "json-single",
          },
          noopSender,
        );
        expect(result.insertedCount).toBe(1);
        expect(await countRows("app", "notes")).toBe(before + 1);
      });

      it("preserves bigint precision during a streamed JSON import", async () => {
        const { importData } = await import("@/main/table-data-import");
        const { withPoolClient } = await import("@/main/pg-utils");
        const filePath = writeImportFile(
          "precise.json",
          '[{"email":"precise-import@example.com","display_name":"Precise Import","balance_cents":9007199254740993}]',
        );
        await importData(
          {
            connectionId,
            schema: "app",
            table: "users",
            filePath,
            format: "json",
            operationId: "precise-number",
          },
          noopSender,
        );
        const stored = await withPoolClient(connectionId, async (client) =>
          client.query<{ balance_cents: string }>(
            "SELECT balance_cents::text AS balance_cents FROM app.users WHERE email = $1",
            ["precise-import@example.com"],
          ),
        );
        expect(stored.rows[0]!.balance_cents).toBe("9007199254740993");
      });

      it("rolls back every batch when a later batch violates a constraint", async () => {
        const { importData } = await import("@/main/table-data-import");
        const before = await countRows("app", "notes");
        const unhandledRejections: unknown[] = [];
        const onUnhandledRejection = (reason: unknown) => {
          unhandledRejections.push(reason);
        };
        process.on("unhandledRejection", onUnhandledRejection);
        // 1500 rows span two batches (batch size 1000 for one column). The bad
        // NULL body sits in the second batch, so a rollback must also wipe the
        // first, already-inserted batch.
        const rows: { body: string | null }[] = Array.from(
          { length: 1_500 },
          (_, i) => ({ body: `row-${String(i)}` }),
        );
        rows[1_200] = { body: null };
        const filePath = writeImportFile("bad.json", JSON.stringify(rows));
        try {
          await expect(
            importData(
              {
                connectionId,
                schema: "app",
                table: "notes",
                filePath,
                format: "json",
                operationId: "rollback",
              },
              noopSender,
            ),
          ).rejects.toThrow(/null|violates/i);
          await new Promise<void>((resolve) => setImmediate(resolve));
        } finally {
          process.off("unhandledRejection", onUnhandledRejection);
        }
        expect(await countRows("app", "notes")).toBe(before);
        expect(unhandledRejections).toEqual([]);
      });

      it("commits a large import across multiple batches atomically", async () => {
        const { importData } = await import("@/main/table-data-import");
        const before = await countRows("app", "notes");
        const rows = Array.from({ length: 2_500 }, (_, i) => ({
          body: `bulk-${String(i)}`,
        }));
        const filePath = writeImportFile("bulk.json", JSON.stringify(rows));
        const result = await importData(
          {
            connectionId,
            schema: "app",
            table: "notes",
            filePath,
            format: "json",
            operationId: "large",
          },
          noopSender,
        );
        expect(result.insertedCount).toBe(2_500);
        expect(await countRows("app", "notes")).toBe(before + 2_500);
      });

      it("treats a header-only CSV as zero rows", async () => {
        const { importData } = await import("@/main/table-data-import");
        const before = await countRows("app", "notes");
        const filePath = writeImportFile("header-only.csv", "body\n");
        const result = await importData(
          {
            connectionId,
            schema: "app",
            table: "notes",
            filePath,
            format: "csv",
            operationId: "header-only",
          },
          noopSender,
        );
        expect(result.insertedCount).toBe(0);
        expect(await countRows("app", "notes")).toBe(before);
      });

      it("rejects an empty CSV file", async () => {
        const { importData } = await import("@/main/table-data-import");
        const filePath = writeImportFile("empty.csv", "");
        await expect(
          importData(
            {
              connectionId,
              schema: "app",
              table: "notes",
              filePath,
              format: "csv",
              operationId: "empty",
            },
            noopSender,
          ),
        ).rejects.toThrow(/empty/i);
      });

      it("rejects imports when read-only mode is on", async () => {
        const { importData } = await import("@/main/table-data-import");
        const { updateSettings } = await import("@/main/settings-store");
        const filePath = writeImportFile(
          "ro.json",
          JSON.stringify([{ body: "x" }]),
        );
        updateSettings({ general: { readOnlyMode: true } });
        try {
          await expect(
            importData(
              {
                connectionId,
                schema: "app",
                table: "notes",
                filePath,
                format: "json",
                operationId: "read-only",
              },
              noopSender,
            ),
          ).rejects.toThrow(/read-only/i);
        } finally {
          updateSettings({ general: { readOnlyMode: false } });
        }
      });

      it("quotes a hostile CSV header and leaves the table intact", async () => {
        const { importData } = await import("@/main/table-data-import");
        const before = await countRows("app", "injection_target");
        // The header names the real (quoted) column; the comma/quotes force CSV
        // quoting, and quoteIdent must keep the identifier safe.
        const filePath = writeImportFile(
          "inject.csv",
          '"evil""col; DROP TABLE x; --"\nsafe-import\n',
        );
        const result = await importData(
          {
            connectionId,
            schema: "app",
            table: "injection_target",
            filePath,
            format: "csv",
            operationId: "hostile-header",
          },
          noopSender,
        );
        expect(result.insertedCount).toBe(1);
        expect(await countRows("app", "injection_target")).toBe(before + 1);
      });
    });

    // -----------------------------------------------------------------------
    // Roles (pooled-connection mutations only: PGlite serves one socket)
    // -----------------------------------------------------------------------

    describe("roles management", () => {
      const roleSuffix = Date.now().toString(36);
      const loginRole = `pgc_login_${roleSuffix}`;
      const noPasswordRole = `pgc_nopass_${roleSuffix}`;
      const failedRole = `pgc failed "${roleSuffix}"`;
      const cloneRoleName = `pgc_clone_${roleSuffix}`;
      const parentRole = `pgc_parent_${roleSuffix}`;

      async function queryRole<T>(
        sql: string,
        params: unknown[],
      ): Promise<T | undefined> {
        const { withPoolClient } = await import("@/main/pg-utils");
        return withPoolClient(connectionId, async (client) => {
          const result = await client.query(sql, params);
          return result.rows[0] as T | undefined;
        });
      }

      afterAll(async () => {
        const { withPoolClient, quoteIdent } = await import("@/main/pg-utils");
        await withPoolClient(connectionId, async (client) => {
          for (const role of [
            cloneRoleName,
            loginRole,
            noPasswordRole,
            failedRole,
            parentRole,
          ]) {
            await client.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`);
          }
        });
      });

      it("creates a role with a SCRAM verifier instead of the plaintext password", async () => {
        const { createRole } = await import("@/main/roles-mutations");
        const { buildScramSha256Verifier } =
          await import("@/main/scram-verifier");
        await createRole({
          connectionId,
          name: parentRole,
          login: false,
        });
        await createRole({
          connectionId,
          name: loginRole,
          login: true,
          password: "pencil",
          membershipRoles: [parentRole],
        });

        const row = await queryRole<{ rolpassword: string }>(
          "SELECT rolpassword FROM pg_authid WHERE rolname = $1",
          [loginRole],
        );
        const stored = row?.rolpassword ?? "";
        expect(stored).toMatch(/^SCRAM-SHA-256\$4096:/);
        const saltBase64 = stored.split("$")[1]!.split(":")[1]!;
        expect(
          buildScramSha256Verifier("pencil", Buffer.from(saltBase64, "base64")),
        ).toBe(stored);
      });

      it("reports hasPassword from pg_authid for superuser connections", async () => {
        const { createRole } = await import("@/main/roles-mutations");
        const { buildSidebarSummary } = await import("@/main/roles-queries");
        await createRole({ connectionId, name: noPasswordRole, login: true });

        const summary = await buildSidebarSummary(connectionId);
        const byName = new Map(summary.roles.map((role) => [role.name, role]));
        expect(summary.currentUser.isSuperuser).toBe(true);
        expect(byName.get(loginRole)?.hasPassword).toBe(true);
        expect(byName.get(noPasswordRole)?.hasPassword).toBe(false);
      });

      it("rolls back CREATE ROLE when a membership grant fails", async () => {
        const { createRole } = await import("@/main/roles-mutations");
        await expect(
          createRole({
            connectionId,
            name: failedRole,
            login: true,
            password: "secret",
            membershipRoles: [`pgc_missing_${roleSuffix}`],
          }),
        ).rejects.toThrow(/does not exist/);

        const row = await queryRole<{ count: number }>(
          "SELECT count(*)::int AS count FROM pg_roles WHERE rolname = $1",
          [failedRole],
        );
        expect(row?.count).toBe(0);
      });

      it("applies alterRole atomically", async () => {
        const { alterRole } = await import("@/main/roles-mutations");
        await expect(
          alterRole({
            connectionId,
            name: loginRole,
            login: false,
            validUntil: "not a timestamp",
          }),
        ).rejects.toThrow();
        const unchanged = await queryRole<{ rolcanlogin: boolean }>(
          "SELECT rolcanlogin FROM pg_roles WHERE rolname = $1",
          [loginRole],
        );
        expect(unchanged?.rolcanlogin).toBe(true);

        await alterRole({
          connectionId,
          name: loginRole,
          login: false,
          password: null,
        });
        const changed = await queryRole<{
          rolcanlogin: boolean;
          rolpassword: string | null;
        }>(
          "SELECT rolcanlogin, rolpassword FROM pg_authid WHERE rolname = $1",
          [loginRole],
        );
        expect(changed).toEqual({ rolcanlogin: false, rolpassword: null });
      });

      it("clones a role together with its memberships", async () => {
        const { cloneRole } = await import("@/main/roles-mutations");
        const { fetchMemberships } = await import("@/main/roles-queries");
        const { withPoolClient } = await import("@/main/pg-utils");
        await cloneRole({
          connectionId,
          sourceName: loginRole,
          newName: cloneRoleName,
        });

        const memberships = await withPoolClient(connectionId, (client) =>
          fetchMemberships(client, cloneRoleName),
        );
        expect(memberships.map((m) => m.parentName)).toEqual([parentRole]);
      });
    });
  });
}
