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
  GET_QUERY_COLUMNS: "table-data:get-query-columns",
  GET_JSON_KEYS: "table-data:get-json-keys",
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
  PREVIEW_QUERY_SQL: "table-data:preview-query-sql",
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

export const UpdateChannels = {
  GET_STATUS: "updates:get-status",
  INSTALL: "updates:install",
  STATUS_CHANGED: "updates:status-changed",
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
  ALTER_ROLE_PASSWORD: "roles:alter-role-password",
  ALTER_ROLE_COMMENT: "roles:alter-role-comment",
  SET_DB_ACCESS_LEVEL: "roles:set-db-access-level",
  SET_TABLE_RESTRICTIONS: "roles:set-table-restrictions",
  CLONE_ROLE: "roles:clone-role",
  RENAME_ROLE: "roles:rename-role",
  LIST_TRIGGERS: "roles:list-triggers",
  SET_TRIGGER_ENABLED: "roles:set-trigger-enabled",
  GET_EFFECTIVE_PERMISSIONS: "roles:get-effective-permissions",
  GET_AUDIT_LOG: "roles:get-audit-log",
  CLEAR_AUDIT_LOG: "roles:clear-audit-log",
} as const;

export const BackupChannels = {
  LIST_DATABASES: "backup:list-databases",
  CANCEL: "backup:cancel",
  PROGRESS: "backup:progress",
  LIST_BACKUPS: "backup:list-backups",
  BACKUP: "backup:create",
  RESTORE: "backup:restore",
  SHOW_RESTORE_FILE_DIALOG: "backup:show-restore-file-dialog",
  DELETE_BACKUP: "backup:delete",
  INSPECT_BACKUP: "backup:inspect",
} as const;

export const ShellChannels = {
  LOCATE_PSQL: "shell:locate-psql",
  START: "shell:start",
  WRITE: "shell:write",
  RESIZE: "shell:resize",
  KILL: "shell:kill",
  DATA: "shell:data",
  EXIT: "shell:exit",
} as const;
