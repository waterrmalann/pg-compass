import type { WorkspaceTab } from "@/shared/types/workspace";

/**
 * The relation currently focused by the active workspace tab, projected onto
 * the sidebar tree so it can highlight the selected node and its ancestors.
 *
 * `kind` names the *leaf* node the tab points at; the intermediate fields
 * describe the path to it so ancestor rows can render an "on path" state.
 */
export interface ActiveSelection {
  connectionId: string;
  schemaName?: string;
  tableName?: string;
  viewName?: string;
  selectedRole?: string;
  kind: "connection" | "schema" | "table" | "view" | "users";
}

export function deriveActiveSelection(
  tabs: WorkspaceTab[],
  activeTabId: string | null,
): ActiveSelection | null {
  if (!activeTabId) return null;
  const tab = tabs.find((item) => item.id === activeTabId);
  if (!tab) return null;

  const { view } = tab;
  if (view.type === "database-manager") return null;
  const connectionId = view.path.connectionId;

  switch (view.type) {
    case "schema-list":
      return { connectionId, kind: "connection" };
    case "schema":
      return { connectionId, schemaName: view.path.schemaName, kind: "schema" };
    case "table-list":
    case "table-details":
      return {
        connectionId,
        schemaName: view.path.schemaName,
        tableName: view.path.tableName,
        kind: "table",
      };
    case "view-list":
    case "view-details":
      return {
        connectionId,
        schemaName: view.path.schemaName,
        viewName: view.path.viewName,
        kind: "view",
      };
    case "users":
      return {
        connectionId,
        selectedRole: view.path.selectedRole,
        kind: "users",
      };
  }
}
