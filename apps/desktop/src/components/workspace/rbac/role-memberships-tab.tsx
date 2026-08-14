import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
                      <Badge variant="secondary" className="ml-2">
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
                      disabled={disabled}
                      onCheckedChange={(next) =>
                        onToggleMembership(parent, next)
                      }
                      aria-label={`Toggle membership in ${parent.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    {membership?.withAdminOption ? (
                      <Badge variant="secondary">Admin</Badge>
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
