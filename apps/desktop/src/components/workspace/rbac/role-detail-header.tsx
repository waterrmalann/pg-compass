import type { ReactNode } from "react";
import {
  Copy,
  Key,
  Loader2,
  Pencil,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PgRole } from "@/shared/types/roles";

interface RoleDetailHeaderProps {
  role: PgRole;
  isSelf: boolean;
  isAdmin: boolean;
  busy: boolean;
  /** Disables every mutation control (a mutation is running or read-only mode). */
  disabled: boolean;
  onCreate: () => void;
  onClone: () => void;
  onRename: () => void;
  onEdit: () => void;
  onResetPassword: () => void;
  onDrop: () => void;
}

export function RoleDetailHeader({
  role,
  isSelf,
  isAdmin,
  busy,
  disabled,
  onCreate,
  onClone,
  onRename,
  onEdit,
  onResetPassword,
  onDrop,
}: Readonly<RoleDetailHeaderProps>) {
  return (
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
          <RoleBadges role={role} isSelf={isSelf} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {isAdmin && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={onCreate}
            >
              <UserPlus className="size-3.5" />
              New
            </Button>
            <HeaderAction
              label="Clone role"
              tooltip={
                role.isSuperuser ? "Superuser roles can't be cloned" : undefined
              }
              disabled={disabled || role.isSuperuser}
              onClick={onClone}
            >
              <Copy className="size-4" />
            </HeaderAction>
            <HeaderAction
              label="Rename role"
              tooltip={
                isSelf
                  ? "Can't rename the role you're currently connected as"
                  : undefined
              }
              disabled={disabled || isSelf}
              onClick={onRename}
            >
              <Pencil className="size-4" />
            </HeaderAction>
            <HeaderAction
              label="Edit role attributes"
              disabled={disabled}
              onClick={onEdit}
            >
              <Shield className="size-4" />
            </HeaderAction>
            <HeaderAction
              label="Reset password"
              tooltip={
                role.canLogin ? undefined : "Only login roles have passwords"
              }
              disabled={disabled || !role.canLogin}
              onClick={onResetPassword}
            >
              <Key className="size-4" />
            </HeaderAction>
            <HeaderAction
              label="Drop role"
              tooltip={
                isSelf
                  ? "Can't drop the role you're currently connected as"
                  : undefined
              }
              disabled={disabled || isSelf}
              onClick={onDrop}
            >
              <Trash2 className="size-4 text-destructive" />
            </HeaderAction>
          </>
        )}
        {busy && (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label="Saving"
          />
        )}
      </div>
    </div>
  );
}

function RoleBadges({
  role,
  isSelf,
}: Readonly<{ role: PgRole; isSelf: boolean }>) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {role.canLogin && <Badge variant="secondary">Login</Badge>}
      {role.isSuperuser && <Badge variant="secondary">Superuser</Badge>}
      {role.canCreateDb && <Badge variant="outline">Create database</Badge>}
      {role.canCreateRole && <Badge variant="outline">Create role</Badge>}
      {role.canReplicate && <Badge variant="outline">Replication</Badge>}
      {role.canBypassRls && <Badge variant="outline">Bypass RLS</Badge>}
      {isSelf && <Badge variant="default">You</Badge>}
    </div>
  );
}

/**
 * Icon button with a tooltip. The trigger is a wrapper span so the tooltip
 * (including the reason an action is unavailable) still shows while the
 * button itself is disabled.
 */
function HeaderAction({
  label,
  tooltip,
  disabled,
  onClick,
  children,
}: Readonly<{
  label: string;
  tooltip?: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
