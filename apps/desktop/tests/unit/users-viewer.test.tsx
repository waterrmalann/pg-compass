import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UsersViewer } from "@/components/workspace/users-viewer";
import type { IpcResult } from "@/shared/types/ipc";
import type { PgRole, RolesSnapshot } from "@/shared/types/roles";

const notifyRolesChanged = vi.fn();

// The Open shell button looks psql up over IPC; not under test here.
vi.mock("@/hooks/use-psql-location", () => ({
  usePsqlLocation: () => ({ location: null, recheck: () => undefined }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({ navigateToView: vi.fn(), notifyRolesChanged }),
}));
vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: { general: { readOnlyMode: false, hideInternalSchemas: true } },
  }),
}));

function role(name: string, overrides: Partial<PgRole> = {}): PgRole {
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
    ...overrides,
  };
}

function snapshotFor(targetUser: string): RolesSnapshot {
  return {
    currentUser: {
      name: "postgres",
      isSuperuser: true,
      canLogin: true,
      canCreateRole: true,
      canCreateDb: true,
    },
    roles: [
      role("postgres", { isSuperuser: true }),
      role("alice"),
      role("bob"),
    ],
    memberships: [],
    databases: [
      {
        name: "app",
        isTemplate: false,
        allowConnections: true,
        owner: "postgres",
        size: "8 MB",
        schemaCount: 1,
        roleCount: 2,
        canConnect: true,
        canCreate: false,
        canTemp: false,
        level: targetUser === "bob" ? "readwrite" : "readonly",
        tables: [],
      },
    ],
    targetUser,
    stats: {
      totalDatabases: 1,
      totalRoles: 3,
      totalUsers: 3,
      superusersCount: 1,
      activeConnections: 1,
    },
  };
}

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

function renderViewer(selectedRole?: string) {
  return render(
    <TooltipProvider>
      <UsersViewer
        path={{
          connectionId: "conn-1",
          connectionLabel: "Local",
          selectedRole,
        }}
      />
    </TooltipProvider>,
  );
}

describe("UsersViewer snapshot targeting", () => {
  beforeEach(() => {
    notifyRolesChanged.mockClear();
    // Radix ScrollArea measures its viewport; jsdom has no ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.assign(window, {
      rolesApi: {
        getSnapshot: vi.fn((_connectionId: string, targetUser?: string) =>
          Promise.resolve(ok(snapshotFor(targetUser ?? "postgres"))),
        ),
        getEffectivePermissions: vi.fn(() => new Promise(() => undefined)),
        alterRoleComment: vi.fn(),
      },
    });
  });

  it("fetches one snapshot targeted at the role the tab was opened for", async () => {
    renderViewer("alice");

    expect(await screen.findByRole("heading", { name: "alice" })).toBeVisible();
    expect(window.rolesApi.getSnapshot).toHaveBeenCalledTimes(1);
    expect(window.rolesApi.getSnapshot).toHaveBeenCalledWith("conn-1", "alice");
  });

  it("defaults to the current user without a second request", async () => {
    renderViewer();

    expect(
      await screen.findByRole("heading", { name: "postgres" }),
    ).toBeVisible();
    expect(window.rolesApi.getSnapshot).toHaveBeenCalledTimes(1);
    expect(window.rolesApi.getSnapshot).toHaveBeenCalledWith(
      "conn-1",
      undefined,
    );
    expect(screen.getByRole("button", { current: true })).toHaveTextContent(
      "postgres",
    );
  });

  it("shows access rows only once the snapshot matches the selected role", async () => {
    const user = userEvent.setup();
    renderViewer("alice");
    await screen.findByRole("heading", { name: "alice" });

    let resolveBob: (value: IpcResult<RolesSnapshot>) => void = () => undefined;
    vi.mocked(window.rolesApi.getSnapshot).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBob = resolve;
        }),
    );

    await user.click(screen.getByRole("button", { name: /^bob/ }));
    await user.click(screen.getByRole("tab", { name: "Database access" }));

    expect(window.rolesApi.getSnapshot).toHaveBeenLastCalledWith(
      "conn-1",
      "bob",
    );
    expect(screen.getByText("Loading database access…")).toBeVisible();
    expect(
      screen.queryByRole("group", { name: "Access level on app" }),
    ).not.toBeInTheDocument();

    resolveBob(ok(snapshotFor("bob")));

    const levels = await screen.findByRole("group", {
      name: "Access level on app",
    });
    expect(levels.querySelector("[aria-pressed='true']")).toHaveTextContent(
      "Read + write",
    );
    expect(window.rolesApi.getSnapshot).toHaveBeenCalledTimes(2);
  });
});
