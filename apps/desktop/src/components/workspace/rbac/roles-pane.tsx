import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ChevronDownIcon,
  Database,
  Key,
  Layers,
  Loader2,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
  Copy,
  Pencil,
} from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AccessLevel,
  AlterRoleInput,
  CloneRoleInput,
  CreateRoleInput,
  EffectivePermissions,
  MembershipInput,
  PgDatabaseInfo,
  PgMembership,
  PgRole,
  PgTableAccess,
  RenameRoleInput,
  RolesSnapshot,
  SetDbAccessLevelInput,
  TableRestrictionInput,
} from "@/shared/types/roles";
import type { IpcResult } from "@/shared/types/ipc";
import { useSettings } from "@/hooks/use-settings";
import { BUILTIN_ROLE_DESCRIPTIONS } from "@/shared/constants/builtin-roles";
import {
  Field,
  LoadingState,
  formatBool,
  formatLevel,
  unwrap,
  useRbacMutation,
} from "./shared";

interface RolesPaneProps {
  connectionId: string;
  snapshot: RolesSnapshot;
  selectedRoleName: string | null;
  onSelectRole: (name: string) => void;
  onAfterMutation: () => void;
  initialSelectedRole?: string;
}

export function RolesPane({
  connectionId,
  snapshot,
  selectedRoleName,
  onSelectRole,
  onAfterMutation,
  initialSelectedRole,
}: Readonly<RolesPaneProps>) {
  const { run } = useRbacMutation(onAfterMutation);
  const [search, setSearch] = useState("");
  const { settings } = useSettings();

  const isAdmin = Boolean(snapshot.currentUser.isSuperuser);

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

  const selectedRole = useMemo<PgRole | null>(
    () =>
      visibleRoles.find((role) => role.name === selectedRoleName) ?? null,
    [visibleRoles, selectedRoleName],
  );

  return (
    <div className="flex h-full min-h-0 gap-4">
      <RolesListPane
        roles={filteredRoles}
        selectedRoleName={selectedRoleName}
        onSelectRole={onSelectRole}
        search={search}
        onSearchChange={setSearch}
        isAdmin={isAdmin}
      />
      <RoleDetailPane
        connectionId={connectionId}
        role={selectedRole}
        memberships={snapshot.memberships}
        databases={snapshot.databases}
        allRoles={visibleRoles}
        isAdmin={isAdmin}
        currentUser={snapshot.currentUser}
        onMutation={run}
        initialSelectedRole={initialSelectedRole}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roles list (left pane)
// ---------------------------------------------------------------------------

function bySuperuserFirst(a: PgRole, b: PgRole): number {
  if (a.isSuperuser === b.isSuperuser) return 0;
  return a.isSuperuser ? -1 : 1;
}

interface RolesListPaneProps {
  roles: PgRole[];
  selectedRoleName: string | null;
  onSelectRole: (roleName: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  isAdmin: boolean;
}

function RolesListPane({
  roles,
  selectedRoleName,
  onSelectRole,
  search,
  onSearchChange,
  isAdmin,
}: Readonly<RolesListPaneProps>) {
  const loginRoles = useMemo(
    () => roles.filter((r) => r.canLogin).sort(bySuperuserFirst),
    [roles],
  );
  const groupRoles = useMemo(
    () => roles.filter((r) => !r.canLogin).sort(bySuperuserFirst),
    [roles],
  );

  const [category, setCategory] = useState<"users" | "roles">("users");

  useEffect(() => {
    if (!selectedRoleName) return;
    const role = roles.find((r) => r.name === selectedRoleName);
    if (!role) return;
    setCategory(role.canLogin ? "users" : "roles");
  }, [selectedRoleName, roles]);

  if (!isAdmin) {
    return (
      <div className="flex h-full min-h-0 w-64 shrink-0 flex-col gap-2 rounded-lg border border-border">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">My Account</span>
          </div>
        </div>
        <Separator />
        <ScrollArea className="min-h-0 flex-1">
          <RoleRowsList
            roles={roles}
            selectedRoleName={selectedRoleName}
            onSelectRole={onSelectRole}
            disabled
            emptyText="No account information available."
          />
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-64 shrink-0 flex-col rounded-lg border border-border">
      <Tabs
        value={category}
        onValueChange={(value) => setCategory(value as "users" | "roles")}
        className="flex min-h-0 flex-1 flex-col gap-2"
      >
        <div className="px-2 pt-2">
          <TabsList className="w-full">
            <TabsTrigger value="users" className="flex-1 gap-1.5">
              <Users className="size-3.5" />
              Users
              <Badge variant="secondary" className="text-[10px]">
                {loginRoles.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="roles" className="flex-1 gap-1.5">
              <Shield className="size-3.5" />
              Roles
              <Badge variant="secondary" className="text-[10px]">
                {groupRoles.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="relative px-3">
          <Search className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={category === "users" ? "Filter users" : "Filter roles"}
            aria-label={category === "users" ? "Filter users" : "Filter roles"}
            className="h-8 pl-8 pr-8 text-xs"
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-4 top-1/2 size-6 -translate-y-1/2"
              aria-label="Clear filter"
              onClick={() => onSearchChange("")}
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
        <Separator />
        <TabsContent value="users" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="min-h-0 h-full">
            <RoleRowsList
              roles={loginRoles}
              selectedRoleName={selectedRoleName}
              onSelectRole={onSelectRole}
              emptyText="No users match the current filter."
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="roles" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="min-h-0 h-full">
            <RoleRowsList
              roles={groupRoles}
              selectedRoleName={selectedRoleName}
              onSelectRole={onSelectRole}
              emptyText="No roles match the current filter."
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RoleRowsList({
  roles,
  selectedRoleName,
  onSelectRole,
  disabled,
  emptyText,
}: Readonly<{
  roles: PgRole[];
  selectedRoleName: string | null;
  onSelectRole: (roleName: string) => void;
  disabled?: boolean;
  emptyText: string;
}>) {
  if (roles.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  return (
    <div className="flex flex-col py-1">
      {roles.map((role) => (
        <RoleRow
          key={role.name}
          role={role}
          selected={role.name === selectedRoleName}
          onSelect={() => onSelectRole(role.name)}
          disabled={Boolean(disabled)}
        />
      ))}
    </div>
  );
}

function RoleRow({
  role,
  selected,
  onSelect,
  disabled,
}: Readonly<{
  role: PgRole;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}>) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-transparent"
      onClick={onSelect}
      disabled={disabled}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{role.name}</span>
        <span className="flex flex-wrap gap-1">
          {role.canLogin === false && (
            <Badge variant="outline" className="text-[10px] uppercase">
              Role
            </Badge>
          )}
          {role.isSuperuser && (
            <Badge variant="destructive" className="text-[10px] uppercase">
              Super
            </Badge>
          )}
          {role.canLogin && !role.isSuperuser && (
            <Badge variant="secondary" className="text-[10px] uppercase">
              Login
            </Badge>
          )}
        </span>
      </span>
      {selected && (
        <span className="size-1.5 rounded-full bg-primary" aria-hidden />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Role detail (right pane)
// ---------------------------------------------------------------------------

interface RoleDetailPaneProps {
  connectionId: string;
  role: PgRole | null;
  memberships: PgMembership[];
  databases: PgDatabaseInfo[];
  allRoles: PgRole[];
  isAdmin: boolean;
  currentUser: RolesSnapshot["currentUser"];
  onMutation: (
    label: string,
    fn: () => Promise<IpcResult<unknown>>,
    options?: { suppressToast?: boolean },
  ) => Promise<boolean>;
  initialSelectedRole?: string;
}

function RoleDetailPane({
  connectionId,
  role,
  memberships,
  databases,
  allRoles,
  isAdmin,
  currentUser,
  onMutation,
}: Readonly<RoleDetailPaneProps>) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!role) {
    return (
      <EmptyDetail>
        Select a role to view its attributes, memberships, and database access.
      </EmptyDetail>
    );
  }

  // Const alias so the non-null narrowing survives nested async closures.
  const activeRole = role;
  const isSelf = activeRole.name === currentUser.name;
  const parentsForRole = memberships.filter((m) => m.memberName === role.name);
  const candidateParents = allRoles.filter(
    (other) => other.name !== role.name && !other.canLogin,
  );

  async function handleCreate(input: CreateRoleInput): Promise<boolean> {
    setBusy(true);
    const ok = await onMutation(`Created role "${input.name}"`, () =>
      globalThis.window.rolesApi.createRole(input),
    );
    setBusy(false);
    if (ok) setCreateOpen(false);
    return ok;
  }

  async function handleEdit(input: AlterRoleInput): Promise<boolean> {
    setBusy(true);
    const ok = await onMutation(`Updated role "${input.name}"`, () =>
      globalThis.window.rolesApi.alterRole(input),
    );
    setBusy(false);
    if (ok) setEditOpen(false);
    return ok;
  }

  async function handleSaveComment(comment: string | null): Promise<boolean> {
    setBusy(true);
    const ok = await onMutation(
      `Updated description for "${activeRole.name}"`,
      () =>
        globalThis.window.rolesApi.alterRoleComment(
          connectionId,
          activeRole.name,
          comment,
        ),
    );
    setBusy(false);
    return ok;
  }

  async function handleResetPassword(password: string): Promise<boolean> {
    setBusy(true);
    const ok = await onMutation(`Reset password for "${activeRole.name}"`, () =>
      globalThis.window.rolesApi.alterRolePassword(
        connectionId,
        activeRole.name,
        password,
      ),
    );
    setBusy(false);
    if (ok) setResetPasswordOpen(false);
    return ok;
  }

  async function handleDrop(): Promise<boolean> {
    setBusy(true);
    const ok = await onMutation(`Dropped role "${activeRole.name}"`, () =>
      globalThis.window.rolesApi.dropRole(connectionId, activeRole.name),
    );
    setBusy(false);
    if (ok) setDropOpen(false);
    return ok;
  }

  async function handleClone(newName: string): Promise<boolean> {
    const input: CloneRoleInput = {
      connectionId,
      sourceName: activeRole.name,
      newName,
    };
    setBusy(true);
    const ok = await onMutation(`Cloned "${activeRole.name}" → "${newName}"`, () =>
      globalThis.window.rolesApi.cloneRole(input),
    );
    setBusy(false);
    if (ok) setCloneOpen(false);
    return ok;
  }

  async function handleRename(newName: string): Promise<boolean> {
    const input: RenameRoleInput = {
      connectionId,
      oldName: activeRole.name,
      newName,
    };
    setBusy(true);
    const ok = await onMutation(`Renamed "${activeRole.name}" → "${newName}"`, () =>
      globalThis.window.rolesApi.renameRole(input),
    );
    setBusy(false);
    if (ok) setRenameOpen(false);
    return ok;
  }

  async function handleToggleMembership(parent: PgRole, next: boolean) {
    const input: MembershipInput = {
      connectionId,
      memberName: activeRole.name,
      parentRoleName: parent.name,
    };
    setBusy(true);
    if (next) {
      await onMutation(
        `Granted "${parent.name}" to "${activeRole.name}"`,
        () => globalThis.window.rolesApi.grantMembership(input),
        { suppressToast: true },
      );
    } else {
      await onMutation(
        `Revoked "${parent.name}" from "${activeRole.name}"`,
        () => globalThis.window.rolesApi.revokeMembership(input),
        { suppressToast: true },
      );
    }
    setBusy(false);
  }

  async function handleSetDbAccessLevel(
    db: PgDatabaseInfo,
    level: AccessLevel,
  ): Promise<void> {
    const input: SetDbAccessLevelInput = {
      connectionId,
      userName: activeRole.name,
      databaseName: db.name,
      level,
      applyToFutureTables: true,
    };
    setBusy(true);
    await onMutation(
      `Set ${formatLevel(level).toLowerCase()} on "${db.name}" for "${activeRole.name}"`,
      () => globalThis.window.rolesApi.setDbAccessLevel(input),
    );
    setBusy(false);
  }

  async function handleSetTableRestrictions(
    db: PgDatabaseInfo,
    tables: Array<{ schema: string; name: string; level: AccessLevel }>,
  ): Promise<boolean> {
    const input: TableRestrictionInput = {
      connectionId,
      userName: activeRole.name,
      databaseName: db.name,
      tables,
    };
    setBusy(true);
    const granted = tables.filter((t) => t.level !== "none").length;
    const ok = await onMutation(
      `Updated ${granted} table grant(s) on "${db.name}" for "${activeRole.name}"`,
      () => globalThis.window.rolesApi.setTableRestrictions(input),
    );
    setBusy(false);
    return ok;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 rounded-lg border border-border">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-md bg-muted p-2">
            {role.canLogin ? (
              <Users className="size-4" />
            ) : (
              <Shield className="size-4" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{role.name}</h2>
            <div className="mt-1 flex flex-wrap gap-1">
              {role.canLogin && (
                <Badge variant="secondary" className="uppercase">
                  Login
                </Badge>
              )}
              {role.isSuperuser && (
                <Badge variant="destructive" className="uppercase">
                  Superuser
                </Badge>
              )}
              {role.canCreateDb && (
                <Badge variant="outline" className="uppercase">
                  Createdb
                </Badge>
              )}
              {role.canCreateRole && (
                <Badge variant="outline" className="uppercase">
                  Createrole
                </Badge>
              )}
              {role.canReplicate && (
                <Badge variant="outline" className="uppercase">
                  Replication
                </Badge>
              )}
              {role.canBypassRls && (
                <Badge variant="outline" className="uppercase">
                  Bypass RLS
                </Badge>
              )}
              {isSelf && (
                <Badge variant="default" className="uppercase">
                  You
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                <UserPlus className="size-3.5" />
                New
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clone role"
                onClick={() => setCloneOpen(true)}
                disabled={busy || role.isSuperuser}
                title="Clone role"
              >
                <Copy className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Rename role"
                onClick={() => setRenameOpen(true)}
                disabled={busy || isSelf}
                title={
                  isSelf
                    ? "Can't rename the role you're currently connected as"
                    : "Rename role"
                }
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit role attributes"
                onClick={() => setEditOpen(true)}
                disabled={busy}
                title="Edit attributes"
              >
                <Shield className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Reset password"
                onClick={() => setResetPasswordOpen(true)}
                disabled={busy || !role.canLogin}
                title="Reset password"
              >
                <Key className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Drop role"
                onClick={() => setDropOpen(true)}
                disabled={busy || isSelf}
                title="Drop role"
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </>
          )}
          {busy && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>
      <Separator />
      <Tabs
        defaultValue="attributes"
        className="flex min-h-0 flex-1 flex-col gap-2"
      >
        <div className="px-4">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="attributes">Attributes</TabsTrigger>
            <TabsTrigger value="memberships">Roles</TabsTrigger>
            <TabsTrigger value="databases">Database Access</TabsTrigger>
            <TabsTrigger value="effective">Effective</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-6">
            <TabsContent value="attributes" className="mt-0">
              <RoleAttributes
                role={role}
                isAdmin={isAdmin}
                isSelf={isSelf}
                onChangePassword={
                  role.canLogin ? () => setResetPasswordOpen(true) : undefined
                }
                onEdit={() => setEditOpen(true)}
                onSaveComment={handleSaveComment}
              />
            </TabsContent>
            <TabsContent value="memberships" className="mt-0">
              <RoleMembershipsTab
                parentsForRole={parentsForRole}
                candidateParents={candidateParents}
                isAdmin={isAdmin}
                busy={busy}
                onToggleMembership={handleToggleMembership}
              />
            </TabsContent>
            <TabsContent value="databases" className="mt-0">
              <DatabaseAccessTab
                connectionId={connectionId}
                role={role}
                databases={databases}
                isAdmin={isAdmin}
                busy={busy}
                onSetDbAccessLevel={handleSetDbAccessLevel}
                onSetTableRestrictions={handleSetTableRestrictions}
              />
            </TabsContent>
            <TabsContent value="effective" className="mt-0">
              <EffectivePermissionsTab
                connectionId={connectionId}
                roleName={role.name}
                isAdmin={isAdmin}
                inheritedRoles={parentsForRole.map((m) => m.parentName)}
              />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>

      {isAdmin && (
        <CreateRoleDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          connectionId={connectionId}
          existingRoles={allRoles}
          busy={busy}
          onSubmit={handleCreate}
        />
      )}
      {isAdmin && (
        <EditRoleDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          role={role}
          connectionId={connectionId}
          busy={busy}
          onSubmit={handleEdit}
        />
      )}
      {isAdmin && (
        <ResetPasswordDialog
          open={resetPasswordOpen}
          onOpenChange={setResetPasswordOpen}
          roleName={role.name}
          busy={busy}
          onSubmit={handleResetPassword}
        />
      )}
      {isAdmin && (
        <CloneRoleDialog
          open={cloneOpen}
          onOpenChange={setCloneOpen}
          sourceName={role.name}
          existingRoles={allRoles}
          busy={busy}
          onSubmit={handleClone}
        />
      )}
      {isAdmin && (
        <RenameRoleDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          roleName={role.name}
          existingRoles={allRoles}
          busy={busy}
          onSubmit={handleRename}
        />
      )}
      {isAdmin && (
        <Dialog
          open={dropOpen}
          onOpenChange={(open) => !busy && setDropOpen(open)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Drop role &quot;{role.name}&quot;?</DialogTitle>
              <DialogDescription>
                This runs <code>DROP ROLE</code> on the connected server. If the
                role still owns objects or has active grants, the operation will
                be rejected by PostgreSQL.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDropOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void handleDrop()}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}Drop role
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function EmptyDetail({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-6">
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

function RoleAttributes({
  role,
  isAdmin,
  isSelf,
  onChangePassword,
  onEdit,
  onSaveComment,
}: Readonly<{
  role: PgRole;
  isAdmin: boolean;
  isSelf: boolean;
  onChangePassword?: () => void;
  onEdit: () => void;
  onSaveComment: (comment: string | null) => Promise<boolean>;
}>) {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <RoleDescriptionField
        key={role.name}
        description={role.description}
        isAdmin={isAdmin}
        onSave={onSaveComment}
      />
      <AttributeGrid role={role} />
      <div className="flex flex-wrap gap-2">
        {isSelf && onChangePassword && (
          <Button variant="outline" size="sm" onClick={onChangePassword}>
            <Key className="size-3.5" /> Reset my password
          </Button>
        )}
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Shield className="size-3.5" /> Edit attributes
          </Button>
        )}
      </div>
    </div>
  );
}

function RoleDescriptionField({
  description,
  isAdmin,
  onSave,
}: Readonly<{
  description: string | null;
  isAdmin: boolean;
  onSave: (comment: string | null) => Promise<boolean>;
}>) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const trimmed = value.trim();
    const ok = await onSave(trimmed.length === 0 ? null : trimmed);
    setSaving(false);
    if (ok) setEditing(false);
  }

  function handleCancel() {
    setValue(description ?? "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Description
          </span>
          {isAdmin && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3" />
              Edit
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {description ?? "No description set."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
      <Label htmlFor="role-description">Description</Label>
      <textarea
        id="role-description"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        placeholder="What is this role for?"
        className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={handleCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AttributeGrid({ role }: Readonly<{ role: PgRole }>) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border p-4 text-sm">
      <AttributeRow label="Login" value={formatBool(role.canLogin)} />
      <AttributeRow label="Superuser" value={formatBool(role.isSuperuser)} />
      <AttributeRow
        label="Can create role"
        value={formatBool(role.canCreateRole)}
      />
      <AttributeRow
        label="Can create database"
        value={formatBool(role.canCreateDb)}
      />
      <AttributeRow
        label="Inherit privileges"
        value={formatBool(role.inherit)}
      />
      <AttributeRow label="Replication" value={formatBool(role.canReplicate)} />
      <AttributeRow label="Bypass RLS" value={formatBool(role.canBypassRls)} />
      <AttributeRow label="Has password" value={formatBool(role.hasPassword)} />
      <AttributeRow
        label="Connection limit"
        value={
          role.connectionLimit === -1
            ? "unlimited"
            : String(role.connectionLimit)
        }
      />
      <AttributeRow
        label="Valid until"
        value={role.validUntil ?? "no expiry"}
      />
    </div>
  );
}

function AttributeRow({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

function RoleMembershipsTab({
  parentsForRole,
  candidateParents,
  isAdmin,
  busy,
  onToggleMembership,
}: Readonly<{
  parentsForRole: PgMembership[];
  candidateParents: PgRole[];
  isAdmin: boolean;
  busy: boolean;
  onToggleMembership: (parent: PgRole, next: boolean) => void;
}>) {
  const parentSet = new Map(parentsForRole.map((m) => [m.parentName, m]));

  if (!isAdmin) {
    return (
      <div className="flex max-w-2xl flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          You can view the roles this principal belongs to. Reassigning roles
          requires a superuser connection.
        </p>
        <div className="rounded-lg border border-border">
          {parentSet.size === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              Not a member of any other role.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {Array.from(parentSet.values()).map((m) => (
                <li key={m.parentName} className="px-3 py-2 text-sm">
                  <div className="flex items-center">
                    {m.parentName}
                    {m.withAdminOption && (
                      <Badge variant="secondary" className="ml-2 uppercase">
                        Admin
                      </Badge>
                    )}
                  </div>
                  {BUILTIN_ROLE_DESCRIPTIONS[m.parentName] && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {BUILTIN_ROLE_DESCRIPTIONS[m.parentName]}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Toggle which roles this principal inherits privileges from.
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Granted</TableHead>
              <TableHead>Can re-grant</TableHead>
              <TableHead>Use</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidateParents.map((parent) => {
              const membership = parentSet.get(parent.name);
              const isMember = Boolean(membership);
              const description = BUILTIN_ROLE_DESCRIPTIONS[parent.name];
              return (
                <TableRow key={parent.name}>
                  <TableCell className="font-medium">{parent.name}</TableCell>
                  <TableCell>
                    <Switch
                      checked={isMember}
                      disabled={busy}
                      onCheckedChange={(next) =>
                        onToggleMembership(parent, next)
                      }
                      aria-label={`Toggle membership in ${parent.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    {membership?.withAdminOption ? (
                      <Badge variant="secondary" className="uppercase">
                        Admin
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-xs text-muted-foreground">
                    {description ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Database access abstraction: No Access / Read Only / Read + Write
// ---------------------------------------------------------------------------

function DatabaseAccessTab({
  role,
  databases,
  isAdmin,
  busy,
  onSetDbAccessLevel,
  onSetTableRestrictions,
}: Readonly<{
  connectionId: string;
  role: PgRole;
  databases: PgDatabaseInfo[];
  isAdmin: boolean;
  busy: boolean;
  onSetDbAccessLevel: (
    db: PgDatabaseInfo,
    level: AccessLevel,
  ) => Promise<void>;
  onSetTableRestrictions: (
    db: PgDatabaseInfo,
    tables: Array<{ schema: string; name: string; level: AccessLevel }>,
  ) => Promise<boolean>;
}>) {
  if (databases.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No databases are connectable on this server.
      </p>
    );
  }

  return (
    <div className="flex max-w-5xl flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Each database grants one of three access levels for{" "}
        <span className="font-medium text-foreground">{role.name}</span>. Read
        Only grants CONNECT, USAGE on the public schema, and SELECT on tables;
        Read + Write adds INSERT, UPDATE, DELETE. Use &quot;Manage
        tables&quot; to grant specific tables — in any schema — their own
        read or read/write level.
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead>Database</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Access level</TableHead>
              <TableHead>Tables</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {databases.map((db) => (
              <DatabaseAccessRow
                key={db.name}
                db={db}
                roleName={role.name}
                isAdmin={isAdmin}
                busy={busy}
                onSetDbAccessLevel={onSetDbAccessLevel}
                onSetTableRestrictions={onSetTableRestrictions}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DatabaseAccessRow({
  db,
  roleName,
  isAdmin,
  busy,
  onSetDbAccessLevel,
  onSetTableRestrictions,
}: Readonly<{
  db: PgDatabaseInfo;
  roleName: string;
  isAdmin: boolean;
  busy: boolean;
  onSetDbAccessLevel: (
    db: PgDatabaseInfo,
    level: AccessLevel,
  ) => Promise<void>;
  onSetTableRestrictions: (
    db: PgDatabaseInfo,
    tables: Array<{ schema: string; name: string; level: AccessLevel }>,
  ) => Promise<boolean>;
}>) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const grantedCount = db.tables.filter((t) => t.level !== "none").length;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <span className="flex items-center gap-2">
          <Database className="size-3.5 text-muted-foreground" />
          {db.name}
        </span>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {db.owner}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {db.size ?? "—"}
      </TableCell>
      <TableCell>
        {isAdmin ? (
          <AccessLevelControl
            value={db.level}
            disabled={busy}
            onChange={(level) => void onSetDbAccessLevel(db, level)}
          />
        ) : (
          <Badge
            variant={db.level === "none" ? "outline" : "secondary"}
            className="uppercase"
          >
            {formatLevel(db.level)}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {isAdmin && db.tables.length > 0 ? (
          <>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setSheetOpen(true)}
            >
              <Layers className="size-3.5" />
              Manage tables
              <Badge variant="secondary" className="text-[10px]">
                {grantedCount}/{db.tables.length}
              </Badge>
            </Button>
            <TableAccessSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              db={db}
              roleName={roleName}
              busy={busy}
              onSave={(tables) => onSetTableRestrictions(db, tables)}
            />
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Per-table access, grouped by schema (tree)
// ---------------------------------------------------------------------------

function groupTablesBySchema(
  tables: PgTableAccess[],
): Array<{ schema: string; tables: PgTableAccess[] }> {
  const bySchema = new Map<string, PgTableAccess[]>();
  for (const table of tables) {
    const list = bySchema.get(table.schemaName) ?? [];
    list.push(table);
    bySchema.set(table.schemaName, list);
  }
  return Array.from(bySchema.entries())
    .map(([schema, schemaTables]) => ({ schema, tables: schemaTables }))
    .sort((a, b) => {
      if (a.schema === "public") return -1;
      if (b.schema === "public") return 1;
      return a.schema.localeCompare(b.schema);
    });
}

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function TableAccessSheet({
  open,
  onOpenChange,
  db,
  roleName,
  busy,
  onSave,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: PgDatabaseInfo;
  roleName: string;
  busy: boolean;
  onSave: (
    tables: Array<{ schema: string; name: string; level: AccessLevel }>,
  ) => Promise<boolean>;
}>) {
  const schemas = useMemo(() => groupTablesBySchema(db.tables), [db.tables]);
  const [draft, setDraft] = useState<Map<string, AccessLevel>>(new Map());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    const next = new Map<string, AccessLevel>();
    for (const table of db.tables) {
      next.set(tableKey(table.schemaName, table.tableName), table.level);
    }
    setDraft(next);
    setSearch("");
  }, [open, db.tables]);

  const filteredSchemas = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return schemas;
    return schemas
      .map((group) => ({
        schema: group.schema,
        tables: group.schema.toLowerCase().includes(trimmed)
          ? group.tables
          : group.tables.filter((t) =>
              t.tableName.toLowerCase().includes(trimmed),
            ),
      }))
      .filter((group) => group.tables.length > 0);
  }, [schemas, search]);

  function setLevel(schema: string, table: string, level: AccessLevel) {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(tableKey(schema, table), level);
      return next;
    });
  }

  function setSchemaLevel(schema: string, level: AccessLevel) {
    const group = schemas.find((g) => g.schema === schema);
    if (!group) return;
    setDraft((prev) => {
      const next = new Map(prev);
      for (const table of group.tables) {
        next.set(tableKey(schema, table.tableName), level);
      }
      return next;
    });
  }

  async function handleSave() {
    const tables = db.tables.map((table) => ({
      schema: table.schemaName,
      name: table.tableName,
      level:
        draft.get(tableKey(table.schemaName, table.tableName)) ?? "none",
    }));
    if (await onSave(tables)) onOpenChange(false);
  }

  const totalGranted = Array.from(draft.values()).filter(
    (level) => level !== "none",
  ).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Table access — {db.name}</SheetTitle>
          <SheetDescription>
            Grant{" "}
            <span className="font-medium text-foreground">{roleName}</span>{" "}
            read or read/write access to specific tables, grouped by schema.
            Tables left at &quot;None&quot; are revoked; future tables are not
            granted automatically.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter schemas or tables"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {totalGranted}/{db.tables.length} granted
            </Badge>
          </div>
          <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
            {filteredSchemas.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                No tables match &quot;{search}&quot;.
              </p>
            ) : (
              <Accordion type="multiple" className="px-2">
                {filteredSchemas.map((group) => {
                  const grantedInSchema = group.tables.filter(
                    (t) =>
                      (draft.get(tableKey(group.schema, t.tableName)) ??
                        "none") !== "none",
                  ).length;
                  return (
                    <AccordionItem key={group.schema} value={group.schema}>
                      <AccordionPrimitive.Header className="flex">
                        <AccordionPrimitive.Trigger className="flex flex-1 items-center gap-2 rounded-md py-2 text-left text-xs font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 [&[data-state=open]>svg]:rotate-0">
                          <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-mono font-semibold">
                            {group.schema}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {grantedInSchema}/{group.tables.length}
                          </Badge>
                          <ChevronDownIcon className="ml-auto size-3.5 shrink-0 rotate-180 text-muted-foreground transition-transform duration-200" />
                        </AccordionPrimitive.Trigger>
                      </AccordionPrimitive.Header>
                      <AccordionContent className="pb-2">
                        <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1.5">
                          <span className="text-[11px] text-muted-foreground">
                            Set all:
                          </span>
                          {(
                            ["none", "readonly", "readwrite"] as AccessLevel[]
                          ).map((level) => (
                            <Button
                              key={level}
                              type="button"
                              variant="ghost"
                              size="xs"
                              disabled={busy}
                              onClick={() =>
                                setSchemaLevel(group.schema, level)
                              }
                            >
                              {formatLevel(level)}
                            </Button>
                          ))}
                        </div>
                        <div className="flex flex-col gap-1">
                          {group.tables.map((table) => (
                            <div
                              key={table.tableName}
                              className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-accent/40"
                            >
                              <span className="truncate font-mono text-xs">
                                {table.tableName}
                              </span>
                              <AccessLevelControl
                                value={
                                  draft.get(
                                    tableKey(group.schema, table.tableName),
                                  ) ?? "none"
                                }
                                disabled={busy}
                                onChange={(level) =>
                                  setLevel(
                                    group.schema,
                                    table.tableName,
                                    level,
                                  )
                                }
                                size="xs"
                              />
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </ScrollArea>
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={handleSave}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Save table access
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AccessLevelControl({
  value,
  disabled,
  onChange,
  size = "sm",
}: Readonly<{
  value: AccessLevel;
  disabled?: boolean;
  onChange: (level: AccessLevel) => void;
  size?: "sm" | "xs";
}>) {
  const levels: AccessLevel[] = ["none", "readonly", "readwrite"];
  const btnSize = size === "xs" ? "xs" : "sm";
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {levels.map((level) => {
        const active = value === level;
        return (
          <Button
            key={level}
            type="button"
            variant={active ? "default" : "ghost"}
            size={btnSize}
            disabled={disabled}
            onClick={() => onChange(level)}
            className="rounded-none border-0"
            aria-pressed={active}
            title={formatLevel(level)}
          >
            {formatLevel(level)}
          </Button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Effective permissions (resolved inheritance)
// ---------------------------------------------------------------------------

function EffectivePermissionsTab({
  connectionId,
  roleName,
  isAdmin,
  inheritedRoles,
}: Readonly<{
  connectionId: string;
  roleName: string;
  isAdmin: boolean;
  inheritedRoles: string[];
}>) {
  const [data, setData] = useState<EffectivePermissions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result =
        await globalThis.window.rolesApi.getEffectivePermissions(
          connectionId,
          roleName,
        );
      setData(unwrap(result));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [connectionId, roleName]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  if (!isAdmin) {
    return (
      <p className="max-w-2xl text-sm text-muted-foreground">
        Resolving effective permissions for another principal requires a
        superuser connection.
      </p>
    );
  }

  if (loading && !data) return <LoadingState label="Resolving permissions…" />;
  if (error) {
    return (
      <div className="flex max-w-2xl flex-col gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void fetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="flex max-w-2xl flex-col gap-4 text-sm">
      <p className="text-sm text-muted-foreground">
        Resolved permissions for <span className="font-medium text-foreground">{roleName}</span>,
        including privileges inherited through role membership.
      </p>
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Databases
        </h3>
        {data.databases.length === 0 ? (
          <p className="text-xs text-muted-foreground">No accessible databases.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.databases.map((db) => (
              <li
                key={db.name}
                className="flex items-center justify-between py-1.5"
              >
                <span className="font-mono text-xs">{db.name}</span>
                <Badge
                  variant={db.level === "none" ? "outline" : "secondary"}
                  className="uppercase"
                >
                  {formatLevel(db.level)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PermissionList
          title="Readable tables"
          items={data.readableTables.map((t) => `${t.schemaName}.${t.tableName}`)}
          emptyText="No SELECT grants."
        />
        <PermissionList
          title="Writable tables"
          items={data.writableTables.map((t) => `${t.schemaName}.${t.tableName}`)}
          emptyText="No write grants."
        />
      </div>

      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Inherited roles
        </h3>
        {inheritedRoles.length === 0 && data.inheritedRoles.length === 0 ? (
          <p className="text-xs text-muted-foreground">No inherited roles.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {data.inheritedRoles.map((name) => (
              <Badge key={name} variant="outline" className="font-mono">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionList({
  title,
  items,
  emptyText,
}: Readonly<{ title: string; items: string[]; emptyText: string }>) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ScrollArea className="h-48" orientation="both">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item} className="whitespace-nowrap font-mono text-xs">
                {item}
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function CreateRoleDialog({
  open,
  onOpenChange,
  connectionId,
  existingRoles,
  busy,
  onSubmit,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  existingRoles: PgRole[];
  busy: boolean;
  onSubmit: (input: CreateRoleInput) => Promise<boolean>;
}>) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [autoGenerated, setAutoGenerated] = useState(false);
  const [login, setLogin] = useState(false);
  const [inherit, setInherit] = useState(true);
  const [connectionLimit, setConnectionLimit] = useState<number | "">("");

  const trimmedName = name.trim();
  const nameConflict = existingRoles.some((role) => role.name === trimmedName);
  const valid =
    trimmedName.length > 0 &&
    !nameConflict &&
    /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(trimmedName);

  function reset() {
    setName("");
    setPassword("");
    setAutoGenerated(false);
    setLogin(false);
    setInherit(true);
    setConnectionLimit("");
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setAutoGenerated(false);
  }

  function handleGenerate() {
    const generated = generateSecurePassword();
    setPassword(generated);
    setAutoGenerated(true);
  }

  async function handleCopy() {
    try {
      const result = await globalThis.window.clipboardApi.writeText(password);
      if (!result.success) {
        throw new Error(result.error ?? "Clipboard write failed.");
      }
      toast.success("Password copied to clipboard.");
    } catch (error) {
      toast.error("Copy failed", { description: (error as Error).message });
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    const input: CreateRoleInput = {
      connectionId,
      name: trimmedName,
      password: password || undefined,
      login,
      inherit,
      connectionLimit:
        connectionLimit === "" ? undefined : Number(connectionLimit),
    };
    if (await onSubmit(input)) reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (busy) return;
        if (open) reset();
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create</DialogTitle>
          <DialogDescription>
            Without <strong>Login</strong>, this creates a role. With it
            enabled, this creates a user that can connect.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Name" htmlFor="create-role-name">
            <Input
              id="create-role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder="e.g. analytics_reader"
              aria-invalid={nameConflict || (name.length > 0 && !valid)}
            />
            {nameConflict && (
              <p className="text-xs text-destructive">
                A role with this name already exists.
              </p>
            )}
          </Field>
          {login && (
            <Field label="Password" htmlFor="create-role-password">
              <div className="flex gap-2">
                <Input
                  id="create-role-password"
                  type={autoGenerated ? "text" : "password"}
                  className={autoGenerated ? "font-mono text-sm" : undefined}
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  autoComplete="new-password"
                />
                {autoGenerated ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copy password"
                    title="Copy password"
                    onClick={handleCopy}
                  >
                    <Copy className="size-4" />
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={handleGenerate}>
                    Generate
                  </Button>
                )}
              </div>
              {autoGenerated && (
                <p className="text-xs text-muted-foreground">
                  Generated password shown above — copy it now, it won&apos;t
                  be shown again.
                </p>
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-4">
            <Label className="gap-2 text-sm">
              <Switch checked={login} onCheckedChange={setLogin} />
              Login
            </Label>
            <Label className="gap-2 text-sm">
              <Switch checked={inherit} onCheckedChange={setInherit} />
              Inherit
            </Label>
          </div>
          <Field
            label="Connection limit (optional)"
            htmlFor="create-role-connlimit"
          >
            <Input
              id="create-role-connlimit"
              type="number"
              min={-1}
              value={connectionLimit}
              onChange={(e) =>
                setConnectionLimit(
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
              placeholder="-1 for unlimited"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRoleDialog({
  open,
  onOpenChange,
  role,
  connectionId,
  busy,
  onSubmit,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: PgRole;
  connectionId: string;
  busy: boolean;
  onSubmit: (input: AlterRoleInput) => Promise<boolean>;
}>) {
  const [login, setLogin] = useState(role.canLogin);
  const [createRole, setCreateRole] = useState(role.canCreateRole);
  const [createDb, setCreateDb] = useState(role.canCreateDb);
  const [connectionLimit, setConnectionLimit] = useState<number | "">(
    role.connectionLimit === -1 ? "" : role.connectionLimit,
  );

  useEffect(() => {
    setLogin(role.canLogin);
    setCreateRole(role.canCreateRole);
    setCreateDb(role.canCreateDb);
    setConnectionLimit(role.connectionLimit === -1 ? "" : role.connectionLimit);
  }, [role]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const input: AlterRoleInput = {
      connectionId,
      name: role.name,
      login,
      createRole,
      createDb,
      connectionLimit:
        connectionLimit === "" ? undefined : Number(connectionLimit),
    };
    await onSubmit(input);
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit &quot;{role.name}&quot;</DialogTitle>
          <DialogDescription>
            Toggle role attributes. To change the password use the dedicated
            reset-password action.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <Label className="gap-2 text-sm">
              <Switch checked={login} onCheckedChange={setLogin} />
              Login
            </Label>
            <Label className="gap-2 text-sm">
              <Switch checked={createRole} onCheckedChange={setCreateRole} />
              Create role
            </Label>
            <Label className="gap-2 text-sm">
              <Switch checked={createDb} onCheckedChange={setCreateDb} />
              Create database
            </Label>
          </div>
          <Field label="Connection limit" htmlFor="edit-role-connlimit">
            <Input
              id="edit-role-connlimit"
              type="number"
              min={-1}
              value={connectionLimit}
              onChange={(e) =>
                setConnectionLimit(
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
              placeholder="-1 for unlimited"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PASSWORD_CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";

function generateSecurePassword(length = 20): string {
  const values = new Uint32Array(length);
  globalThis.crypto.getRandomValues(values);
  return Array.from(
    values,
    (n) => PASSWORD_CHARSET[n % PASSWORD_CHARSET.length],
  ).join("");
}

function ResetPasswordDialog({
  open,
  onOpenChange,
  roleName,
  busy,
  onSubmit,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleName: string;
  busy: boolean;
  onSubmit: (password: string) => Promise<boolean>;
}>) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [autoGenerated, setAutoGenerated] = useState(false);
  const mismatch = !autoGenerated && password !== confirm;

  function reset() {
    setPassword("");
    setConfirm("");
    setAutoGenerated(false);
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setAutoGenerated(false);
  }

  function handleGenerate() {
    const generated = generateSecurePassword();
    setPassword(generated);
    setConfirm(generated);
    setAutoGenerated(true);
  }

  async function handleCopy() {
    try {
      const result = await globalThis.window.clipboardApi.writeText(password);
      if (!result.success) {
        throw new Error(result.error ?? "Clipboard write failed.");
      }
      toast.success("Password copied to clipboard.");
    } catch (error) {
      toast.error("Copy failed", { description: (error as Error).message });
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    if (await onSubmit(password)) reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (busy) return;
        if (open) reset();
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for <strong>{roleName}</strong>. The password is
            sent only to the local PostgreSQL instance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="New password" htmlFor="reset-password">
            <div className="flex gap-2">
              <Input
                id="reset-password"
                type={autoGenerated ? "text" : "password"}
                className={autoGenerated ? "font-mono text-sm" : undefined}
                value={password}
                onChange={(e) => handlePasswordChange(e.target.value)}
                autoComplete="new-password"
                required
              />
              {autoGenerated ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy password"
                  title="Copy password"
                  onClick={handleCopy}
                >
                  <Copy className="size-4" />
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={handleGenerate}>
                  Generate
                </Button>
              )}
            </div>
          </Field>
          {autoGenerated ? (
            <p className="text-xs text-muted-foreground">
              Generated password shown above — copy it now, it won&apos;t be
              shown again. No confirmation needed.
            </p>
          ) : (
            <Field label="Confirm password" htmlFor="reset-password-confirm">
              <Input
                id="reset-password-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                aria-invalid={mismatch}
              />
              {mismatch && (
                <p className="text-xs text-destructive">
                  Passwords do not match.
                </p>
              )}
            </Field>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || mismatch || password.length === 0}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CloneRoleDialog({
  open,
  onOpenChange,
  sourceName,
  existingRoles,
  busy,
  onSubmit,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceName: string;
  existingRoles: PgRole[];
  busy: boolean;
  onSubmit: (newName: string) => Promise<boolean>;
}>) {
  const [newName, setNewName] = useState("");
  const trimmed = newName.trim();
  const conflict = existingRoles.some((role) => role.name === trimmed);
  const valid =
    trimmed.length > 0 &&
    !conflict &&
    /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(trimmed);

  useEffect(() => {
    if (!open) setNewName("");
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    if (await onSubmit(trimmed)) setNewName("");
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clone role &quot;{sourceName}&quot;</DialogTitle>
          <DialogDescription>
            Creates a new role with the same attributes and memberships.
            Superuser roles cannot be cloned.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="New role name" htmlFor="clone-role-name">
            <Input
              id="clone-role-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoComplete="off"
              placeholder="e.g. accounting_reader_2"
              aria-invalid={conflict || (trimmed.length > 0 && !valid)}
            />
            {conflict && (
              <p className="text-xs text-destructive">
                A role with this name already exists.
              </p>
            )}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Clone role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameRoleDialog({
  open,
  onOpenChange,
  roleName,
  existingRoles,
  busy,
  onSubmit,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleName: string;
  existingRoles: PgRole[];
  busy: boolean;
  onSubmit: (newName: string) => Promise<boolean>;
}>) {
  const [newName, setNewName] = useState("");
  const trimmed = newName.trim();
  const conflict = existingRoles.some((role) => role.name === trimmed);
  const valid =
    trimmed.length > 0 &&
    trimmed !== roleName &&
    !conflict &&
    /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(trimmed);

  useEffect(() => {
    if (!open) setNewName("");
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    if (await onSubmit(trimmed)) setNewName("");
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename role &quot;{roleName}&quot;</DialogTitle>
          <DialogDescription>
            Runs <code>ALTER ROLE … RENAME TO</code>. Existing grants reference
            the role by OID, but applications connecting by name will need the
            new value.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="New name" htmlFor="rename-role-name">
            <Input
              id="rename-role-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoComplete="off"
              placeholder={roleName}
              aria-invalid={conflict || (trimmed.length > 0 && !valid)}
            />
            {conflict && (
              <p className="text-xs text-destructive">
                A role with this name already exists.
              </p>
            )}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Rename role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}