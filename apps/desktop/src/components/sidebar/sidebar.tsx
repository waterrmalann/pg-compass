import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/badge";
import {
  useSidebarResize,
  SIDEBAR_MIN_WIDTH,
} from "@/hooks/use-sidebar-resize";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { ConnectionFormDialog } from "@/components/connections/connection-form-dialog";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import {
  getShortcut,
  matchesShortcut,
  shortcutLabel,
} from "@/shared/constants/shortcuts";
import { SidebarHeader } from "./sidebar-header";
import { SidebarContent } from "./sidebar-content";
import { SidebarFooter } from "./sidebar-footer";

export function Sidebar() {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const { sidebarWidth, sidebarRef, handleResizeStart, maxSidebarWidth } =
    useSidebarResize();
  const {
    formOpen,
    setFormOpen,
    settingsOpen,
    setSettingsOpen,
    editingConnection,
    handleOpenCreate,
    handleEdit,
    handleOpenSettings,
  } = useSidebarState();

  useEffect(function setupSidebarSearchShortcut() {
    function handleKeyDown(event: KeyboardEvent) {
      if (!matchesShortcut("sidebar-search", event)) return;
      if (document.activeElement?.closest(".cm-editor")) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <aside
        ref={sidebarRef}
        className="relative flex h-full min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        style={{
          width: `${sidebarWidth}px`,
          minWidth: `${SIDEBAR_MIN_WIDTH}px`,
          maxWidth: `${maxSidebarWidth}px`,
        }}
      >
        <SidebarHeader onOpenSettings={handleOpenSettings} />
        <div className="shrink-0 px-2 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && search) {
                  event.preventDefault();
                  setSearch("");
                }
              }}
              placeholder="Search"
              aria-label="Search sidebar"
              className="h-8 bg-background/40 pr-16 pl-8 text-[13px]"
            />
            {search ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                aria-label="Clear sidebar search"
                onClick={() => {
                  setSearch("");
                  searchRef.current?.focus();
                }}
              >
                <X />
              </Button>
            ) : (
              <Kbd className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2">
                {shortcutLabel(getShortcut("sidebar-search"))}
              </Kbd>
            )}
          </div>
        </div>
        <SidebarContent search={search} onEdit={handleEdit} />
        <SidebarFooter onNewConnection={handleOpenCreate} />
        <button
          type="button"
          aria-label="Resize sidebar"
          className="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize bg-transparent transition-colors duration-150 hover:bg-sidebar-border focus-visible:bg-ring/40 focus-visible:outline-none"
          onPointerDown={handleResizeStart}
        />
      </aside>

      <ConnectionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editConnection={editingConnection}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
