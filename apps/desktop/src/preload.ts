// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import {
  ClipboardChannels,
  ConnectionChannels,
  DbSyncChannels,
  HelpChannels,
  RolesChannels,
  SettingsChannels,
  TableDataChannels,
  WorkspaceChannels,
} from "./shared/constants/ipc-channels";
import type {
  BackupFileInfo,
  BackupInspection,
  DbSyncBackupInput,
  DbSyncCancelInput,
  DbSyncListDatabasesInput,
  DbSyncProdGuardState,
  DbSyncProgressEvent,
  DbSyncRestoreInput,
  DbSyncResult,
  DbSyncRunInput,
} from "./shared/types/db-sync";
import type {
  ConnectionConfig,
  ConnectionFileDialogOptions,
  ConnectionInput,
  DatabaseSchema,
  SchemaTreeOptions,
} from "./shared/types/connection";
import type {
  AlterRoleInput,
  AuditLogEntry,
  CloneRoleInput,
  CreateRoleInput,
  CreateTriggerFunctionInput,
  CreateTriggerInput,
  DbAccessInput,
  DbReadonlyGrantInput,
  DropTriggerInput,
  EffectivePermissions,
  MembershipInput,
  PgTriggerFunction,
  PgTriggerInfo,
  RenameRoleInput,
  RolesSidebarSummary,
  RolesSnapshot,
  SetDbAccessLevelInput,
  SetTriggerEnabledInput,
  TableRestrictionInput,
} from "./shared/types/roles";
import type { AppSettings, AppSettingsPatch } from "./shared/types/settings";
import type {
  ColumnStructure,
  CancelQueryParams,
  CancelQueryResult,
  ConstraintInfo,
  DeleteRowsParams,
  DeleteRowsResult,
  ExportDataParams,
  ExportResult,
  ExecuteQueryParams,
  GetRowsParams,
  ImportDataParams,
  ImportProgress,
  ImportResult,
  IndexInfo,
  InsertRowParams,
  InsertRowResult,
  OpenDialogOptions,
  SaveDialogOptions,
  SqlDumpParams,
  TableMetaParams,
  TableTypeInfo,
  TableRowsResult,
  ToggleTriggerParams,
  TriggerInfo,
  UpdateCellParams,
  UpdateCellResult,
  UpdateRowParams,
  UpdateRowResult,
  SearchForeignKeyParams,
  SearchForeignKeyResult,
} from "./shared/types/table-data";
import type {
  ClipboardApi,
  ConnectionApi,
  DbSyncApi,
  HelpApi,
  IpcResult,
  RolesApi,
  SettingsApi,
  TableDataApi,
  WorkspaceApi,
} from "./shared/types/ipc";

const connectionApi = {
  getAll: (): Promise<IpcResult<ConnectionConfig[]>> =>
    ipcRenderer.invoke(ConnectionChannels.GET_ALL),

  getById: (id: string): Promise<IpcResult<ConnectionConfig>> =>
    ipcRenderer.invoke(ConnectionChannels.GET_BY_ID, id),

  create: (input: ConnectionInput): Promise<IpcResult<ConnectionConfig>> =>
    ipcRenderer.invoke(ConnectionChannels.CREATE, input),

  update: (
    id: string,
    input: ConnectionInput,
  ): Promise<IpcResult<ConnectionConfig>> =>
    ipcRenderer.invoke(ConnectionChannels.UPDATE, id, input),

  delete: (id: string): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke(ConnectionChannels.DELETE, id),

  toggleFavourite: (id: string): Promise<IpcResult<ConnectionConfig>> =>
    ipcRenderer.invoke(ConnectionChannels.TOGGLE_FAVOURITE, id),

  test: (id: string): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke(ConnectionChannels.TEST, id),

  getSchemaTree: (
    id: string,
    options?: SchemaTreeOptions,
  ): Promise<IpcResult<DatabaseSchema[]>> =>
    ipcRenderer.invoke(ConnectionChannels.GET_SCHEMA_TREE, id, options),

  showOpenFileDialog: (
    options: ConnectionFileDialogOptions,
  ): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(ConnectionChannels.SHOW_OPEN_FILE_DIALOG, options),
} satisfies ConnectionApi;

