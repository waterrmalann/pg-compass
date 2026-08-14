import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useLatestRequest } from "@/hooks/use-latest-request";
import { useWorkspace } from "@/hooks/use-workspace";
import { unwrap } from "@/components/workspace/rbac/shared";
import type { PgRole, RolesSidebarSummary } from "@/shared/types/roles";
import type { WorkspaceTabView } from "@/shared/types/workspace";

interface SidebarFooterProps {
  onNewConnection: () => void;
}

const MAX_ROLES_SHOWN = 12;

export function SidebarFooter({
  onNewConnection,
}: Readonly<SidebarFooterProps>) {
  const { tabs, activeTabId, openTab, rolesRevision } = useWorkspace();
  const { connections } = useConnections();
  const activeConnection = useMemo(() => {
    const tab = tabs.find((item) => item.id === activeTabId);
    if (!tab) return null;
    const { view } = tab;
    if (view.type === "database-manager") return null;
    return connections.find((c) => c.id === view.path.connectionId) ?? null;
  }, [tabs, activeTabId, connections]);
  const activeConnectionId = activeConnection?.id ?? null;

  const runLatestRequest = useLatestRequest();
  const [summary, setSummary] = useState<RolesSidebarSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  // Connection whose summary last failed, so switching tabs back and forth
  // doesn't repeat the same error toast.
  const lastFailedConnectionIdRef = useRef<string | null>(null);

  // Uses the lightweight summary (not the full snapshot) so the sidebar
  // doesn't open a connection to every database on the server. The pool
  // connects on demand, so no separate connection test is needed.
  const loadSummary = useCallback(
    async (connectionId: string | null) => {
      setLoading(connectionId !== null);
      // Every call, including "no connection", goes through the latest-request
      // guard so an older in-flight response can't land afterwards.
      const request = await runLatestRequest(async () => {
        if (!connectionId) return null;
        return unwrap(
          await globalThis.window.rolesApi.getSidebarSummary(connectionId),
        );
      });
      if (request.status === "stale") return;
      setLoading(false);

      if (request.status === "error") {
        setSummary(null);
        const alreadyReported =
          lastFailedConnectionIdRef.current === connectionId;
        lastFailedConnectionIdRef.current = connectionId;
        if (alreadyReported) return;
        toast.error("Failed to load roles", {
          description: (request.error as Error).message,
        });
        return;
      }

      if (connectionId) lastFailedConnectionIdRef.current = null;
      setSummary(request.value);
    },
    [runLatestRequest],
  );

  // Refetch only when the active connection changes (not on every tab
  // switch within it) or after an RBAC mutation.
  useEffect(() => {
    void loadSummary(activeConnectionId);
  }, [activeConnectionId, rolesRevision, loadSummary]);

  const roles = useMemo(
    () => (summary?.roles ?? []).filter((role) => role.canLogin),
    [summary?.roles],
  );
  const isAdmin = Boolean(summary?.currentUser.isSuperuser);

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

  const usersShown = roles.slice(0, MAX_ROLES_SHOWN);
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
          <Users className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">
            {isAdmin ? "Users" : "My account"}
          </span>
          {accentColor && (
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: accentColor }}
              aria-hidden
            />
          )}
          {loading && (
            <Loader2
              className="size-3 shrink-0 animate-spin text-muted-foreground"
              aria-label="Loading roles"
            />
          )}
          {!loading && activeConnection && (
            <Badge variant="outline" className="text-[10px]">
              {roles.length}
            </Badge>
          )}
        </button>
      </div>
      {!loading && summary && expanded && (
        <>
          <ScrollArea className="min-h-0 [&>[data-slot=scroll-area-viewport]]:max-h-40">
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
            {isAdmin ? "Manage users & RBAC" : "View my access"}
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
        Database manager
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
      <span className="flex-1 truncate">{role.name}</span>
      {role.isSuperuser && (
        <Badge variant="secondary" className="text-[10px]">
          Superuser
        </Badge>
      )}
    </button>
  );
}
