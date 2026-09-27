import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible label. Omit for icon-only segments (then set `ariaLabel`). */
  label?: ReactNode;
  icon?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * Segmented control (docs/DESIGN.md §9.2) for switching between a few
 * mutually exclusive modes. Segments are toggle buttons with `aria-pressed`.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  disabled = false,
}: Readonly<{
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="segmented-control"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const iconOnly = !option.label;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            title={iconOnly ? option.ariaLabel : undefined}
            disabled={disabled || option.disabled}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "inline-flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md text-xs font-medium whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 [&_svg]:size-3.5 [&_svg]:shrink-0",
              iconOnly ? "w-6 flex-none" : "px-2",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
