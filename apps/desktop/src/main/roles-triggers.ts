import type {
  PgTriggerInfo,
  SetTriggerEnabledInput,
} from "../shared/types/roles";
import { withDatabaseClient } from "./pg-utils";
import { requireSuperuser } from "./roles-queries";
import { setTriggerEnabledOnClient } from "./table-data-meta";

interface PgTriggerRow {
  schema_name: string;
  table_name: string;
  trigger_name: string;
  timing: string;
  events: string;
  function_name: string;
  function_schema: string;
  enabled_mode: PgTriggerInfo["enabledMode"];
  orientation: string;
}

/** Every user trigger in `database` (superuser only). */
export async function listTriggers(
  connectionId: string,
  database: string,
): Promise<PgTriggerInfo[]> {
  return withDatabaseClient(connectionId, database, async (client) => {
    await requireSuperuser(client);
    const result = await client.query<PgTriggerRow>(`
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        t.tgname AS trigger_name,
        -- tgtype bits: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16,
        -- TRUNCATE=32, INSTEAD=64. AFTER is neither BEFORE nor INSTEAD.
        CASE
          WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF'
          WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE'
          ELSE 'AFTER'
        END AS timing,
        concat_ws(',',
          CASE WHEN (t.tgtype & 4) <> 0 THEN 'INSERT' END,
          CASE WHEN (t.tgtype & 8) <> 0 THEN 'DELETE' END,
          CASE WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE' END,
          CASE WHEN (t.tgtype & 32) <> 0 THEN 'TRUNCATE' END
        ) AS events,
        p.proname AS function_name,
        pn.nspname AS function_schema,
        CASE t.tgenabled
          WHEN 'O' THEN 'origin'
          WHEN 'D' THEN 'disabled'
          WHEN 'R' THEN 'replica'
          WHEN 'A' THEN 'always'
          ELSE 'origin'
        END AS enabled_mode,
        CASE WHEN (t.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END
          AS orientation
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
      WHERE NOT t.tgisinternal
      ORDER BY n.nspname, c.relname, t.tgname
    `);
    return result.rows.map((row) => ({
      schemaName: row.schema_name,
      tableName: row.table_name,
      triggerName: row.trigger_name,
      timing: row.timing,
      events: row.events,
      functionName: row.function_name,
      functionSchema: row.function_schema,
      enabled: row.enabled_mode !== "disabled",
      enabledMode: row.enabled_mode,
      orientation: row.orientation,
    }));
  });
}

/**
 * Toggles a trigger in `databaseName` using the same existence check and
 * quoting as the table viewer's trigger toggle.
 */
export async function setTriggerEnabled(
  input: SetTriggerEnabledInput,
): Promise<void> {
  await withDatabaseClient(
    input.connectionId,
    input.databaseName,
    async (client) => {
      await requireSuperuser(client);
      await setTriggerEnabledOnClient(client, {
        schema: input.schemaName,
        table: input.tableName,
        trigger: input.triggerName,
        enabled: input.enabled,
      });
    },
  );
}
