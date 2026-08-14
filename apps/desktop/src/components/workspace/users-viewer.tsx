import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Database,
  Loader2,
  Shield,
  ScrollText,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import { useWorkspace } from "@/hooks/use-workspace";
import { useLatestRequest } from "@/hooks/use-latest-request";
import type { RolesSnapshot } from "@/shared/types/roles";
import type { UsersViewerPath } from "@/shared/types/workspace";
import { ErrorState, unwrap } from "./rbac/shared";
import { RolesPane } from "./rbac/roles-pane";
import { DatabaseCards } from "./rbac/database-cards";
import { TriggersPane } from "./rbac/triggers-pane";
import { AuditLogPane } from "./rbac/audit-log-pane";

interface UsersViewerProps {
  path: UsersViewerPath;
}

export function UsersViewer({ path }: Readonly<UsersViewerProps>) {
  const { navigateToView } = useWorkspace();
  const [snapshot, setSnapshot] = useState<RolesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoleName, setSelectedRoleName] = useState<string | null>(
    path.selectedRole ?? null,
  );
  const [activeTab, setActiveTab] = useState<string>("users");

  const isAdmin = Boolean(snapshot?.currentUser.isSuperuser);

  // fetchSnapshot is only recreated when the connection changes (see deps
  // below), so it must read the *current* selection through a ref rather
  // than closing over `selectedRoleName` — otherwise every mutation-driven
  // refresh would snap the selection back to whatever it was at mount.
  const selectedRoleNameRef = useRef(selectedRoleName);
  useEffect(() => {
    selectedRoleNameRef.current = selectedRoleName;
  }, [selectedRoleName]);

  // The Users tab is now reused (not re-created) when the sidebar's roles
  // list is clicked for a different role on the same connection — sync the
  // selection when the tab's `path.selectedRole` changes so that reuse
  // actually navigates, instead of just re-focusing the tab on whatever
  // role happened to be selected when it was first opened.
  useEffect(() => {
    if (path.selectedRole) setSelectedRoleName(path.selectedRole);
  }, [path.selectedRole]);

  const runLatestSnapshotRequest = useLatestRequest();

  const fetchSnapshot = useCallback(
    async (force: boolean) => {
      if (!force) setLoading(true);
      else setRefreshing(true);

      // Two calls can overlap (e.g. a mutation's auto-refresh plus a manual
      // Refresh click) — without sequencing, a slower older request could
      // resolve after a faster newer one and clobber it with stale data.
      const result = await runLatestSnapshotRequest(async () => {
        const response = await globalThis.window.rolesApi.getSnapshot(
          path.connectionId,
        );
        return unwrap(response);
      });

      if (result.status === "stale") return;
      setLoading(false);
      setRefreshing(false);

      if (result.status === "error") {
        const message = (result.error as Error).message;
        setError(message);
        toast.error("Failed to load users / roles", { description: message });
        return;
      }

      const next = result.value;
      setSnapshot(next);
      setLastRefreshedAt(new Date());
      setError(null);

      const roleNames = new Set(next.roles.map((r) => r.name));
      const desired = next.currentUser.isSuperuser
        ? (selectedRoleNameRef.current ?? next.roles[0]?.name ?? null)
        : next.currentUser.name;
      const resolved =
        desired && roleNames.has(desired) ? desired : (next.roles[0]?.name ?? null);
      setSelectedRoleName(resolved);
    },
    [path.connectionId, runLatestSnapshotRequest],
  );

  useEffect(() => {
    void fetchSnapshot(false);
  }, [path.connectionId, fetchSnapshot]);

  // Database Access levels are evaluated for a specific role server-side.
  // Whenever the selected role diverges from what the current snapshot was
  // scoped to, refetch just that scoping so the tab reflects that role's
  // real grants instead of the superuser's own (unrestricted) access.
  useEffect(() => {
    if (!snapshot?.currentUser.isSuperuser) return;
    if (!selectedRoleName || selectedRoleName === snapshot.targetUser) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await globalThis.window.rolesApi.getSnapshot(
          path.connectionId,
          selectedRoleName,
        );
        const next = unwrap(result);
        if (cancelled) return;
        setSnapshot((prev) =>
          prev
            ? { ...prev, databases: next.databases, targetUser: next.targetUser }
            : prev,
        );
      } catch (err) {
        if (!cancelled) {
          toast.error("Failed to load database access", {
            description: (err as Error).message,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRoleName, snapshot?.currentUser.isSuperuser, snapshot?.targetUser, path.connectionId]);

  const handleRefresh = useCallback(async () => {
    await fetchSnapshot(true);
  }, [fetchSnapshot]);

  const handleAfterMutation = useCallback(() => {
    void fetchSnapshot(true);
  }, [fetchSnapshot]);

  const databaseNames = useMemo(
    () =>
      (snapshot?.databases ?? [])
        .filter((db) => db.allowConnections !== false)
        .map((db) => db.name),
    [snapshot?.databases],
  );

  return (
    <ViewerShell
      breadcrumb={[
        {
          label: path.connectionLabel,
          view: {
            type: "schema-list",
            path: {
              connectionId: path.connectionId,
              connectionLabel: path.connectionLabel,
            },
          },
        },
        {
          label: "Users & RBAC",
          view: {
            type: "users",
            path,
          },
        },
      ]}
      onNavigateToView={(view) => {
        navigateToView(view).catch(() => undefined);
      }}
      onRefresh={handleRefresh}
      refreshing={refreshing}
      lastRefreshedAt={lastRefreshedAt}
      refreshLabel="Refresh users, roles, and database access"
    >
      {loading || !snapshot ? (
        error ? (
          <ErrorState message={error} onRetry={handleRefresh} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading users and roles…
          </div>
        )
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <DashboardSummary snapshot={snapshot} />
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex min-h-0 flex-1 flex-col gap-2"
          >
            <TabsList>
              <TabsTrigger value="users" className="gap-1.5">
                <Users className="size-3.5" />
                Users & Roles
              </TabsTrigger>
              <TabsTrigger value="databases" className="gap-1.5">
                <Database className="size-3.5" />
                Databases
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="triggers" className="gap-1.5">
                  <Zap className="size-3.5" />
                  Triggers
                </TabsTrigger>
              )}
              <TabsTrigger value="audit" className="gap-1.5">
                <ScrollText className="size-3.5" />
                Audit Log
              </TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="mt-0 min-h-0 flex-1">
              <RolesPane
                connectionId={path.connectionId}
                snapshot={snapshot}
                selectedRoleName={selectedRoleName}
                onSelectRole={setSelectedRoleName}
                onAfterMutation={handleAfterMutation}
                initialSelectedRole={path.selectedRole}
              />
            </TabsContent>

            <TabsContent value="databases" className="mt-0 min-h-0 flex-1">
              <DatabaseCards
                databases={snapshot.databases}
                onOpenUsers={() => setActiveTab("users")}
              />
            </TabsContent>

            {isAdmin && (
              <TabsContent value="triggers" className="mt-0 min-h-0 flex-1">
                <TriggersPane
                  connectionId={path.connectionId}
                  databaseNames={databaseNames}
                />
              </TabsContent>
            )}

            <TabsContent value="audit" className="mt-0 min-h-0 flex-1">
              <AuditLogPane
                connectionId={path.connectionId}
                isAdmin={isAdmin}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </ViewerShell>
  );
}

// ---------------------------------------------------------------------------
// Dashboard summary (compact stat strip)
// ---------------------------------------------------------------------------

function DashboardSummary({ snapshot }: Readonly<{ snapshot: RolesSnapshot }>) {
  const stats = snapshot.stats;
  const currentUser = snapshot.currentUser;
  const items = [
    { label: "Databases", value: stats.totalDatabases, icon: <Database className="size-3.5" /> },
    { label: "Users", value: stats.totalUsers, icon: <Users className="size-3.5" /> },
    { label: "Roles", value: stats.totalRoles, icon: <Shield className="size-3.5" /> },
    {
      label: "Superusers",
      value: stats.superusersCount,
      icon: <Shield className="size-3.5" />,
    },
    {
      label: "Active connections",
      value: stats.activeConnections,
      icon: <Activity className="size-3.5" />,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 pr-2">
        <Badge
          variant={currentUser.isSuperuser ? "destructive" : "secondary"}
          className="uppercase"
        >
          {currentUser.isSuperuser ? "Superuser" : "Non-superuser"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Signed in as <span className="font-mono text-foreground">{currentUser.name}</span>
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex items-center gap-1.5">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground">{item.icon}</span>
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-mono font-medium">
                {item.value === -1 ? "—" : item.value}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}