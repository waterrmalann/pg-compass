import { Fragment, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceTabView } from "@/shared/types/workspace";

interface BreadcrumbItem {
  label: string;
  view?: WorkspaceTabView;
}

interface ViewerShellProps {
  breadcrumb: BreadcrumbItem[];
  onNavigateToView?: (view: WorkspaceTabView) => void;
  onRefresh: () => void;
  refreshDisabled?: boolean;
  refreshing?: boolean;
  lastRefreshedAt?: Date | null;
  refreshLabel?: string;
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
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 p-4">{children}</div>
    </div>
  );
}
