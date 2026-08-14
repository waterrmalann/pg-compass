/** What each PostgreSQL predefined (pg_*) role, plus the default "postgres" superuser, grants. */
export const BUILTIN_ROLE_DESCRIPTIONS: Record<string, string> = {
  postgres: "Default superuser role created when the cluster is initialized.",
  pg_read_all_data:
    "Read all data (tables, views, sequences) as if granted SELECT on every object, plus USAGE on every schema.",
  pg_write_all_data:
    "Write all data (tables, views, sequences) as if granted INSERT/UPDATE/DELETE on every object, plus USAGE on every schema.",
  pg_read_all_settings:
    "Read all configuration settings, including ones normally visible only to superusers.",
  pg_read_all_stats:
    "Read all pg_stat_* views and statistics-related extensions, including ones normally visible only to superusers.",
  pg_stat_scan_tables:
    "Run monitoring functions that may take ACCESS SHARE locks on tables, potentially for a long time.",
  pg_monitor:
    "Read/execute monitoring views and functions. Includes pg_read_all_settings, pg_read_all_stats, and pg_stat_scan_tables.",
  pg_database_owner:
    "Placeholder membership held by whoever owns the current database.",
  pg_signal_backend:
    "Send signals (cancel/terminate) to other backends, except those started by superusers.",
  pg_read_server_files:
    "Read files on the database server via COPY and related server-side file-access functions.",
  pg_write_server_files:
    "Write files on the database server via COPY and related server-side file-access functions.",
  pg_execute_server_program:
    "Execute server-side programs via COPY and related functions that run a program on the server.",
  pg_checkpoint: "Run the CHECKPOINT command.",
  pg_use_reserved_connections:
    "Use connection slots reserved via the reserved_connections setting.",
  pg_create_subscription: "Create logical replication subscriptions.",
};
