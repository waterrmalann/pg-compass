import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLatestRequest } from "@/hooks/use-latest-request";
import type { EffectivePermissions } from "@/shared/types/roles";
import { LoadingState, formatLevel, unwrap } from "./shared";

interface EffectivePermissionsTabProps {
  connectionId: string;
  roleName: string;
  isAdmin: boolean;
}

export function EffectivePermissionsTab({
  connectionId,
  roleName,
  isAdmin,
}: Readonly<EffectivePermissionsTabProps>) {
  const runLatestRequest = useLatestRequest();
  const [data, setData] = useState<EffectivePermissions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const request = await runLatestRequest(async () =>
      unwrap(
        await globalThis.window.rolesApi.getEffectivePermissions(
          connectionId,
          roleName,
        ),
      ),
    );
    if (request.status === "stale") return;
    setLoading(false);
    if (request.status === "error") {
      setError((request.error as Error).message);
      return;
    }
    setData(request.value);
  }, [connectionId, roleName, runLatestRequest]);

  useEffect(() => {
    // Never show one role's resolved permissions under another role's name.
    setData(null);
    setError(null);
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <p className="max-w-2xl text-sm text-muted-foreground">
        Resolving effective permissions for another principal requires a
        superuser connection.
      </p>
    );
  }

  if (error) {
    return (
      <div className="flex max-w-2xl flex-col gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            void load();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (loading || !data) return <LoadingState label="Resolving permissions…" />;

  return (
    <div className="flex max-w-2xl flex-col gap-4 text-sm">
      <p className="text-sm text-muted-foreground">
        Resolved permissions for{" "}
        <span className="font-medium text-foreground">{roleName}</span>,
        including privileges inherited through role membership.
      </p>
      <div className="rounded-lg border border-border p-4">
        <SectionHeading>Databases</SectionHeading>
        {data.databases.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No accessible databases.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.databases.map((db) => (
              <li
                key={db.name}
                className="flex items-center justify-between py-1.5"
              >
                <span className="font-mono text-xs">{db.name}</span>
                <Badge variant={db.level === "none" ? "outline" : "secondary"}>
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
          items={data.readableTables.map(
            (t) => `${t.schemaName}.${t.tableName}`,
          )}
          emptyText="No SELECT grants."
        />
        <PermissionList
          title="Writable tables"
          items={data.writableTables.map(
            (t) => `${t.schemaName}.${t.tableName}`,
          )}
          emptyText="No write grants."
        />
      </div>

      <div className="rounded-lg border border-border p-4">
        <SectionHeading>Inherited roles</SectionHeading>
        {data.inheritedRoles.length === 0 ? (
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

function SectionHeading({ children }: Readonly<{ children: string }>) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function PermissionList({
  title,
  items,
  emptyText,
}: Readonly<{ title: string; items: string[]; emptyText: string }>) {
  return (
    <div className="rounded-lg border border-border p-4">
      <SectionHeading>{title}</SectionHeading>
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
