import type {
  ConnectionConfig,
  ConnectionFileDialogOptions,
  ConnectionInput,
  DatabaseSchema,
  SchemaTreeOptions,
} from "./connection";
import type {
  AlterRoleInput,
  AuditLogEntry,
  CloneRoleInput,
  CreateRoleInput,
  EffectivePermissions,
  MembershipInput,
  PgTriggerInfo,
  RenameRoleInput,
  RolesSidebarSummary,
  RolesSnapshot,
  SetDbAccessLevelInput,
  SetTriggerEnabledInput,
  TableRestrictionInput,
} from "./roles";
import type { SchemaDiagram, SchemaDiagramParams } from "./schema-diagram";
import type { AppSettings, AppSettingsPatch } from "./settings";
import type { UpdateStatus } from "./updates";
import type {
  BackupCancelInput,
  BackupCreateInput,
  BackupFileInfo,
  BackupInspection,
  BackupListDatabasesInput,
  BackupProgressEvent,
  BackupRestoreInput,
  BackupRunResult,
} from "./backup";
import type {
  PsqlLocation,
  ShellDataEvent,
  ShellExitEvent,
  ShellResizeInput,
  ShellSessionInput,
  ShellStartInput,
  ShellStartResult,
  ShellWriteInput,
} from "./shell";
import type { QueryColumnMetadata } from "../query-dsl/types";
import type {
  CancelQueryParams,
  CancelQueryResult,
  ColumnStructure,
  ConstraintInfo,
  DeleteRowsParams,
  DeleteRowsResult,
  ExecuteQueryParams,
  ExportDataParams,
  ExportResult,
  GetJsonKeysParams,
  GetRowsParams,
  ImportDataParams,
  ImportProgress,
  ImportResult,
  IndexInfo,
  InsertRowParams,
  InsertRowResult,
  OpenDialogOptions,
  PreviewQuerySqlParams,
  PreviewQuerySqlResult,
  SaveDialogOptions,
  SearchForeignKeyParams,
  SearchForeignKeyResult,
  SqlDumpParams,
  TableDataFailure,
  TableMetaParams,
  TableRowsResult,
  TableTypeInfo,
  ToggleTriggerParams,
  TriggerInfo,
  UpdateCellParams,
  UpdateCellResult,
  UpdateRowParams,
  UpdateRowResult,
} from "./table-data";

export type IpcResult<T> =
  | { success: true; data: T; error?: never; failure?: never }
  | {
      success: false;
      data?: never;
      error: string;
      /** Structured detail for Data-tab operations; absent elsewhere. */
      failure?: TableDataFailure;
    };

export interface ConnectionApi {
  getAll(): Promise<IpcResult<ConnectionConfig[]>>;
  getById(id: string): Promise<IpcResult<ConnectionConfig>>;
  create(input: ConnectionInput): Promise<IpcResult<ConnectionConfig>>;
  update(
    id: string,
    input: ConnectionInput,
  ): Promise<IpcResult<ConnectionConfig>>;
  delete(id: string): Promise<IpcResult<boolean>>;
  toggleFavourite(id: string): Promise<IpcResult<ConnectionConfig>>;
  test(id: string): Promise<IpcResult<boolean>>;
  getSchemaTree(
    id: string,
    options?: SchemaTreeOptions,
  ): Promise<IpcResult<DatabaseSchema[]>>;
  /** Tables, columns and foreign keys for the database Diagram tab. */
  getSchemaDiagram(
    params: SchemaDiagramParams,
  ): Promise<IpcResult<SchemaDiagram>>;
  showOpenFileDialog(
    options: ConnectionFileDialogOptions,
  ): Promise<IpcResult<string | null>>;
}

export interface SettingsApi {
  get(): Promise<IpcResult<AppSettings>>;
  update(patch: AppSettingsPatch): Promise<IpcResult<AppSettings>>;
}

export interface TableDataApi {
  getRows(params: GetRowsParams): Promise<IpcResult<TableRowsResult>>;
  getStructure(params: TableMetaParams): Promise<IpcResult<ColumnStructure[]>>;
  getQueryColumns(
    params: TableMetaParams,
  ): Promise<IpcResult<QueryColumnMetadata[]>>;
  /** Object keys sampled at a JSON column or path, for key completion. */
  getJsonKeys(params: GetJsonKeysParams): Promise<IpcResult<string[]>>;
  getIndexes(params: TableMetaParams): Promise<IpcResult<IndexInfo[]>>;
  getConstraints(params: TableMetaParams): Promise<IpcResult<ConstraintInfo[]>>;
  getTriggers(params: TableMetaParams): Promise<IpcResult<TriggerInfo[]>>;
  getTypes(params: TableMetaParams): Promise<IpcResult<TableTypeInfo[]>>;
  toggleTrigger(params: ToggleTriggerParams): Promise<IpcResult<TriggerInfo[]>>;
  executeQuery(params: ExecuteQueryParams): Promise<IpcResult<TableRowsResult>>;
  cancelQuery(params: CancelQueryParams): Promise<IpcResult<CancelQueryResult>>;
  showSaveDialog(options: SaveDialogOptions): Promise<IpcResult<string | null>>;
  showOpenDialog(options: OpenDialogOptions): Promise<IpcResult<string | null>>;
  exportData(params: ExportDataParams): Promise<IpcResult<ExportResult>>;
  previewQuerySql(
    params: PreviewQuerySqlParams,
  ): Promise<IpcResult<PreviewQuerySqlResult>>;
  sqlDump(params: SqlDumpParams): Promise<IpcResult<ExportResult>>;
  importData(params: ImportDataParams): Promise<IpcResult<ImportResult>>;
  insertRow(params: InsertRowParams): Promise<IpcResult<InsertRowResult>>;
  updateCell(params: UpdateCellParams): Promise<IpcResult<UpdateCellResult>>;
  updateRow(params: UpdateRowParams): Promise<IpcResult<UpdateRowResult>>;
  deleteRows(params: DeleteRowsParams): Promise<IpcResult<DeleteRowsResult>>;
  searchForeignKey(
    params: SearchForeignKeyParams,
  ): Promise<IpcResult<SearchForeignKeyResult>>;
  onExportProgress(callback: (rowCount: number) => void): () => void;
  onImportProgress(callback: (progress: ImportProgress) => void): () => void;
}

