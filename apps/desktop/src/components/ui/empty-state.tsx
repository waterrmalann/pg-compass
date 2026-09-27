import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Centered placeholder for empty, loading or failed content. Quiet by
 * default: a hairline icon tile, a short title and one muted line.
 */
export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
}: Readonly<{
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-3 px-4 py-8 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-muted/55 text-muted-foreground shadow-xs/5 [&_svg]:size-4">
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {description ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Centered spinner for content that is still loading. */
export function LoadingState({
  label = "Loading",
  className,
}: Readonly<{ label?: string; className?: string }>) {
  return (
    <div
      role="status"
      className={cn("flex h-full items-center justify-center", className)}
    >
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
