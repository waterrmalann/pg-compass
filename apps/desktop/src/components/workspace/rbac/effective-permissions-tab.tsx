import { useCallback, useEffect, useState } from "react";
import {
  CircleAlert,
  Database,
  RefreshCw,
  Shield,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelCount,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel";
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
      <EmptyState
        icon={<ShieldCheck />}
        title="Superuser required"
        description="Resolving effective permissions for another role needs a superuser connection."
      />
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<CircleAlert />}
        title="Couldn't resolve permissions"
        description={error}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void load();
          }}
        >
          <RefreshCw />
          Retry
        </Button>
      </EmptyState>
    );
  }
  if (loading || !data) return <LoadingState label="Resolving permissions…" />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-5 text-muted-foreground">
        Resolved permissions for{" "}
        <span className="font-mono text-foreground">{roleName}</span>, including
        privileges inherited through role membership.
      </p>
      <Panel>
        <PanelHeader>
          <Database />
          <PanelTitle>Databases</PanelTitle>
          <PanelCount>{data.databases.length}</PanelCount>
        </PanelHeader>
        {data.databases.length === 0 ? (
          <EmptyText>No accessible databases.</EmptyText>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70">
            {data.databases.map((db) => (
              <li
                key={db.name}
                className="flex h-10 items-center justify-between gap-2 px-4"
              >
                <span className="font-mono text-[12.5px]">{db.name}</span>
                <Badge variant={db.level === "none" ? "outline" : "default"}>
                  {formatLevel(db.level)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
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

      <Panel>
        <PanelHeader>
          <Shield />
          <PanelTitle>Inherited roles</PanelTitle>
          <PanelCount>{data.inheritedRoles.length}</PanelCount>
        </PanelHeader>
        {data.inheritedRoles.length === 0 ? (
          <EmptyText>No inherited roles.</EmptyText>
        ) : (
          <div className="flex flex-wrap gap-1.5 p-4">
            {data.inheritedRoles.map((name) => (
              <Badge key={name} className="font-mono">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function EmptyText({ children }: Readonly<{ children: string }>) {
  return (
    <p className="px-4 py-6 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function PermissionList({
  title,
  items,
  emptyText,
}: Readonly<{ title: string; items: string[]; emptyText: string }>) {
  return (
    <Panel>
      <PanelHeader>
        <Table2 />
        <PanelTitle>{title}</PanelTitle>
        <PanelCount>{items.length}</PanelCount>
      </PanelHeader>
      {items.length === 0 ? (
        <EmptyText>{emptyText}</EmptyText>
      ) : (
        <ScrollArea className="h-48" orientation="both">
          <ul className="flex flex-col py-1.5">
            {items.map((item) => {
              const dot = item.indexOf(".");
              return (
                <li
                  key={item}
                  className="px-4 py-0.5 font-mono text-xs leading-5 whitespace-nowrap"
                >
                  <span className="text-muted-foreground">
                    {item.slice(0, dot + 1)}
                  </span>
                  {item.slice(dot + 1)}
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </Panel>
  );
}
