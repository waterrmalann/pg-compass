import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionChannels } from "@/shared/constants/ipc-channels";

interface FakeClient {
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  clients: [] as FakeClient[],
  queryError: null as Error | null,
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.handle },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
}));

vi.mock("pg", () => {
  class Client {
    connect = vi.fn(async () => undefined);
    query = vi.fn(async () => {
      if (mocks.queryError) throw mocks.queryError;
      return { rows: [{ "?column?": 1 }] };
    });
    end = vi.fn(async () => undefined);
    constructor() {
      mocks.clients.push(this);
    }
  }
  class Pool {}
  return { Client, Pool };
});

vi.mock("@/main/connection-store", () => ({
  getAllConnections: () => [],
  getConnectionById: (id: string) =>
    id === "local"
      ? {
          id: "local",
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
        }
      : undefined,
}));

import { configureIpcSecurity } from "@/main/ipc-security";
import { registerConnectionHandlers } from "@/main/connection-ipc";

const RENDERER_URL = "file:///app/index.html";
const mainFrame = { url: RENDERER_URL };
const event = { senderFrame: mainFrame, sender: { id: 1, mainFrame } };

function getHandler(channel: string) {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel);
  return call![1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
}

describe("connection test handler", () => {
  beforeEach(() => {
    mocks.handle.mockReset();
    mocks.clients.length = 0;
    mocks.queryError = null;
    configureIpcSecurity(RENDERER_URL);
    registerConnectionHandlers();
  });

  it("reports success and closes the probe connection", async () => {
    const result = await getHandler(ConnectionChannels.TEST)(event, "local");
    expect(result).toEqual({ success: true, data: true });
    expect(mocks.clients).toHaveLength(1);
    expect(mocks.clients[0]!.end).toHaveBeenCalledOnce();
  });

  it("closes the probe connection when the test query fails", async () => {
    mocks.queryError = new Error("canceling statement due to timeout");
    const result = await getHandler(ConnectionChannels.TEST)(event, "local");
    expect(result).toEqual({
      success: false,
      error: "canceling statement due to timeout",
    });
    expect(mocks.clients[0]!.end).toHaveBeenCalledOnce();
  });
});
