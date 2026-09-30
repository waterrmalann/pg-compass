import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataTab } from "@/components/workspace/table-viewer/data-tab";
import type { DataQueryInput, QueryDslError } from "@/shared/query-dsl/types";

const settingsState = { readOnlyMode: false };
const exportProps = vi.fn();
const deleteProps = vi.fn();

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ settings: { general: settingsState } }),
}));
// A plain input stands in for CodeMirror; the editor has its own tests.
vi.mock("@/components/workspace/table-viewer/query-dsl-editor", () => ({
  QueryDslEditor: ({
    ariaLabel,
    value,
    onChange,
    onSubmit,
    errors,
  }: {
    ariaLabel: string;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    errors: QueryDslError[];
  }) => (
    <input
      aria-label={ariaLabel}
      aria-invalid={errors.length > 0}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSubmit();
      }}
    />
  ),
}));
vi.mock("@/components/workspace/export-dropdown", () => ({
  ExportDropdown: (props: unknown) => {
    exportProps(props);
    return null;
  },
}));
vi.mock("@/components/workspace/table-viewer/delete-data-dialog", () => ({
  DeleteDataDialog: (props: unknown) => {
    deleteProps(props);
    return null;
  },
}));
vi.mock("@/components/workspace/table-viewer/add-data-dropdown", () => ({
  AddDataDropdown: () => <button type="button">Add data</button>,
}));
vi.mock("@/components/workspace/table-viewer/table-data-view", () => ({
  TableDataView: ({ rows }: { rows: { id: number }[] }) => (
    <div>rows: {rows.map((row) => row.id).join(",")}</div>
  ),
}));
vi.mock("@/components/workspace/table-viewer/card-data-view", () => ({
  CardDataView: () => null,
}));

const EMPTY: DataQueryInput = { filter: "", projection: "", sort: "" };

function rowsResult(ids: number[], primaryKey: string[] | null = ["id"]) {
  return {
    success: true,
    data: {
      columns: [{ name: "id", dataType: "int4", dataTypeId: 23 }],
      rows: ids.map((id) => ({ id })),
      totalCount: ids.length,
      primaryKey,
    },
  };
}

const QUERY_COLUMNS = [
  { name: "id", typeName: "int4", family: "numeric" },
  { name: "name", typeName: "text", family: "text" },
];

function installApi(getRows: ReturnType<typeof vi.fn>) {
  Object.assign(window, {
    tableDataApi: {
      getRows,
      getQueryColumns: vi
        .fn()
        .mockResolvedValue({ success: true, data: QUERY_COLUMNS }),
    },
  });
}

