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
 * Loads catalog metadata with `client` (inside the caller's transaction),
 * binds the parsed query against it and compiles SQL fragments.
 */
export async function bindAndCompile(
  client: PoolClient,
  schema: string,
  table: string,
  ast: DataQueryAst,
): Promise<PreparedDataQuery> {
  const metadata = await loadRelationMetadata(client, schema, table);
  const bound = bindDataQuery(ast, metadata.columns);
  if (!bound.ok) throw new QueryDslFailure(bound.errors);
  return {
    metadata,
    compiled: compileDataQuery(
      bound.value,
      metadata.primaryKey,
      `${quoteIdent(schema)}.${quoteIdent(table)}`,
    ),
  };
}
