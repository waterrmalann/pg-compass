import { describe, expect, it } from "vitest";
import { buildWindowTitle } from "@/components/workspace/utils/build-window-title";
import type { WorkspaceTabView } from "@/shared/types";

describe("buildWindowTitle", () => {
  it("returns the app title when there is no active view", () => {
    expect(buildWindowTitle(undefined)).toBe("PG Compass");
  });

  it("builds titles for schema and table views", () => {
    const schemaView: WorkspaceTabView = {
      type: "schema",
      path: {
        connectionId: "c1",
        connectionLabel: "Local",
        schemaName: "app",
      },
    };

    const tableView: WorkspaceTabView = {
      type: "table-details",
      path: {
        connectionId: "c1",
        connectionLabel: "Local",
        schemaName: "app",
        tableName: "users",
      },
    };

    expect(buildWindowTitle(schemaView)).toBe("PG Compass - Local/app");
    expect(buildWindowTitle(tableView)).toBe("PG Compass - Local/app/users");
  });

  it("builds a title for the users view", () => {
    const usersView: WorkspaceTabView = {
      type: "users",
      path: {
        connectionId: "c1",
        connectionLabel: "Local",
        selectedRole: "reader",
      },
    };
    expect(buildWindowTitle(usersView)).toBe("PG Compass - Local · Users");
  });
});
