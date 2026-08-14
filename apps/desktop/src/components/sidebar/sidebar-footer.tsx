import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  DatabaseZap,
  Loader2,
  Plus,
  Shield,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useConnections } from "@/hooks/use-connections";
import { useWorkspace } from "@/hooks/use-workspace";
import type { PgRole, RolesSidebarSummary } from "@/shared/types/roles";
import type { IpcResult } from "@/shared/types/ipc";
import type { WorkspaceTabView } from "@/shared/types/workspace";

interface SidebarFooterProps {
  onNewConnection: () => void;
}

function unwrap<T>(result: IpcResult<T>): T {
  if (result.success) return result.data;
  throw new Error(result.error);
}

export function SidebarFooter({
  onNewConnection,
}: Readonly<SidebarFooterProps>) {
  const { tabs, activeTabId, openTab } = useWorkspace();
  const { connections, testConnection } = useConnections();
  const activeConnection = useMemo(() => {
    const tab = tabs.find((item) => item.id === activeTabId);
    if (!tab) return null;
    const { view } = tab;
    if (view.type === "database-manager") return null;
    return connections.find((c) => c.id === view.path.connectionId) ?? null;
  }, [tabs, activeTabId, connections]);

  const [snapshot, setSnapshot] = useState<RolesSidebarSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  // Re-evaluate roles when the active connection changes. We don't need a
  // hard connection — a successful test on the connection is enough to fetch
  // roles; the API falls back to the saved connection's pool. Uses the
  // lightweight summary (not the full snapshot) so the sidebar doesn't
  // trigger a connection attempt against every database on the server.
  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      if (!activeConnection) {
        setSnapshot(null);
        return;
      }
      setLoading(true);
      try {
        await testConnection(activeConnection.id);
        const result = await globalThis.window.rolesApi.getSidebarSummary(
          activeConnection.id,
        );
        if (cancelled) return;
        setSnapshot(unwrap(result));
      } catch (err) {
        if (cancelled) return;
        setSnapshot(null);
        toast.error("Failed to load roles", {
          description: (err as Error).message,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.id]);

  const roles = useMemo(
    () => (snapshot?.roles ?? []).filter((role) => role.canLogin),
    [snapshot?.roles],
  );
  const isAdmin = Boolean(snapshot?.currentUser.isSuperuser);

  function handleOpenUsers(roleName?: string): void {
    if (!activeConnection) return;
    const view: WorkspaceTabView = {
      type: "users",
      path: {
        connectionId: activeConnection.id,
        connectionLabel: activeConnection.label,
        selectedRole: roleName,
      },
    };
    openTab(view, activeConnection.color).catch(() => undefined);
  }

  const usersShown = roles.slice(0, 12);
  const hiddenCount = Math.max(0, roles.length - usersShown.length);
  const accentColor = activeConnection?.color;

  return (
    <div className="mt-auto flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
          disabled={!activeConnection}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse roles list" : "Expand roles list"}
        >
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && activeConnection ? "" : "-rotate-90",
            )}
          />
          <Users
            className={cn("size-3.5 shrink-0", !accentColor && "text-sidebar-primary")}
            style={accentColor ? { color: accentColor } : undefined}
          />
          <span className="flex-1 truncate">
            {isAdmin ? "Users" : "My Account"}
          </span>
          {loading ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : activeConnection ? (
            <Badge
              variant="outline"
              className="text-[10px]"
              style={
                accentColor
                  ? { color: accentColor, borderColor: accentColor }
                  : undefined
              }
            >
              {roles.length}
            </Badge>
          ) : null}
        </button>
      </div>
      {!loading && snapshot && expanded && (
        <>
          <ScrollArea className="max-h-40 min-h-0">
            <div className="flex flex-col gap-0.5">
              {usersShown.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-muted-foreground">
                  No roles visible.
                </p>
              ) : (
                usersShown.map((role) => (
                  <RolePill
                    key={role.name}
                    role={role}
                    onClick={() => handleOpenUsers(role.name)}
                  />
                ))
              )}
              {hiddenCount > 0 && (
                <p className="px-1 pt-1 text-[11px] text-muted-foreground">
                  + {hiddenCount} more in the Users view
                </p>
              )}
            </div>
          </ScrollArea>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            onClick={() => handleOpenUsers(undefined)}
          >
            <Shield className="size-3.5" />
            {isAdmin ? "Manage Users & RBAC" : "View My Access"}
          </Button>
        </>
      )}
      <Separator className="bg-sidebar-border" />

      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => {
          openTab({ type: "database-manager" }).catch(() => undefined);
        }}
      >
        <DatabaseZap className="size-3.5" />
        Database Manager
      </Button>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={onNewConnection}
          >
            <Plus className="size-4" />
            <span>New Connection</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Add a new PostgreSQL connection</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function RolePill({
  role,
  onClick,
}: Readonly<{ role: PgRole; onClick: () => void }>) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors hover:bg-sidebar-accent/60"
      onClick={onClick}
    >
      <span className="truncate flex-1">{role.name}</span>
      {role.isSuperuser && (
        <Badge variant="destructive" className="text-[9px] uppercase">
          Super
        </Badge>
      )}
      {role.canLogin && !role.isSuperuser && (
        <Badge variant="secondary" className="text-[9px] uppercase">
          Login
        </Badge>
      )}
      {role.canLogin === false && (
        <Badge variant="outline" className="text-[9px] uppercase">
          Role
        </Badge>
      )}
    </button>
  );
}
