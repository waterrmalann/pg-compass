import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS } from "@/shared/types/settings";
import { TableDetailsViewer } from "@/components/workspace/table-details-viewer";
import { DEFAULT_RELATION_SESSION } from "@/shared/types/workspace";

const refreshSchemaTree = vi.fn().mockResolvedValue([]);
const refreshSchemaTreeWithStatus = vi
  .fn()
  .mockResolvedValue({ ok: true, data: [] });
const detailLoader = vi.fn();

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: DEFAULT_APP_SETTINGS,
    updateSettings: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    refreshSchemaTree,
    refreshSchemaTreeWithStatus,
    navigateToView: vi.fn(),
    relationSessions: { "table-tab": DEFAULT_RELATION_SESSION },
    updateRelationSession: vi.fn(),
  }),
}));

vi.mock("@/components/workspace/table-viewer/data-tab", () => ({
  DataTab: ({
    refreshSignal,
    onRefreshComplete,
  }: {
    refreshSignal: number;
    onRefreshComplete: (success: boolean) => void;
  }) => {
    useEffect(() => {
      if (refreshSignal > 0) {
        detailLoader();
        onRefreshComplete(true);
      }
    }, [onRefreshComplete, refreshSignal]);
    return <div>Data detail</div>;
  },
}));

describe("detail refresh contract", () => {
  beforeEach(() => {
    refreshSchemaTree.mockClear();
    refreshSchemaTreeWithStatus.mockClear();
    detailLoader.mockClear();
  });

  it("refreshes the schema tree and the active detail loader", async () => {
    const user = userEvent.setup();
    render(
      <TableDetailsViewer
        tabId="table-tab"
        path={{
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
          tableName: "users",
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /refresh data and table metadata/i }),
    );
    await waitFor(() =>
      expect(refreshSchemaTreeWithStatus).toHaveBeenCalledWith("conn-1", true),
    );
    await waitFor(() => expect(detailLoader).toHaveBeenCalledTimes(1));
  });
});
