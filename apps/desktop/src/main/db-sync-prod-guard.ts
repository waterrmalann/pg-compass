import type { DbSyncProdGuardState } from "../shared/types/db-sync";

/**
 * "Show production databases in Database Sync target pickers" is
 * intentionally never persisted to disk — it lives only in this
 * module's memory, so a quit (or crash) always comes back up disabled,
 * and it self-clears after its TTL even if the app stays open.
 */
const GUARD_TTL_MS = 5 * 60 * 1000;

let enabledUntil: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function clearGuard(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  enabledUntil = null;
}

/** Lazily expires the guard on read, so callers never see a stale "enabled". */
export function getProdGuardState(): DbSyncProdGuardState {
  if (enabledUntil !== null && Date.now() >= enabledUntil) {
    clearGuard();
  }
  return { enabled: enabledUntil !== null, enabledUntil };
}

export function setProdGuardEnabled(enabled: boolean): DbSyncProdGuardState {
  clearGuard();
  if (enabled) {
    enabledUntil = Date.now() + GUARD_TTL_MS;
    timer = setTimeout(clearGuard, GUARD_TTL_MS);
  }
  return getProdGuardState();
}
