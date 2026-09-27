import * as React from "react";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-[13px] leading-none font-medium text-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-64 peer-disabled:cursor-not-allowed peer-disabled:opacity-64",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
