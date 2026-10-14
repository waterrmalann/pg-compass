import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarContent } from "@/components/sidebar/sidebar-content";

const refreshSchemaTreeWithStatus = vi.fn();

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({
    loading: false,
    connections: [
      {
        id: "conn-1",
        label: "Local",
        favourite: false,
        mode: "uri",
        uri: "postgresql://localhost/app",
      },
      {
        id: "conn-2",
        label: "Remote",
        favourite: false,
        mode: "uri",
        uri: "postgresql://remote/app",
      },
    ],
  }),
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    schemaCache: {},
    refreshSchemaTreeWithStatus,
  }),
}));

vi.mock("@/components/connections/connection-item", () => ({
  ConnectionItem: ({
    connection,
    connected,
    onConnectedChange,
    searchActive,
  }: {
    connection: { id: string };
    connected: boolean;
    onConnectedChange: (connected: boolean) => void;
    searchActive?: boolean;
  }) => (
    <div>
      {searchActive ? `result ${connection.id}` : connection.id}
      <button
        type="button"
        onClick={() => onConnectedChange(!connected)}
      >{`${connected ? "Disconnect" : "Connect"} ${connection.id}`}</button>
    </div>
  ),
}));

describe("sidebar search loading", () => {
  beforeEach(() => {
    refreshSchemaTreeWithStatus.mockReset();
  });

  it("does not search or load disconnected instances", () => {
    render(<SidebarContent search="missing" onEdit={vi.fn()} />);

    expect(screen.getByText("No connected instances")).toBeVisible();
    expect(refreshSchemaTreeWithStatus).not.toHaveBeenCalled();
  });

  it("loads only connected instances and retries a failed load", async () => {
    const user = userEvent.setup();
    let finishFirst!: (value: { ok: boolean; data: [] }) => void;
    refreshSchemaTreeWithStatus
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ ok: true, data: [] });

    const view = render(<SidebarContent search="" onEdit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Connect conn-1" }));
    view.rerender(<SidebarContent search="missing" onEdit={vi.fn()} />);

    expect(screen.getByText(/Searching cached relation trees/)).toBeVisible();
    expect(refreshSchemaTreeWithStatus).toHaveBeenCalledWith("conn-1");
    expect(refreshSchemaTreeWithStatus).not.toHaveBeenCalledWith("conn-2");

    finishFirst({ ok: false, data: [] });
    await screen.findByText("No matching relations");

    view.rerender(<SidebarContent search="" onEdit={vi.fn()} />);
    view.rerender(<SidebarContent search="missing" onEdit={vi.fn()} />);
    await waitFor(() =>
      expect(refreshSchemaTreeWithStatus).toHaveBeenCalledTimes(2),
    );
  });

  it("reuses a successful search load until the instance disconnects", async () => {
    const user = userEvent.setup();
    refreshSchemaTreeWithStatus.mockResolvedValue({ ok: true, data: [] });

    const view = render(<SidebarContent search="" onEdit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Connect conn-1" }));
    view.rerender(<SidebarContent search="missing" onEdit={vi.fn()} />);
    await screen.findByText("No matching relations");

    view.rerender(<SidebarContent search="" onEdit={vi.fn()} />);
    view.rerender(<SidebarContent search="other" onEdit={vi.fn()} />);
    await screen.findByText("No matching relations");
    expect(refreshSchemaTreeWithStatus).toHaveBeenCalledTimes(1);

    view.rerender(<SidebarContent search="" onEdit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Disconnect conn-1" }));
    await user.click(screen.getByRole("button", { name: "Connect conn-1" }));
    view.rerender(<SidebarContent search="missing" onEdit={vi.fn()} />);
    await waitFor(() =>
      expect(refreshSchemaTreeWithStatus).toHaveBeenCalledTimes(2),
    );
  });
});
