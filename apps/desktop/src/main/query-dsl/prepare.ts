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
  const lockSql =
    lockMode === "ROW EXCLUSIVE" ? "ROW EXCLUSIVE" : "ACCESS SHARE";
  await client.query(`LOCK TABLE ${relationSql} IN ${lockSql} MODE`);
  const metadata = await loadRelationMetadata(client, schema, table);
  const bound = bindDataQuery(ast, metadata.columns);
  if (!bound.ok) throw new QueryDslFailure(bound.errors);
  return {
    metadata,
    compiled: compileDataQuery(bound.value, metadata.primaryKey, relationSql),
  };
}
