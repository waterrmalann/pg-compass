import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import type { ConnectionConfig } from "@/shared/types/connection";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

// The sidebar list holds secret-redacted copies of each connection.
const listedConnection: ConnectionConfig = {
  id: "conn-1",
  label: "Shop",
  favourite: false,
  mode: "uri",
  uri: "",
};

describe("useSidebarState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(window, {
      connectionApi: { getById: vi.fn() },
    });
  });

  it("opens the edit form with the stored connection, not the redacted list copy", async () => {
    const storedConnection: ConnectionConfig = {
      ...listedConnection,
      uri: "postgresql://app:secret@db.local/shop",
    };
    vi.mocked(window.connectionApi.getById).mockResolvedValue({
      success: true,
      data: storedConnection,
    });
    const { result } = renderHook(() => useSidebarState());

    await act(() => result.current.handleEdit(listedConnection));

    expect(window.connectionApi.getById).toHaveBeenCalledWith("conn-1");
    expect(result.current.editingConnection).toEqual(storedConnection);
    expect(result.current.formOpen).toBe(true);
  });

  it("keeps the edit form closed and shows an error when loading fails", async () => {
    vi.mocked(window.connectionApi.getById).mockResolvedValue({
      success: false,
      error: "Store unavailable",
    });
    const { result } = renderHook(() => useSidebarState());

    await act(() => result.current.handleEdit(listedConnection));

    expect(result.current.formOpen).toBe(false);
    expect(result.current.editingConnection).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith('Failed to load "Shop"', {
      description: "Store unavailable",
    });
  });
});
