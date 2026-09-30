import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "@/shared/types/settings";
import type { PsqlLocation } from "@/shared/types/shell";

const mocks = vi.hoisted(() => ({
  settings: null as AppSettings | null,
  updateSettings: vi.fn(),
  forceOpenTab: vi.fn(),
  toast: vi.fn(),
  locatePsql: vi.fn(),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({ forceOpenTab: mocks.forceOpenTab }),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

import { ViewerShell } from "@/components/workspace/viewer-shell";

const path = { connectionId: "conn-1", connectionLabel: "Shop" };

function withSettings(general: Partial<AppSettings["general"]>) {
  mocks.settings = {
    ...DEFAULT_APP_SETTINGS,
    general: { ...DEFAULT_APP_SETTINGS.general, ...general },
  };
}

function psqlAt(location: Partial<PsqlLocation>) {
  mocks.locatePsql.mockResolvedValue({
    success: true,
    data: { path: null, source: null, platform: "darwin", ...location },
  });
}

function renderShell() {
  return render(
    <ViewerShell breadcrumb={[{ label: "Shop" }]} shellPath={path}>
      content
    </ViewerShell>,
  );
}

describe("Open shell button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withSettings({ shellAccess: true });
    Object.defineProperty(window, "shellApi", {
      configurable: true,
      value: { locatePsql: mocks.locatePsql },
    });
  });

  it("opens a new shell tab when psql is available", async () => {
    psqlAt({ path: "/usr/bin/psql", source: "path" });
    const user = userEvent.setup();
    renderShell();

    const button = await screen.findByRole("button", { name: "Open shell" });
    await waitFor(() => expect(mocks.locatePsql).toHaveBeenCalled());
    await user.click(button);

    expect(button).not.toHaveAttribute("aria-disabled");
    expect(mocks.forceOpenTab).toHaveBeenCalledWith({ type: "shell", path });
  });

  it("is disabled with install steps when psql is missing", async () => {
    psqlAt({ problem: "psql was not found." });
    const user = userEvent.setup();
    renderShell();

    // The unavailable state renders a different button, so query after it.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open shell" }),
      ).toHaveAttribute("aria-disabled", "true"),
    );
    const button = screen.getByRole("button", { name: "Open shell" });
    expect(button).toHaveAttribute(
      "aria-description",
      expect.stringMatching(/brew install libpq.*Settings → General/),
    );

    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "psql not found. Install it with Homebrew (brew install libpq) or Postgres.app. Or set its path in Settings → General.",
    );

    await user.click(button);
    expect(mocks.forceOpenTab).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("shows the configured-path problem instead of install steps", async () => {
    withSettings({ shellAccess: true, psqlPath: "/opt/psql" });
    psqlAt({
      platform: "linux",
      problem: "No executable psql at /opt/psql.",
    });
    renderShell();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open shell" }),
      ).toHaveAttribute(
        "aria-description",
        "No executable psql at /opt/psql. Fix or clear the psql path in Settings → General.",
      ),
    );
  });

  it("offers to turn shell access on when it is off", async () => {
    withSettings({ shellAccess: false });
    psqlAt({ path: "/usr/bin/psql", source: "path" });
    mocks.updateSettings.mockResolvedValue({
      ...DEFAULT_APP_SETTINGS,
      general: { ...DEFAULT_APP_SETTINGS.general, shellAccess: true },
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Open shell" }));
    expect(mocks.forceOpenTab).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      "Shell access is off",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Turn on" }),
      }),
    );

    const options = mocks.toast.mock.calls[0]?.[1] as {
      action: { onClick: () => void };
    };
    options.action.onClick();
    await waitFor(() =>
      expect(mocks.forceOpenTab).toHaveBeenCalledWith({ type: "shell", path }),
    );
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      general: { shellAccess: true },
    });
  });
});
