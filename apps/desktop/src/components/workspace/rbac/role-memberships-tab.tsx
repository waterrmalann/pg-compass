import { Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Panel,
  PanelCount,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MissingValue } from "@/components/workspace/relation-list-table";
import { BUILTIN_ROLE_DESCRIPTIONS } from "@/shared/constants/builtin-roles";
import type { PgMembership, PgRole } from "@/shared/types/roles";

interface RoleMembershipsTabProps {
  parentsForRole: PgMembership[];
  candidateParents: PgRole[];
  isAdmin: boolean;
  disabled: boolean;
  onToggleMembership: (parent: PgRole, next: boolean) => void;
}

export function RoleMembershipsTab({
  parentsForRole,
  candidateParents,
  isAdmin,
  disabled,
  onToggleMembership,
}: Readonly<RoleMembershipsTabProps>) {
  const parentSet = new Map(parentsForRole.map((m) => [m.parentName, m]));

  if (!isAdmin) {
    return (
      <Panel className="max-w-3xl">
        <PanelHeader>
          <Shield />
          <PanelTitle>Member of</PanelTitle>
          <PanelCount>{parentSet.size}</PanelCount>
          <span className="ml-auto text-xs text-muted-foreground">
            Changing memberships needs a superuser
          </span>
        </PanelHeader>
        {parentSet.size === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Not a member of any other role.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70">
            {Array.from(parentSet.values()).map((m) => (
              <li
                key={m.parentName}
                className="flex flex-col gap-0.5 px-4 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12.5px] font-medium">
                    {m.parentName}
                  </span>
                  {m.withAdminOption && <Badge>Admin</Badge>}
                </div>
                {BUILTIN_ROLE_DESCRIPTIONS[m.parentName] && (
                  <p className="text-xs text-muted-foreground">
                    {BUILTIN_ROLE_DESCRIPTIONS[m.parentName]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    );
  }

  return (
    <Panel className="max-w-3xl">
      <PanelHeader>
        <Shield />
        <PanelTitle>Member of</PanelTitle>
        <PanelCount>{parentSet.size}</PanelCount>
        <span className="ml-auto text-xs text-muted-foreground">
          Inherits privileges from the roles switched on
        </span>
      </PanelHeader>
      {candidateParents.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          There are no group roles to join.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Can re-grant</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidateParents.map((parent) => {
              const membership = parentSet.get(parent.name);
              const isMember = Boolean(membership);
              const description = BUILTIN_ROLE_DESCRIPTIONS[parent.name];
              return (
                <TableRow key={parent.name}>
                  <TableCell className="font-mono text-[12.5px] font-medium">
                    {parent.name}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={isMember}
                      disabled={disabled}
                      onCheckedChange={(next) =>
                        onToggleMembership(parent, next)
                      }
                      aria-label={`Toggle membership in ${parent.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    {membership?.withAdminOption ? (
                      <Badge>Admin</Badge>
                    ) : (
                      <MissingValue />
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs text-xs whitespace-normal text-muted-foreground">
                    {description ?? <MissingValue />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