const settingsApi = {
  get: (): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(SettingsChannels.GET),

  update: (patch: AppSettingsPatch): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(SettingsChannels.UPDATE, patch),
} satisfies SettingsApi;

const tableDataApi = {
  getRows: (params: GetRowsParams): Promise<IpcResult<TableRowsResult>> =>
    ipcRenderer.invoke(TableDataChannels.GET_ROWS, params),

  getStructure: (
    params: TableMetaParams,
  ): Promise<IpcResult<ColumnStructure[]>> =>
    ipcRenderer.invoke(TableDataChannels.GET_STRUCTURE, params),

  getIndexes: (params: TableMetaParams): Promise<IpcResult<IndexInfo[]>> =>
    ipcRenderer.invoke(TableDataChannels.GET_INDEXES, params),

  getConstraints: (
    params: TableMetaParams,
  ): Promise<IpcResult<ConstraintInfo[]>> =>
    ipcRenderer.invoke(TableDataChannels.GET_CONSTRAINTS, params),

  getTriggers: (params: TableMetaParams): Promise<IpcResult<TriggerInfo[]>> =>
    ipcRenderer.invoke(TableDataChannels.GET_TRIGGERS, params),

  getTypes: (params: TableMetaParams): Promise<IpcResult<TableTypeInfo[]>> =>
    ipcRenderer.invoke(TableDataChannels.GET_TYPES, params),

  toggleTrigger: (
    params: ToggleTriggerParams,
  ): Promise<IpcResult<TriggerInfo[]>> =>
    ipcRenderer.invoke(TableDataChannels.TOGGLE_TRIGGER, params),

  executeQuery: (
    params: ExecuteQueryParams,
  ): Promise<IpcResult<TableRowsResult>> =>
    ipcRenderer.invoke(TableDataChannels.EXECUTE_QUERY, params),

  cancelQuery: (
    params: CancelQueryParams,
  ): Promise<IpcResult<CancelQueryResult>> =>
    ipcRenderer.invoke(TableDataChannels.CANCEL_QUERY, params),

  showSaveDialog: (
    options: SaveDialogOptions,
  ): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(TableDataChannels.SHOW_SAVE_DIALOG, options),

  showOpenDialog: (
    options: OpenDialogOptions,
  ): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(TableDataChannels.SHOW_OPEN_DIALOG, options),

  exportData: (params: ExportDataParams): Promise<IpcResult<ExportResult>> =>
    ipcRenderer.invoke(TableDataChannels.EXPORT_DATA, params),

  sqlDump: (params: SqlDumpParams): Promise<IpcResult<ExportResult>> =>
    ipcRenderer.invoke(TableDataChannels.SQL_DUMP, params),

  importData: (params: ImportDataParams): Promise<IpcResult<ImportResult>> =>
    ipcRenderer.invoke(TableDataChannels.IMPORT_DATA, params),

  insertRow: (params: InsertRowParams): Promise<IpcResult<InsertRowResult>> =>
    ipcRenderer.invoke(TableDataChannels.INSERT_ROW, params),

  updateCell: (
    params: UpdateCellParams,
  ): Promise<IpcResult<UpdateCellResult>> =>
    ipcRenderer.invoke(TableDataChannels.UPDATE_CELL, params),

  updateRow: (params: UpdateRowParams): Promise<IpcResult<UpdateRowResult>> =>
    ipcRenderer.invoke(TableDataChannels.UPDATE_ROW, params),

  deleteRows: (
    params: DeleteRowsParams,
  ): Promise<IpcResult<DeleteRowsResult>> =>
    ipcRenderer.invoke(TableDataChannels.DELETE_ROWS, params),

  searchForeignKey: (
    params: SearchForeignKeyParams,
  ): Promise<IpcResult<SearchForeignKeyResult>> =>
    ipcRenderer.invoke(TableDataChannels.SEARCH_FK, params),

  onExportProgress: (callback: (rowCount: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, rowCount: number) =>
      callback(rowCount);
    ipcRenderer.on(TableDataChannels.EXPORT_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(TableDataChannels.EXPORT_PROGRESS, handler);
    };
  },

  onImportProgress: (callback: (progress: ImportProgress) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: ImportProgress,
    ) => callback(progress);
    ipcRenderer.on(TableDataChannels.IMPORT_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(TableDataChannels.IMPORT_PROGRESS, handler);
    };
  },
} satisfies TableDataApi;

