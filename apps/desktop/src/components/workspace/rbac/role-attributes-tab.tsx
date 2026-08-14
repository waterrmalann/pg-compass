import { useState } from "react";
import { Key, Loader2, Pencil, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { PgRole } from "@/shared/types/roles";
import { formatBool } from "./shared";

interface RoleAttributesTabProps {
  role: PgRole;
  isAdmin: boolean;
  isSelf: boolean;
  /** Disables every mutation control (a mutation is running or read-only mode). */
  disabled: boolean;
  onResetPassword: () => void;
  onEdit: () => void;
  onSaveComment: (comment: string | null) => Promise<boolean>;
}

export function RoleAttributesTab({
  role,
  isAdmin,
  isSelf,
  disabled,
  onResetPassword,
  onEdit,
  onSaveComment,
}: Readonly<RoleAttributesTabProps>) {
  const canResetOwnPassword = isAdmin && isSelf && role.canLogin;
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <RoleDescriptionField
        key={role.name}
        description={role.description}
        isAdmin={isAdmin}
        disabled={disabled}
        onSave={onSaveComment}
      />
      <AttributeGrid role={role} />
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {canResetOwnPassword && (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={onResetPassword}
            >
              <Key className="size-3.5" /> Reset my password
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onEdit}
          >
            <Shield className="size-3.5" /> Edit attributes
          </Button>
        </div>
      )}
    </div>
  );
}

function RoleDescriptionField({
  description,
  isAdmin,
  disabled,
  onSave,
}: Readonly<{
  description: string | null;
  isAdmin: boolean;
  disabled: boolean;
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
              disabled={disabled}
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
        <Button
          type="button"
          size="sm"
          onClick={() => {
            handleSave().catch(() => undefined);
          }}
          disabled={saving || disabled}
        >
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

function formatHasPassword(hasPassword: boolean | null): string {
  // null: the server only reveals this to superusers.
  if (hasPassword === null) return "unknown";
  return formatBool(hasPassword);
}

function AttributeGrid({ role }: Readonly<{ role: PgRole }>) {
  const connectionLimit =
    role.connectionLimit === -1 ? "unlimited" : String(role.connectionLimit);
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
      <AttributeRow
        label="Has password"
        value={formatHasPassword(role.hasPassword)}
      />
      <AttributeRow label="Connection limit" value={connectionLimit} />
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
