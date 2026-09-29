import { Fragment, type ReactNode } from "react";
import { RefreshCw, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/use-settings";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";
import type {
  DatabaseViewerPath,
  WorkspaceTabView,
} from "@/shared/types/workspace";

interface BreadcrumbItem {
  label: string;
  view?: WorkspaceTabView;
}

interface ViewerShellProps {
  breadcrumb: BreadcrumbItem[];
  onNavigateToView?: (view: WorkspaceTabView) => void;
  /** Omit on screens with nothing to refresh (the shell). */
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  refreshing?: boolean;
  lastRefreshedAt?: Date | null;
  refreshLabel?: string;
  /** The open connection; shows an Open shell button beside Refresh. */
  shellPath?: DatabaseViewerPath;
  /** Extra top-bar content, placed before the buttons. */
  actions?: ReactNode;
  children: ReactNode;
}

/** App top bar (docs/DESIGN.md §9.21) plus the padded content area. */
export function ViewerShell({
  breadcrumb,
  onNavigateToView,
  onRefresh,
  refreshDisabled,
  refreshing = false,
  lastRefreshedAt,
  refreshLabel = "Refresh visible content",
  shellPath,
  actions,
  children,
}: Readonly<ViewerShellProps>) {
  const lastIndex = breadcrumb.length - 1;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <nav
          className="flex min-w-0 items-center gap-1.5 text-[13px]"
          aria-label="Breadcrumb"
        >
          {breadcrumb.map((item, index) => {
            const key = `${item.label}-${String(index)}`;
            const isCurrent = index === lastIndex;
            const targetView = item.view;
            const canNavigate = Boolean(targetView && onNavigateToView);
            const handleClick =
              targetView && onNavigateToView
                ? () => onNavigateToView(targetView)
                : undefined;

            return (
              <Fragment key={key}>
                {index > 0 && (
                  <span aria-hidden className="text-muted-foreground/60">
                    /
                  </span>
                )}
                <button
                  type="button"
                  className={cn(
                    "max-w-56 truncate rounded-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                    isCurrent
                      ? "font-medium text-foreground"
                      : "font-mono text-xs text-muted-foreground hover:text-foreground",
                  )}
                  onClick={handleClick}
                  disabled={!canNavigate}
                  aria-current={isCurrent ? "page" : undefined}
                >
                  {item.label}
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {lastRefreshedAt ? (
            <span
              className="text-xs text-muted-foreground tabular-nums"
              title={lastRefreshedAt.toLocaleString()}
            >
              Updated{" "}
              {lastRefreshedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : null}
          {actions}
          {shellPath ? <OpenShellButton path={shellPath} /> : null}
          {onRefresh ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={refreshDisabled || refreshing}
              data-view-refresh
              title={refreshLabel}
              aria-label={refreshLabel}
            >
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
              {refreshing ? "Refreshing" : "Refresh"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 p-4">{children}</div>
    </div>
  );
}

/**
 * Opens a new psql tab for the connection. Shell access is opt-in (Settings →
 * General), so while it is off the button offers to turn it on instead.
 */
function OpenShellButton({ path }: Readonly<{ path: DatabaseViewerPath }>) {
  const { settings, updateSettings } = useSettings();
  const { forceOpenTab } = useWorkspace();

  function openShell() {
    void forceOpenTab({ type: "shell", path });
  }

  function handleClick() {
    if (settings.general.shellAccess) {
      openShell();
      return;
    }
    toast("Shell access is off", {
      description:
        "The shell runs psql on this computer. Turn on shell access to open one.",
      action: {
        label: "Turn on",
        onClick: () => {
          void updateSettings({ general: { shellAccess: true } }).then(
            (updated) => {
              if (updated?.general.shellAccess) openShell();
            },
          );
        },
      },
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      title="Open a psql shell for this connection"
    >
      <SquareTerminal />
      Open shell
    </Button>
  );
}