const helpApi = {
  onShowLicense: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(HelpChannels.SHOW_LICENSE, listener);
    return () => {
      ipcRenderer.removeListener(HelpChannels.SHOW_LICENSE, listener);
    };
  },

  onShowAbout: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(HelpChannels.SHOW_ABOUT, listener);
    return () => {
      ipcRenderer.removeListener(HelpChannels.SHOW_ABOUT, listener);
    };
  },

  onShowShortcuts: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(HelpChannels.SHOW_SHORTCUTS, listener);
    return () => {
      ipcRenderer.removeListener(HelpChannels.SHOW_SHORTCUTS, listener);
    };
  },
} satisfies HelpApi;

const workspaceApi = {
  onCloseTab: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(WorkspaceChannels.CLOSE_TAB, listener);
    return () => {
      ipcRenderer.removeListener(WorkspaceChannels.CLOSE_TAB, listener);
    };
  },

  onNextTab: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(WorkspaceChannels.NEXT_TAB, listener);
    return () => {
      ipcRenderer.removeListener(WorkspaceChannels.NEXT_TAB, listener);
    };
  },

  onPrevTab: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(WorkspaceChannels.PREV_TAB, listener);
    return () => {
      ipcRenderer.removeListener(WorkspaceChannels.PREV_TAB, listener);
    };
  },
} satisfies WorkspaceApi;

const clipboardApi = {
  writeText: (text: string): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(ClipboardChannels.WRITE_TEXT, text),
} satisfies ClipboardApi;

const rolesApi = {
  getSnapshot: (
    connectionId: string,
    targetUser?: string,
  ): Promise<IpcResult<RolesSnapshot>> =>
    ipcRenderer.invoke(RolesChannels.GET_SNAPSHOT, {
      connectionId,
      targetUser,
    }),

  getSidebarSummary: (
    connectionId: string,
  ): Promise<IpcResult<RolesSidebarSummary>> =>
    ipcRenderer.invoke(RolesChannels.GET_SIDEBAR_SUMMARY, { connectionId }),

  createRole: (input: CreateRoleInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.CREATE_ROLE, input),

  alterRole: (input: AlterRoleInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.ALTER_ROLE, input),

  dropRole: (connectionId: string, name: string): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.DROP_ROLE, { connectionId, name }),

  grantMembership: (input: MembershipInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.GRANT_MEMBERSHIP, input),

  revokeMembership: (input: MembershipInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.REVOKE_MEMBERSHIP, input),

  grantDbConnect: (input: DbAccessInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.GRANT_DB_CONNECT, input),

  revokeDbConnect: (input: DbAccessInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.REVOKE_DB_CONNECT, input),

  grantDbReadonly: (input: DbReadonlyGrantInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.GRANT_DB_READONLY, input),

  revokeDbReadonly: (input: DbReadonlyGrantInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.REVOKE_DB_READONLY, input),

  alterRolePassword: (
    connectionId: string,
    name: string,
    password: string,
  ): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.ALTER_ROLE_PASSWORD, {
      connectionId,
      name,
      password,
    }),

  alterRoleComment: (
    connectionId: string,
    name: string,
    comment: string | null,
  ): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.ALTER_ROLE_COMMENT, {
      connectionId,
      name,
      comment,
    }),

  setDbAccessLevel: (
    input: SetDbAccessLevelInput,
  ): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.SET_DB_ACCESS_LEVEL, input),

  setTableRestrictions: (
    input: TableRestrictionInput,
  ): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.SET_TABLE_RESTRICTIONS, input),

  cloneRole: (input: CloneRoleInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.CLONE_ROLE, input),

  renameRole: (input: RenameRoleInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.RENAME_ROLE, input),

  listTriggers: (
    connectionId: string,
    databaseName: string,
  ): Promise<IpcResult<PgTriggerInfo[]>> =>
    ipcRenderer.invoke(RolesChannels.LIST_TRIGGERS, {
      connectionId,
      databaseName,
    }),

  createTrigger: (input: CreateTriggerInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.CREATE_TRIGGER, input),

  dropTrigger: (input: DropTriggerInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.DROP_TRIGGER, input),

  setTriggerEnabled: (
    input: SetTriggerEnabledInput,
  ): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.SET_TRIGGER_ENABLED, input),

  listTriggerFunctions: (
    connectionId: string,
    databaseName: string,
  ): Promise<IpcResult<PgTriggerFunction[]>> =>
    ipcRenderer.invoke(RolesChannels.LIST_TRIGGER_FUNCTIONS, {
      connectionId,
      databaseName,
    }),

  createTriggerFunction: (
    input: CreateTriggerFunctionInput,
  ): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.CREATE_TRIGGER_FUNCTION, input),

  getEffectivePermissions: (
    connectionId: string,
    user: string,
  ): Promise<IpcResult<EffectivePermissions>> =>
    ipcRenderer.invoke(RolesChannels.GET_EFFECTIVE_PERMISSIONS, {
      connectionId,
      user,
    }),

  getAuditLog: (connectionId: string): Promise<IpcResult<AuditLogEntry[]>> =>
    ipcRenderer.invoke(RolesChannels.GET_AUDIT_LOG, { connectionId }),

  clearAuditLog: (connectionId: string): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(RolesChannels.CLEAR_AUDIT_LOG, { connectionId }),
} satisfies RolesApi;

