import { act, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { forEachDiagnostic } from "@codemirror/lint";
import { describe, expect, it, vi } from "vitest";
import { QueryDslEditor } from "@/components/workspace/table-viewer/query-dsl-editor";
import type { QueryDslError } from "@/shared/query-dsl/types";

function renderEditor(errors: QueryDslError[] = [], value = "id >=") {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const view = render(
    <QueryDslEditor
      field="filter"
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder="Filter"
      ariaLabel="Filter"
      columns={[]}
      errors={errors}
      errorId="filter-error"
    />,
  );
  const container = view.getByTestId("query-dsl-filter");
  const editorView = EditorView.findFromDOM(
    container.querySelector(".cm-editor") as HTMLElement,
  )!;
  return { onChange, onSubmit, editorView, container, view };
}

describe("QueryDslEditor", () => {
  it("labels the editor and marks error ranges accessibly", () => {
    const error: QueryDslError = {
      code: "expected-value",
      field: "filter",
      message: 'Expected a value after ">="',
      from: 5,
      to: 5,
    };
    const { editorView, container } = renderEditor([error]);

    const content = container.querySelector(".cm-content")!;
    expect(content).toHaveAttribute("aria-label", "Filter");
    expect(content).toHaveAttribute("aria-invalid", "true");
    expect(content).toHaveAttribute("aria-describedby", "filter-error");

    const marked: { from: number; to: number; message: string }[] = [];
    forEachDiagnostic(editorView.state, (diagnostic, from, to) => {
      marked.push({ from, to, message: diagnostic.message });
    });
    // Zero-width ranges at the end widen to the previous character.
    expect(marked).toEqual([
      { from: 4, to: 5, message: 'Expected a value after ">="' },
    ]);
  });

  it("applies on Enter and on the run shortcut", () => {
    const { editorView, onSubmit } = renderEditor();
    const press = (init: KeyboardEventInit) =>
      editorView.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ...init }),
      );
    act(() => {
      press({ key: "Enter" });
      press({ key: "Enter", ctrlKey: true });
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("flattens pasted newlines into spaces", () => {
    const { editorView, onChange } = renderEditor([], "");
    act(() => {
      editorView.dispatch({
        changes: { from: 0, insert: "id = 1\nOR id = 2" },
      });
    });
    expect(editorView.state.doc.toString()).toBe("id = 1 OR id = 2");
    expect(onChange).toHaveBeenLastCalledWith("id = 1 OR id = 2");
  });
});
