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
import { cn } from "@/lib/utils";
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
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/55 text-muted-foreground shadow-xs/5">
          {role.canLogin ? (
            <Users className="size-4" />
          ) : (
            <Shield className="size-4" />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="truncate font-mono text-sm leading-5 font-medium">
            {role.name}
          </h2>
          <RoleBadges role={role} isSelf={isSelf} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {isAdmin && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="mr-1.5"
              disabled={disabled}
              onClick={onCreate}
            >
              <UserPlus />
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
              <Copy />
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
              <Pencil />
            </HeaderAction>
            <HeaderAction
              label="Edit role attributes"
              disabled={disabled}
              onClick={onEdit}
            >
              <Shield />
            </HeaderAction>
            <HeaderAction
              label="Reset password"
              tooltip={
                role.canLogin ? undefined : "Only login roles have passwords"
              }
              disabled={disabled || !role.canLogin}
              onClick={onResetPassword}
            >
              <Key />
            </HeaderAction>
            <HeaderAction
              label="Drop role"
              tooltip={
                isSelf
                  ? "Can't drop the role you're currently connected as"
                  : undefined
              }
              disabled={disabled || isSelf}
              destructive
              onClick={onDrop}
            >
              <Trash2 />
            </HeaderAction>
          </>
        )}
        {busy && (
          <Loader2
            className="ml-1 size-3.5 animate-spin text-muted-foreground"
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
    <div className="flex flex-wrap gap-1">
      {isSelf && <Badge variant="secondary">You</Badge>}
      {role.canLogin ? <Badge>Login</Badge> : <Badge>Group role</Badge>}
      {role.isSuperuser && <Badge>Superuser</Badge>}
      {role.canCreateDb && <Badge>Create database</Badge>}
      {role.canCreateRole && <Badge>Create role</Badge>}
      {role.canReplicate && <Badge>Replication</Badge>}
      {role.canBypassRls && <Badge>Bypass RLS</Badge>}
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
  destructive = false,
  onClick,
  children,
}: Readonly<{
  label: string;
  tooltip?: string;
  disabled: boolean;
  destructive?: boolean;
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
            className={cn(destructive && "hover:text-destructive-foreground")}
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
