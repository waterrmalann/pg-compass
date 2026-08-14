import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/shared/types/connection";
import { BackupChannels } from "@/shared/constants/ipc-channels";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  userDataDir: "",
  connections: new Map<string, unknown>(),
  readOnlyMode: false,
  runPgTool: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => mocks.userDataDir },
  ipcMain: { handle: mocks.handle },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
}));

vi.mock("@/main/connection-store", () => ({
  getConnectionById: (id: string) => mocks.connections.get(id),
}));

vi.mock("@/main/settings-store", () => ({
  getSettings: () => ({ general: { readOnlyMode: mocks.readOnlyMode } }),
}));

vi.mock("@/main/audit-store", () => ({ logAudit: vi.fn() }));

vi.mock("@/main/pg-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/pg-utils")>()),
  withPoolClient: vi.fn(async () => {
    throw new Error("no database in unit tests");
  }),
}));

vi.mock("@/main/backup-process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/backup-process")>()),
  runPgTool: mocks.runPgTool,
}));

import { approveSavePath, configureIpcSecurity } from "@/main/ipc-security";
import { backupsDir, isInsideDir } from "@/main/backup-files";
import {
  assertRestoreAllowed,
  registerBackupHandlers,
  resolveRestoreSource,
} from "@/main/backup-ipc";

const RENDERER_URL = "file:///app/index.html";

function createEvent(senderId = 1) {
  const mainFrame = { url: RENDERER_URL };
  return {
    senderFrame: mainFrame,
    sender: {
      id: senderId,
      mainFrame,
      once: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
    },
  };
}

function buildConnection(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
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
    ...overrides,
  };
}

function restoreInput(backupPath: string, extra: Record<string, unknown> = {}) {
  return {
    runId: "run-12345678",
    target: { connectionId: "local", database: "app" },
    backupPath,
    ...extra,
  };
}

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`No handler registered for ${channel}`);
  return call[1] as Handler;
}

function writeOutsideDump(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-compass-outside-"));
  const filePath = path.join(dir, "picked.dump");
  fs.writeFileSync(filePath, "dump");
  return filePath;
}

describe("backup IPC", () => {
  beforeEach(() => {
    mocks.userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "pg-compass-user-data-"),
    );
    mocks.connections.clear();
    mocks.connections.set("local", buildConnection());
    mocks.readOnlyMode = false;
    mocks.runPgTool.mockReset();
    mocks.runPgTool.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    mocks.handle.mockReset();
    configureIpcSecurity(RENDERER_URL);
    registerBackupHandlers();
  });

  afterEach(() => {
    delete process.env.PG_COMPASS_TEST_OPEN_DIALOG_PATH;
  });

  describe("path confinement", () => {
    it("accepts only paths strictly inside the directory", () => {
      const dir = backupsDir();
      expect(isInsideDir(dir, path.join(dir, "a.dump"))).toBe(true);
      expect(isInsideDir(dir, path.join(dir, "..", "a.dump"))).toBe(false);
      expect(isInsideDir(dir, `${dir}-evil${path.sep}a.dump`)).toBe(false);
      expect(isInsideDir(dir, dir)).toBe(false);
      expect(isInsideDir(dir, path.join(os.tmpdir(), "a.dump"))).toBe(false);
    });

    it("allows backups-directory files and dialog-approved files only", () => {
      const event = createEvent();
      const inside = path.join(backupsDir(), "app.dump");
      expect(resolveRestoreSource(event as never, inside)).toBe(inside);

      const outside = writeOutsideDump();
      expect(() => resolveRestoreSource(event as never, outside)).toThrow(
        /not approved/,
      );

      approveSavePath(event as never, outside, "import");
      expect(() => resolveRestoreSource(event as never, outside)).toThrow(
        /not approved/,
      );

      approveSavePath(event as never, outside, "restore");
      expect(resolveRestoreSource(event as never, outside)).toBe(outside);
      expect(() => resolveRestoreSource(event as never, outside)).toThrow(
        /not approved/,
      );
    });

    it("rejects delete and inspect outside the backups directory", async () => {
      const outside = writeOutsideDump();
      const deleteResult = await getHandler(BackupChannels.DELETE_BACKUP)(
        createEvent(),
        { path: outside },
      );
      const inspectResult = await getHandler(BackupChannels.INSPECT_BACKUP)(
        createEvent(),
        { path: outside },
      );
      expect(deleteResult).toEqual({
        success: false,
        error: "Invalid backup path.",
      });
      expect(inspectResult).toEqual({
        success: false,
        error: "Invalid backup path.",
      });
      expect(fs.existsSync(outside)).toBe(true);
    });
  });

  describe("restore guards", () => {
    it("refuses restores in read-only mode", () => {
      mocks.readOnlyMode = true;
      expect(() => assertRestoreAllowed(restoreInput("/a.dump"))).toThrow(
        /read-only mode/,
      );
    });

    it("requires confirmation for production-looking targets", () => {
      mocks.connections.set(
        "local",
        buildConnection({
          mode: "uri",
          fields: undefined,
          uri: "postgresql://u@db.prod.example.com/app",
        }),
      );
      expect(() => assertRestoreAllowed(restoreInput("/a.dump"))).toThrow(
        /looks like a production database/,
      );
      expect(() =>
        assertRestoreAllowed(
          restoreInput("/a.dump", { confirmProduction: true }),
        ),
      ).not.toThrow();
    });

    it("allows ordinary targets without confirmation", () => {
      expect(() => assertRestoreAllowed(restoreInput("/a.dump"))).not.toThrow();
    });
  });

  describe("handlers", () => {
    it("restores a dialog-picked file once production is confirmed", async () => {
      mocks.connections.set("local", buildConnection({ label: "Prod EU" }));
      const picked = writeOutsideDump();
      process.env.PG_COMPASS_TEST_OPEN_DIALOG_PATH = picked;
      const event = createEvent();

      const dialogResult = await getHandler(
        BackupChannels.SHOW_RESTORE_FILE_DIALOG,
      )(event);
      expect(dialogResult).toEqual({ success: true, data: picked });

      const restore = getHandler(BackupChannels.RESTORE);
      const unconfirmed = await restore(event, restoreInput(picked));
      expect(unconfirmed).toMatchObject({ success: false });
      expect(mocks.runPgTool).not.toHaveBeenCalled();

      // The refused attempt did not consume the dialog grant.
      const confirmed = await restore(
        event,
        restoreInput(picked, { confirmProduction: true }),
      );
      expect(confirmed).toEqual({
        success: true,
        data: { status: "ok", backupPath: undefined },
      });
      const [command, args] = mocks.runPgTool.mock.calls[0]!;
      expect(command).toBe("pg_restore");
      expect((args as string[]).slice(-2)).toEqual(["--", picked]);
    });

    it("rejects a restore of an unapproved file outside the backups directory", async () => {
      const result = await getHandler(BackupChannels.RESTORE)(
        createEvent(),
        restoreInput(writeOutsideDump()),
      );
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(/not approved/),
      });
      expect(mocks.runPgTool).not.toHaveBeenCalled();
    });

    it("still allows creating backups in read-only mode", async () => {
      mocks.readOnlyMode = true;
      const result = await getHandler(BackupChannels.BACKUP)(createEvent(), {
        runId: "run-12345678",
        source: { connectionId: "local", database: "app" },
      });
      expect(result).toMatchObject({
        success: true,
        data: { status: "ok" },
      });
      expect(mocks.runPgTool.mock.calls[0]![0]).toBe("pg_dump");
    });
  });
});
