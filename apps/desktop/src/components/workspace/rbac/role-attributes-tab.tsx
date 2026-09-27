import { useState } from "react";
import { Key, Loader2, Pencil, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
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
              <Key />
              Reset my password
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onEdit}
          >
            <Shield />
            Edit attributes
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
      <div className="flex flex-col gap-1">
        <div className="flex min-h-6 items-center justify-between gap-2">
          <span className="text-[13px] font-medium">Description</span>
          {isAdmin && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={() => setEditing(true)}
            >
              <Pencil />
              Edit
            </Button>
          )}
        </div>
        <p className="text-[13px] leading-5 text-muted-foreground">
          {description ?? "No description set."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="role-description">Description</Label>
      <textarea
        id="role-description"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        placeholder="What is this role for?"
        className={cn(fieldClassName, "min-h-20 resize-y px-2.5 py-2")}
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
          {saving && <Loader2 className="animate-spin" />}
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
    <Panel>
      <PanelHeader>
        <Shield />
        <PanelTitle>Attributes</PanelTitle>
      </PanelHeader>
      <dl className="grid sm:grid-cols-2">
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
        <AttributeRow
          label="Replication"
          value={formatBool(role.canReplicate)}
        />
        <AttributeRow
          label="Bypass RLS"
          value={formatBool(role.canBypassRls)}
        />
        <AttributeRow
          label="Has password"
          value={formatHasPassword(role.hasPassword)}
        />
        <AttributeRow label="Connection limit" value={connectionLimit} />
        <AttributeRow
          label="Valid until"
          value={role.validUntil ?? "no expiry"}
        />
      </dl>
    </Panel>
  );
}

function AttributeRow({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex h-9 items-center justify-between gap-3 border-b border-border/70 px-4 text-[13px] sm:odd:border-r">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs">{value}</dd>
    </div>
  );
}
