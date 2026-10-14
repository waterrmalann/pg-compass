import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withPoolClient: vi.fn(),
  withDedicatedClient: vi.fn(),
}));

vi.mock("@/main/pg-utils", () => ({
  extendedQuery: (text: string) => ({ text, queryMode: "extended" }),
  quoteIdent: (value: string) => `"${value}"`,
  withPoolClient: mocks.withPoolClient,
  withDedicatedClient: mocks.withDedicatedClient,
}));

vi.mock("@/main/table-data-utils", () => ({
  buildTypeMap: vi.fn().mockResolvedValue(new Map()),
  buildEnumTypeMap: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/main/table-data-fk", () => ({
  resolveForeignKeys: vi.fn().mockResolvedValue(new Map()),
}));

import { cancelQuery, executeQuery } from "@/main/table-data-rows";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("query cancellation lifecycle", () => {
  beforeEach(() => {
    mocks.withPoolClient.mockReset();
    mocks.withDedicatedClient.mockReset();
  });

  it("honors cancellation while the query is waiting for a pooled client", async () => {
    const clientGate = deferred<void>();
    const fakeClient = { processID: 42, query: vi.fn() };
    mocks.withPoolClient.mockImplementation(
      async (_connectionId: string, callback: (client: unknown) => unknown) => {
        await clientGate.promise;
        return callback(fakeClient);
      },
    );

    const running = executeQuery({
      connectionId: "conn-1",
      queryId: "pending-query",
      sql: "SELECT 1",
      page: 1,
      pageSize: 25,
    });
    await expect(cancelQuery("conn-1", "pending-query")).resolves.toBe(
      "cancel-requested",
    );
    clientGate.resolve();
    await expect(running).rejects.toThrow("Query cancelled.");
    expect(mocks.withDedicatedClient).not.toHaveBeenCalled();
  });

  it("keeps the target pool lease until an in-flight cancel handshake settles", async () => {
    const countGate = deferred<{ rows: Array<{ count: string }> }>();
    const cancelGate = deferred<boolean>();
    let poolLeaseReleased = false;
    const fakeClient = {
      processID: 42,
      query: vi.fn().mockImplementation((query: string | { text: string }) => {
        const sql = typeof query === "string" ? query : query.text;
        if (sql.includes("count(*)")) return countGate.promise;
        if (sql.includes("__data_subquery")) {
          return Promise.resolve({ rows: [], fields: [] });
        }
        return Promise.resolve({ rows: [], fields: [] });
      }),
    };
    mocks.withPoolClient.mockImplementation(
      async (_connectionId: string, callback: (client: unknown) => unknown) => {
        try {
          return await callback(fakeClient);
        } finally {
          poolLeaseReleased = true;
        }
      },
    );
    mocks.withDedicatedClient.mockImplementation(() => cancelGate.promise);

    const running = executeQuery({
      connectionId: "conn-1",
      queryId: "lease-query",
      sql: "SELECT 1",
      page: 1,
      pageSize: 25,
    });
    await vi.waitFor(() => expect(fakeClient.query).toHaveBeenCalled());
    const cancelling = cancelQuery("conn-1", "lease-query");
    countGate.resolve({ rows: [{ count: "0" }] });
    let runningSettled = false;
    void running.finally(() => {
      runningSettled = true;
    });
    // Let every remaining step of the query finish; only the cancel handshake
    // is still pending, so the lease must still be held.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(poolLeaseReleased).toBe(false);
    expect(runningSettled).toBe(false);
    cancelGate.resolve(true);
    await expect(cancelling).resolves.toBe("cancel-requested");
    await expect(running).resolves.toMatchObject({ rows: [] });
    expect(poolLeaseReleased).toBe(true);
  });
});
