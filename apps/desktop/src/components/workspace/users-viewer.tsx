import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Database,
  Shield,
  ScrollText,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import { useWorkspace } from "@/hooks/use-workspace";
import { useLatestRequest } from "@/hooks/use-latest-request";
import type { RolesSnapshot } from "@/shared/types/roles";
import type { UsersViewerPath } from "@/shared/types/workspace";
import { ErrorState, LoadingState, unwrap } from "./rbac/shared";
import { RolesPane } from "./rbac/roles-pane";
import { DatabaseCards } from "./rbac/database-cards";
import { TriggersPane } from "./rbac/triggers-pane";
import { AuditLogPane } from "./rbac/audit-log-pane";

interface UsersViewerProps {
  path: UsersViewerPath;
}

export function UsersViewer({ path }: Readonly<UsersViewerProps>) {
  const { navigateToView, notifyRolesChanged } = useWorkspace();
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

  // The snapshot's per-database access is evaluated for one role
  // (`targetUser`), so every fetch targets the selected role. The fetcher
  // reads the selection through a ref, updated synchronously by
  // `selectRole`, so a refresh that immediately follows a selection change
  // (e.g. after a rename) already targets the new role.
  const selectedRoleNameRef = useRef(selectedRoleName);
  // The target of the most recently started fetch, so a selection change
  // that a fetch is already covering doesn't start a second request.
  const requestedTargetRef = useRef<string | null>(null);

  const selectRole = useCallback((name: string | null) => {
    selectedRoleNameRef.current = name;
    setSelectedRoleName(name);
  }, []);

  // A reused Users tab (sidebar click on another role) navigates in place.
  useEffect(() => {
    if (path.selectedRole) selectRole(path.selectedRole);
  }, [path.selectedRole, selectRole]);

  const runLatestSnapshotRequest = useLatestRequest();

  const fetchSnapshot = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);

      const targetUser = selectedRoleNameRef.current;
      requestedTargetRef.current = targetUser;
      const result = await runLatestSnapshotRequest(async () =>
        unwrap(
          await globalThis.window.rolesApi.getSnapshot(
            path.connectionId,
            targetUser ?? undefined,
          ),
        ),
      );

      if (result.status === "stale") return;
      setLoading(false);
      setRefreshing(false);

      if (result.status === "error") {
        const message = (result.error as Error).message;
        setError(message);
        toast.error("Failed to load users and roles", {
          description: message,
        });
        return;
      }

      const next = result.value;
      setSnapshot(next);
      setLastRefreshedAt(new Date());
      setError(null);

      // Keep the selection on the role the snapshot was evaluated for.
      // Without a selection the server evaluates the current user, which
      // becomes the default selection — no second request needed.
      const targetExists =
        targetUser !== null && next.roles.some((r) => r.name === targetUser);
      const resolved =
        next.currentUser.isSuperuser && targetExists
          ? targetUser
          : next.targetUser;
      requestedTargetRef.current = resolved;
      selectRole(resolved);
    },
    [path.connectionId, runLatestSnapshotRequest, selectRole],
  );

  useEffect(() => {
    void fetchSnapshot("initial");
  }, [fetchSnapshot]);

  // Selecting another role refetches the snapshot targeted at that role.
  useEffect(() => {
    if (!snapshot?.currentUser.isSuperuser) return;
    if (!selectedRoleName) return;
    if (selectedRoleName === snapshot.targetUser) return;
    if (selectedRoleName === requestedTargetRef.current) return;
    void fetchSnapshot("refresh");
  }, [selectedRoleName, snapshot, fetchSnapshot]);

  const handleRefresh = useCallback(async () => {
    await fetchSnapshot("refresh");
  }, [fetchSnapshot]);

  const handleAfterMutation = useCallback(() => {
    void fetchSnapshot("refresh");
    notifyRolesChanged();
  }, [fetchSnapshot, notifyRolesChanged]);

  const databaseNames = useMemo(
    () =>
      (snapshot?.databases ?? [])
        .filter((db) => db.allowConnections)
        .map((db) => db.name),
    [snapshot?.databases],
  );

  let content: React.ReactNode;
  if (!snapshot) {
    content =
      error && !loading ? (
        <ErrorState
          message={error}
          onRetry={() => {
            void fetchSnapshot("initial");
          }}
        />
      ) : (
        <LoadingState label="Loading users and roles…" />
      );
  } else {
    content = (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <DashboardSummary snapshot={snapshot} />
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col gap-2"
        >
          <TabsList>
            <TabsTrigger value="users">
              <Users />
              Users and roles
            </TabsTrigger>
            <TabsTrigger value="databases">
              <Database />
              Databases
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="triggers">
                <Zap />
                Triggers
              </TabsTrigger>
            )}
            <TabsTrigger value="audit">
              <ScrollText />
              Audit log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-0 min-h-0 flex-1">
            <RolesPane
              connectionId={path.connectionId}
              snapshot={snapshot}
              selectedRoleName={selectedRoleName}
              onSelectRole={selectRole}
              onAfterMutation={handleAfterMutation}
            />
          </TabsContent>

          <TabsContent value="databases" className="mt-0 min-h-0 flex-1">
            <DatabaseCards
              databases={snapshot.databases}
              targetUser={snapshot.targetUser}
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
            <AuditLogPane connectionId={path.connectionId} isAdmin={isAdmin} />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

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
          label: "Users and roles",
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
      {content}
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
    { label: "Databases", value: stats.totalDatabases, icon: <Database /> },
    { label: "Users", value: stats.totalUsers, icon: <Users /> },
    { label: "Roles", value: stats.totalRoles, icon: <Shield /> },
    { label: "Superusers", value: stats.superusersCount, icon: <Shield /> },
    {
      label: "Active connections",
      value: stats.activeConnections,
      icon: <Activity />,
    },
  ];

  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs/5">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Signed in as</span>
        <span className="font-mono text-[12.5px] text-foreground">
          {currentUser.name}
        </span>
        <Badge>{currentUser.isSuperuser ? "Superuser" : "Non-superuser"}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:ml-auto">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          >
            {item.icon}
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-mono text-foreground tabular-nums">
              {item.value === -1 ? "—" : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
