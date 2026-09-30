import type { PoolClient } from "pg";
import { bindDataQuery } from "../../shared/query-dsl/bind";
import { parseDataQuery } from "../../shared/query-dsl/parser";
import type {
  DataQueryAst,
  DataQueryInput,
  QueryDslError,
  RelationMetadata,
} from "../../shared/query-dsl/types";
import { compileDataQuery, type CompiledDataQuery } from "./compile";
import { quoteIdent } from "../pg-utils";
import { loadRelationMetadata } from "./relation-metadata";

/** A DSL syntax or binding failure, reported to the renderer as structured errors. */
export class QueryDslFailure extends Error {
  constructor(readonly errors: QueryDslError[]) {
    super(errors[0]?.message ?? "Invalid query.");
    this.name = "QueryDslFailure";
  }
}

/** Syntax-only check; runs before any database work. */
export function parseDataQueryOrThrow(input: DataQueryInput): DataQueryAst {
  const parsed = parseDataQuery(input);
  if (!parsed.ok) throw new QueryDslFailure(parsed.errors);
  return parsed.value;
}

export interface PreparedDataQuery {
  metadata: RelationMetadata;
  compiled: CompiledDataQuery;
}

/**
 * Table lock taken before the catalog is read. It conflicts with the
 * ACCESS EXCLUSIVE lock every ALTER TABLE needs, so the columns and types
 * the query was bound against can't change before the transaction ends.
 * Reads use ACCESS SHARE (what SELECT takes anyway); deletes use ROW
 * EXCLUSIVE (what DELETE takes anyway).
 */
export type RelationLockMode = "ACCESS SHARE" | "ROW EXCLUSIVE";

// LOCK TABLE refuses materialized views and foreign tables
// (wrong_object_type) and needs table-level privileges that a role with only
// column-level SELECT lacks (insufficient_privilege). Neither should stop
// the Data tab from working, so those relations fall back to the
// transaction's snapshot plus binding, as before the lock existed.
const LOCK_FALLBACK_CODES = new Set(["42809", "42501"]);

async function lockRelation(
  client: PoolClient,
  relationSql: string,
  lockMode: RelationLockMode,
): Promise<void> {
  const lockSql =
    lockMode === "ROW EXCLUSIVE" ? "ROW EXCLUSIVE" : "ACCESS SHARE";
  // A savepoint keeps a refused LOCK from aborting the caller's transaction.
  await client.query("SAVEPOINT pg_compass_relation_lock");
  try {
    await client.query(`LOCK TABLE ${relationSql} IN ${lockSql} MODE`);
    await client.query("RELEASE SAVEPOINT pg_compass_relation_lock");
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (!LOCK_FALLBACK_CODES.has(code)) throw err;
    await client.query("ROLLBACK TO SAVEPOINT pg_compass_relation_lock");
    await client.query("RELEASE SAVEPOINT pg_compass_relation_lock");
  }
}

/**
 * Locks the relation, loads its catalog metadata with `client` (inside the
 * caller's transaction), binds the parsed query against it and compiles
 * SQL fragments.
 */
export async function bindAndCompile(
  client: PoolClient,
  schema: string,
  table: string,
  ast: DataQueryAst,
  lockMode: RelationLockMode,
): Promise<PreparedDataQuery> {
  const relationSql = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  await lockRelation(client, relationSql, lockMode);
  const metadata = await loadRelationMetadata(client, schema, table);
  const bound = bindDataQuery(ast, metadata.columns);
  if (!bound.ok) throw new QueryDslFailure(bound.errors);
  return {
    metadata,
    compiled: compileDataQuery(bound.value, metadata.primaryKey, relationSql),
  };
}
