import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// Chips (docs/DESIGN.md §9.3). Neutral by default; status variants are only
// for deviations ("normal is neutral") and always tint, never fill solid.
const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded px-1.5 text-[11px] leading-none font-medium whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border border-border/70 bg-muted/55 text-subtle-foreground",
        secondary: "bg-muted text-subtle-foreground",
        outline: "border border-border/70 text-subtle-foreground",
        ghost: "text-subtle-foreground",
        destructive: "bg-destructive/10 text-destructive-foreground",
        warning: "bg-warning/10 text-warning-foreground",
        success: "bg-success/10 text-success-foreground",
        info: "bg-info/10 text-info-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

/** Keyboard hint chip, e.g. ⌘K (docs/DESIGN.md §9.3). */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] leading-none text-subtle-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Badge, Kbd, badgeVariants };
