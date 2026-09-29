import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS } from "@/shared/types/settings";
import { SchemaViewer } from "@/components/workspace/schema-viewer";

const openTab = vi.fn().mockResolvedValue(undefined);
const navigateToView = vi.fn().mockResolvedValue(undefined);
const refreshSchemaTreeWithStatus = vi
  .fn()
  .mockResolvedValue({ ok: true, data: [] });

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: DEFAULT_APP_SETTINGS,
    updateSettings: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    schemaCache: {
      "conn-1": [
        {
          name: "app",
          tables: ["users"],
          views: [
            {
              name: "active_users",
              definition:
                "SELECT id, email, display_name FROM app.users WHERE status = 'active'",
            },
          ],
          tableStats: {
            users: { estimatedRowCount: 120, sizeOnDisk: "64 kB" },
          },
        },
      ],
    },
    refreshSchemaTreeWithStatus,
    openTab,
    navigateToView,
  }),
}));

describe("SchemaViewer", () => {
  it("lists views from the schema cache and opens the selected view", async () => {
    const user = userEvent.setup();

    render(
      <SchemaViewer
        path={{
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
        }}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Views" }));

    expect(screen.getByText("active_users")).toBeInTheDocument();
    expect(screen.getByText(/FROM app\.users/)).toBeInTheDocument();

    await user.click(screen.getByText("active_users"));

    expect(openTab).toHaveBeenCalledWith({
      type: "view-details",
      path: {
        connectionId: "conn-1",
        connectionLabel: "Local",
        schemaName: "app",
        viewName: "active_users",
      },
    });
  });

  it("does not show a successful refresh timestamp after metadata failure", async () => {
    const user = userEvent.setup();
    refreshSchemaTreeWithStatus.mockResolvedValueOnce({ ok: false, data: [] });
    render(
      <SchemaViewer
        path={{
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /refresh schema app and visible relation list/i,
      }),
    );
    await waitFor(() => expect(refreshSchemaTreeWithStatus).toHaveBeenCalled());
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });
});
