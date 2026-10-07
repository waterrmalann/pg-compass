import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider, useConnections } from "@/hooks/use-connections";
import type { ConnectionConfig } from "@/shared/types/connection";

const baseConnection: ConnectionConfig = {
  id: "conn-1",
  label: "Local",
  favourite: false,
  mode: "fields",
  fields: {
    host: "localhost",
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: "secret",
  },
};

describe("useConnections", () => {
  beforeEach(() => {
    Object.assign(window, {
      connectionApi: {
        getAll: vi.fn().mockResolvedValue({
          success: true,
          data: [baseConnection],
        }),
        create: vi.fn().mockResolvedValue({
          success: true,
          data: { ...baseConnection, id: "conn-2", label: "Created" },
        }),
        update: vi.fn().mockResolvedValue({
          success: true,
          data: { ...baseConnection, label: "Updated" },
        }),
        delete: vi.fn().mockResolvedValue({ success: true, data: true }),
        toggleFavourite: vi.fn().mockResolvedValue({
          success: true,
          data: { ...baseConnection, favourite: true },
        }),
        test: vi.fn().mockResolvedValue({ success: true, data: true }),
        getSchemaTree: vi.fn().mockResolvedValue({
          success: true,
          data: [{ name: "app", tables: ["users"], views: [] }],
        }),
      },
    });
  });

  it("loads connections and reloads them after creating one", async () => {
    const { result } = renderHook(() => useConnections(), {
      wrapper: ConnectionProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.connections).toHaveLength(1);

    let created: ConnectionConfig | null = null;
    await act(async () => {
      created = await result.current.create({
        label: "Created",
        favourite: false,
        mode: "fields",
        fields: baseConnection.fields,
      });
    });

    expect((created as ConnectionConfig | null)?.id).toBe("conn-2");
    // The list is reloaded from the store after a successful create.
    expect(window.connectionApi.getAll).toHaveBeenCalledTimes(2);
  });

  it("returns null and keeps the list when creating fails", async () => {
    vi.mocked(window.connectionApi.create).mockResolvedValueOnce({
      success: false,
      error: "label is required",
    });
    const { result } = renderHook(() => useConnections(), {
      wrapper: ConnectionProvider,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created: ConnectionConfig | null = baseConnection;
    await act(async () => {
      created = await result.current.create({
        label: "",
        favourite: false,
        mode: "fields",
        fields: baseConnection.fields,
      });
    });

    expect(created).toBeNull();
    expect(window.connectionApi.getAll).toHaveBeenCalledTimes(1);
    expect(result.current.connections).toHaveLength(1);
  });
});
