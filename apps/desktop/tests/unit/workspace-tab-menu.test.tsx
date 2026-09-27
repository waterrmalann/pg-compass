import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "@/components/workspace/workspace";
import type { WorkspaceTab } from "@/shared/types/workspace";

const closeTab = vi.fn();
const closeAllTabs = vi.fn();

const tabs: WorkspaceTab[] = [
  {
    id: "database-manager",
    title: "Database manager",
    view: { type: "database-manager" },
  },
  {
    id: "conn-1:users",
    title: "Local · Users",
    view: {
      type: "users",
      path: { connectionId: "conn-1", connectionLabel: "Local" },
    },
  },
];

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    tabs,
    activeTabId: "database-manager",
    setActiveTab: vi.fn(),
    closeTab,
    closeAllTabs,
  }),
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ connections: [] }),
}));
vi.mock("@/hooks/use-density", () => ({ useDensity: () => "compact" }));
vi.mock("@/hooks/use-workspace-shortcuts", () => ({
  useWorkspaceShortcuts: () => undefined,
}));
vi.mock("@/components/workspace/database-manager-viewer", () => ({
  DatabaseManagerViewer: () => <div>Database manager body</div>,
}));
vi.mock("@/components/workspace/users-viewer", () => ({
  UsersViewer: () => null,
}));

describe("workspace tab context menu", () => {
  beforeEach(() => {
    closeTab.mockClear();
    closeAllTabs.mockClear();
  });

  it("opens from the keyboard context-menu event and closes all tabs", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const tabButton = screen.getByRole("button", { name: "Local · Users" });

    // Shift+F10 / the Menu key dispatch `contextmenu` on the focused element.
    tabButton.focus();
    fireEvent.contextMenu(tabButton);

    const item = await screen.findByRole("menuitem", {
      name: "Close all tabs",
    });
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu")).toBeVisible();
    await user.click(item);

    expect(closeAllTabs).toHaveBeenCalledTimes(1);
    expect(closeTab).not.toHaveBeenCalled();
  });
});
