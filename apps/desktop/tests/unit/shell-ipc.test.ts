import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShellChannels } from "@/shared/constants/ipc-channels";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  connections: new Map<string, unknown>(),
  settings: { readOnlyMode: false, shellAccess: true },
  psqlPath: "/usr/bin/psql" as string | null,
  spawn: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.handle },
}));

vi.mock("node-pty", () => ({ spawn: mocks.spawn }));

vi.mock("@/main/connection-store", () => ({
  getConnectionById: (id: string) => mocks.connections.get(id),
}));

vi.mock("@/main/settings-store", () => ({
  getSettings: () => ({ general: mocks.settings }),
}));

vi.mock("@/main/shell-process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/shell-process")>()),
  findExecutable: () => mocks.psqlPath,
}));

import { configureIpcSecurity } from "@/main/ipc-security";
import { killAllShellSessions, registerShellHandlers } from "@/main/shell-ipc";

const RENDERER_URL = "file:///app/index.html";
const SESSION_ID = "session-12345678";

function createEvent() {
  const mainFrame = { url: RENDERER_URL };
  return {
    senderFrame: mainFrame,
    sender: {
      id: 1,
      mainFrame,
      once: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
    },
  };
}

function createFakePty() {
  let onData: (data: string) => void = () => undefined;
  let onExit: (event: { exitCode: number }) => void = () => undefined;
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (callback: typeof onData) => {
      onData = callback;
    },
    onExit: (callback: typeof onExit) => {
      onExit = callback;
    },
    emitData: (data: string) => onData(data),
    emitExit: (exitCode: number) => onExit({ exitCode }),
  };
}

function handler(channel: string) {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`No handler for ${channel}`);
  return call[1] as (event: unknown, input: unknown) => Promise<unknown>;
}

function startInput() {
  return { sessionId: SESSION_ID, connectionId: "local", cols: 80, rows: 24 };
}

describe("shell IPC", () => {
  beforeEach(() => {
    mocks.handle.mockReset();
    mocks.spawn.mockReset();
    mocks.settings = { readOnlyMode: false, shellAccess: true };
    mocks.psqlPath = "/usr/bin/psql";
    mocks.connections.set("local", {
      id: "local",
      label: "Local",
      favourite: false,
      mode: "fields",
      fields: {
        host: "localhost",
        port: 5432,
        database: "shop",
        user: "demo",
        password: "secret",
      },
    });
    killAllShellSessions();
    configureIpcSecurity(RENDERER_URL);
    registerShellHandlers();
  });

  it("refuses to start while shell access is off", async () => {
    mocks.settings.shellAccess = false;
    const result = await handler(ShellChannels.START)(
      createEvent(),
      startInput(),
    );
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/Shell access is turned off/),
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("explains a missing psql", async () => {
    mocks.psqlPath = null;
    const result = await handler(ShellChannels.START)(
      createEvent(),
      startInput(),
    );
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/psql not found/),
    });
  });

  it("spawns psql and bridges input, output, resize and exit", async () => {
    const fakePty = createFakePty();
    mocks.spawn.mockReturnValue(fakePty);
    mocks.settings.readOnlyMode = true;
    const event = createEvent();

    const result = await handler(ShellChannels.START)(event, startInput());
    expect(result).toEqual({
      success: true,
      data: { database: "shop", readOnly: true },
    });

    const [file, args, options] = mocks.spawn.mock.calls[0] as [
      string,
      string[],
      { cols: number; rows: number; env: Record<string, string> },
    ];
    expect(file).toBe("/usr/bin/psql");
    expect(args[0]).toMatch(/^--dbname=.*dbname='shop'/);
    expect(args.join(" ")).not.toContain("secret");
    expect(options).toMatchObject({ cols: 80, rows: 24 });
    expect(options.env).toMatchObject({
      PGPASSWORD: "secret",
      PGOPTIONS: "-c default_transaction_read_only=on",
    });

    await handler(ShellChannels.WRITE)(event, {
      sessionId: SESSION_ID,
      data: "\\dt\r",
    });
    expect(fakePty.write).toHaveBeenCalledWith("\\dt\r");

    await handler(ShellChannels.RESIZE)(event, {
      sessionId: SESSION_ID,
      cols: 120,
      rows: 40,
    });
    expect(fakePty.resize).toHaveBeenCalledWith(120, 40);

    fakePty.emitData("shop=# ");
    expect(event.sender.send).toHaveBeenCalledWith(ShellChannels.DATA, {
      sessionId: SESSION_ID,
      data: "shop=# ",
    });

    fakePty.emitExit(0);
    expect(event.sender.send).toHaveBeenCalledWith(ShellChannels.EXIT, {
      sessionId: SESSION_ID,
      exitCode: 0,
    });
    const afterExit = await handler(ShellChannels.WRITE)(event, {
      sessionId: SESSION_ID,
      data: "x",
    });
    expect(afterExit).toMatchObject({ success: false });
  });

  it("kills a session on request and rejects duplicate ids", async () => {
    const fakePty = createFakePty();
    mocks.spawn.mockReturnValue(fakePty);
    const event = createEvent();

    await handler(ShellChannels.START)(event, startInput());
    const duplicate = await handler(ShellChannels.START)(event, startInput());
    expect(duplicate).toMatchObject({ success: false });

    await handler(ShellChannels.KILL)(event, { sessionId: SESSION_ID });
    expect(fakePty.kill).toHaveBeenCalled();
  });

  it("rejects malformed input", async () => {
    const result = await handler(ShellChannels.START)(createEvent(), {
      ...startInput(),
      cols: 0,
    });
    expect(result).toMatchObject({ success: false });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
