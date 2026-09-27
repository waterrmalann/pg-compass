import { Compass } from "lucide-react";
import { Kbd } from "@/components/ui/badge";
import { getShortcut, shortcutLabel } from "@/shared/constants/shortcuts";

const WELCOME_SHORTCUTS = [
  "sidebar-search",
  "refresh",
  "run-query",
  "close-tab",
] as const;

export function WelcomeScreen() {
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto bg-background p-6">
      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="flex flex-col gap-4">
          <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted/55 text-muted-foreground shadow-xs/5">
            <Compass className="size-4.5" />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl leading-tight font-medium tracking-[-0.025em] text-foreground">
              Pick a connection. Start exploring.
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Open a connection from the sidebar to browse its schemas, tables
              and views. Nothing is written to your database unless you edit a
              row.
            </p>
          </div>
        </div>

        <div className="flex flex-col">
          <p className="mb-1 text-xs text-muted-foreground">Shortcuts</p>
          <ul className="divide-y divide-border border-y border-border">
            {WELCOME_SHORTCUTS.map((id) => {
              const shortcut = getShortcut(id);
              return (
                <li
                  key={id}
                  className="flex h-10 items-center justify-between gap-4 text-[13px] text-foreground"
                >
                  {shortcut.label}
                  <Kbd>{shortcutLabel(shortcut)}</Kbd>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
