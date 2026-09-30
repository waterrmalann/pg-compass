import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteDataDialog } from "@/components/workspace/table-viewer/delete-data-dialog";
import type { ColumnInfo } from "@/shared/types/table-data";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const columns: ColumnInfo[] = [
  { name: "id", dataTypeId: 23, dataType: "int4" },
  { name: "display_name", dataTypeId: 25, dataType: "text" },
  { name: "profile", dataTypeId: 3802, dataType: "jsonb" },
];

const rows = [
  { id: 1, display_name: "Alice", profile: { role: "admin" } },
  { id: 2, display_name: "Bob", profile: { role: "viewer" } },
];

function installTableDataApiMock(options?: {
  getRows?: ReturnType<typeof vi.fn>;
  deleteRows?: ReturnType<typeof vi.fn>;
}) {
  const getRows =
    options?.getRows ??
    vi.fn(async () => ({
      success: true,
      data: {
        columns,
        rows,
        totalCount: rows.length,
        primaryKey: ["id"],
      },
    }));
  const deleteRows =
    options?.deleteRows ??
    vi.fn(async () => ({
      success: true,
      data: { deletedCount: rows.length },
    }));

  Object.defineProperty(globalThis.window, "tableDataApi", {
    configurable: true,
    value: {
      getRows,
      deleteRows,
    },
  });

  return { getRows, deleteRows };
}

function renderDialog(
  overrides?: Partial<ComponentProps<typeof DeleteDataDialog>>,
) {
  const onOpenChange = vi.fn();
  const onDeleted = vi.fn();
  render(
    <DeleteDataDialog
      open
      onOpenChange={onOpenChange}
      connectionId="c1"
      schema="app"
      table="users"
      query={{
        filter: "status = 'inactive'",
        projection: "id, name AS label",
        sort: "name DESC",
        skip: "",
        limit: "",
      }}
      initialPreviewMode="table"
      onDeleted={onDeleted}
      {...overrides}
    />,
  );
  return { onOpenChange, onDeleted };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("DeleteDataDialog", () => {
  it("previews full rows with the active filter and sort, then deletes by filter only", async () => {
    const { getRows, deleteRows } = installTableDataApiMock();
    const { onOpenChange, onDeleted } = renderDialog();

    expect(await screen.findByText("Delete 2 documents")).toBeInTheDocument();
    expect(screen.getByLabelText("Current delete filter")).toHaveValue(
      "status = 'inactive'",
    );

    await waitFor(() => expect(getRows).toHaveBeenCalledTimes(1));
    expect(getRows).toHaveBeenCalledWith({
      connectionId: "c1",
      schema: "app",
      table: "users",
      page: 1,
      pageSize: 5,
      query: {
        filter: "status = 'inactive'",
        projection: "",
        sort: "name DESC",
        skip: "",
        limit: "",
      },
    });
    expect(await screen.findByText("Alice")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteRows).toHaveBeenCalledTimes(1));
    expect(deleteRows).toHaveBeenCalledWith({
      connectionId: "c1",
      schema: "app",
      table: "users",
      filter: "status = 'inactive'",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("shows no-filter copy and sends an empty filter when deleting all documents", async () => {
    const { getRows, deleteRows } = installTableDataApiMock();
    renderDialog({
      query: { filter: "", projection: "", sort: "", skip: "", limit: "" },
    });

    expect(screen.getByLabelText("Current delete filter")).toHaveValue(
      "No filter (all documents)",
    );
    await waitFor(() =>
      expect(getRows).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { filter: "", projection: "", sort: "", skip: "", limit: "" },
        }),
      ),
    );

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(deleteRows).toHaveBeenCalledWith(
        expect.objectContaining({ filter: "" }),
      ),
    );
  });

  it("can switch the preview from table to JSON", async () => {
    installTableDataApiMock();
    renderDialog();

    await screen.findByText("Alice");
    fireEvent.click(screen.getByRole("button", { name: "JSON preview" }));

    expect(screen.getByText(/"display_name": "Alice"/)).toBeInTheDocument();
    expect(screen.getByText(/"role": "admin"/)).toBeInTheDocument();
  });

  it("handles an empty preview and prevents a no-op delete", async () => {
    installTableDataApiMock({
      getRows: vi.fn(async () => ({
        success: true,
        data: {
          columns,
          rows: [],
          totalCount: 0,
          primaryKey: ["id"],
        },
      })),
    });
    renderDialog();

    expect(
      await screen.findByText("No documents match the current filter."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("counts every row the filter matches, ignoring Skip and Limit", async () => {
    const getRows = vi.fn(async () => ({
      success: true,
      data: { columns, rows, totalCount: 57, primaryKey: ["id"] },
    }));
    installTableDataApiMock({ getRows });
    renderDialog({
      query: {
        filter: "status = 'inactive'",
        projection: "",
        sort: "",
        skip: "10",
        limit: "5",
      },
    });

    expect(screen.getByText("Delete documents")).toBeInTheDocument();
    expect(await screen.findByText("Delete 57 documents")).toBeInTheDocument();
    expect(getRows).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ skip: "", limit: "" }),
      }),
    );
    expect(
      screen.getByText(/Skip and Limit don.t apply here/),
    ).toBeInTheDocument();
  });

  it("shows preview errors and keeps the destructive action disabled", async () => {
    installTableDataApiMock({
      getRows: vi.fn(async () => ({
        success: false,
        error: 'syntax error at or near "bad"',
      })),
    });
    renderDialog();

    expect(
      await screen.findByText('syntax error at or near "bad"'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});
