import * as React from "react";

import { cn } from "@/lib/utils";

/** Shared field recipe (docs/DESIGN.md §9.8) for inputs, selects and textareas. */
export const fieldClassName =
  "w-full min-w-0 rounded-lg border border-input bg-background text-sm text-foreground shadow-xs/5 outline-none transition-[color,border-color,box-shadow] duration-150 selection:bg-foreground/20 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-64 aria-invalid:border-destructive/36 aria-invalid:ring-2 aria-invalid:ring-destructive/16 dark:shadow-edge dark:focus-visible:shadow-none dark:focus-visible:ring-ring/48 dark:aria-invalid:shadow-none dark:aria-invalid:ring-destructive/24 dark:disabled:shadow-none";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClassName,
        "h-8 px-2.5 py-1 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
