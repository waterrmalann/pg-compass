import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RowEditDialog } from "@/components/workspace/table-viewer/row-edit-dialog";
import { registerDefaultRenderers } from "@/components/workspace/renderers/default-renderers";
import {
  editRegistry,
  registerDefaultEditors,
  type TypeEditorProps,
} from "@/components/workspace/renderers/edit-registry";
import type { ColumnInfo } from "@/shared/types/table-data";

beforeAll(() => {
  try {
    registerDefaultRenderers();
  } catch {
    /* idempotent */
  }
  try {
    registerDefaultEditors();
  } catch {
    /* idempotent */
  }
});

const columns: ColumnInfo[] = [
  { name: "id", dataTypeId: 23, dataType: "int4", isNullable: false },
  {
    name: "display_name",
    dataTypeId: 1043,
    dataType: "varchar",
    isNullable: false,
  },
  { name: "login_count", dataTypeId: 23, dataType: "int4", isNullable: false },
  { name: "profile_note", dataTypeId: 25, dataType: "text", isNullable: true },
];

const row = {
  id: 1,
  display_name: "Alice",
  login_count: 5,
  profile_note: "hi",
};

interface UpdateRowMock {
  fn: ReturnType<typeof vi.fn>;
}

function setupUpdateRowMock(
  impl: (params: unknown) => unknown = () => ({
    success: true,
    data: { row: { ...row, display_name: "Alice 2" } },
  }),
): UpdateRowMock {
  const fn = vi.fn(async (params: unknown) => impl(params));
  Object.defineProperty(globalThis.window, "tableDataApi", {
    configurable: true,
    value: { updateRow: fn },
  });
  return { fn };
}

