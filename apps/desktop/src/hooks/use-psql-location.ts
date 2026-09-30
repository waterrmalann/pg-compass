import { useCallback, useEffect, useState } from "react";
import { useSettings } from "@/hooks/use-settings";
import type { PsqlLocation } from "@/shared/types/shell";

// Every mounted tab has an Open shell button; callers in the same moment
// (mount, window focus) share one lookup instead of one IPC call each.
let pendingLookup: Promise<PsqlLocation | null> | null = null;

function lookUpPsql(): Promise<PsqlLocation | null> {
  if (pendingLookup) return pendingLookup;
  pendingLookup = globalThis.window.shellApi
    .locatePsql()
    .then((result) => (result.success ? result.data : null))
    .catch(() => null)
    .finally(() => {
      pendingLookup = null;
    });
  return pendingLookup;
}

/**
 * Where psql would start from, or `null` while unknown. Re-checked when the
 * psql path setting changes and when the window regains focus (the user may
 * have just installed it).
 */
export function usePsqlLocation(): {
  location: PsqlLocation | null;
  recheck: () => void;
} {
  const { settings } = useSettings();
  const configuredPath = settings.general.psqlPath;
  const [location, setLocation] = useState<PsqlLocation | null>(null);

  const recheck = useCallback(() => {
    void lookUpPsql().then((next) => {
      if (next) setLocation(next);
    });
  }, []);

  useEffect(
    function checkWhenPathChanges() {
      recheck();
    },
    [configuredPath, recheck],
  );

  useEffect(
    function checkOnFocus() {
      globalThis.window.addEventListener("focus", recheck);
      return () => globalThis.window.removeEventListener("focus", recheck);
    },
    [recheck],
  );

  return { location, recheck };
}
