import { ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";

type IpcHandler<Args extends unknown[], Result> = (
  event: IpcMainInvokeEvent,
  ...args: Args
) => Result;

let trustedRendererUrl: string | null = null;
const SAVE_PATH_TTL_MS = 5 * 60 * 1_000;
type SavePurpose = "export" | "sql-dump" | "import" | "restore";
interface SavePathGrant {
  purpose: SavePurpose;
  expiresAt: number;
}
const approvedSavePaths = new Map<number, Map<string, SavePathGrant>>();
const trackedWebContents = new Set<number>();

function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  url.search = "";
  return url.href;
}

export function configureIpcSecurity(rendererUrl: string): void {
  trustedRendererUrl = normalizeUrl(rendererUrl);
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const senderFrame = event.senderFrame;
  if (
    trustedRendererUrl === null ||
    senderFrame === null ||
    senderFrame !== event.sender.mainFrame ||
    normalizeUrl(senderFrame.url) !== trustedRendererUrl
  ) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }
}

export function registerIpcHandler<Args extends unknown[], Result>(
  channel: string,
  handler: IpcHandler<Args, Result>,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return handler(event, ...(args as Args));
  });
}

function trackWebContents(event: IpcMainInvokeEvent): void {
  const senderId = event.sender.id;
  if (trackedWebContents.has(senderId)) return;

  trackedWebContents.add(senderId);
  event.sender.once("destroyed", () => {
    approvedSavePaths.delete(senderId);
    trackedWebContents.delete(senderId);
  });
}

export function approveSavePath(
  event: IpcMainInvokeEvent,
  selectedPath: string,
  purpose: SavePurpose,
): string {
  const normalizedPath = path.resolve(selectedPath);
  trackWebContents(event);

  const paths =
    approvedSavePaths.get(event.sender.id) ?? new Map<string, SavePathGrant>();
  paths.set(normalizedPath, {
    purpose,
    expiresAt: Date.now() + SAVE_PATH_TTL_MS,
  });
  approvedSavePaths.set(event.sender.id, paths);
  return normalizedPath;
}

export function consumeApprovedSavePath(
  event: IpcMainInvokeEvent,
  requestedPath: string,
  purpose: SavePurpose,
): string {
  const normalizedPath = path.resolve(requestedPath);
  const paths = approvedSavePaths.get(event.sender.id);
  const grant = paths?.get(normalizedPath);
  paths?.delete(normalizedPath);
  if (paths?.size === 0) {
    approvedSavePaths.delete(event.sender.id);
  }
  if (!grant || grant.purpose !== purpose || grant.expiresAt < Date.now()) {
    throw new Error("The selected file was not approved by a file dialog.");
  }
  return normalizedPath;
}
