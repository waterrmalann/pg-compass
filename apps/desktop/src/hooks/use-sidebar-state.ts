import { useState } from "react";
import { toast } from "sonner";
import type { ConnectionConfig } from "@/shared/types/connection";

export function useSidebarState() {
  const [formOpen, setFormOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<
    ConnectionConfig | undefined
  >(undefined);

  function handleOpenCreate() {
    setEditingConnection(undefined);
    setFormOpen(true);
  }

  async function handleEdit(connection: ConnectionConfig) {
    // `connection` comes from the (secret-redacted) connection list — fetch
    // the real credentials fresh so the form doesn't open with a blank
    // password/URI that would overwrite the saved secret on save.
    const fresh = await globalThis.window.connectionApi.getById(
      connection.id,
    );
    if (!fresh.success) {
      toast.error(`Failed to load "${connection.label}"`, {
        description: fresh.error,
      });
      return;
    }
    setEditingConnection(fresh.data);
    setFormOpen(true);
  }

  function handleOpenSettings() {
    setSettingsOpen(true);
  }

  return {
    formOpen,
    setFormOpen,
    settingsOpen,
    setSettingsOpen,
    editingConnection,
    handleOpenCreate,
    handleEdit,
    handleOpenSettings,
  };
}
