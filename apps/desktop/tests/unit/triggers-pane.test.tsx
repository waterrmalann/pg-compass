import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { TriggersPane } from "@/components/workspace/rbac/triggers-pane";
import type { IpcResult } from "@/shared/types/ipc";
import type { PgTriggerInfo } from "@/shared/types/roles";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ settings: { general: { readOnlyMode: false } } }),
}));

function trigger(tableName: string, triggerName: string): PgTriggerInfo {
  return {
    schemaName: "public",
    tableName,
    triggerName,
    timing: "BEFORE",
    events: "INSERT",
    functionName: "touch",
    functionSchema: "public",
    enabled: true,
    enabledMode: "origin",
    orientation: "ROW",
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("TriggersPane", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("ignores a slower response for the previously selected database", async () => {
    const first = deferred<IpcResult<PgTriggerInfo[]>>();
    Object.assign(window, {
      rolesApi: {
        listTriggers: vi.fn((_connectionId: string, database: string) =>
          database === "alpha"
            ? first.promise
            : Promise.resolve({
                success: true,
                data: [trigger("orders", "beta_trigger")],
              }),
        ),
        setTriggerEnabled: vi.fn(),
      },
    });
    const user = userEvent.setup();
    render(
      <TriggersPane connectionId="conn-1" databaseNames={["alpha", "beta"]} />,
    );

    await user.selectOptions(screen.getByLabelText("Database"), "beta");
    expect(await screen.findByText("beta_trigger")).toBeVisible();

    first.resolve({ success: true, data: [trigger("users", "alpha_trigger")] });
    await new Promise((done) => setTimeout(done, 0));

    expect(screen.queryByText("alpha_trigger")).not.toBeInTheDocument();
    expect(screen.getByText("beta_trigger")).toBeVisible();
  });

  it("confirms toggle-all with the count and database, then reports partial failures once", async () => {
    Object.assign(window, {
      rolesApi: {
        listTriggers: vi.fn().mockResolvedValue({
          success: true,
          data: [
            trigger("users", "t1"),
            trigger("orders", "t2"),
            trigger("items", "t3"),
          ],
        }),
        setTriggerEnabled: vi
          .fn()
          .mockResolvedValueOnce({ success: true, data: undefined })
          .mockResolvedValueOnce({ success: false, error: "permission denied" })
          .mockResolvedValueOnce({ success: false, error: "locked" }),
      },
    });
    const user = userEvent.setup();
    render(<TriggersPane connectionId="conn-1" databaseNames={["shop"]} />);
    await screen.findByText("t1");

    await user.click(
      screen.getByRole("switch", { name: "All triggers enabled" }),
    );

    expect(
      screen.getByRole("heading", { name: "Disable all triggers?" }),
    ).toBeVisible();
    expect(
      screen.getByText(/This will disable 3 triggers in/),
    ).toHaveTextContent("This will disable 3 triggers in shop.");
    expect(window.rolesApi.setTriggerEnabled).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Disable 3 triggers" }),
    );

    await waitFor(() =>
      expect(window.rolesApi.setTriggerEnabled).toHaveBeenCalledTimes(3),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to disable 2 of 3 triggers in shop",
      { description: "permission denied" },
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does nothing when the toggle-all confirmation is cancelled", async () => {
    Object.assign(window, {
      rolesApi: {
        listTriggers: vi
          .fn()
          .mockResolvedValue({ success: true, data: [trigger("users", "t1")] }),
        setTriggerEnabled: vi.fn(),
      },
    });
    const user = userEvent.setup();
    render(<TriggersPane connectionId="conn-1" databaseNames={["shop"]} />);
    await screen.findByText("t1");

    await user.click(
      screen.getByRole("switch", { name: "All triggers enabled" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(window.rolesApi.setTriggerEnabled).not.toHaveBeenCalled();
  });
});
