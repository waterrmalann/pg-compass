import { useMemo, useState } from "react";
import { useSettings } from "@/hooks/use-settings";
import type { RolesSnapshot } from "@/shared/types/roles";
import { RoleDetail } from "./role-detail";
import { RoleList } from "./role-list";

interface RolesPaneProps {
  connectionId: string;
  snapshot: RolesSnapshot;
  selectedRoleName: string | null;
  onSelectRole: (name: string) => void;
  onAfterMutation: () => void;
}

export function RolesPane({
  connectionId,
  snapshot,
  selectedRoleName,
  onSelectRole,
  onAfterMutation,
}: Readonly<RolesPaneProps>) {
  const [search, setSearch] = useState("");
  const { settings } = useSettings();

  const isAdmin = snapshot.currentUser.isSuperuser;

  const showInternalRoles = !settings.general.hideInternalSchemas;
  const visibleRoles = useMemo(
    () =>
      showInternalRoles
        ? snapshot.roles
        : snapshot.roles.filter((role) => !role.name.startsWith("pg_")),
    [snapshot.roles, showInternalRoles],
  );

  const filteredRoles = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    return visibleRoles.filter(
      (role) => !trimmed || role.name.toLowerCase().includes(trimmed),
    );
  }, [visibleRoles, search]);

  const selectedRole =
    visibleRoles.find((role) => role.name === selectedRoleName) ?? null;

  return (
    <div className="flex h-full min-h-0 gap-4">
      <RoleList
        roles={filteredRoles}
        selectedRoleName={selectedRoleName}
        onSelectRole={onSelectRole}
        search={search}
        onSearchChange={setSearch}
        isAdmin={isAdmin}
      />
      {selectedRole ? (
        <RoleDetail
          // Keyed by role so open dialogs, drafts and typed passwords never
          // carry over from one role to another.
          key={selectedRole.name}
          connectionId={connectionId}
          role={selectedRole}
          memberships={snapshot.memberships}
          databases={snapshot.databases}
          accessTargetUser={snapshot.targetUser}
          allRoles={visibleRoles}
          isAdmin={isAdmin}
          currentUser={snapshot.currentUser}
          onSelectRole={onSelectRole}
          onAfterMutation={onAfterMutation}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-6">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            Select a role to view its attributes, memberships, and database
            access.
          </p>
        </div>
      )}
    </div>
  );
}
