import type { ClientBase } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/main/pg-utils", () => ({
  withPoolClient: vi.fn(),
}));

import { withPoolClient } from "@/main/pg-utils";
import {
  getSchemaDiagram,
  groupDiagramTables,
  loadSchemaDiagram,
} from "@/main/schema-diagram";

function columnRow(
  table: string,
  column: string | null,
  overrides: Partial<{
    data_type: string;
    not_null: boolean;
    is_primary_key: boolean;
    is_unique: boolean;
  }> = {},
) {
  return {
    schema_name: "app",
    table_name: table,
    column_name: column,
    data_type: column === null ? null : "integer",
    not_null: column === null ? null : true,
    is_primary_key: false,
    is_unique: false,
    ...overrides,
  };
}

/** Records every statement and answers the two catalog queries. */
function createFakeClient(options: { failOn?: RegExp } = {}) {
  const statements: string[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    statements.push(text.trim().split("\n")[0]!.trim());
    if (options.failOn?.test(text)) throw new Error("catalog failed");
    if (text.includes("FROM pg_class c")) {
      expect(values).toEqual([["app"]]);
      return { rows: [columnRow("users", "id", { is_primary_key: true })] };
    }
    if (text.includes("FROM pg_constraint con")) {
      return {
        rows: [
          {
            name: "orders_user_id_fkey",
            source_schema: "app",
            source_table: "orders",
            source_columns: ["user_id"],
            target_schema: "app",
            target_table: "users",
            target_columns: ["id"],
          },
        ],
      };
    }
    return { rows: [] };
  });
  // pg's overloaded `query` type cannot be met by a plain mock.
  const client = { query } as unknown as Pick<ClientBase, "query">;
  return { client, statements, query };
}

describe("groupDiagramTables", () => {
  it("groups ordered column rows into tables and maps column flags", () => {
    const tables = groupDiagramTables([
      columnRow("orders", "id", { is_primary_key: true, is_unique: true }),
      columnRow("orders", "note", { data_type: "text", not_null: false }),
      columnRow("users", "email", { data_type: "text", is_unique: true }),
    ]);

    expect(tables).toEqual([
      {
        schema: "app",
        name: "orders",
        columns: [
          {
            name: "id",
            dataType: "integer",
            isNullable: false,
            isPrimaryKey: true,
            isUnique: true,
          },
          {
            name: "note",
            dataType: "text",
            isNullable: true,
            isPrimaryKey: false,
            isUnique: false,
          },
        ],
      },
      {
        schema: "app",
        name: "users",
        columns: [
          {
            name: "email",
            dataType: "text",
            isNullable: false,
            isPrimaryKey: false,
            isUnique: true,
          },
        ],
      },
    ]);
  });

  it("keeps a table without columns as an empty table", () => {
    expect(groupDiagramTables([columnRow("empty_shell", null)])).toEqual([
      { schema: "app", name: "empty_shell", columns: [] },
    ]);
  });

  it("starts a new table when only the schema changes", () => {
    const tables = groupDiagramTables([
      columnRow("items", "id"),
      { ...columnRow("items", "id"), schema_name: "archive" },
    ]);
    expect(tables.map((table) => `${table.schema}.${table.name}`)).toEqual([
      "app.items",
      "archive.items",
    ]);
  });
});

describe("loadSchemaDiagram", () => {
  it("reads the catalog in one read-only transaction with a timeout", async () => {
    const { client, statements } = createFakeClient();

    const diagram = await loadSchemaDiagram(client, ["app"]);

    expect(statements).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = '15s'",
      "SELECT",
      "SELECT",
      "ROLLBACK",
    ]);
    expect(diagram.tables).toHaveLength(1);
    expect(diagram.foreignKeys).toEqual([
      {
        name: "orders_user_id_fkey",
        sourceSchema: "app",
        sourceTable: "orders",
        sourceColumns: ["user_id"],
        targetSchema: "app",
        targetTable: "users",
        targetColumns: ["id"],
      },
    ]);
  });

  it("never touches table data, sizes or information_schema", async () => {
    const { client, query } = createFakeClient();
    await loadSchemaDiagram(client, ["app"]);

    const sql = query.mock.calls.map(([text]) => text).join("\n");
    expect(sql).not.toMatch(/information_schema/i);
    expect(sql).not.toMatch(/pg_(total_)?relation_size|reltuples|count\(/i);
    // Partitions and their copied foreign keys are excluded.
    expect(sql).toMatch(/NOT c\.relispartition/);
    expect(sql).toMatch(/NOT source\.relispartition/);
    expect(sql).toMatch(/NOT target\.relispartition/);
  });

  it("rolls back and rethrows when a catalog query fails", async () => {
    const { client, statements } = createFakeClient({
      failOn: /FROM pg_constraint con/,
    });

    await expect(loadSchemaDiagram(client, ["app"])).rejects.toThrow(
      "catalog failed",
    );
    expect(statements.at(-1)).toBe("ROLLBACK");
  });
});

describe("getSchemaDiagram", () => {
  it("returns an empty diagram without connecting when no schema is asked for", async () => {
    const diagram = await getSchemaDiagram({ connectionId: "c1", schemas: [] });

    expect(diagram).toEqual({ tables: [], foreignKeys: [] });
    expect(withPoolClient).not.toHaveBeenCalled();
  });
});
