import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTempDir } from "../support/store";

function entry(id: string, connectionId: string) {
  return {
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    connectionId,
    connectionLabel: connectionId,
    actor: "admin",
    action: "create-role",
    target: "reader",
    success: true,
    error: null,
  };
}

function seedAuditLog(entries: ReturnType<typeof entry>[]): void {
  const storeDir = process.env.PG_COMPASS_STORE_DIR ?? "";
  fs.writeFileSync(
    path.join(storeDir, "audit-log.json"),
    JSON.stringify({ auditLog: entries }),
  );
}

const logArgs = {
  connectionLabel: "A",
  actor: "admin",
  action: "drop-role",
  target: "reader",
  success: true,
};

describe("audit-store", () => {
  beforeEach(() => {
    process.env.PG_COMPASS_STORE_DIR = createTempDir("pg-compass-audit-");
    vi.resetModules();
  });

  it("keeps the newest 5,000 entries by evicting the oldest", async () => {
    seedAuditLog(
      Array.from({ length: 5_000 }, (_, index) => entry(`old-${index}`, "a")),
    );
    const { getAuditLog, logAudit } = await import("@/main/audit-store");

    logAudit({ ...logArgs, connectionId: "a" });

    const log = getAuditLog("a");
    expect(log).toHaveLength(5_000);
    expect(log[0]!.id).toBe("old-1");
    expect(log.at(-1)).toMatchObject({ action: "drop-role", error: null });
  });

  it("clears only the given connection's entries", async () => {
    seedAuditLog([entry("a-1", "a"), entry("b-1", "b"), entry("a-2", "a")]);
    const { clearAuditLog, getAuditLog } = await import("@/main/audit-store");

    clearAuditLog("a");

    expect(getAuditLog("a")).toEqual([]);
    expect(getAuditLog("b").map((item) => item.id)).toEqual(["b-1"]);
  });
});