export interface HelpApi {
  onShowLicense(callback: () => void): () => void;
  onShowAbout(callback: () => void): () => void;
  onShowShortcuts(callback: () => void): () => void;
}

export interface UpdateApi {
  getStatus(): Promise<IpcResult<UpdateStatus>>;
  install(): Promise<IpcResult<void>>;
  onStatusChanged(callback: (status: UpdateStatus) => void): () => void;
}

export interface WorkspaceApi {
  onCloseTab(callback: () => void): () => void;
  onNextTab(callback: () => void): () => void;
  onPrevTab(callback: () => void): () => void;
}

export interface ClipboardApi {
  writeText(text: string): Promise<IpcResult<void>>;
}

export interface RolesApi {
  getSnapshot(
    connectionId: string,
    targetUser?: string,
  ): Promise<IpcResult<RolesSnapshot>>;
  getSidebarSummary(
    connectionId: string,
  ): Promise<IpcResult<RolesSidebarSummary>>;
  createRole(input: CreateRoleInput): Promise<IpcResult<void>>;
  alterRole(input: AlterRoleInput): Promise<IpcResult<void>>;
  dropRole(connectionId: string, name: string): Promise<IpcResult<void>>;
  grantMembership(input: MembershipInput): Promise<IpcResult<void>>;
  revokeMembership(input: MembershipInput): Promise<IpcResult<void>>;
  alterRolePassword(
    connectionId: string,
    name: string,
    password: string,
  ): Promise<IpcResult<void>>;
  alterRoleComment(
    connectionId: string,
    name: string,
    comment: string | null,
  ): Promise<IpcResult<void>>;
  setDbAccessLevel(input: SetDbAccessLevelInput): Promise<IpcResult<void>>;
  setTableRestrictions(input: TableRestrictionInput): Promise<IpcResult<void>>;
  cloneRole(input: CloneRoleInput): Promise<IpcResult<void>>;
  renameRole(input: RenameRoleInput): Promise<IpcResult<void>>;
  listTriggers(
    connectionId: string,
    databaseName: string,
  ): Promise<IpcResult<PgTriggerInfo[]>>;
  setTriggerEnabled(input: SetTriggerEnabledInput): Promise<IpcResult<void>>;
  getEffectivePermissions(
    connectionId: string,
    user: string,
  ): Promise<IpcResult<EffectivePermissions>>;
  getAuditLog(connectionId: string): Promise<IpcResult<AuditLogEntry[]>>;
  clearAuditLog(connectionId: string): Promise<IpcResult<void>>;
}

export interface BackupApi {
  listDatabases(input: BackupListDatabasesInput): Promise<IpcResult<string[]>>;
  cancel(input: BackupCancelInput): Promise<IpcResult<void>>;
  onProgress(callback: (event: BackupProgressEvent) => void): () => void;
  listBackups(): Promise<IpcResult<BackupFileInfo[]>>;
  backup(input: BackupCreateInput): Promise<IpcResult<BackupRunResult>>;
  restore(input: BackupRestoreInput): Promise<IpcResult<BackupRunResult>>;
  /** Opens a native file picker; the chosen path is approved for one restore. */
  showRestoreFileDialog(): Promise<IpcResult<string | null>>;
  deleteBackup(path: string): Promise<IpcResult<void>>;
  inspectBackup(path: string): Promise<IpcResult<BackupInspection>>;
}

export interface ShellApi {
  /** Where psql would be started from, using the psql path setting. */
  locatePsql(): Promise<IpcResult<PsqlLocation>>;
  /** Spawns psql in a pseudo-terminal for the connection's database. */
  start(input: ShellStartInput): Promise<IpcResult<ShellStartResult>>;
  write(input: ShellWriteInput): Promise<IpcResult<void>>;
  resize(input: ShellResizeInput): Promise<IpcResult<void>>;
  kill(input: ShellSessionInput): Promise<IpcResult<void>>;
  onData(callback: (event: ShellDataEvent) => void): () => void;
  onExit(callback: (event: ShellExitEvent) => void): () => void;
}
