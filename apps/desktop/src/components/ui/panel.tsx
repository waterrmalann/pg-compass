import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Panel (docs/DESIGN.md §9.15): the basic container for workspace content.
 * Tables and lists go edge to edge inside; the border does the separating.
 */
function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="panel"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs/5",
        className,
      )}
      {...props}
    />
  );
}

function PanelHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function PanelTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="panel-title"
      className={cn("text-sm leading-5 font-medium text-foreground", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

/** Count badge that sits next to a panel title (§9.3). */
function PanelCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="panel-count"
      className={cn(
        "rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-subtle-foreground tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

function PanelFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-footer"
      className={cn(
        "flex shrink-0 items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Panel, PanelHeader, PanelTitle, PanelCount, PanelFooter };
