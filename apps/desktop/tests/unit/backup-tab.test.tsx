import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BackupTab } from "@/components/workspace/database-manager/backup-tab";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ connections: [] }),
}));

function renderBackupTab() {
  const onBackupsChanged = vi.fn();
  render(
    <TooltipProvider>
      <BackupTab
        onUseForRestore={vi.fn()}
        onBackupsChanged={onBackupsChanged}
      />
    </TooltipProvider>,
  );
  return { onBackupsChanged };
}

describe("BackupTab", () => {
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
      backupApi: {
        listDatabases: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listBackups: vi.fn().mockResolvedValue({
          success: true,
          data: [
            {
              path: "/backups/app.dump",
              fileName: "app.dump",
              sizeBytes: 1024,
              mtimeMs: Date.now(),
              target: "Local:app",
              createdAt: null,
            },
          ],
        }),
        inspectBackup: vi
          .fn()
          .mockRejectedValue(new Error("pg_restore missing")),
        deleteBackup: vi.fn().mockRejectedValue(new Error("EPERM")),
        onProgress: vi.fn(() => () => undefined),
      },
    });
  });

  it("shows inspection failures inline and exposes the expanded state", async () => {
    const user = userEvent.setup();
    renderBackupTab();
    const toggle = await screen.findByRole("button", { name: /^app\.dump/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("pg_restore missing")).toBeVisible();
  });

  it("re-enables the delete dialog when removing a backup throws", async () => {
    const user = userEvent.setup();
    const { onBackupsChanged } = renderBackupTab();
    await user.click(
      await screen.findByRole("button", { name: "Remove backup app.dump" }),
    );
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to remove backup", {
        description: "EPERM",
      }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Remove" }),
    ).toBeEnabled();
    expect(onBackupsChanged).not.toHaveBeenCalled();
  });
});