function setupInsertRowMock(
  impl: (params: unknown) => unknown = () => ({
    success: true,
    data: { row: { id: 99, display_name: "New", login_count: 0 } },
  }),
): UpdateRowMock {
  const fn = vi.fn(async (params: unknown) => impl(params));
  Object.defineProperty(globalThis.window, "tableDataApi", {
    configurable: true,
    value: { insertRow: fn },
  });
  return { fn };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("RowEditDialog", () => {
  it("renders one editor per non-PK column; PK is read-only", () => {
    setupUpdateRowMock();
    render(
      <RowEditDialog
        columns={columns}
        row={row}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );
    // Save disabled when no changes.
    expect(screen.getByTestId("row-editor-save")).toBeDisabled();
    // Each non-PK column gets a field.
    expect(screen.getByTestId("row-field-display_name")).toBeInTheDocument();
    expect(screen.getByTestId("row-field-login_count")).toBeInTheDocument();
    // PK column is rendered but not as an editable input.
    expect(screen.getByTestId("row-field-id")).toBeInTheDocument();
    expect(screen.queryByTestId("setnull-id")).toBeNull();
    expect(screen.queryByTestId("revert-id")).toBeNull();
    expect(screen.queryByTestId("setnull-display_name")).toBeNull();
    expect(screen.queryByTestId("setnull-login_count")).toBeNull();
    expect(screen.getByTestId("setnull-profile_note")).toBeInTheDocument();
  });

  it("enables Save once a field changes; saves with both edits in one call", async () => {
    const { fn } = setupUpdateRowMock();
    const onRowUpdated = vi.fn();
    render(
      <RowEditDialog
        columns={columns}
        row={row}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={onRowUpdated}
        onClose={() => {}}
      />,
    );

    const nameField = screen
      .getByTestId("row-field-display_name")
      .querySelector("input")!;
    fireEvent.change(nameField, { target: { value: "Alice 2" } });

    const countField = screen
      .getByTestId("row-field-login_count")
      .querySelector("input")!;
    fireEvent.change(countField, { target: { value: "9" } });

    const save = screen.getByTestId("row-editor-save");
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(fn).toHaveBeenCalledWith({
      connectionId: "c1",
      schema: "app",
      table: "users",
      pkColumns: ["id"],
      pkValues: [1],
      changes: [
        {
          column: "display_name",
          pgCast: "varchar",
          newValue: "Alice 2",
          setNull: false,
        },
        { column: "login_count", pgCast: "int4", newValue: 9, setNull: false },
      ],
    });
    await waitFor(() => expect(onRowUpdated).toHaveBeenCalled());
  });

  it("revert clears one field's draft without affecting the other", () => {
    setupUpdateRowMock();
    render(
      <RowEditDialog
        columns={columns}
        row={row}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );
    const nameInput = screen
      .getByTestId("row-field-display_name")
      .querySelector("input")! as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Renamed" } });
    const countInput = screen
      .getByTestId("row-field-login_count")
      .querySelector("input")! as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: "9" } });

    expect(
      screen.getByTestId("row-field-display_name").getAttribute("data-changed"),
    ).toBe("true");

    fireEvent.click(screen.getByTestId("revert-display_name"));

    expect(
      (
        screen
          .getByTestId("row-field-display_name")
          .querySelector("input")! as HTMLInputElement
      ).value,
    ).toBe("Alice");
    expect(
      screen.getByTestId("row-field-display_name").getAttribute("data-changed"),
    ).toBe("false");
    expect(
      screen.getByTestId("row-field-login_count").getAttribute("data-changed"),
    ).toBe("true");
  });

  it("Set NULL replaces the input with a NULL pill and sends setNull: true", async () => {
    const { fn } = setupUpdateRowMock();
    render(
      <RowEditDialog
        columns={columns}
        row={row}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("setnull-profile_note"));
    expect(screen.getByTestId("null-pill-profile_note")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("row-editor-save"));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    const call = fn.mock.calls[0]![0] as { changes: unknown[] };
    expect(call.changes).toEqual([
      { column: "profile_note", pgCast: "text", newValue: null, setNull: true },
    ]);
  });

  it("Set NULL on a column that is already NULL is not a change", () => {
    setupUpdateRowMock();
    render(
      <RowEditDialog
        columns={columns}
        row={{ ...row, profile_note: null }}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("setnull-profile_note"));

    expect(
      screen.getByTestId("row-field-profile_note").getAttribute("data-changed"),
    ).toBe("false");
    expect(screen.getByTestId("row-editor-save")).toBeDisabled();
  });

  it("Set NULL on an enum column sends the enum's qualified cast", async () => {
    const { fn } = setupUpdateRowMock();
    render(
      <RowEditDialog
        columns={[
          columns[0]!,
          {
            name: "role",
            dataTypeId: 99999,
            dataType: "user_role",
            enumPgCast: '"app"."user_role"',
            enumLabels: ["admin", "viewer"],
            isNullable: true,
          },
        ]}
        row={{ id: 1, role: "admin" }}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("setnull-role"));
    fireEvent.click(screen.getByTestId("row-editor-save"));

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(fn.mock.calls[0]![0]).toMatchObject({
      changes: [
        {
          column: "role",
          pgCast: '"app"."user_role"',
          newValue: null,
          setNull: true,
        },
      ],
    });
  });

  it("keeps the dialog open after a failed update and allows a retry", async () => {
    const { fn } = setupUpdateRowMock(() => ({
      success: false,
      error: "permission denied",
    }));
    const onRowUpdated = vi.fn();
    const onClose = vi.fn();
    render(
      <RowEditDialog
        columns={columns}
        row={row}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={onRowUpdated}
        onClose={onClose}
      />,
    );
    const countInput = screen
      .getByTestId("row-field-login_count")
      .querySelector("input")!;
    fireEvent.change(countInput, { target: { value: "9" } });

    fireEvent.click(screen.getByTestId("row-editor-save"));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("row-editor-save")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("row-editor-save"));

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(onRowUpdated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("surfaces validation errors and blocks save when an integer field is invalid", async () => {
    const { fn } = setupUpdateRowMock();
    render(
      <RowEditDialog
        columns={columns}
        row={row}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );
    const countInput = screen
      .getByTestId("row-field-login_count")
      .querySelector("input")!;
    fireEvent.change(countInput, { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByTestId("row-editor-save"));
    expect(fn).not.toHaveBeenCalled();
    expect(screen.getByTestId("row-field-login_count").textContent).toMatch(
      /not a valid int4/i,
    );
  });

  it("Cancel closes immediately when there are no changes", () => {
    setupUpdateRowMock();
    const onClose = vi.fn();
    render(
      <RowEditDialog
        columns={columns}
        row={row}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Cancel asks for confirm when there are pending changes", () => {
    setupUpdateRowMock();
    const onClose = vi.fn();
    render(
      <RowEditDialog
        columns={columns}
        row={row}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={onClose}
      />,
    );
    const nameInput = screen
      .getByTestId("row-field-display_name")
      .querySelector("input")!;
    fireEvent.change(nameInput, { target: { value: "Renamed" } });

    const confirmSpy = vi
      .spyOn(globalThis.window, "confirm")
      .mockReturnValueOnce(false);
    fireEvent.click(screen.getByText("Cancel"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("RowEditDialog — insert mode", () => {
  it("renders an editable field for every column (PK included) and an Insert button", () => {
    setupInsertRowMock();
    render(
      <RowEditDialog
        mode="insert"
        columns={columns}
        row={{}}
        primaryKey={["id"]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );
    // Insert is enabled even with no fields set (DEFAULT VALUES insert allowed).
    const save = screen.getByTestId("row-editor-save");
    expect(save).toHaveTextContent("Insert");
    expect(save).not.toBeDisabled();
    // Even the PK column is editable in insert mode.
    expect(
      screen.getByTestId("row-field-id").querySelector("input"),
    ).not.toBeNull();
  });

  it("sends only the columns the user filled in (blank fields omitted)", async () => {
    const { fn } = setupInsertRowMock();
    const onClose = vi.fn();
    render(
      <RowEditDialog
        mode="insert"
        columns={columns}
        row={{}}
        primaryKey={["id"]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={onClose}
      />,
    );

    const nameField = screen
      .getByTestId("row-field-display_name")
      .querySelector("input")!;
    fireEvent.change(nameField, { target: { value: "New Person" } });

    fireEvent.click(screen.getByTestId("row-editor-save"));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(fn).toHaveBeenCalledWith({
      connectionId: "c1",
      schema: "app",
      table: "users",
      changes: [
        {
          column: "display_name",
          pgCast: "varchar",
          newValue: "New Person",
          setNull: false,
        },
      ],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("inserts with an empty change set when nothing is filled in", async () => {
    const { fn } = setupInsertRowMock();
    render(
      <RowEditDialog
        mode="insert"
        columns={columns}
        row={{}}
        primaryKey={["id"]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("row-editor-save"));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    const call = fn.mock.calls[0]![0] as { changes: unknown[] };
    expect(call.changes).toEqual([]);
  });

  it("inserts an explicitly entered empty string instead of using the default", async () => {
    const { fn } = setupInsertRowMock();
    render(
      <RowEditDialog
        mode="insert"
        columns={columns}
        row={{}}
        primaryKey={["id"]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );
    const nameField = screen
      .getByTestId("row-field-display_name")
      .querySelector("input")!;
    fireEvent.change(nameField, { target: { value: "temporary" } });
    fireEvent.change(nameField, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("row-editor-save"));

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(fn.mock.calls[0]![0]).toMatchObject({
      changes: [{ column: "display_name", newValue: "", setNull: false }],
    });
  });

  it("ignores repeated keyboard submissions while an insert is pending", async () => {
    let resolveInsert!: (value: unknown) => void;
    const { fn } = setupInsertRowMock(
      () => new Promise((resolve) => (resolveInsert = resolve)),
    );
    render(
      <RowEditDialog
        mode="insert"
        columns={columns}
        row={{}}
        primaryKey={["id"]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByTestId("row-editor");
    fireEvent.keyDown(dialog, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(dialog, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveInsert({ success: true, data: { row: { id: 1 } } });
    });
  });

  describe("geography fields", () => {
    const geoColumns: ColumnInfo[] = [
      {
        name: "location",
        dataTypeId: 99999,
        dataType: "geography",
        isNullable: true,
      },
    ];

    // Stands in for the Leaflet map editor, which jsdom can't render.
    function StubMapEditor(props: Readonly<TypeEditorProps>) {
      return (
        <div>
          <span data-testid="stub-initial">{String(props.initialValue)}</span>
          <button
            type="button"
            onClick={() =>
              props.onSave({
                value: "SRID=4326;POINT(76.27 9.93)",
                pgCast: "geometry",
              })
            }
          >
            Stub save
          </button>
        </div>
      );
    }

    function renderGeoInsert() {
      render(
        <RowEditDialog
          mode="insert"
          columns={geoColumns}
          row={{}}
          primaryKey={[]}
          schema="app"
          table="places"
          connectionId="c1"
          onRowUpdated={() => {}}
          onClose={() => {}}
        />,
      );
    }

    it("shows the WKT format as a placeholder", () => {
      setupInsertRowMock();
      renderGeoInsert();
      const textarea = screen
        .getByTestId("row-field-location")
        .querySelector("textarea")!;
      expect(textarea).toHaveAttribute(
        "placeholder",
        "SRID=4326;POINT(lng lat)",
      );
    });

    it("fills the field from the map editor and inserts it with the column's cast", async () => {
      const geographyEditor = editRegistry.get("geography");
      editRegistry.register("geography", {
        ...geographyEditor,
        Component: StubMapEditor,
      });
      try {
        const { fn } = setupInsertRowMock();
        renderGeoInsert();
        const textarea = screen
          .getByTestId("row-field-location")
          .querySelector("textarea")!;
        fireEvent.change(textarea, { target: { value: "POINT(1 2)" } });

        fireEvent.click(screen.getByTestId("map-trigger-location"));
        // The map opens on whatever is already typed.
        expect(screen.getByTestId("stub-initial")).toHaveTextContent(
          "POINT(1 2)",
        );
        fireEvent.click(screen.getByText("Stub save"));

        await waitFor(() =>
          expect(screen.queryByTestId("map-editor-dialog-location")).toBeNull(),
        );
        expect(textarea).toHaveValue("SRID=4326;POINT(76.27 9.93)");

        fireEvent.click(screen.getByTestId("row-editor-save"));
        await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
        expect(fn.mock.calls[0]![0]).toMatchObject({
          changes: [
            {
              column: "location",
              pgCast: "geography",
              newValue: "SRID=4326;POINT(76.27 9.93)",
              setNull: false,
            },
          ],
        });
      } finally {
        editRegistry.register("geography", geographyEditor);
      }
    });

    it("has no map button when no map editor is registered", () => {
      setupInsertRowMock();
      renderGeoInsert();
      expect(screen.queryByTestId("map-trigger-location")).toBeNull();
    });
  });
});