function renderTab(onSessionChange = vi.fn()) {
  render(
    <DataTab
      connectionId="c1"
      schema="app"
      table="users"
      relationType="table"
      onSessionChange={onSessionChange}
    />,
  );
  return { onSessionChange };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function lastGetRowsQuery(getRows: ReturnType<typeof vi.fn>) {
  const call = getRows.mock.calls.at(-1)?.[0] as {
    page: number;
    query: DataQueryInput;
  };
  return call;
}

beforeEach(() => {
  settingsState.readOnlyMode = false;
  exportProps.mockReset();
  deleteProps.mockReset();
});

describe("DataTab query DSL", () => {
  it("does not fetch on draft edits and applies all fields atomically", async () => {
    const getRows = vi
      .fn()
      .mockResolvedValueOnce(rowsResult([1, 2, 3]))
      .mockResolvedValueOnce(rowsResult([3]));
    installApi(getRows);
    const { onSessionChange } = renderTab();
    await screen.findByText("rows: 1,2,3");

    type("Filter", "id > 2");
    fireEvent.click(screen.getByRole("button", { name: "Query options" }));
    type("Sort", "id DESC");
    expect(getRows).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText("rows: 3");
    expect(lastGetRowsQuery(getRows)).toMatchObject({
      page: 1,
      query: { filter: "id > 2", projection: "", sort: "id DESC" },
    });
    expect(onSessionChange).toHaveBeenCalledWith({
      dataQuery: { filter: "id > 2", projection: "", sort: "id DESC" },
    });
  });

  it("keeps the active results when a draft has a syntax or binding error", async () => {
    const getRows = vi.fn().mockResolvedValue(rowsResult([1, 2]));
    installApi(getRows);
    renderTab();
    await screen.findByText("rows: 1,2");
    await waitFor(() =>
      expect(window.tableDataApi.getQueryColumns).toHaveBeenCalled(),
    );

    type("Filter", "id >=");
    fireEvent.keyDown(screen.getByLabelText("Filter"), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Expected a value after ">="',
    );
    expect(screen.getByLabelText("Filter")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    type("Filter", "nmae = 'x'");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Column "nmae" does not exist. Did you mean name?',
    );

    expect(getRows).toHaveBeenCalledTimes(1);
    expect(screen.getByText("rows: 1,2")).toBeVisible();
  });

  it("opens the options row when Project or Sort has an error", async () => {
    installApi(vi.fn().mockResolvedValue(rowsResult([1])));
    renderTab();
    await screen.findByText("rows: 1");
    fireEvent.click(screen.getByRole("button", { name: "Query options" }));
    type("Sort", "id 5");
    fireEvent.click(screen.getByRole("button", { name: "Query options" }));
    expect(screen.queryByLabelText("Sort")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ASC, DESC, 1, or -1",
    );
    expect(screen.getByLabelText("Sort")).toHaveValue("id 5");
  });

  it("does not promote a query the main process rejects", async () => {
    const getRows = vi
      .fn()
      .mockResolvedValueOnce(rowsResult([1, 2]))
      .mockResolvedValueOnce({
        success: false,
        error: 'Column "name" does not exist.',
        failure: {
          kind: "query-dsl",
          errors: [
            {
              code: "unknown-column",
              field: "filter",
              message: 'Column "name" does not exist.',
              from: 0,
              to: 4,
            },
          ],
        },
      })
      .mockResolvedValue(rowsResult([2]));
    installApi(getRows);
    const { onSessionChange } = renderTab();
    await screen.findByText("rows: 1,2");

    type("Filter", "name = 'x'");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Column "name" does not exist.',
    );
    expect(screen.getByText("rows: 1,2")).toBeVisible();
    expect(onSessionChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ dataQuery: expect.anything() }),
    );
    expect(deleteProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: EMPTY }),
    );
  });

  it("pages and resizes with the active query, never the draft", async () => {
    const getRows = vi.fn().mockResolvedValue({
      success: true,
      data: {
        columns: [{ name: "id", dataType: "int4", dataTypeId: 23 }],
        rows: [{ id: 1 }],
        totalCount: 500,
        primaryKey: ["id"],
      },
    });
    installApi(getRows);
    renderTab();
    await screen.findByText("rows: 1");

    type("Filter", "id > 1");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(getRows).toHaveBeenCalledTimes(2));
    await screen.findByText("rows: 1");

    type("Filter", "id > 100");
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(getRows).toHaveBeenCalledTimes(3));
    expect(lastGetRowsQuery(getRows)).toMatchObject({
      page: 2,
      query: { filter: "id > 1" },
    });
  });

  it("treats an unchanged Apply as a no-op and Clear as a reset", async () => {
    const getRows = vi.fn().mockResolvedValue(rowsResult([1]));
    installApi(getRows);
    renderTab();
    await screen.findByText("rows: 1");

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(getRows).toHaveBeenCalledTimes(1);

    type("Filter", "id = 1");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(getRows).toHaveBeenCalledTimes(2));
    await screen.findByText("rows: 1");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(getRows).toHaveBeenCalledTimes(3));
    expect(lastGetRowsQuery(getRows)).toMatchObject({ page: 1, query: EMPTY });
    expect(screen.getByLabelText("Filter")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("marks hidden active options and passes the DSL to export and delete", async () => {
    const getRows = vi
      .fn()
      .mockResolvedValueOnce(rowsResult([1, 2]))
      .mockResolvedValueOnce(rowsResult([2, 1], null));
    installApi(getRows);
    renderTab();
    await screen.findByText("rows: 1,2");
    expect(exportProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ dataQuery: undefined }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Query options" }));
    type("Project", "id");
    type("Sort", "id -1");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText("rows: 2,1");

    fireEvent.click(
      screen.getByRole("button", { name: "Query options, 2 active" }),
    );
    expect(screen.queryByLabelText("Project")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Query options, 2 active" }),
    ).toHaveTextContent("2");

    const active = { filter: "", projection: "id", sort: "id -1" };
    expect(exportProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ dataQuery: active }),
    );
    expect(deleteProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: active }),
    );
  });

  it("explains that projected rows are read-only", async () => {
    const getRows = vi
      .fn()
      .mockResolvedValueOnce(rowsResult([1]))
      .mockResolvedValueOnce(rowsResult([1], null));
    installApi(getRows);
    renderTab();
    await screen.findByText("rows: 1");
    expect(screen.getByRole("button", { name: "Add data" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Query options" }));
    type("Project", "id");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const readOnly = await screen.findByRole("button", { name: "Read-only" });
    expect(readOnly).toHaveAttribute("aria-disabled", "true");
    expect(readOnly).toHaveAttribute(
      "aria-description",
      "Clear projection to edit rows.",
    );
    expect(screen.queryByRole("button", { name: "Add data" })).toBeNull();
  });

  it("ignores a stale response after a newer query was applied", async () => {
    const pending: ((value: unknown) => void)[] = [];
    const getRows = vi
      .fn()
      .mockResolvedValueOnce(rowsResult([1, 2, 3]))
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            pending.push(resolve);
          }),
      );
    installApi(getRows);
    const { onSessionChange } = renderTab();
    await screen.findByText("rows: 1,2,3");

    type("Filter", "id = 1");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    type("Filter", "id = 2");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => {
      pending[1]!(rowsResult([2]));
    });
    await screen.findByText("rows: 2");
    await act(async () => {
      pending[0]!(rowsResult([1]));
    });

    expect(screen.getByText("rows: 2")).toBeVisible();
    expect(onSessionChange).toHaveBeenCalledTimes(1);
    expect(onSessionChange).toHaveBeenCalledWith({
      dataQuery: { filter: "id = 2", projection: "", sort: "" },
    });
  });
});
