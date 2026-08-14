import type { ConnectionConfig } from "./types/connection";

const PROD_PATTERN = /prod/i;

function extractHost(
  connection: Pick<ConnectionConfig, "mode" | "uri" | "fields">,
): string {
  if (connection.mode === "uri" && connection.uri) {
    try {
      return new URL(connection.uri).hostname;
    } catch {
      return connection.uri;
    }
  }
  return connection.fields?.host ?? "";
}

/**
 * Flags a database as production by connection host/label or the database
 * name itself. Shared between the renderer (target-picker display/filtering)
 * and the main process (actual enforcement) so the two can't drift apart.
 */
export function looksLikeProduction(
  connection:
    | Pick<ConnectionConfig, "label" | "mode" | "uri" | "fields">
    | undefined,
  database: string,
): boolean {
  if (!connection) return false;
  return (
    PROD_PATTERN.test(connection.label) ||
    PROD_PATTERN.test(extractHost(connection)) ||
    PROD_PATTERN.test(database)
  );
}
