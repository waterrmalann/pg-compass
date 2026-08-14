import { useEffect, useRef } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { Compartment, EditorState } from "@codemirror/state";
import { keymap, EditorView, lineNumbers } from "@codemirror/view";
import { pgTheme } from "@/components/sql-editor/pg-theme";

export function isStructuredEditType(pgType: string): boolean {
  return pgType === "json" || pgType === "jsonb" || pgType.startsWith("_");
}

export function StructuredValueEditor({
  value,
  onChange,
  disabled,
  ariaLabel,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editableCompartment = useRef(new Compartment());
  const ariaLabelCompartment = useRef(new Compartment());

  // Mount-only: the view is created once and never torn down for prop
  // changes, so an in-progress edit survives `disabled` toggling (e.g. while
  // a save is pending) instead of reverting to the value captured at mount.
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          lineNumbers(),
          history(),
          json(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          ...pgTheme,
          editableCompartment.current.of(EditorView.editable.of(!disabled)),
          ariaLabelCompartment.current.of(
            EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            "&": { minHeight: "8rem", maxHeight: "20rem" },
            ".cm-scroller": { overflow: "auto", fontSize: "12px" },
            ".cm-content": { minHeight: "8rem" },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; disabled/ariaLabel are reconfigured via compartments below
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.current.reconfigure(
        EditorView.editable.of(!disabled),
      ),
    });
  }, [disabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: ariaLabelCompartment.current.reconfigure(
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      ),
    });
  }, [ariaLabel]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div
      ref={hostRef}
      className="overflow-hidden rounded-md border border-input bg-background"
      data-structured-editor
    />
  );
}
