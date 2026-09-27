import type {
  BackupApi,
  ClipboardApi,
  ConnectionApi,
  HelpApi,
  RolesApi,
  SettingsApi,
  TableDataApi,
  UpdateApi,
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
    updateApi: UpdateApi;
  }
}
