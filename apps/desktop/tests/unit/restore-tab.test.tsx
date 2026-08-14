import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RestoreTab } from "@/components/workspace/database-manager/restore-tab";
import type { BackupFileInfo } from "@/shared/types/backup";

const settings = { general: { readOnlyMode: false } };

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ settings }),
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({
    connections: [
      {
        id: "prod-conn",
        label: "Billing prod",
        mode: "fields",
        favourite: false,
        fields: {
          host: "10.0.0.5",
          port: 5432,
          database: "",
          user: "",
          password: "",
        },
      },
      {
        id: "dev-conn",
        label: "Local dev",
        mode: "fields",
        favourite: false,
        fields: {
          host: "localhost",
          port: 5432,
          database: "",
          user: "",
          password: "",
        },
      },
    ],
  }),
}));

function backupFile(path: string): BackupFileInfo {
  return {
    path,
    fileName: path.split("/").at(-1) ?? path,
    sizeBytes: 2048,
    mtimeMs: Date.now(),
    target: null,
    createdAt: null,
  };
}

function renderRestoreTab(prefillPath: string | null = null) {
  const onConsumePrefill = vi.fn();
  const view = render(
    <RestoreTab
      prefillPath={prefillPath}
      onConsumePrefill={onConsumePrefill}
      backupsRevision={0}
    />,
  );
  return { view, onConsumePrefill };
}

async function chooseTarget(connectionLabel: string) {
  const user = userEvent.setup();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Target connection" }),
    connectionLabel,
  );
  await waitFor(() =>
    // By label: a production dialog may already hide the page from the a11y tree.
    expect(screen.getByLabelText("Target database")).toHaveValue("app"),
  );
  return user;
}

describe("RestoreTab", () => {
  beforeEach(() => {
    settings.general.readOnlyMode = false;
    Object.assign(window, {
      backupApi: {
        listDatabases: vi
          .fn()
          .mockResolvedValue({ success: true, data: ["app"] }),
        listBackups: vi.fn().mockResolvedValue({ success: true, data: [] }),
        onProgress: vi.fn(() => () => undefined),
        restore: vi
          .fn()
          .mockResolvedValue({ success: true, data: { status: "ok" } }),
        cancel: vi.fn(),
        showRestoreFileDialog: vi.fn(),
      },
    });
  });

  it("refreshes the backup list when a prefill path arrives", async () => {
    const listBackups = vi.mocked(window.backupApi.listBackups);
    const { view, onConsumePrefill } = renderRestoreTab();
    await waitFor(() => expect(listBackups).toHaveBeenCalledTimes(1));

    listBackups.mockResolvedValue({
      success: true,
      data: [backupFile("/backups/fresh.dump")],
    });
    view.rerender(
      <RestoreTab
        prefillPath="/backups/fresh.dump"
        onConsumePrefill={onConsumePrefill}
        backupsRevision={0}
      />,
    );

    await waitFor(() => expect(listBackups).toHaveBeenCalledTimes(2));
    expect(onConsumePrefill).toHaveBeenCalled();
    const select = screen.getByRole("combobox", { name: "Backup to restore" });
    await waitFor(() => expect(select).toHaveValue("/backups/fresh.dump"));
    expect(
      screen.getByRole("option", { name: /fresh\.dump \(2\.0 KB/ }),
    ).toBeInTheDocument();
  });

  it("keeps a missing prefilled file visible but refuses to run it", async () => {
    renderRestoreTab("/backups/deleted.dump");
    const user = await chooseTarget("Local dev");
    await user.type(screen.getByLabelText(/to confirm/), "app");

    const select = screen.getByRole("combobox", { name: "Backup to restore" });
    expect(select).toHaveValue("/backups/deleted.dump");
    expect(
      screen.getByRole("option", { name: "deleted.dump (not in backup list)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run restore" })).toBeDisabled();
  });

  it("requires production confirmation and sends confirmProduction", async () => {
    vi.mocked(window.backupApi.listBackups).mockResolvedValue({
      success: true,
      data: [backupFile("/backups/a.dump")],
    });
    renderRestoreTab("/backups/a.dump");

    const user = await chooseTarget("Billing prod");
    expect(
      await screen.findByText("Production database selected"),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Yes, use it as target" }),
    );
    await user.type(screen.getByLabelText(/to confirm/), "app");

    const run = screen.getByRole("button", { name: "Run restore" });
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);

    await waitFor(() =>
      expect(window.backupApi.restore).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { connectionId: "prod-conn", database: "app" },
          backupPath: "/backups/a.dump",
          confirmProduction: true,
          backupTarget: true,
        }),
      ),
    );
  });

  it("does not claim production confirmation for other targets", async () => {
    vi.mocked(window.backupApi.listBackups).mockResolvedValue({
      success: true,
      data: [backupFile("/backups/a.dump")],
    });
    renderRestoreTab("/backups/a.dump");

    const user = await chooseTarget("Local dev");
    expect(
      screen.queryByText("Production database selected"),
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/to confirm/), "app");
    await user.click(screen.getByRole("button", { name: "Run restore" }));

    await waitFor(() =>
      expect(window.backupApi.restore).toHaveBeenCalledWith(
        expect.objectContaining({ confirmProduction: false }),
      ),
    );
  });

  it("picks a file through the backup API's restore file dialog", async () => {
    vi.mocked(window.backupApi.showRestoreFileDialog).mockResolvedValue({
      success: true,
      data: "/elsewhere/manual.dump",
    });
    renderRestoreTab();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Browse for file" }));
    await user.click(screen.getByRole("button", { name: "Browse…" }));

    expect(
      await screen.findByDisplayValue("/elsewhere/manual.dump"),
    ).toBeInTheDocument();
  });

  it("disables running a restore in read-only mode", async () => {
    settings.general.readOnlyMode = true;
    vi.mocked(window.backupApi.listBackups).mockResolvedValue({
      success: true,
      data: [backupFile("/backups/a.dump")],
    });
    renderRestoreTab("/backups/a.dump");

    const user = await chooseTarget("Local dev");
    await user.type(screen.getByLabelText(/to confirm/), "app");

    expect(screen.getByText(/Read-only mode is on/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Run restore" })).toBeDisabled();
  });
});
