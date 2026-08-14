import { useEffect, useMemo, useState } from "react";
import { Search, Shield, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { PgRole } from "@/shared/types/roles";

type RoleCategory = "users" | "roles";

function bySuperuserFirst(a: PgRole, b: PgRole): number {
  if (a.isSuperuser === b.isSuperuser) return 0;
  return a.isSuperuser ? -1 : 1;
}

interface RoleListProps {
  roles: PgRole[];
  selectedRoleName: string | null;
  onSelectRole: (roleName: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  isAdmin: boolean;
}

export function RoleList({
  roles,
  selectedRoleName,
  onSelectRole,
  search,
  onSearchChange,
  isAdmin,
}: Readonly<RoleListProps>) {
  const loginRoles = useMemo(
    () => roles.filter((r) => r.canLogin).sort(bySuperuserFirst),
    [roles],
  );
  const groupRoles = useMemo(
    () => roles.filter((r) => !r.canLogin).sort(bySuperuserFirst),
    [roles],
  );

  const [category, setCategory] = useState<RoleCategory>("users");

  useEffect(() => {
    if (!selectedRoleName) return;
    const role = roles.find((r) => r.name === selectedRoleName);
    if (!role) return;
    setCategory(role.canLogin ? "users" : "roles");
  }, [selectedRoleName, roles]);

  if (!isAdmin) {
    return (
      <div className="flex h-full min-h-0 w-64 shrink-0 flex-col gap-2 rounded-lg border border-border">
        <div className="flex items-center gap-2 px-3 py-2">
          <Users className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">My account</span>
        </div>
        <Separator />
        <ScrollArea className="min-h-0 flex-1">
          <RoleRows
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

  const filterLabel = category === "users" ? "Filter users" : "Filter roles";

  return (
    <div className="flex h-full min-h-0 w-64 shrink-0 flex-col rounded-lg border border-border">
      <Tabs
        value={category}
        onValueChange={(value) => setCategory(value as RoleCategory)}
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
            placeholder={filterLabel}
            aria-label={filterLabel}
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
          <ScrollArea className="h-full min-h-0">
            <RoleRows
              roles={loginRoles}
              selectedRoleName={selectedRoleName}
              onSelectRole={onSelectRole}
              emptyText="No users match the current filter."
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="roles" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full min-h-0">
            <RoleRows
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

function RoleRows({
  roles,
  selectedRoleName,
  onSelectRole,
  disabled = false,
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
    <div className="flex flex-col gap-0.5 p-1">
      {roles.map((role) => (
        <RoleRow
          key={role.name}
          role={role}
          selected={role.name === selectedRoleName}
          onSelect={() => onSelectRole(role.name)}
          disabled={disabled}
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
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-default",
        selected
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:hover:bg-transparent",
      )}
      onClick={onSelect}
      disabled={disabled}
      aria-current={selected ? "true" : undefined}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">{role.name}</span>
        <span className="flex flex-wrap gap-1">
          {role.isSuperuser && (
            <Badge variant="secondary" className="text-[10px]">
              Superuser
            </Badge>
          )}
          {role.canLogin && !role.isSuperuser && (
            <Badge variant="outline" className="text-[10px]">
              Login
            </Badge>
          )}
          {!role.canLogin && (
            <Badge variant="outline" className="text-[10px]">
              Role
            </Badge>
          )}
        </span>
      </span>
    </button>
  );
}
