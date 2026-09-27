import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import type {
  AlterRoleInput,
  CreateRoleInput,
  PgRole,
} from "@/shared/types/roles";
import { PasswordInput } from "./password-input";
import { Field, isValidPgName } from "./shared";

/*
 * Every dialog keeps its form state in a child rendered inside DialogContent,
 * which unmounts when the dialog closes — so typed or generated passwords
 * and names never carry over to the next time a dialog opens.
 */

interface BaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
}

function RoleDialog({
  open,
  onOpenChange,
  busy,
  title,
  description,
  children,
}: Readonly<
  BaseDialogProps & {
    title: ReactNode;
    description: ReactNode;
    children: ReactNode;
  }
>) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function DialogActions({
  busy,
  submitLabel,
  submitDisabled,
  submitVariant = "default",
  onCancel,
  onSubmit,
}: Readonly<{
  busy: boolean;
  submitLabel: string;
  submitDisabled?: boolean;
  submitVariant?: "default" | "destructive";
  onCancel: () => void;
  /** Omit for a form submit button. */
  onSubmit?: () => void;
}>) {
  return (
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        type={onSubmit ? "button" : "submit"}
        variant={submitVariant}
        disabled={busy || submitDisabled}
        onClick={onSubmit}
      >
        {busy && <Loader2 className="animate-spin" />}
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

function NameError({
  name,
  conflict,
}: Readonly<{ name: string; conflict: boolean }>) {
  if (conflict) {
    return (
      <p className="text-xs text-destructive-foreground">
        A role with this name already exists.
      </p>
    );
  }
  if (name.length > 0 && !isValidPgName(name)) {
    return (
      <p className="text-xs text-destructive-foreground">
        Names can be at most 63 bytes and cannot contain NUL characters.
      </p>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function CreateRoleDialog({
  open,
  onOpenChange,
  busy,
  connectionId,
  existingRoles,
  onSubmit,
}: Readonly<
  BaseDialogProps & {
    connectionId: string;
    existingRoles: PgRole[];
    onSubmit: (input: CreateRoleInput) => Promise<boolean>;
  }
>) {
  return (
    <RoleDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title="New role"
      description="With Login on, this creates a user that can connect. Without it, a group role that others can be granted."
    >
      <CreateRoleForm
        connectionId={connectionId}
        existingRoles={existingRoles}
        busy={busy}
        onCancel={() => onOpenChange(false)}
        onSubmit={onSubmit}
      />
    </RoleDialog>
  );
}

function CreateRoleForm({
  connectionId,
  existingRoles,
  busy,
  onCancel,
  onSubmit,
}: Readonly<{
  connectionId: string;
  existingRoles: PgRole[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateRoleInput) => Promise<boolean>;
}>) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState(false);
  const [login, setLogin] = useState(false);
  const [inherit, setInherit] = useState(true);
  const [connectionLimit, setConnectionLimit] = useState<number | "">("");

  const trimmedName = name.trim();
  const nameConflict = existingRoles.some((role) => role.name === trimmedName);
  const valid = isValidPgName(trimmedName) && !nameConflict;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    // A password is only meaningful for a role that can log in.
    const sendPassword = login && password.length > 0;
    const input: CreateRoleInput = {
      connectionId,
      name: trimmedName,
      password: sendPassword ? password : undefined,
      login,
      inherit,
      connectionLimit:
        connectionLimit === "" ? undefined : Number(connectionLimit),
    };
    await onSubmit(input);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label="Name" htmlFor="create-role-name">
        <Input
          id="create-role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          placeholder="e.g. analytics_reader"
          aria-invalid={trimmedName.length > 0 && !valid}
        />
        <NameError name={trimmedName} conflict={nameConflict} />
      </Field>
      {login && (
        <Field label="Password" htmlFor="create-role-password">
          <PasswordInput
            id="create-role-password"
            value={password}
            generated={generated}
            onChange={(value) => {
              setPassword(value);
              setGenerated(false);
            }}
            onGenerate={(value) => {
              setPassword(value);
              setGenerated(true);
            }}
          />
        </Field>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Label className="gap-2">
          <Switch checked={login} onCheckedChange={setLogin} />
          Login
        </Label>
        <Label className="gap-2">
          <Switch checked={inherit} onCheckedChange={setInherit} />
          Inherit
        </Label>
      </div>
      <Field
        label="Connection limit (optional)"
        htmlFor="create-role-connlimit"
      >
        <ConnectionLimitInput
          id="create-role-connlimit"
          value={connectionLimit}
          onChange={setConnectionLimit}
        />
      </Field>
      <DialogActions
        busy={busy}
        submitLabel="Create"
        submitDisabled={!valid}
        onCancel={onCancel}
      />
    </form>
  );
}

function ConnectionLimitInput({
  id,
  value,
  onChange,
}: Readonly<{
  id: string;
  value: number | "";
  onChange: (value: number | "") => void;
}>) {
  return (
    <Input
      id={id}
      type="number"
      min={-1}
      value={value}
      onChange={(e) =>
        onChange(e.target.value === "" ? "" : Number(e.target.value))
      }
      placeholder="-1 for unlimited"
    />
  );
}

// ---------------------------------------------------------------------------
// Edit attributes
// ---------------------------------------------------------------------------

export function EditRoleDialog({
  open,
  onOpenChange,
  busy,
  role,
  connectionId,
  onSubmit,
}: Readonly<
  BaseDialogProps & {
    role: PgRole;
    connectionId: string;
    onSubmit: (input: AlterRoleInput) => Promise<boolean>;
  }
>) {
  return (
    <RoleDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={<>Edit &quot;{role.name}&quot;</>}
      description="Change what this role can do. Use Reset password to change its password."
    >
      <EditRoleForm
        role={role}
        connectionId={connectionId}
        busy={busy}
        onCancel={() => onOpenChange(false)}
        onSubmit={onSubmit}
      />
    </RoleDialog>
  );
}

function EditRoleForm({
  role,
  connectionId,
  busy,
  onCancel,
  onSubmit,
}: Readonly<{
  role: PgRole;
  connectionId: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: AlterRoleInput) => Promise<boolean>;
}>) {
  const [login, setLogin] = useState(role.canLogin);
  const [createRole, setCreateRole] = useState(role.canCreateRole);
  const [createDb, setCreateDb] = useState(role.canCreateDb);
  const [connectionLimit, setConnectionLimit] = useState<number | "">(
    role.connectionLimit === -1 ? "" : role.connectionLimit,
  );

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Label className="gap-2">
          <Switch checked={login} onCheckedChange={setLogin} />
          Login
        </Label>
        <Label className="gap-2">
          <Switch checked={createRole} onCheckedChange={setCreateRole} />
          Create role
        </Label>
        <Label className="gap-2">
          <Switch checked={createDb} onCheckedChange={setCreateDb} />
          Create database
        </Label>
      </div>
      <Field label="Connection limit" htmlFor="edit-role-connlimit">
        <ConnectionLimitInput
          id="edit-role-connlimit"
          value={connectionLimit}
          onChange={setConnectionLimit}
        />
      </Field>
      <DialogActions
        busy={busy}
        submitLabel="Save changes"
        onCancel={onCancel}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------------------

export function ResetPasswordDialog({
  open,
  onOpenChange,
  busy,
  roleName,
  onSubmit,
}: Readonly<
  BaseDialogProps & {
    roleName: string;
    onSubmit: (password: string) => Promise<boolean>;
  }
>) {
  return (
    <RoleDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title="Reset password"
      description={
        <>
          Set a new password for <strong>{roleName}</strong>. The password is
          sent only to the connected PostgreSQL server.
        </>
      }
    >
      <ResetPasswordForm
        busy={busy}
        onCancel={() => onOpenChange(false)}
        onSubmit={onSubmit}
      />
    </RoleDialog>
  );
}

function ResetPasswordForm({
  busy,
  onCancel,
  onSubmit,
}: Readonly<{
  busy: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<boolean>;
}>) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [generated, setGenerated] = useState(false);
  const mismatch = !generated && password !== confirm;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    await onSubmit(password);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label="New password" htmlFor="reset-password">
        <PasswordInput
          id="reset-password"
          value={password}
          generated={generated}
          required
          onChange={(value) => {
            setPassword(value);
            setGenerated(false);
          }}
          onGenerate={(value) => {
            setPassword(value);
            setConfirm(value);
            setGenerated(true);
          }}
        />
      </Field>
      {!generated && (
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
            <p className="text-xs text-destructive-foreground">
              Passwords do not match.
            </p>
          )}
        </Field>
      )}
      <DialogActions
        busy={busy}
        submitLabel="Reset password"
        submitDisabled={mismatch || password.length === 0}
        onCancel={onCancel}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Clone / rename (both just ask for a new role name)
// ---------------------------------------------------------------------------

export function RoleNameDialog({
  open,
  onOpenChange,
  busy,
  idPrefix,
  title,
  description,
  fieldLabel,
  placeholder,
  submitLabel,
  currentName,
  existingRoles,
  onSubmit,
}: Readonly<
  BaseDialogProps & {
    idPrefix: string;
    title: ReactNode;
    description: ReactNode;
    fieldLabel: string;
    placeholder: string;
    submitLabel: string;
    /** The role being renamed/cloned; submitting the same name is refused. */
    currentName: string;
    existingRoles: PgRole[];
    onSubmit: (newName: string) => Promise<boolean>;
  }
>) {
  return (
    <RoleDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={title}
      description={description}
    >
      <RoleNameForm
        idPrefix={idPrefix}
        fieldLabel={fieldLabel}
        placeholder={placeholder}
        submitLabel={submitLabel}
        currentName={currentName}
        existingRoles={existingRoles}
        busy={busy}
        onCancel={() => onOpenChange(false)}
        onSubmit={onSubmit}
      />
    </RoleDialog>
  );
}

function RoleNameForm({
  idPrefix,
  fieldLabel,
  placeholder,
  submitLabel,
  currentName,
  existingRoles,
  busy,
  onCancel,
  onSubmit,
}: Readonly<{
  idPrefix: string;
  fieldLabel: string;
  placeholder: string;
  submitLabel: string;
  currentName: string;
  existingRoles: PgRole[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (newName: string) => Promise<boolean>;
}>) {
  const [newName, setNewName] = useState("");
  const trimmed = newName.trim();
  const conflict = existingRoles.some((role) => role.name === trimmed);
  const valid = isValidPgName(trimmed) && trimmed !== currentName && !conflict;
  const inputId = `${idPrefix}-name`;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await onSubmit(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label={fieldLabel} htmlFor={inputId}>
        <Input
          id={inputId}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={trimmed.length > 0 && !valid}
        />
        <NameError name={trimmed} conflict={conflict} />
      </Field>
      <DialogActions
        busy={busy}
        submitLabel={submitLabel}
        submitDisabled={!valid}
        onCancel={onCancel}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Drop
// ---------------------------------------------------------------------------

export function DropRoleDialog({
  open,
  onOpenChange,
  busy,
  roleName,
  onConfirm,
}: Readonly<
  BaseDialogProps & {
    roleName: string;
    onConfirm: () => void;
  }
>) {
  return (
    <RoleDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={<>Drop role &quot;{roleName}&quot;?</>}
      description={
        <>
          This runs <code>DROP ROLE</code> on the connected server. If the role
          still owns objects or has active grants, the operation will be
          rejected by PostgreSQL.
        </>
      }
    >
      <DialogActions
        busy={busy}
        submitLabel="Drop role"
        submitVariant="destructive"
        onCancel={() => onOpenChange(false)}
        onSubmit={onConfirm}
      />
    </RoleDialog>
  );
}
