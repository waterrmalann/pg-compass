import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { RowEditButton } from "@/components/workspace/table-viewer/row-edit-button";
import { registerDefaultRenderers } from "@/components/workspace/renderers/default-renderers";
import { registerDefaultEditors } from "@/components/workspace/renderers/edit-registry";
import type { ColumnInfo } from "@/shared/types/table-data";

beforeAll(() => {
  registerDefaultRenderers();
  registerDefaultEditors();
});

const columns: ColumnInfo[] = [
  { name: "id", dataTypeId: 23, dataType: "int4" },
  { name: "display_name", dataTypeId: 25, dataType: "text" },
];

const row = { id: 1, display_name: "Alice" };

describe("RowEditButton gating", () => {
  it("renders nothing when readOnly=true", () => {
    const { container } = render(
      <RowEditButton
        columns={columns}
        row={row}
        readOnly
        primaryKey={["id"]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
      />,
    );
    expect(screen.queryByTestId("row-edit-button")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when primaryKey is null", () => {
    const { container } = render(
      <RowEditButton
        columns={columns}
        row={row}
        readOnly={false}
        primaryKey={null}
        schema="app"
        table="active_users"
        connectionId="c1"
        onRowUpdated={() => {}}
      />,
    );
    expect(screen.queryByTestId("row-edit-button")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when primaryKey is an empty array", () => {
    const { container } = render(
      <RowEditButton
        columns={columns}
        row={row}
        readOnly={false}
        primaryKey={[]}
        schema="app"
        table="notes"
        connectionId="c1"
        onRowUpdated={() => {}}
      />,
    );
    expect(screen.queryByTestId("row-edit-button")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders the icon when both gates clear", () => {
    render(
      <RowEditButton
        columns={columns}
        row={row}
        readOnly={false}
        primaryKey={["id"]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
      />,
    );
    const btn = screen.getByTestId("row-edit-button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", "Edit row");
  });

  it("opens the dialog on click", () => {
    render(
      <RowEditButton
        columns={columns}
        row={row}
        readOnly={false}
        primaryKey={["id"]}
        schema="app"
        table="users"
        connectionId="c1"
        onRowUpdated={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("row-edit-button"));
    expect(screen.getByTestId("row-editor")).toBeInTheDocument();
  });
});
