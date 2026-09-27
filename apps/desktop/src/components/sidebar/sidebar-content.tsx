import { useEffect, useMemo, useRef, useState } from "react";
import { Database, Loader2, SearchX } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/ui/empty-state";
import { useConnections } from "@/hooks/use-connections";
import { ConnectionItem } from "@/components/connections/connection-item";
import type { ConnectionConfig } from "@/shared/types/connection";
import type { DatabaseSchema } from "@/shared/types/connection";
import { useWorkspace } from "@/hooks/use-workspace";

export function filterConnectionTree(
  connection: ConnectionConfig,
  schemas: DatabaseSchema[],
  rawSearch: string,
): { matches: boolean; schemas: DatabaseSchema[] } {
  const search = rawSearch.trim().toLowerCase();
  if (!search) return { matches: true, schemas };
  if (connection.label.toLowerCase().includes(search)) {
    return { matches: true, schemas };
  }

  const filteredSchemas = schemas.flatMap((schema) => {
    if (schema.name.toLowerCase().includes(search)) return [schema];
    const tables = schema.tables.filter((name) =>
      name.toLowerCase().includes(search),
    );
    const views = schema.views.filter((view) =>
      view.name.toLowerCase().includes(search),
    );
    if (tables.length === 0 && views.length === 0) return [];
    return [{ ...schema, tables, views }];
  });
  return { matches: filteredSchemas.length > 0, schemas: filteredSchemas };
}

export function SidebarContent({
  onEdit,
  search,
}: Readonly<{
  onEdit: (c: ConnectionConfig) => void;
  search: string;
}>) {
  const { connections, loading } = useConnections();
  const { schemaCache, refreshSchemaTreeWithStatus } = useWorkspace();
  const [connectedConnectionIds, setConnectedConnectionIds] = useState(
    () => new Set<string>(),
  );
  const searchLoadedConnections = useRef(new Set<string>());
  const searchPendingConnections = useRef(new Set<string>());
  const [searchLoadingCount, setSearchLoadingCount] = useState(0);
  const searchActive = search.trim().length > 0;
  const connectedConnections = useMemo(
    () =>
      connections.filter((connection) =>
        connectedConnectionIds.has(connection.id),
      ),
    [connectedConnectionIds, connections],
  );

  function setConnectionConnected(
    connectionId: string,
    connected: boolean,
  ): void {
    setConnectedConnectionIds((current) => {
      const next = new Set(current);
      if (connected) {
        next.add(connectionId);
      } else {
        next.delete(connectionId);
        searchLoadedConnections.current.delete(connectionId);
      }
      return next;
    });
  }

  useEffect(() => {
    if (!searchActive) return;
    for (const connection of connectedConnections) {
      if (searchLoadedConnections.current.has(connection.id)) continue;
      if (searchPendingConnections.current.has(connection.id)) continue;
      searchPendingConnections.current.add(connection.id);
      setSearchLoadingCount(searchPendingConnections.current.size);
      void refreshSchemaTreeWithStatus(connection.id).then((result) => {
        searchPendingConnections.current.delete(connection.id);
        if (result.ok) searchLoadedConnections.current.add(connection.id);
        setSearchLoadingCount(searchPendingConnections.current.size);
      });
    }
  }, [connectedConnections, refreshSchemaTreeWithStatus, searchActive]);

  const filteredConnections = useMemo(
    () =>
      connectedConnections.flatMap((connection) => {
        const filtered = filterConnectionTree(
          connection,
          schemaCache[connection.id] ?? [],
          search,
        );
        return filtered.matches
          ? [{ connection, schemas: filtered.schemas }]
          : [];
      }),
    [connectedConnections, schemaCache, search],
  );

  // Separate favourites from the rest
  const favourites = connections.filter((c) => c.favourite);
  const others = connections.filter((c) => !c.favourite);

  if (loading) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={`skeleton-${String(i)}`}
              className="flex h-8 items-center gap-2 px-2"
            >
              <div className="size-4 animate-pulse rounded bg-sidebar-accent" />
              <div className="h-2.5 flex-1 animate-pulse rounded bg-sidebar-accent" />
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  }

  if (connections.length === 0) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <EmptyState
          icon={<Database />}
          title="No connections yet"
          description="Add a PostgreSQL connection to start exploring your databases."
        />
      </ScrollArea>
    );
  }

  if (searchActive && filteredConnections.length === 0) {
    if (searchLoadingCount > 0) {
      return (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Searching cached relation trees…
          </div>
        </ScrollArea>
      );
    }
    if (connectedConnections.length === 0) {
      return (
        <ScrollArea className="min-h-0 flex-1">
          <EmptyState
            icon={<SearchX />}
            title="No connected instances"
            description="Clear search, then connect to an instance to search its schemas and relations."
          />
        </ScrollArea>
      );
    }
    return (
      <ScrollArea className="min-h-0 flex-1">
        <EmptyState
          icon={<SearchX />}
          title="No matching relations"
          description="Try a connection, schema, table, or view name."
        />
      </ScrollArea>
    );
  }

  if (searchActive) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-px p-2">
          {filteredConnections.map(({ connection, schemas }) => (
            <ConnectionItem
              key={connection.id}
              connection={connection}
              onEdit={onEdit}
              connected
              onConnectedChange={(connected) =>
                setConnectionConnected(connection.id, connected)
              }
              searchSchemas={schemas}
              searchActive
            />
          ))}
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-px p-2">
        {favourites.length > 0 && (
          <>
            <SectionLabel>Favourites</SectionLabel>
            {favourites.map((c) => (
              <ConnectionItem
                key={c.id}
                connection={c}
                onEdit={onEdit}
                connected={connectedConnectionIds.has(c.id)}
                onConnectedChange={(connected) =>
                  setConnectionConnected(c.id, connected)
                }
              />
            ))}
          </>
        )}
        {others.length > 0 && (
          <>
            {favourites.length > 0 && <SectionLabel>Connections</SectionLabel>}
            {others.map((c) => (
              <ConnectionItem
                key={c.id}
                connection={c}
                onEdit={onEdit}
                connected={connectedConnectionIds.has(c.id)}
                onConnectedChange={(connected) =>
                  setConnectionConnected(c.id, connected)
                }
              />
            ))}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function SectionLabel({ children }: Readonly<{ children: string }>) {
  return (
    <p className="mt-4 mb-1 px-2 text-xs text-muted-foreground first:mt-1">
      {children}
    </p>
  );
}
