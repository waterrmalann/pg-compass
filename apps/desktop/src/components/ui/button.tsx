import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// Quiet Utility button (docs/DESIGN.md §9.1). Primary is neutral and inverted;
// hover changes fill only, press gives a tiny scale on primary.
const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-medium whitespace-nowrap outline-none transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-invalid:border-destructive/36 aria-invalid:ring-destructive/16 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-shine hover:border-primary/90 hover:bg-primary/90 active:scale-[0.98] active:border-primary/85 active:bg-primary/85 active:shadow-none data-[pressed]:bg-primary/85",
        destructive:
          "border-destructive bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/85",
        outline:
          "border-border bg-background shadow-xs/5 hover:bg-accent/50 active:bg-accent active:shadow-none data-[pressed]:bg-accent dark:border-input dark:bg-white/[0.025] dark:shadow-edge dark:hover:bg-accent/50 dark:active:bg-accent dark:active:shadow-none",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-accent",
        ghost:
          "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/80 aria-pressed:bg-accent aria-pressed:text-foreground",
        link: "h-auto! border-transparent px-0! text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
      },
      size: {
        default: "h-8 px-2.5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 gap-1.5 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 px-3.5",
        icon: "size-8 [&_svg]:mx-0",
        "icon-xs":
          "size-6 rounded-md [&_svg]:mx-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm":
          "size-7 rounded-md [&_svg]:mx-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 [&_svg]:mx-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
