import { Compass, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SidebarHeader({
  onOpenSettings,
}: Readonly<{
  onOpenSettings: () => void;
}>) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-3">
      <div className="flex size-5 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
        <Compass className="size-3.5" strokeWidth={2.25} />
      </div>
      <h1 className="flex-1 text-[13px] font-medium tracking-[-0.01em] text-sidebar-accent-foreground">
        PG Compass
      </h1>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Open settings"
            onClick={onOpenSettings}
          >
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
