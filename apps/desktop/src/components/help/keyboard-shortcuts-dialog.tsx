import { useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge, Kbd } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  SHORTCUTS,
  currentShortcutPlatform,
  shortcutLabel,
} from "@/shared/constants/shortcuts";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: Readonly<KeyboardShortcutsDialogProps>) {
  const [search, setSearch] = useState("");
  const platform = currentShortcutPlatform();
  const query = search.trim().toLowerCase();
  const visible = query
    ? SHORTCUTS.filter((shortcut) =>
        `${shortcut.label} ${shortcut.category} ${shortcutLabel(shortcut, platform)}`
          .toLowerCase()
          .includes(query),
      )
    : SHORTCUTS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="pb-0 sm:max-w-lg"
        onKeyDown={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(".cm-editor")
          ) {
            event.stopPropagation();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Search the shortcuts available in the current platform.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search shortcuts"
            className="pl-8 text-[13px]"
          />
        </div>
        <div className="-mx-5 max-h-80 overflow-y-auto border-t border-border">
          {visible.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-muted-foreground">
              No shortcuts match.
            </p>
          ) : (
            visible.map((shortcut) => (
              <div
                key={shortcut.id}
                className="flex h-11 items-center justify-between gap-4 border-b border-border/70 px-5 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <p className="text-[13px]">{shortcut.label}</p>
                  <Badge variant="outline">{shortcut.category}</Badge>
                </div>
                <Kbd>{shortcutLabel(shortcut, platform)}</Kbd>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
