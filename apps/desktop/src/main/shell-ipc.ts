import os from "node:os";
import type { WebContents } from "electron";
import * as pty from "node-pty";
import { ShellChannels } from "../shared/constants/ipc-channels";
import type {
  ShellResizeInput,
  ShellSessionInput,
  ShellStartInput,
  ShellStartResult,
  ShellWriteInput,
} from "../shared/types/shell";
import { getConnectionById } from "./connection-store";
import { getSettings } from "./settings-store";
import { registerIpcHandler } from "./ipc-security";
import { resolvePgToolTarget } from "./backup-process";
import {
  buildPsqlArgs,
  buildPsqlEnv,
  connectionDatabase,
  findExecutable,
} from "./shell-process";
import {
  validateShellResizeInput,
  validateShellSessionInput,
  validateShellStartInput,
  validateShellWriteInput,
} from "./ipc-validation";

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface ShellSession {
  process: pty.IPty;
}

/** Keyed by `${webContents.id}:${sessionId}` so renderers never share one. */
const sessions = new Map<string, ShellSession>();
const trackedWebContents = new Set<number>();

function sessionKey(sender: WebContents, sessionId: string): string {
  return `${String(sender.id)}:${sessionId}`;
}

function requireSession(sender: WebContents, sessionId: string): ShellSession {
  const session = sessions.get(sessionKey(sender, sessionId));
  if (!session) throw new Error("Shell session not found.");
  return session;
}

/** A closed or reloaded window must not leave psql processes behind. */
function killSessionsOnDestroy(sender: WebContents): void {
  if (trackedWebContents.has(sender.id)) return;
  trackedWebContents.add(sender.id);

  const prefix = `${String(sender.id)}:`;
  const killOwnSessions = () => {
    for (const [key, session] of sessions) {
      if (!key.startsWith(prefix)) continue;
      session.process.kill();
      sessions.delete(key);
    }
  };
  sender.once("destroyed", () => {
    killOwnSessions();
    trackedWebContents.delete(sender.id);
  });
  // A reload keeps the WebContents but drops every terminal in it.
  sender.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) killOwnSessions();
  });
}

export function killAllShellSessions(): void {
  for (const session of sessions.values()) {
    session.process.kill();
  }
  sessions.clear();
}

// ---------------------------------------------------------------------------
// psql
// ---------------------------------------------------------------------------

async function startShell(
  input: ShellStartInput,
  sender: WebContents,
): Promise<ShellStartResult> {
  const settings = getSettings();
  if (!settings.general.shellAccess) {
    throw new Error(
      "Shell access is turned off. Turn it on in Settings → General.",
    );
  }

  const key = sessionKey(sender, input.sessionId);
  if (sessions.has(key)) {
    throw new Error("A shell with this identifier is already running.");
  }

  const connection = getConnectionById(input.connectionId);
  if (!connection) throw new Error("Connection not found.");

  const psqlPath = findExecutable("psql");
  if (!psqlPath) {
    throw new Error(
      "psql not found. Install the PostgreSQL client tools and make sure psql is on your PATH.",
    );
  }

  const database = connectionDatabase(connection);
  const readOnly = settings.general.readOnlyMode;
  const target = await resolvePgToolTarget(connection, database);

  let shellProcess: pty.IPty;
  try {
    shellProcess = pty.spawn(psqlPath, buildPsqlArgs(target), {
      name: "xterm-256color",
      cols: input.cols,
      rows: input.rows,
      cwd: os.homedir(),
      env: { ...process.env, ...buildPsqlEnv(target, readOnly) },
    });
  } catch (err) {
    await target.cleanup();
    throw err;
  }

  sessions.set(key, { process: shellProcess });
  killSessionsOnDestroy(sender);

  shellProcess.onData((data) => {
    if (sender.isDestroyed()) return;
    sender.send(ShellChannels.DATA, { sessionId: input.sessionId, data });
  });
  shellProcess.onExit(({ exitCode }) => {
    sessions.delete(key);
    void target.cleanup();
    if (sender.isDestroyed()) return;
    sender.send(ShellChannels.EXIT, { sessionId: input.sessionId, exitCode });
  });

  return { database, readOnly };
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

export function registerShellHandlers(): void {
  registerIpcHandler(ShellChannels.START, async (event, rawInput: unknown) => {
    try {
      const input = validateShellStartInput(rawInput);
      const data = await startShell(input, event.sender);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(ShellChannels.WRITE, (event, rawInput: unknown) => {
    try {
      const input: ShellWriteInput = validateShellWriteInput(rawInput);
      requireSession(event.sender, input.sessionId).process.write(input.data);
      return { success: true, data: undefined };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(ShellChannels.RESIZE, (event, rawInput: unknown) => {
    try {
      const input: ShellResizeInput = validateShellResizeInput(rawInput);
      const session = requireSession(event.sender, input.sessionId);
      session.process.resize(input.cols, input.rows);
      return { success: true, data: undefined };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(ShellChannels.KILL, (event, rawInput: unknown) => {
    try {
      const input: ShellSessionInput = validateShellSessionInput(rawInput);
      const key = sessionKey(event.sender, input.sessionId);
      const session = sessions.get(key);
      if (session) {
        session.process.kill();
        sessions.delete(key);
      }
      return { success: true, data: undefined };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
