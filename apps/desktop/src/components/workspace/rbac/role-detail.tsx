import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/hooks/use-settings";
import type {
  AccessLevel,
  AlterRoleInput,
  CreateRoleInput,
  CurrentUser,
  PgDatabaseInfo,
  PgMembership,
  PgRole,
} from "@/shared/types/roles";
import { DatabaseAccessTab } from "./database-access-tab";
import { EffectivePermissionsTab } from "./effective-permissions-tab";
import {
  CreateRoleDialog,
  DropRoleDialog,
  EditRoleDialog,
  ResetPasswordDialog,
  RoleNameDialog,
} from "./role-dialogs";
import { RoleAttributesTab } from "./role-attributes-tab";
import { RoleDetailHeader } from "./role-detail-header";
import { RoleMembershipsTab } from "./role-memberships-tab";
import { ReadOnlyNotice, formatLevel, useRbacMutation } from "./shared";
import type { TableGrant } from "./table-access-sheet";

type OpenDialog =
  | "create"
  | "edit"
  | "reset-password"
  | "clone"
  | "rename"
  | "drop";

interface RoleDetailProps {
  connectionId: string;
  role: PgRole;
  memberships: PgMembership[];
  databases: PgDatabaseInfo[];
  accessTargetUser: string;
  allRoles: PgRole[];
  isAdmin: boolean;
  currentUser: CurrentUser;
  onSelectRole: (name: string) => void;
  onAfterMutation: () => void;
}

