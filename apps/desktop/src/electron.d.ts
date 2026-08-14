import type {
  BackupApi,
  ClipboardApi,
  ConnectionApi,
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
    backupApi: BackupApi;
  }
}
