import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { EditableCell } from "@/components/workspace/table-viewer/editable-cell";
import { registerDefaultRenderers } from "@/components/workspace/renderers/default-renderers";
import { registerDefaultEditors } from "@/components/workspace/renderers/edit-registry";
import type { ColumnInfo } from "@/shared/types/table-data";

beforeAll(() => {
  // The component needs display renderers and cell editors. Registering is
  // idempotent, so it does not matter if another test file ran first.
  registerDefaultRenderers();
  registerDefaultEditors();
});

const textCol: ColumnInfo = {
  name: "display_name",
  dataTypeId: 25,
  dataType: "text",
  isNullable: true,
};

/**
 * The read-only-mode gate is the compliance core of Phase 1. These tests
 * assert the DOM contains zero edit affordances in the gated states — no
 * test-id, no role="dialog", no onDoubleClick that opens an editor.
 */
describe("EditableCell gating", () => {
  it("renders no edit affordance when readOnly=true", () => {
    const { container } = render(
      <EditableCell
        col={textCol}
        value="Alice"
        readOnly
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        variant="cell"
      />,
    );
    expect(screen.queryByTestId("cell-editor-target")).toBeNull();
    expect(screen.queryByTestId("cell-editor")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // And the display itself is still rendered.
    expect(container.textContent).toContain("Alice");
  });

  it("renders no edit affordance when primaryKey is null", () => {
    render(
      <EditableCell
        col={textCol}
        value="Bob"
        readOnly={false}
        primaryKey={null}
        pkValues={[]}
        schema="app"
        table="active_users"
        connectionId="c1"
        variant="cell"
      />,
    );
    expect(screen.queryByTestId("cell-editor-target")).toBeNull();
    expect(screen.queryByTestId("cell-editor")).toBeNull();
  });

  it("renders no edit affordance when primaryKey is an empty array", () => {
    render(
      <EditableCell
        col={textCol}
        value="Carol"
        readOnly={false}
        primaryKey={[]}
        pkValues={[]}
        schema="app"
        table="notes"
        connectionId="c1"
        variant="cell"
      />,
    );
    expect(screen.queryByTestId("cell-editor-target")).toBeNull();
  });

  it("opens the editor on double-click when editable", () => {
    render(
      <EditableCell
        col={textCol}
        value="Eve"
        readOnly={false}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        variant="cell"
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("cell-editor-target"));
    expect(screen.getByTestId("cell-editor")).toBeInTheDocument();
  });

  it("renders no edit affordance for a primary-key cell", () => {
    render(
      <EditableCell
        col={{
          name: "id",
          dataTypeId: 23,
          dataType: "int4",
          isNullable: false,
        }}
        value={1}
        readOnly={false}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        variant="cell"
      />,
    );
    expect(screen.queryByTestId("cell-editor-target")).toBeNull();
    expect(screen.queryByTestId("cell-editor")).toBeNull();
  });

  it("hides Set NULL when the column is not nullable", () => {
    render(
      <EditableCell
        col={{ ...textCol, isNullable: false }}
        value="Frank"
        readOnly={false}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        variant="cell"
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("cell-editor-target"));
    expect(screen.queryByText("Set NULL")).toBeNull();
  });
});

describe("EditableCell enum editor", () => {
  const enumCol: ColumnInfo = {
    name: "role",
    dataTypeId: 99999,
    dataType: "user_role",
    enumPgCast: '"app"."user_role"',
    enumLabels: ["admin", "editor", "viewer"],
  };

  it("renders a <select> with the enum labels when the column is an enum", () => {
    render(
      <EditableCell
        col={enumCol}
        value="viewer"
        readOnly={false}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        variant="cell"
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("cell-editor-target"));
    const select = screen.getByTestId("cell-enum-select") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const options = Array.from(select.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toEqual(["admin", "editor", "viewer"]);
    expect(select.value).toBe("viewer");
    expect(select).toHaveClass("bg-background", "text-foreground");
  });

  it("falls back to the first label when the current value is null", () => {
    render(
      <EditableCell
        col={enumCol}
        value={null}
        readOnly={false}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        variant="cell"
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("cell-editor-target"));
    const select = screen.getByTestId("cell-enum-select") as HTMLSelectElement;
    expect(select.value).toBe("admin");
  });
});

describe("EditableCell boolean editor", () => {
  const boolCol: ColumnInfo = {
    name: "is_verified",
    dataTypeId: 16,
    dataType: "bool",
  };

  it("renders a themed toggle for boolean columns", () => {
    render(
      <EditableCell
        col={boolCol}
        value={true}
        readOnly={false}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        variant="cell"
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("cell-editor-target"));
    expect(screen.getByTestId("cell-bool-toggle")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /toggle boolean value/i }),
    ).toHaveAttribute("data-state", "checked");
    expect(screen.getByText("True")).toBeInTheDocument();
  });

  it("reflects false values in the toggle state", () => {
    render(
      <EditableCell
        col={boolCol}
        value={false}
        readOnly={false}
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        variant="cell"
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("cell-editor-target"));
    expect(
      screen.getByRole("switch", { name: /toggle boolean value/i }),
    ).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByText("False")).toBeInTheDocument();
  });
});

describe("EditableCell read-only-mode DOM contract", () => {
  it("matches the DOM of the plain display renderer exactly when readOnly=true", () => {
    const plain = render(
      <>
        {/* What a read-only renderer would emit directly. */}
        {"Alice"}
      </>,
    );
    const plainHtml = plain.container.innerHTML;
    plain.unmount();

    const gated = render(
      <EditableCell
        col={textCol}
        value="Alice"
        readOnly
        primaryKey={["id"]}
        pkValues={[1]}
        schema="app"
        table="users"
        connectionId="c1"
        variant="cell"
      />,
    );
    // A truly read-only cell introduces no wrapping element around the
    // renderer output. This snapshot guard catches accidental regressions
    // (e.g. someone wraps the display in a <button> unconditionally).
    expect(gated.container.innerHTML).toBe(plainHtml);
  });
});
