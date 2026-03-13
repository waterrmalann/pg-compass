import type {
  ConnectionConfig,
  ConnectionInput,
  DatabaseSchema,
  SchemaTreeOptions,
} from './shared/types/connection';
import type {
  AppSettings,
  AppSettingsPatch,
} from './shared/types/settings';
import type {
  ColumnStructure,
  ConstraintInfo,
  ExecuteQueryParams,
  GetRowsParams,
  IndexInfo,
  TableMetaParams,
  TableRowsResult,
} from './shared/types/table-data';

export interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ConnectionApi {
  getAll(): Promise<IpcResult<ConnectionConfig[]>>;
  getById(id: string): Promise<IpcResult<ConnectionConfig>>;
  create(input: ConnectionInput): Promise<IpcResult<ConnectionConfig>>;
  update(id: string, input: ConnectionInput): Promise<IpcResult<ConnectionConfig>>;
  delete(id: string): Promise<IpcResult<boolean>>;
  toggleFavourite(id: string): Promise<IpcResult<ConnectionConfig>>;
  test(id: string): Promise<IpcResult<boolean>>;
  getSchemaTree(
    id: string,
    options?: SchemaTreeOptions,
  ): Promise<IpcResult<DatabaseSchema[]>>;
}

interface SettingsApi {
  get(): Promise<IpcResult<AppSettings>>;
  update(patch: AppSettingsPatch): Promise<IpcResult<AppSettings>>;
}

interface TableDataApi {
  getRows(params: GetRowsParams): Promise<IpcResult<TableRowsResult>>;
  getStructure(params: TableMetaParams): Promise<IpcResult<ColumnStructure[]>>;
  getIndexes(params: TableMetaParams): Promise<IpcResult<IndexInfo[]>>;
  getConstraints(params: TableMetaParams): Promise<IpcResult<ConstraintInfo[]>>;
  executeQuery(params: ExecuteQueryParams): Promise<IpcResult<TableRowsResult>>;
}

interface HelpApi {
  onShowLicense(callback: () => void): () => void;
  onShowAbout(callback: () => void): () => void;
}

declare global {
  interface Window {
    connectionApi: ConnectionApi;
    settingsApi: SettingsApi;
    tableDataApi: TableDataApi;
    helpApi: HelpApi;
  }
}
