import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildConnectionString,
  ConnectionItem,
} from "@/components/connections/connection-item";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConnections } from "@/hooks/use-connections";
import { useWorkspace } from "@/hooks/use-workspace";
import type { ConnectionConfig } from "@/shared/types/connection";

vi.mock("@/hooks/use-connections", () => ({
  useConnections: vi.fn(),
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const uriConnection: ConnectionConfig = {
  id: "conn-1",
  label: "Local",
  favourite: false,
  mode: "uri",
  uri: "postgresql://postgres:secret@localhost:5432/app",
};

const fieldConnection: ConnectionConfig = {
  id: "conn-2",
  label: "Field Local",
  favourite: false,
  mode: "fields",
  fields: {
    host: "localhost",
    port: 5432,
    database: "app db",
    user: "app user",
    password: "sec/ret",
  },
};

describe("ConnectionItem", () => {
  beforeEach(() => {
    vi.mocked(useConnections).mockReturnValue({
      connections: [],
      loading: false,
      refresh: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      toggleFavourite: vi.fn(),
      testConnection: vi.fn(),
      getSchemaTree: vi.fn(),
    });

    vi.mocked(useWorkspace).mockReturnValue({
      tabs: [],
      activeTabId: null,
      schemaCache: {},
      setActiveTab: vi.fn(),
      closeTab: vi.fn(),
      closeConnectionTabs: vi.fn(),
      closeAllTabs: vi.fn(),
      moveTab: vi.fn(),
      openTab: vi.fn(),
      forceOpenTab: vi.fn(),
      navigateToView: vi.fn(),
      refreshSchemaTree: vi.fn(),
      refreshSchemaTreeWithStatus: vi
        .fn()
        .mockResolvedValue({ ok: true, data: [] }),
      refreshTabs: vi.fn(),
      relationSessions: {},
      updateRelationSession: vi.fn(),
      rolesRevision: 0,
      notifyRolesChanged: vi.fn(),
    });

    Object.assign(window, {
      connectionApi: {
        getById: vi
          .fn()
          .mockResolvedValue({ success: true, data: uriConnection }),
      },
      clipboardApi: {
        writeText: vi.fn().mockResolvedValue({ success: true }),
      },
    });
  });

  it("copies the stored URI, not the redacted list copy, from the context menu", async () => {
    const user = userEvent.setup();
    // The sidebar list strips secrets, so the item must fetch the stored copy.
    const listedConnection: ConnectionConfig = { ...uriConnection, uri: "" };

    render(
      <TooltipProvider>
        <ConnectionItem
          connection={listedConnection}
          onEdit={vi.fn()}
          connected={false}
          onConnectedChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Copy connection string",
      }),
    );

    await waitFor(() =>
      expect(window.clipboardApi.writeText).toHaveBeenCalledWith(
        "postgresql://postgres:secret@localhost:5432/app",
      ),
    );
    expect(window.connectionApi.getById).toHaveBeenCalledWith("conn-1");
  });

  it("builds a PostgreSQL URL from individual connection fields", () => {
    expect(buildConnectionString(fieldConnection)).toBe(
      "postgresql://app%20user:sec%2Fret@localhost:5432/app%20db",
    );
  });

  it("requires explicit confirmation before deleting the local connection", async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue(true);
    const closeConnectionTabs = vi.fn();
    vi.mocked(useConnections).mockReturnValue({
      ...vi.mocked(useConnections)(),
      remove,
    });
    vi.mocked(useWorkspace).mockReturnValue({
      ...vi.mocked(useWorkspace)(),
      closeConnectionTabs,
    });

    render(
      <TooltipProvider>
        <ConnectionItem
          connection={uriConnection}
          onEdit={vi.fn()}
          connected={false}
          onConnectedChange={vi.fn()}
        />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Delete saved connection" }),
    );
    await waitFor(() => expect(remove).toHaveBeenCalledWith("conn-1"));
    expect(closeConnectionTabs).toHaveBeenCalledWith("conn-1");
  });

  it("keeps the delete dialog open and tabs intact when deleting fails", async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue(false);
    const closeConnectionTabs = vi.fn();
    const onConnectedChange = vi.fn();
    vi.mocked(useConnections).mockReturnValue({
      ...vi.mocked(useConnections)(),
      remove,
    });
    vi.mocked(useWorkspace).mockReturnValue({
      ...vi.mocked(useWorkspace)(),
      closeConnectionTabs,
    });

    render(
      <TooltipProvider>
        <ConnectionItem
          connection={uriConnection}
          onEdit={vi.fn()}
          connected={true}
          onConnectedChange={onConnectedChange}
        />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(
      screen.getByRole("button", { name: "Delete saved connection" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to delete "Local"'),
    );
    expect(
      screen.getByRole("button", { name: "Delete saved connection" }),
    ).toBeEnabled();
    expect(closeConnectionTabs).not.toHaveBeenCalled();
    expect(onConnectedChange).not.toHaveBeenCalled();
  });
});
