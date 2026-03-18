// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import { ConnectionChannels } from './shared/types/connection';
import { SettingsChannels } from './shared/types/settings';
import { TableDataChannels } from './shared/types/table-data';
import { HelpChannels } from './shared/constants/help';
import { WorkspaceChannels } from './shared/constants/workspace';
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

/** IPC result wrapper. */
export interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const connectionApi = {
  getAll: (): Promise<IpcResult<ConnectionConfig[]>> =>
    ipcRenderer.invoke(ConnectionChannels.GET_ALL),

  getById: (id: string): Promise<IpcResult<ConnectionConfig>> =>
    ipcRenderer.invoke(ConnectionChannels.GET_BY_ID, id),

  create: (input: ConnectionInput): Promise<IpcResult<ConnectionConfig>> =>
    ipcRenderer.invoke(ConnectionChannels.CREATE, input),

  update: (id: string, input: ConnectionInput): Promise<IpcResult<ConnectionConfig>> =>
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
};

const settingsApi = {
  get: (): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(SettingsChannels.GET),

  update: (patch: AppSettingsPatch): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(SettingsChannels.UPDATE, patch),
};

const tableDataApi = {
  getRows: (params: GetRowsParams): Promise<IpcResult<TableRowsResult>> =>
    ipcRenderer.invoke(TableDataChannels.GET_ROWS, params),

  getStructure: (params: TableMetaParams): Promise<IpcResult<ColumnStructure[]>> =>
    ipcRenderer.invoke(TableDataChannels.GET_STRUCTURE, params),

  getIndexes: (params: TableMetaParams): Promise<IpcResult<IndexInfo[]>> =>
    ipcRenderer.invoke(TableDataChannels.GET_INDEXES, params),

  getConstraints: (params: TableMetaParams): Promise<IpcResult<ConstraintInfo[]>> =>
    ipcRenderer.invoke(TableDataChannels.GET_CONSTRAINTS, params),

  executeQuery: (params: ExecuteQueryParams): Promise<IpcResult<TableRowsResult>> =>
    ipcRenderer.invoke(TableDataChannels.EXECUTE_QUERY, params),
};

const helpApi = {
  onShowLicense: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(HelpChannels.SHOW_LICENSE, listener);
    return () => { ipcRenderer.removeListener(HelpChannels.SHOW_LICENSE, listener); };
  },

  onShowAbout: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(HelpChannels.SHOW_ABOUT, listener);
    return () => { ipcRenderer.removeListener(HelpChannels.SHOW_ABOUT, listener); };
  },
};

const workspaceApi = {
  onCloseTab: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(WorkspaceChannels.CLOSE_TAB, listener);
    return () => { ipcRenderer.removeListener(WorkspaceChannels.CLOSE_TAB, listener); };
  },

  onNextTab: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(WorkspaceChannels.NEXT_TAB, listener);
    return () => { ipcRenderer.removeListener(WorkspaceChannels.NEXT_TAB, listener); };
  },

  onPrevTab: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(WorkspaceChannels.PREV_TAB, listener);
    return () => { ipcRenderer.removeListener(WorkspaceChannels.PREV_TAB, listener); };
  },
};

contextBridge.exposeInMainWorld('connectionApi', connectionApi);
contextBridge.exposeInMainWorld('settingsApi', settingsApi);
contextBridge.exposeInMainWorld('tableDataApi', tableDataApi);
contextBridge.exposeInMainWorld('helpApi', helpApi);
contextBridge.exposeInMainWorld('workspaceApi', workspaceApi);
