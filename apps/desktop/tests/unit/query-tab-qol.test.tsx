import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryTab } from "@/components/workspace/table-viewer/query-tab";

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({ schemaCache: {} }),
}));

vi.mock("@/components/sql-editor/sql-editor", () => ({
  SqlEditor: ({
    value,
    onChange,
    onSubmit,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSubmit?: () => void;
  }) => (
    <>
      <textarea
        aria-label="SQL"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" onClick={onSubmit}>
        Submit editor shortcut
      </button>
    </>
  ),
}));

vi.mock("@/components/workspace/export-dropdown", () => ({
  ExportDropdown: () => null,
}));

describe("QueryTab QOL controls", () => {
  beforeEach(() => {
    Object.assign(window, {
      tableDataApi: {
        executeQuery: vi.fn(),
        cancelQuery: vi.fn().mockResolvedValue({
          success: true,
          data: { status: "cancel-requested" },
        }),
      },
    });
  });

  it("shows Cancel for an in-flight query and targets that invocation", async () => {
    const user = userEvent.setup();
    vi.mocked(window.tableDataApi.executeQuery).mockReturnValue(
      new Promise(() => undefined),
    );

    render(<QueryTab connectionId="conn-1" schema="app" table="users" />);

    await user.click(screen.getByRole("button", { name: "Run query" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(window.tableDataApi.cancelQuery).toHaveBeenCalledWith({
        connectionId: "conn-1",
        queryId: expect.any(String),
      }),
    );
  });

  it("ignores repeated editor submissions while a query is running", async () => {
    const user = userEvent.setup();
    vi.mocked(window.tableDataApi.executeQuery).mockReturnValue(
      new Promise(() => undefined),
    );
    render(<QueryTab connectionId="conn-1" schema="app" table="users" />);

    const shortcut = screen.getByRole("button", {
      name: "Submit editor shortcut",
    });
    await user.click(shortcut);
    await user.click(shortcut);
    expect(window.tableDataApi.executeQuery).toHaveBeenCalledTimes(1);
  });

  it("refreshes the last successfully submitted SQL without replacing editor text", async () => {
    const user = userEvent.setup();
    vi.mocked(window.tableDataApi.executeQuery).mockResolvedValue({
      success: true,
      data: { columns: [], rows: [], totalCount: 0, primaryKey: null },
    });
    const onRefreshComplete = vi.fn();
    const view = render(
      <QueryTab
        connectionId="conn-1"
        schema="app"
        table="users"
        refreshSignal={0}
        onRefreshComplete={onRefreshComplete}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() =>
      expect(window.tableDataApi.executeQuery).toHaveBeenCalledTimes(1),
    );

    view.rerender(
      <QueryTab
        connectionId="conn-1"
        schema="app"
        table="users"
        refreshSignal={1}
        onRefreshComplete={onRefreshComplete}
      />,
    );
    await waitFor(() =>
      expect(window.tableDataApi.executeQuery).toHaveBeenCalledTimes(2),
    );
    expect(onRefreshComplete).toHaveBeenCalledWith(true);
  });
});
