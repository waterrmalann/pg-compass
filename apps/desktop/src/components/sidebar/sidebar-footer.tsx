import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  DatabaseZap,
  Loader2,
  Plus,
  Shield,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
    <div className="mt-auto flex shrink-0 flex-col gap-px border-t border-sidebar-border p-2">
      {activeConnection && (
        <div className="flex flex-col gap-px pb-1.5">
          <button
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground outline-none transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse roles list" : "Expand roles list"}
          >
            <ChevronDown
              className={cn(
                "size-3 shrink-0 transition-transform duration-150",
                !expanded && "-rotate-90",
              )}
            />
            <span className="min-w-0 flex-1 truncate">
              {isAdmin ? "Users" : "My account"}
            </span>
            {accentColor && (
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: accentColor }}
                aria-hidden
              />
            )}
            {loading ? (
              <Loader2
                className="size-3 shrink-0 animate-spin"
                aria-label="Loading roles"
              />
            ) : (
              <span className="font-mono text-[11px] text-subtle-foreground tabular-nums">
                {roles.length}
              </span>
            )}
          </button>
          {!loading && summary && expanded && (
            <>
              <ScrollArea className="min-h-0 [&>[data-slot=scroll-area-viewport]]:max-h-40">
                <div className="flex flex-col gap-px">
                  {usersShown.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      No login roles visible.
                    </p>
                  ) : (
                    usersShown.map((role) => (
                      <RoleRow
                        key={role.name}
                        role={role}
                        onClick={() => handleOpenUsers(role.name)}
                      />
                    ))
                  )}
                  {hiddenCount > 0 && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {hiddenCount} more in Users
                    </p>
                  )}
                </div>
              </ScrollArea>
              <SidebarRowButton onClick={() => handleOpenUsers(undefined)}>
                <Shield />
                {isAdmin ? "Manage users and roles" : "View my access"}
              </SidebarRowButton>
            </>
          )}
        </div>
      )}

      <SidebarRowButton
        onClick={() => {
          openTab({ type: "database-manager" }).catch(() => undefined);
        }}
      >
        <DatabaseZap />
        Database manager
      </SidebarRowButton>

      <Button
        variant="outline"
        size="sm"
        className="mt-1.5 w-full"
        onClick={onNewConnection}
        title="Add a new PostgreSQL connection"
      >
        <Plus />
        New connection
      </Button>
    </div>
  );
}

function SidebarRowButton({
  onClick,
  children,
}: Readonly<{ onClick: () => void; children: ReactNode }>) {
  return (
    <button
      type="button"
      className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RoleRow({
  role,
  onClick,
}: Readonly<{ role: PgRole; onClick: () => void }>) {
  return (
    <button
      type="button"
      className="flex h-7 items-center gap-2 rounded-md pr-1 pl-2 text-left text-xs text-sidebar-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      onClick={onClick}
    >
      <User className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono">{role.name}</span>
      {role.isSuperuser && <Badge>Superuser</Badge>}
    </button>
  );
}
