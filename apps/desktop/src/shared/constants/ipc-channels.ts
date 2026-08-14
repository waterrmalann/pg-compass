export const ConnectionChannels = {
  GET_ALL: "connections:get-all",
  GET_BY_ID: "connections:get-by-id",
  CREATE: "connections:create",
  UPDATE: "connections:update",
  DELETE: "connections:delete",
  TOGGLE_FAVOURITE: "connections:toggle-favourite",
  TEST: "connections:test",
  GET_SCHEMA_TREE: "connections:get-schema-tree",
  SHOW_OPEN_FILE_DIALOG: "connections:show-open-file-dialog",
} as const;

export const SettingsChannels = {
  GET: "settings:get",
  UPDATE: "settings:update",
} as const;

export const TableDataChannels = {
  GET_ROWS: "table-data:get-rows",
  GET_STRUCTURE: "table-data:get-structure",
  GET_INDEXES: "table-data:get-indexes",
  GET_CONSTRAINTS: "table-data:get-constraints",
  GET_TRIGGERS: "table-data:get-triggers",
  GET_TYPES: "table-data:get-types",
  TOGGLE_TRIGGER: "table-data:toggle-trigger",
  EXECUTE_QUERY: "table-data:execute-query",
  CANCEL_QUERY: "table-data:cancel-query",
  SHOW_SAVE_DIALOG: "table-data:show-save-dialog",
  SHOW_OPEN_DIALOG: "table-data:show-open-dialog",
  EXPORT_DATA: "table-data:export-data",
  EXPORT_PROGRESS: "table-data:export-progress",
  SQL_DUMP: "table-data:sql-dump",
  IMPORT_DATA: "table-data:import-data",
  IMPORT_PROGRESS: "table-data:import-progress",
  INSERT_ROW: "table-data:insert-row",
  UPDATE_CELL: "table-data:update-cell",
  UPDATE_ROW: "table-data:update-row",
  DELETE_ROWS: "table-data:delete-rows",
  SEARCH_FK: "table-data:search-fk",
} as const;

export const HelpChannels = {
  SHOW_LICENSE: "help:show-license",
  SHOW_ABOUT: "help:show-about",
  SHOW_SHORTCUTS: "help:show-shortcuts",
} as const;

export const WorkspaceChannels = {
  CLOSE_TAB: "workspace:close-tab",
  NEXT_TAB: "workspace:next-tab",
  PREV_TAB: "workspace:prev-tab",
} as const;

export const ClipboardChannels = {
  WRITE_TEXT: "clipboard:write-text",
} as const;

export const RolesChannels = {
  GET_SNAPSHOT: "roles:get-snapshot",
  GET_SIDEBAR_SUMMARY: "roles:get-sidebar-summary",
  CREATE_ROLE: "roles:create-role",
  ALTER_ROLE: "roles:alter-role",
  DROP_ROLE: "roles:drop-role",
  GRANT_MEMBERSHIP: "roles:grant-membership",
  REVOKE_MEMBERSHIP: "roles:revoke-membership",
  GRANT_DB_CONNECT: "roles:grant-db-connect",
  REVOKE_DB_CONNECT: "roles:revoke-db-connect",
  GRANT_DB_READONLY: "roles:grant-db-readonly",
  REVOKE_DB_READONLY: "roles:revoke-db-readonly",
  ALTER_ROLE_PASSWORD: "roles:alter-role-password",
  ALTER_ROLE_COMMENT: "roles:alter-role-comment",
  SET_DB_ACCESS_LEVEL: "roles:set-db-access-level",
  SET_TABLE_RESTRICTIONS: "roles:set-table-restrictions",
  CLONE_ROLE: "roles:clone-role",
  RENAME_ROLE: "roles:rename-role",
  LIST_TRIGGERS: "roles:list-triggers",
  CREATE_TRIGGER: "roles:create-trigger",
  DROP_TRIGGER: "roles:drop-trigger",
  SET_TRIGGER_ENABLED: "roles:set-trigger-enabled",
  LIST_TRIGGER_FUNCTIONS: "roles:list-trigger-functions",
  CREATE_TRIGGER_FUNCTION: "roles:create-trigger-function",
  GET_EFFECTIVE_PERMISSIONS: "roles:get-effective-permissions",
  GET_AUDIT_LOG: "roles:get-audit-log",
  CLEAR_AUDIT_LOG: "roles:clear-audit-log",
} as const;

export const DbSyncChannels = {
  LIST_DATABASES: "db-sync:list-databases",
  RUN: "db-sync:run",
  CANCEL: "db-sync:cancel",
  PROGRESS: "db-sync:progress",
  GET_PROD_GUARD: "db-sync:get-prod-guard",
  SET_PROD_GUARD: "db-sync:set-prod-guard",
  LIST_BACKUPS: "db-sync:list-backups",
  BACKUP: "db-sync:backup",
  RESTORE: "db-sync:restore",
  DELETE_BACKUP: "db-sync:delete-backup",
  INSPECT_BACKUP: "db-sync:inspect-backup",
} as const;
