import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarFooter } from "@/components/sidebar/sidebar-footer";
import { useWorkspace } from "@/hooks/use-workspace";
import type { IpcResult } from "@/shared/types/ipc";
import type { PgRole, RolesSidebarSummary } from "@/shared/types/roles";
import type { WorkspaceTab } from "@/shared/types/workspace";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/use-workspace", () => ({ useWorkspace: vi.fn() }));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({
    connections: [
      { id: "conn-a", label: "Alpha", mode: "fields", favourite: false },
      { id: "conn-b", label: "Beta", mode: "fields", favourite: false },
    ],
  }),
}));

const tabs: WorkspaceTab[] = [
  {
    id: "a-schemas",
    title: "Alpha",
    view: {
      type: "schema-list",
      path: { connectionId: "conn-a", connectionLabel: "Alpha" },
    },
  },
  {
    id: "a-users",
    title: "Alpha · Users",
    view: {
      type: "users",
      path: { connectionId: "conn-a", connectionLabel: "Alpha" },
    },
  },
  {
    id: "database-manager",
    title: "Database manager",
    view: { type: "database-manager" },
  },
];

function loginRole(name: string): PgRole {
  return {
    name,
    isSuperuser: false,
    canLogin: true,
    canCreateRole: false,
    canCreateDb: false,
    inherit: true,
    connectionLimit: -1,
    validUntil: null,
    hasPassword: true,
    canReplicate: false,
    canBypassRls: false,
    description: null,
  };
}

function summary(roleNames: string[]): IpcResult<RolesSidebarSummary> {
  return {
    success: true,
    data: {
      currentUser: {
        name: "postgres",
        isSuperuser: true,
        canLogin: true,
        canCreateRole: true,
        canCreateDb: true,
      },
      roles: roleNames.map(loginRole),
    },
  };
}

function setWorkspace(activeTabId: string, rolesRevision = 0) {
  vi.mocked(useWorkspace).mockReturnValue({
    tabs,
    activeTabId,
    openTab: vi.fn(),
    rolesRevision,
  } as unknown as ReturnType<typeof useWorkspace>);
}

function renderFooter() {
  const view = render(
    <TooltipProvider>
      <SidebarFooter onNewConnection={vi.fn()} />
    </TooltipProvider>,
  );
  const rerender = () =>
    view.rerender(
      <TooltipProvider>
        <SidebarFooter onNewConnection={vi.fn()} />
      </TooltipProvider>,
    );
  return { rerender };
}

describe("SidebarFooter roles summary", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.assign(window, {
      connectionApi: { test: vi.fn() },
      rolesApi: {
        getSidebarSummary: vi.fn().mockResolvedValue(summary(["alice"])),
      },
    });
  });

  it("clears the spinner when the active tab leaves the connection mid-load", async () => {
    let resolvePending: (value: IpcResult<RolesSidebarSummary>) => void = () =>
      undefined;
    vi.mocked(window.rolesApi.getSidebarSummary).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePending = resolve;
      }),
    );
    setWorkspace("a-schemas");
    const { rerender } = renderFooter();
    expect(screen.getByLabelText("Loading roles")).toBeInTheDocument();

    setWorkspace("database-manager");
    rerender();
    await waitFor(() =>
      expect(screen.queryByLabelText("Loading roles")).not.toBeInTheDocument(),
    );

    resolvePending(summary(["late"]));
    await new Promise((done) => setTimeout(done, 0));
    expect(screen.queryByText("late")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Loading roles")).not.toBeInTheDocument();
  });

  it("loads once per connection and never tests the connection", async () => {
    setWorkspace("a-schemas");
    const { rerender } = renderFooter();
    expect(await screen.findByText("alice")).toBeVisible();

    setWorkspace("a-users");
    rerender();

    expect(window.rolesApi.getSidebarSummary).toHaveBeenCalledTimes(1);
    expect(window.connectionApi.test).not.toHaveBeenCalled();
  });

  it("refetches the role count after an RBAC mutation", async () => {
    setWorkspace("a-schemas");
    const { rerender } = renderFooter();
    expect(await screen.findByText("alice")).toBeVisible();

    vi.mocked(window.rolesApi.getSidebarSummary).mockResolvedValue(
      summary(["alice", "bob"]),
    );
    setWorkspace("a-schemas", 1);
    rerender();

    expect(await screen.findByText("bob")).toBeVisible();
    expect(window.rolesApi.getSidebarSummary).toHaveBeenCalledTimes(2);
  });

  it("reports a failing connection once rather than on every tab switch", async () => {
    vi.mocked(window.rolesApi.getSidebarSummary).mockResolvedValue({
      success: false,
      error: "permission denied",
    });
    setWorkspace("a-schemas");
    const { rerender } = renderFooter();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

    setWorkspace("database-manager");
    rerender();
    setWorkspace("a-schemas");
    rerender();

    await waitFor(() =>
      expect(window.rolesApi.getSidebarSummary).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Loading roles")).not.toBeInTheDocument(),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
