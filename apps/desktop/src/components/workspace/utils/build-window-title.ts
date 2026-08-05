import { WorkspaceTabView } from "@/shared/types";

export function buildWindowTitle(view: WorkspaceTabView | undefined): string {
  const base = "PG Compass";
  if (!view) return base;
  if (view.type === "database-manager") return `${base} - Database Manager`;

  const label = view.path.connectionLabel;

  if (view.type === "schema-list") return `${base} - ${label}`;
  if (view.type === "users") return `${base} - ${label} · Users`;

  const schema = view.path.schemaName;

  if (view.type === "schema") return `${base} - ${label}/${schema}`;

  if (view.type === "table-list" || view.type === "table-details")
    return `${base} - ${label}/${schema}/${view.path.tableName}`;

  // view-list or view-details
  return `${base} - ${label}/${schema}/${view.path.viewName}`;
}
