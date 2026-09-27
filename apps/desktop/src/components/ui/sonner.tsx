import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

// Toasts are popovers (docs/DESIGN.md §6): popover surface, hairline border,
// shadow-lg. Status stays in the icon, never in a solid fill.
function Toaster({ ...props }: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast font-sans! text-[13px]! gap-2.5! px-3.5! py-3! shadow-lg! [&_[data-icon]]:text-muted-foreground",
          title: "font-medium!",
          description: "text-xs! text-muted-foreground!",
          error: "[&_[data-icon]]:text-destructive-foreground!",
          warning: "[&_[data-icon]]:text-warning-foreground!",
          info: "[&_[data-icon]]:text-info-foreground!",
          success: "[&_[data-icon]]:text-success-foreground!",
          actionButton: "bg-primary! text-primary-foreground! rounded-md!",
          cancelButton: "bg-muted! text-subtle-foreground! rounded-md!",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
