export interface DatabaseViewerPath {
  connectionId: string;
  connectionLabel: string;
}

export interface WorkspacePath extends DatabaseViewerPath {
  schemaName: string;
}

export type SchemaViewerPath = WorkspacePath;

export interface TableListViewerPath extends WorkspacePath {
  tableName: string;
}

export interface ViewListViewerPath extends WorkspacePath {
  viewName: string;
}

export interface UsersViewerPath extends DatabaseViewerPath {
  /** Optional role name to focus in the RBAC viewer on open. */
  selectedRole?: string;
}

export type WorkspaceTabView =
  | {
      type: "schema-list";
      path: DatabaseViewerPath;
    }
  | {
      type: "schema";
      path: SchemaViewerPath;
    }
  | {
      type: "table-list";
      path: TableListViewerPath;
    }
  | {
      type: "table-details";
      path: TableListViewerPath;
    }
  | {
      type: "view-list";
      path: ViewListViewerPath;
    }
  | {
      type: "view-details";
      path: ViewListViewerPath;
    }
  | {
      type: "users";
      path: UsersViewerPath;
    }
  | {
      /** Global tool — not scoped to a single connection, so no `path`. */
      type: "database-manager";
    };

export interface WorkspaceTab {
  id: string;
  title: string;
  color?: string;
  view: WorkspaceTabView;
}

export type RelationSubTab =
  | "data"
  | "structure"
  | "indexes"
  | "constraints"
  | "triggers"
  | "types"
  | "query";

export interface RelationSessionState {
  activeSubTab: RelationSubTab;
  dataViewMode: "table" | "card";
  dataPageSize: number;
  dataWhereClause: string;
}

export const DEFAULT_RELATION_SESSION: RelationSessionState = {
  activeSubTab: "data",
  dataViewMode: "table",
  dataPageSize: 50,
  dataWhereClause: "",
};
