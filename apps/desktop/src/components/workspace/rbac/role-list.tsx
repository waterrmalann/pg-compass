import { useEffect, useMemo, useState } from "react";
import { Search, Shield, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { ScrollArea } from "@/components/ui/scroll-area";
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
      <Panel className="h-full w-64 shrink-0">
        <PanelHeader>
          <Users />
          <PanelTitle>My account</PanelTitle>
        </PanelHeader>
        <ScrollArea className="min-h-0 flex-1">
          <RoleRows
            roles={roles}
            selectedRoleName={selectedRoleName}
            onSelectRole={onSelectRole}
            disabled
            emptyText="No account information available."
          />
        </ScrollArea>
      </Panel>
    );
  }

  const filterLabel = category === "users" ? "Filter users" : "Filter roles";

  return (
    <Panel className="h-full w-64 shrink-0">
      <Tabs
        value={category}
        onValueChange={(value) => setCategory(value as RoleCategory)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2">
          <TabsList className="w-full">
            <TabsTrigger value="users" className="flex-1">
              <Users />
              Users
              <CountHint>{loginRoles.length}</CountHint>
            </TabsTrigger>
            <TabsTrigger value="roles" className="flex-1">
              <Shield />
              Roles
              <CountHint>{groupRoles.length}</CountHint>
            </TabsTrigger>
          </TabsList>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={filterLabel}
              aria-label={filterLabel}
              className="h-7 pr-7 pl-8 text-xs"
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-0.5 size-6 -translate-y-1/2"
                aria-label="Clear filter"
                onClick={() => onSearchChange("")}
              >
                <X />
              </Button>
            )}
          </div>
        </div>
        <TabsContent value="users" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full min-h-0">
            <RoleRows
              roles={loginRoles}
              selectedRoleName={selectedRoleName}
              onSelectRole={onSelectRole}
              emptyText="No users match the filter."
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="roles" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full min-h-0">
            <RoleRows
              roles={groupRoles}
              selectedRoleName={selectedRoleName}
              onSelectRole={onSelectRole}
              emptyText="No roles match the filter."
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

function CountHint({ children }: Readonly<{ children: number }>) {
  return (
    <span className="font-mono text-[11px] text-subtle-foreground tabular-nums">
      {children}
    </span>
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
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-px p-1.5">
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
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
        selected
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:hover:bg-transparent",
      )}
      onClick={onSelect}
      disabled={disabled}
      aria-current={selected ? "true" : undefined}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
        {role.name}
      </span>
      {role.isSuperuser && <Badge>Superuser</Badge>}
    </button>
  );
}
