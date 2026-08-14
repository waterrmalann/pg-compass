import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  editRegistry,
  registerDefaultEditors,
} from "@/components/workspace/renderers/edit-registry";
import { DateTimeEditor } from "@/components/workspace/renderers/date-time-editor";
import { StructuredValueEditor } from "@/components/workspace/renderers/structured-value-editor";
import { DataTab } from "@/components/workspace/table-viewer/data-tab";

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({ schemaCache: {} }),
}));
vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ settings: { general: { readOnlyMode: true } } }),
}));
vi.mock("@/components/sql-editor/sql-editor", () => ({
  SqlEditor: () => <div />,
}));
vi.mock("@/components/workspace/export-dropdown", () => ({
  ExportDropdown: () => null,
}));
vi.mock("@/components/workspace/table-viewer/table-data-view", () => ({
  TableDataView: ({ rows }: { rows: unknown[] }) => (
    <div>visible rows: {rows.length}</div>
  ),
}));
vi.mock("@/components/workspace/table-viewer/card-data-view", () => ({
  CardDataView: () => null,
}));
vi.mock("@/components/workspace/table-viewer/delete-data-dialog", () => ({
  DeleteDataDialog: () => null,
}));

describe("edit registry local date/timestamp inputs", () => {
  // `pg` builds date/timestamp Dates from LOCAL fields; a zone east of UTC
  // makes a UTC-based read shift the value back by a day.
  beforeAll(() => {
    vi.stubEnv("TZ", "Asia/Kolkata");
    registerDefaultEditors();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("reads a date from its local calendar fields", () => {
    const localMidnight = new Date(2024, 0, 5);
    // Guard: the zone override must be active for this test to mean anything.
    expect(localMidnight.getTimezoneOffset()).toBe(-330);

    expect(editRegistry.get("date").toInput(localMidnight)).toBe("2024-01-05");
  });

  it("reads a timestamp without time zone from its local fields", () => {
    const local = new Date(2024, 0, 5, 0, 15, 30, 120);

    expect(editRegistry.get("timestamp").toInput(local)).toBe(
      "2024-01-05T00:15:30.120",
    );
  });

  it("omits zero milliseconds from a local timestamp", () => {
    const local = new Date(2024, 11, 31, 23, 59, 59);

    expect(editRegistry.get("timestamp").toInput(local)).toBe(
      "2024-12-31T23:59:59",
    );
  });

  it("keeps timestamptz as an absolute UTC instant", () => {
    const instant = new Date("2024-01-05T00:15:30.000Z");

    expect(editRegistry.get("timestamptz").toInput(instant)).toBe(
      "2024-01-05T00:15:30.000Z",
    );
  });
});

describe("DateTimeEditor timezone", () => {
  function ControlledEditor({
    initial,
    onChange,
  }: Readonly<{ initial: string; onChange: (value: string) => void }>) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <button type="button" onClick={() => setValue(initial)}>
          Revert
        </button>
        <button type="button" onClick={() => setValue("2024-01-05T10:00:00Z")}>
          Set UTC
        </button>
        <DateTimeEditor
          pgType="timestamptz"
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      </>
    );
  }

  it("derives the offset from the current value, including external changes", () => {
    const onChange = vi.fn();
    render(
      <ControlledEditor
        initial="2024-01-05T10:00:00+05:30"
        onChange={onChange}
      />,
    );
    const offset = screen.getByLabelText("Timezone offset");
    expect(offset).toHaveValue("+05:30");

    fireEvent.click(screen.getByRole("button", { name: "Set UTC" }));
    expect(offset).toHaveValue("Z");

    fireEvent.change(screen.getByLabelText("timestamptz picker"), {
      target: { value: "2024-01-06T08:30:00" },
    });
    expect(onChange).toHaveBeenLastCalledWith("2024-01-06T08:30:00Z");
  });

  it("follows a revert back to the original offset", () => {
    const onChange = vi.fn();
    render(
      <ControlledEditor
        initial="2024-01-05T10:00:00+05:30"
        onChange={onChange}
      />,
    );
    const offset = screen.getByLabelText("Timezone offset");

    fireEvent.change(offset, { target: { value: "-05:00" } });
    expect(onChange).toHaveBeenLastCalledWith("2024-01-05T10:00:00-05:00");
    expect(offset).toHaveValue("-05:00");

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(offset).toHaveValue("+05:30");
  });
});

describe("StructuredValueEditor", () => {
  function ControlledJson({ disabled }: Readonly<{ disabled: boolean }>) {
    const [value, setValue] = useState('{"a":1}');
    return (
      <StructuredValueEditor
        value={value}
        onChange={setValue}
        disabled={disabled}
        ariaLabel="payload"
      />
    );
  }

  it("keeps an in-progress edit and the same editor when disabled toggles", () => {
    const { container, rerender } = render(<ControlledJson disabled={false} />);
    const editorDom = container.querySelector<HTMLElement>(".cm-editor");
    expect(editorDom).not.toBeNull();
    const view = EditorView.findFromDOM(editorDom!);
    expect(view).not.toBeNull();

    act(() => {
      view!.dispatch({
        changes: { from: 0, to: view!.state.doc.length, insert: '{"a":2}' },
      });
    });
    rerender(<ControlledJson disabled />);

    expect(container.querySelector(".cm-editor")).toBe(editorDom);
    expect(view!.state.doc.toString()).toBe('{"a":2}');
    expect(
      container.querySelector(".cm-content")?.getAttribute("contenteditable"),
    ).toBe("false");

    rerender(<ControlledJson disabled={false} />);
    expect(view!.state.doc.toString()).toBe('{"a":2}');
    expect(
      container.querySelector(".cm-content")?.getAttribute("contenteditable"),
    ).toBe("true");
  });
});

describe("DataTab loading state", () => {
  it("clears the spinner when a background refresh supersedes a pending foreground load", async () => {
    Object.assign(window, {
      tableDataApi: {
        getRows: vi
          .fn()
          // Initial foreground load never resolves (e.g. a slow query).
          .mockImplementationOnce(() => new Promise(() => undefined))
          .mockResolvedValueOnce({
            success: true,
            data: {
              columns: [{ name: "id", dataType: "int4", dataTypeId: 23 }],
              rows: [{ id: 1 }],
              totalCount: 1,
              primaryKey: ["id"],
            },
          }),
      },
    });
    const view = render(
      <DataTab
        connectionId="conn-1"
        schema="app"
        table="users"
        relationType="table"
        refreshSignal={0}
      />,
    );

    view.rerender(
      <DataTab
        connectionId="conn-1"
        schema="app"
        table="users"
        relationType="table"
        refreshSignal={1}
      />,
    );

    expect(await screen.findByText("visible rows: 1")).toBeVisible();
    expect(window.tableDataApi.getRows).toHaveBeenCalledTimes(2);
  });
});
