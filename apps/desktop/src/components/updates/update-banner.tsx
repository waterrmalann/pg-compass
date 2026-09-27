import { useEffect, useState } from "react";
import { ArrowUpRight, CircleArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UpdateStatus } from "@/shared/types/updates";

/** Identifies what the banner is showing, so dismissing it hides only that message. */
function getStatusKey(status: UpdateStatus): string {
  if (status.kind === "up-to-date") {
    return status.kind;
  }
  return `${status.kind}:${status.version ?? ""}`;
}

/**
 * A strip above the app shell that announces a newer release (Linux, or
 * Windows before Squirrel has it) or a downloaded update (Windows). Closing
 * it lasts for this session only; it comes back on the next launch.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "up-to-date" });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(function subscribeToUpdateStatus() {
    const updateApi = globalThis.window.updateApi;
    let active = true;

    updateApi.getStatus().then((result) => {
      if (active && result.success) {
        setStatus(result.data);
      }
    });
    const unsubscribe = updateApi.onStatusChanged(setStatus);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (status.kind === "up-to-date") {
    return null;
  }

  const statusKey = getStatusKey(status);
  if (dismissedKey === statusKey) {
    return null;
  }

  const productVersion =
    status.version === null ? "An update" : `PG Compass ${status.version}`;
  const message =
    status.kind === "ready"
      ? `${productVersion} is ready to install.`
      : `${productVersion} is available.`;

  return (
    <div
      role="status"
      className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-info/10 pr-1.5 pl-3 text-[12.5px]"
    >
      <CircleArrowDown className="size-3.5 shrink-0 text-info-foreground" />
      <p className="min-w-0 truncate">{message}</p>

      {status.kind === "available" && (
        <Button asChild variant="outline" size="xs">
          <a href={status.releaseUrl} target="_blank" rel="noopener noreferrer">
            Download
            <ArrowUpRight />
          </a>
        </Button>
      )}
      {status.kind === "ready" && (
        <Button
          variant="outline"
          size="xs"
          onClick={() => void globalThis.window.updateApi.install()}
        >
          Restart to update
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon-xs"
        className="ml-auto"
        aria-label="Dismiss update notice"
        onClick={() => setDismissedKey(statusKey)}
      >
        <X />
      </Button>
    </div>
  );
}
