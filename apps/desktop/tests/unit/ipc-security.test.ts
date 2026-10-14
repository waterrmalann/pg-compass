import { beforeEach, describe, expect, it, vi } from "vitest";

const { handle } = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle },
}));

import {
  approveSavePath,
  configureIpcSecurity,
  consumeApprovedSavePath,
  registerIpcHandler,
} from "@/main/ipc-security";

function createEvent(url = "file:///app/index.html", senderId = 1) {
  const mainFrame = { url };
  return {
    senderFrame: mainFrame,
    sender: {
      id: senderId,
      mainFrame,
      once: vi.fn(),
    },
  };
}

describe("IPC sender and file capability security", () => {
  beforeEach(() => {
    handle.mockReset();
    configureIpcSecurity("file:///app/index.html");
  });

  it("rejects handlers invoked by a different renderer", async () => {
    registerIpcHandler("test:channel", () => "ok");
    const wrappedHandler = handle.mock.calls[0]?.[1] as (
      event: unknown,
    ) => unknown;

    expect(wrappedHandler(createEvent())).toBe("ok");
    expect(() => wrappedHandler(createEvent("https://evil.example/"))).toThrow(
      /untrusted renderer/,
    );
  });

  it("accepts the trusted page with a hash or query string", () => {
    registerIpcHandler("test:channel", () => "ok");
    const wrappedHandler = handle.mock.calls[0]?.[1] as (
      event: unknown,
    ) => unknown;

    expect(
      wrappedHandler(createEvent("file:///app/index.html?tab=1#/settings")),
    ).toBe("ok");
  });

  it.each([
    [
      "a subframe showing the trusted page",
      () => ({
        ...createEvent(),
        senderFrame: { url: "file:///app/index.html" },
      }),
    ],
    ["another local page", () => createEvent("file:///app/other.html")],
  ])("rejects %s", (_label, buildEvent) => {
    registerIpcHandler("test:channel", () => "ok");
    const wrappedHandler = handle.mock.calls[0]?.[1] as (
      event: unknown,
    ) => unknown;

    expect(() => wrappedHandler(buildEvent())).toThrow(/untrusted renderer/);
  });
  it("consumes an approved save path only once and only for its sender", () => {
    const event = createEvent();
    const approvedPath = approveSavePath(
      event as never,
      "export.csv",
      "export",
    );

    expect(
      consumeApprovedSavePath(event as never, approvedPath, "export"),
    ).toBe(approvedPath);
    expect(() =>
      consumeApprovedSavePath(event as never, approvedPath, "export"),
    ).toThrow(/not approved/);

    const otherEvent = createEvent(undefined, 2);
    approveSavePath(event as never, "second.csv", "export");
    expect(() =>
      consumeApprovedSavePath(otherEvent as never, "second.csv", "export"),
    ).toThrow(/not approved/);
  });

  it("binds grants to an operation and expires abandoned paths", () => {
    vi.useFakeTimers();
    const event = createEvent();
    const dumpPath = approveSavePath(event as never, "dump.sql", "sql-dump");

    expect(() =>
      consumeApprovedSavePath(event as never, dumpPath, "export"),
    ).toThrow(/not approved/);

    const exportPath = approveSavePath(event as never, "export.csv", "export");
    vi.advanceTimersByTime(5 * 60 * 1_000 + 1);
    expect(() =>
      consumeApprovedSavePath(event as never, exportPath, "export"),
    ).toThrow(/not approved/);
    vi.useRealTimers();
  });
});