const dbSyncApi = {
  listDatabases: (
    input: DbSyncListDatabasesInput,
  ): Promise<IpcResult<string[]>> =>
    ipcRenderer.invoke(DbSyncChannels.LIST_DATABASES, input),

  run: (input: DbSyncRunInput): Promise<IpcResult<DbSyncResult>> =>
    ipcRenderer.invoke(DbSyncChannels.RUN, input),

  cancel: (input: DbSyncCancelInput): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(DbSyncChannels.CANCEL, input),

  onProgress: (callback: (event: DbSyncProgressEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: DbSyncProgressEvent,
    ) => callback(progress);
    ipcRenderer.on(DbSyncChannels.PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(DbSyncChannels.PROGRESS, handler);
    };
  },

  getProdGuard: (): Promise<IpcResult<DbSyncProdGuardState>> =>
    ipcRenderer.invoke(DbSyncChannels.GET_PROD_GUARD),

  setProdGuard: (enabled: boolean): Promise<IpcResult<DbSyncProdGuardState>> =>
    ipcRenderer.invoke(DbSyncChannels.SET_PROD_GUARD, { enabled }),

  listBackups: (): Promise<IpcResult<BackupFileInfo[]>> =>
    ipcRenderer.invoke(DbSyncChannels.LIST_BACKUPS),

  backup: (input: DbSyncBackupInput): Promise<IpcResult<DbSyncResult>> =>
    ipcRenderer.invoke(DbSyncChannels.BACKUP, input),

  restore: (input: DbSyncRestoreInput): Promise<IpcResult<DbSyncResult>> =>
    ipcRenderer.invoke(DbSyncChannels.RESTORE, input),

  deleteBackup: (path: string): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(DbSyncChannels.DELETE_BACKUP, { path }),

  inspectBackup: (path: string): Promise<IpcResult<BackupInspection>> =>
    ipcRenderer.invoke(DbSyncChannels.INSPECT_BACKUP, { path }),
} satisfies DbSyncApi;

contextBridge.exposeInMainWorld("connectionApi", connectionApi);
contextBridge.exposeInMainWorld("settingsApi", settingsApi);
contextBridge.exposeInMainWorld("tableDataApi", tableDataApi);
contextBridge.exposeInMainWorld("helpApi", helpApi);
contextBridge.exposeInMainWorld("workspaceApi", workspaceApi);
contextBridge.exposeInMainWorld("clipboardApi", clipboardApi);
contextBridge.exposeInMainWorld("rolesApi", rolesApi);
contextBridge.exposeInMainWorld("dbSyncApi", dbSyncApi);