export function RoleDetail({
  connectionId,
  role,
  memberships,
  databases,
  accessTargetUser,
  allRoles,
  isAdmin,
  currentUser,
  onSelectRole,
  onAfterMutation,
}: Readonly<RoleDetailProps>) {
  const { settings } = useSettings();
  const readOnlyMode = settings.general.readOnlyMode;
  const { busy, run } = useRbacMutation(onAfterMutation);
  const [openDialog, setOpenDialog] = useState<OpenDialog | null>(null);

  const controlsDisabled = busy || readOnlyMode;
  const isSelf = role.name === currentUser.name;
  const parentsForRole = memberships.filter((m) => m.memberName === role.name);
  const candidateParents = allRoles.filter(
    (other) => other.name !== role.name && !other.canLogin,
  );

  function dialogProps(dialog: OpenDialog) {
    return {
      open: openDialog === dialog,
      onOpenChange: (open: boolean) => setOpenDialog(open ? dialog : null),
      busy,
    };
  }

  /** Runs a mutation and closes the open dialog when it succeeds. */
  async function runAndClose(
    ...args: Parameters<typeof run>
  ): Promise<boolean> {
    const ok = await run(...args);
    if (ok) setOpenDialog(null);
    return ok;
  }

  function handleCreate(input: CreateRoleInput) {
    return runAndClose(`Created role "${input.name}"`, () =>
      globalThis.window.rolesApi.createRole(input),
    );
  }

  function handleEdit(input: AlterRoleInput) {
    return runAndClose(`Updated role "${input.name}"`, () =>
      globalThis.window.rolesApi.alterRole(input),
    );
  }

  function handleResetPassword(password: string) {
    return runAndClose(`Reset password for "${role.name}"`, () =>
      globalThis.window.rolesApi.alterRolePassword(
        connectionId,
        role.name,
        password,
      ),
    );
  }

  function handleClone(newName: string) {
    return runAndClose(`Cloned "${role.name}" → "${newName}"`, () =>
      globalThis.window.rolesApi.cloneRole({
        connectionId,
        sourceName: role.name,
        newName,
      }),
    );
  }

  function handleRename(newName: string) {
    return runAndClose(
      `Renamed "${role.name}" → "${newName}"`,
      () =>
        globalThis.window.rolesApi.renameRole({
          connectionId,
          oldName: role.name,
          newName,
        }),
      // Follow the role to its new name before the snapshot refresh, which
      // is evaluated for the selected role.
      { onSuccess: () => onSelectRole(newName) },
    );
  }

  function handleDrop() {
    void runAndClose(
      `Dropped role "${role.name}"`,
      () => globalThis.window.rolesApi.dropRole(connectionId, role.name),
      { onSuccess: () => onSelectRole(currentUser.name) },
    );
  }

  function handleSaveComment(comment: string | null) {
    return run(`Updated description for "${role.name}"`, () =>
      globalThis.window.rolesApi.alterRoleComment(
        connectionId,
        role.name,
        comment,
      ),
    );
  }

  function handleToggleMembership(parent: PgRole, next: boolean) {
    const input = {
      connectionId,
      memberName: role.name,
      parentRoleName: parent.name,
    };
    if (next) {
      void run(
        `Granted "${parent.name}" to "${role.name}"`,
        () => globalThis.window.rolesApi.grantMembership(input),
        { suppressToast: true },
      );
      return;
    }
    void run(
      `Revoked "${parent.name}" from "${role.name}"`,
      () => globalThis.window.rolesApi.revokeMembership(input),
      { suppressToast: true },
    );
  }

  function handleSetDbAccessLevel(db: PgDatabaseInfo, level: AccessLevel) {
    void run(
      `Set ${formatLevel(level).toLowerCase()} on "${db.name}" for "${role.name}"`,
      () =>
        globalThis.window.rolesApi.setDbAccessLevel({
          connectionId,
          userName: role.name,
          databaseName: db.name,
          level,
          applyToFutureTables: true,
        }),
    );
  }

  function handleSetTableRestrictions(
    db: PgDatabaseInfo,
    tables: TableGrant[],
  ) {
    const granted = tables.filter((t) => t.level !== "none").length;
    return run(
      `Updated ${granted} table grant(s) on "${db.name}" for "${role.name}"`,
      () =>
        globalThis.window.rolesApi.setTableRestrictions({
          connectionId,
          userName: role.name,
          databaseName: db.name,
          tables,
        }),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 rounded-lg border border-border">
      <RoleDetailHeader
        role={role}
        isSelf={isSelf}
        isAdmin={isAdmin}
        busy={busy}
        disabled={controlsDisabled}
        onCreate={() => setOpenDialog("create")}
        onClone={() => setOpenDialog("clone")}
        onRename={() => setOpenDialog("rename")}
        onEdit={() => setOpenDialog("edit")}
        onResetPassword={() => setOpenDialog("reset-password")}
        onDrop={() => setOpenDialog("drop")}
      />
      {isAdmin && readOnlyMode && (
        <div className="px-4">
          <ReadOnlyNotice action="change roles" />
        </div>
      )}
      <Separator />
      <Tabs
        defaultValue="attributes"
        className="flex min-h-0 flex-1 flex-col gap-2"
      >
        <div className="px-4">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="attributes">Attributes</TabsTrigger>
            <TabsTrigger value="memberships">Roles</TabsTrigger>
            <TabsTrigger value="databases">Database access</TabsTrigger>
            <TabsTrigger value="effective">Effective</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-6">
            <TabsContent value="attributes" className="mt-0">
              <RoleAttributesTab
                role={role}
                isAdmin={isAdmin}
                isSelf={isSelf}
                disabled={controlsDisabled}
                onResetPassword={() => setOpenDialog("reset-password")}
                onEdit={() => setOpenDialog("edit")}
                onSaveComment={handleSaveComment}
              />
            </TabsContent>
            <TabsContent value="memberships" className="mt-0">
              <RoleMembershipsTab
                parentsForRole={parentsForRole}
                candidateParents={candidateParents}
                isAdmin={isAdmin}
                disabled={controlsDisabled}
                onToggleMembership={handleToggleMembership}
              />
            </TabsContent>
            <TabsContent value="databases" className="mt-0">
              <DatabaseAccessTab
                role={role}
                databases={databases}
                accessTargetUser={accessTargetUser}
                isAdmin={isAdmin}
                disabled={controlsDisabled}
                onSetDbAccessLevel={handleSetDbAccessLevel}
                onSetTableRestrictions={handleSetTableRestrictions}
              />
            </TabsContent>
            <TabsContent value="effective" className="mt-0">
              <EffectivePermissionsTab
                connectionId={connectionId}
                roleName={role.name}
                isAdmin={isAdmin}
              />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>

      {isAdmin && (
        <>
          <CreateRoleDialog
            {...dialogProps("create")}
            connectionId={connectionId}
            existingRoles={allRoles}
            onSubmit={handleCreate}
          />
          <EditRoleDialog
            {...dialogProps("edit")}
            role={role}
            connectionId={connectionId}
            onSubmit={handleEdit}
          />
          <ResetPasswordDialog
            {...dialogProps("reset-password")}
            roleName={role.name}
            onSubmit={handleResetPassword}
          />
          <RoleNameDialog
            {...dialogProps("clone")}
            idPrefix="clone-role"
            title={<>Clone role &quot;{role.name}&quot;</>}
            description="Creates a new role with the same attributes and memberships. Superuser roles cannot be cloned."
            fieldLabel="New role name"
            placeholder="e.g. accounting_reader_2"
            submitLabel="Clone role"
            currentName={role.name}
            existingRoles={allRoles}
            onSubmit={handleClone}
          />
          <RoleNameDialog
            {...dialogProps("rename")}
            idPrefix="rename-role"
            title={<>Rename role &quot;{role.name}&quot;</>}
            description={
              <>
                Runs <code>ALTER ROLE … RENAME TO</code>. Existing grants
                reference the role by OID, but applications connecting by name
                will need the new value.
              </>
            }
            fieldLabel="New name"
            placeholder={role.name}
            submitLabel="Rename role"
            currentName={role.name}
            existingRoles={allRoles}
            onSubmit={handleRename}
          />
          <DropRoleDialog
            {...dialogProps("drop")}
            roleName={role.name}
            onConfirm={handleDrop}
          />
        </>
      )}
    </div>
  );
}
