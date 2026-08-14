import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateSecurePassword } from "@/components/workspace/rbac/password-input";
import { RoleDetail } from "@/components/workspace/rbac/role-detail";
import { isValidPgName } from "@/components/workspace/rbac/shared";
import type { CurrentUser, PgRole } from "@/shared/types/roles";

const settings = { general: { readOnlyMode: false } };

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ settings }),
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

function currentUser(isSuperuser: boolean, name = "postgres"): CurrentUser {
  return {
    name,
    isSuperuser,
    canLogin: true,
    canCreateRole: isSuperuser,
    canCreateDb: isSuperuser,
  };
}

function renderDetail({
  selected = role("alice"),
  isAdmin = true,
  user = currentUser(true),
}: {
  selected?: PgRole;
  isAdmin?: boolean;
  user?: CurrentUser;
} = {}) {
  const onAfterMutation = vi.fn();
  render(
    <TooltipProvider>
      <RoleDetail
        connectionId="conn-1"
        role={selected}
        memberships={[]}
        databases={[]}
        accessTargetUser={selected.name}
        allRoles={[role("postgres", { isSuperuser: true }), selected]}
        isAdmin={isAdmin}
        currentUser={user}
        onSelectRole={vi.fn()}
        onAfterMutation={onAfterMutation}
      />
    </TooltipProvider>,
  );
  return { onAfterMutation };
}

describe("RoleDetail", () => {
  beforeEach(() => {
    settings.general.readOnlyMode = false;
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
        createRole: vi
          .fn()
          .mockResolvedValue({ success: true, data: undefined }),
        alterRolePassword: vi
          .fn()
          .mockResolvedValue({ success: true, data: undefined }),
      },
      clipboardApi: { writeText: vi.fn() },
    });
  });

  it("forgets a generated password when the reset dialog is closed", async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await user.click(screen.getByRole("button", { name: "Generate" }));
    const generated = (
      screen.getByLabelText("New password") as HTMLInputElement
    ).value;
    expect(generated).toHaveLength(20);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Generate" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Copy password" }),
    ).not.toBeInTheDocument();
  });

  it("forgets a typed password when the reset dialog is dismissed", async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await user.type(screen.getByLabelText("New password"), "hunter2");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("does not send a password when creating a role without login", async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole("button", { name: "New" }));
    await user.type(screen.getByLabelText("Name"), "reporting");
    await user.click(screen.getByRole("switch", { name: "Login" }));
    await user.type(screen.getByLabelText("Password"), "secret-pw");
    await user.click(screen.getByRole("switch", { name: "Login" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(window.rolesApi.createRole).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "reporting",
          login: false,
          password: undefined,
        }),
      ),
    );
  });

  it("sends the password when creating a login role", async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole("button", { name: "New" }));
    await user.type(screen.getByLabelText("Name"), "app user");
    await user.click(screen.getByRole("switch", { name: "Login" }));
    await user.type(screen.getByLabelText("Password"), "secret-pw");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(window.rolesApi.createRole).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "app user",
          login: true,
          password: "secret-pw",
        }),
      ),
    );
  });

  it("hides 'Reset my password' for non-superuser connections", () => {
    renderDetail({
      selected: role("reader"),
      isAdmin: false,
      user: currentUser(false, "reader"),
    });

    expect(
      screen.queryByRole("button", { name: /Reset my password/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reset password" }),
    ).not.toBeInTheDocument();
  });

  it("shows 'Reset my password' to a superuser viewing their own role", () => {
    renderDetail({ selected: role("postgres", { isSuperuser: true }) });

    expect(
      screen.getByRole("button", { name: /Reset my password/ }),
    ).toBeEnabled();
  });

  it("shows an unknown password state instead of guessing", () => {
    renderDetail({ selected: role("alice", { hasPassword: null }) });

    expect(screen.getByText("unknown")).toBeVisible();
  });

  it("disables role mutations in read-only mode and says why", () => {
    settings.general.readOnlyMode = true;
    renderDetail();

    expect(screen.getByText(/Read-only mode is on/)).toBeVisible();
    for (const name of [
      "New",
      "Clone role",
      "Rename role",
      "Edit role attributes",
      "Reset password",
      "Drop role",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });
});

describe("rbac helpers", () => {
  it("generates passwords from crypto.getRandomValues", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");

    const password = generateSecurePassword(24);

    expect(password).toHaveLength(24);
    expect(spy).toHaveBeenCalledWith(expect.any(Uint32Array));
    spy.mockRestore();
  });

  it("accepts any non-empty name up to 63 UTF-8 bytes without NUL", () => {
    expect(isValidPgName("analytics_reader")).toBe(true);
    expect(isValidPgName("Reporting Team")).toBe(true);
    expect(isValidPgName("app-user.v2")).toBe(true);
    expect(isValidPgName("é".repeat(31))).toBe(true);
    expect(isValidPgName("a".repeat(63))).toBe(true);

    expect(isValidPgName("")).toBe(false);
    expect(isValidPgName("a".repeat(64))).toBe(false);
    expect(isValidPgName("é".repeat(32))).toBe(false);
    expect(isValidPgName("bad\0name")).toBe(false);
  });
});
