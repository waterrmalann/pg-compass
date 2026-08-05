import Store from "electron-store";
import { randomUUID } from "node:crypto";
import { resolveStoreOptions } from "./store-config";
import type { AuditLogEntry } from "../shared/types/roles";

interface AuditStoreSchema {
  auditLog: AuditLogEntry[];
}

const MAX_AUDIT_ENTRIES = 5_000;

const store = new Store<AuditStoreSchema>({
  ...resolveStoreOptions({ name: "audit-log" }),
  defaults: {
    auditLog: [],
  },
});

interface LogAuditArgs {
  connectionId: string;
  connectionLabel: string;
  actor: string;
  action: string;
  target: string;
  success: boolean;
  error?: string;
}

/** Append a single entry, evicting the oldest entries when the log fills. */
export function logAudit(args: Readonly<LogAuditArgs>): void {
  const entry: AuditLogEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    connectionId: args.connectionId,
    connectionLabel: args.connectionLabel,
    actor: args.actor,
    action: args.action,
    target: args.target,
    success: args.success,
    error: args.success ? null : args.error ?? "Unknown error",
  };

  const current = store.get("auditLog");
  const next = [...current, entry];
  if (next.length > MAX_AUDIT_ENTRIES) {
    next.splice(0, next.length - MAX_AUDIT_ENTRIES);
  }
  store.set("auditLog", next);
}

/** Get all entries scoped to a specific connection, newest-last. */
export function getAuditLog(connectionId: string): AuditLogEntry[] {
  return store
    .get("auditLog")
    .filter((entry) => entry.connectionId === connectionId);
}

/** Remove all audit entries for a specific connection. */
export function clearAuditLog(connectionId: string): void {
  const next = store
    .get("auditLog")
    .filter((entry) => entry.connectionId !== connectionId);
  store.set("auditLog", next);
}