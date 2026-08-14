import type {
  ClipboardApi,
  ConnectionApi,
  DbSyncApi,
  HelpApi,
  RolesApi,
  SettingsApi,
  TableDataApi,
  WorkspaceApi,
} from "./shared/types/ipc";

declare global {
  interface Window {
    connectionApi: ConnectionApi;
    settingsApi: SettingsApi;
    tableDataApi: TableDataApi;
    helpApi: HelpApi;
    workspaceApi: WorkspaceApi;
    clipboardApi: ClipboardApi;
    rolesApi: RolesApi;
    dbSyncApi: DbSyncApi;
  }
}
