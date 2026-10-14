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

const DEFAULT_SQL = 'SELECT * FROM "app"."users" LIMIT 100;';

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

    const executingQueryId = vi.mocked(window.tableDataApi.executeQuery).mock
      .calls[0]![0].queryId;
    await waitFor(() =>
      expect(window.tableDataApi.cancelQuery).toHaveBeenCalledWith({
        connectionId: "conn-1",
        queryId: executingQueryId,
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
    await screen.findByText(/returned/);

    const editor = screen.getByRole("textbox", { name: "SQL" });
    await user.clear(editor);
    await user.type(editor, "SELECT 2");

    view.rerender(
      <QueryTab
        connectionId="conn-1"
        schema="app"
        table="users"
        refreshSignal={1}
        onRefreshComplete={onRefreshComplete}
      />,
    );
    await waitFor(() => expect(onRefreshComplete).toHaveBeenCalledWith(true));
    expect(window.tableDataApi.executeQuery).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(window.tableDataApi.executeQuery).mock.calls[1]![0].sql,
    ).toBe(DEFAULT_SQL);
    expect(editor).toHaveValue("SELECT 2");
  });

  it("pages through the last run SQL, not unsubmitted editor text", async () => {
    const user = userEvent.setup();
    vi.mocked(window.tableDataApi.executeQuery).mockResolvedValue({
      success: true,
      data: { columns: [], rows: [], totalCount: 120, primaryKey: null },
    });
    render(<QueryTab connectionId="conn-1" schema="app" table="users" />);
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await screen.findByText(/returned/);

    const editor = screen.getByRole("textbox", { name: "SQL" });
    await user.clear(editor);
    await user.type(editor, "SELECT 2");

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(window.tableDataApi.executeQuery).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox")).not.toBeDisabled(),
    );
    await user.selectOptions(screen.getByRole("combobox"), "100");
    await waitFor(() =>
      expect(window.tableDataApi.executeQuery).toHaveBeenCalledTimes(3),
    );

    const calls = vi.mocked(window.tableDataApi.executeQuery).mock.calls;
    expect(calls[1]![0]).toMatchObject({ sql: DEFAULT_SQL, page: 2 });
    expect(calls[2]![0]).toMatchObject({
      sql: DEFAULT_SQL,
      page: 1,
      pageSize: 100,
    });
  });

  it("reports a failed refresh without executing while a query is running", async () => {
    const user = userEvent.setup();
    vi.mocked(window.tableDataApi.executeQuery).mockReturnValue(
      new Promise(() => undefined),
    );
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
    await screen.findByRole("button", { name: "Cancel" });

    view.rerender(
      <QueryTab
        connectionId="conn-1"
        schema="app"
        table="users"
        refreshSignal={1}
        onRefreshComplete={onRefreshComplete}
      />,
    );
    await waitFor(() => expect(onRefreshComplete).toHaveBeenCalledWith(false));
    expect(window.tableDataApi.executeQuery).toHaveBeenCalledTimes(1);
  });

  it("completes a refresh without executing when nothing has run yet", async () => {
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

    view.rerender(
      <QueryTab
        connectionId="conn-1"
        schema="app"
        table="users"
        refreshSignal={1}
        onRefreshComplete={onRefreshComplete}
      />,
    );
    await waitFor(() => expect(onRefreshComplete).toHaveBeenCalledWith(true));
    expect(window.tableDataApi.executeQuery).not.toHaveBeenCalled();
  });
});
