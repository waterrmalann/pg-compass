import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "@/shared/types/settings";

const mocks = vi.hoisted(() => ({
  settings: null as AppSettings | null,
  updateSettings: vi.fn(),
  locatePsql: vi.fn(),
  showOpenFileDialog: vi.fn(),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

import { PsqlPathSetting } from "@/components/settings/psql-path-setting";

function withPsqlPath(psqlPath: string) {
  mocks.settings = {
    ...DEFAULT_APP_SETTINGS,
    general: { ...DEFAULT_APP_SETTINGS.general, psqlPath },
  };
}

describe("psql path setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withPsqlPath("");
    mocks.locatePsql.mockResolvedValue({
      success: true,
      data: { path: "/usr/bin/psql", source: "path", platform: "linux" },
    });
    Object.defineProperty(window, "shellApi", {
      configurable: true,
      value: { locatePsql: mocks.locatePsql },
    });
    Object.defineProperty(window, "connectionApi", {
      configurable: true,
      value: { showOpenFileDialog: mocks.showOpenFileDialog },
    });
  });

  it("shows which psql the shell will use", async () => {
    render(<PsqlPathSetting />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Using /usr/bin/psql from your PATH.",
    );
    expect(screen.getByLabelText("psql path")).toHaveValue("");
  });

  it("shows install steps when psql is missing", async () => {
    mocks.locatePsql.mockResolvedValue({
      success: true,
      data: { path: null, source: null, platform: "win32", problem: "x" },
    });
    render(<PsqlPathSetting />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /psql not found\. Install it with the PostgreSQL installer/,
    );
  });

  it("saves a typed path on Enter, trimmed", async () => {
    const user = userEvent.setup();
    render(<PsqlPathSetting />);

    await user.type(
      screen.getByLabelText("psql path"),
      "  /opt/pg/bin/psql {Enter}",
    );
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      general: { psqlPath: "/opt/pg/bin/psql" },
    });
  });

  it("does not save an unchanged path on blur", async () => {
    const user = userEvent.setup();
    render(<PsqlPathSetting />);

    await user.click(screen.getByLabelText("psql path"));
    await user.tab();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("saves a path chosen with Browse", async () => {
    mocks.showOpenFileDialog.mockResolvedValue({
      success: true,
      data: "/Applications/Postgres.app/Contents/Versions/17/bin/psql",
    });
    const user = userEvent.setup();
    render(<PsqlPathSetting />);

    await user.click(screen.getByRole("button", { name: "Browse" }));
    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        general: {
          psqlPath: "/Applications/Postgres.app/Contents/Versions/17/bin/psql",
        },
      }),
    );
    expect(mocks.showOpenFileDialog).toHaveBeenCalledWith({
      title: "Choose psql",
      defaultPath: undefined,
    });
  });

  it("keeps settings pointers out of the Settings dialog", async () => {
    withPsqlPath("/opt/psql");
    mocks.locatePsql.mockResolvedValue({
      success: true,
      data: {
        path: null,
        source: null,
        platform: "linux",
        problem: "No executable psql at /opt/psql.",
      },
    });
    render(<PsqlPathSetting />);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("No executable psql at /opt/psql.");
    expect(status).not.toHaveTextContent(/Settings/);
  });

  it("clears a configured path back to automatic search", async () => {
    withPsqlPath("/opt/pg/bin/psql");
    mocks.locatePsql.mockResolvedValue({
      success: true,
      data: { path: "/opt/pg/bin/psql", source: "setting", platform: "linux" },
    });
    const user = userEvent.setup();
    render(<PsqlPathSetting />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Using /opt/pg/bin/psql from this path.",
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      general: { psqlPath: "" },
    });
  });
});
