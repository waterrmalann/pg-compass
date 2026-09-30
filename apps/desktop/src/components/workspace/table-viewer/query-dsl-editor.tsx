import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { fieldClassName } from "@/components/ui/input";
import { pgSingleLineTheme, pgTheme } from "@/components/sql-editor/pg-theme";
import { cn } from "@/lib/utils";
import { getShortcut } from "@/shared/constants/shortcuts";
import { DSL_KEYWORDS } from "@/shared/query-dsl/parser";
import type {
  QueryColumnMetadata,
  QueryDslError,
  QueryDslField,
} from "@/shared/query-dsl/types";
import { suggestDslCompletions } from "./query-dsl-completion";

/** Highlighting only; the shared tokenizer and parser do the real work. */
const dslLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^'(?:[^']|'')*'?/)) return "string";
    if (stream.match(/^"(?:[^"]|"")*"?/)) return "propertyName";
    if (stream.match(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)) {
      return "number";
    }
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_$]*/) as
      | RegExpMatchArray
      | null
      | boolean;
    if (Array.isArray(word)) {
      const upper = word[0].toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") return "bool";
      if (upper === "NULL") return "null";
      return DSL_KEYWORDS.has(upper) ? "keyword" : "propertyName";
    }
    if (stream.match(/^(?:>=|<=|<>|!=|[=<>])/)) return "operator";
    stream.next();
    return "punctuation";
  },
});

/** Pasted or programmatic newlines become spaces: the fields are single-line. */
const singleLineFilter = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || transaction.newDoc.lines === 1) {
    return transaction;
  }
  const flattened = transaction.newDoc.toString().replace(/\r?\n|\r/g, " ");
  return [
    transaction,
    {
      changes: { from: 0, to: transaction.newDoc.length, insert: flattened },
      sequential: true,
    },
  ];
});

interface QueryDslEditorProps {
  field: QueryDslField;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  ariaLabel: string;
  columns: QueryColumnMetadata[];
  /** Errors for this field from the last Apply; ranges are marked in place. */
  errors: QueryDslError[];
  /** Id of the element describing the current error, for aria-describedby. */
  errorId?: string;
  className?: string;
}

/**
 * Single-line CodeMirror editor for one Data-tab DSL field. Deliberately
 * separate from `SqlEditor` so SQL parsing, completion and lint rules cannot
 * leak into the restricted grammar.
 */
export function QueryDslEditor({
  field,
  value,
  onChange,
  onSubmit,
  placeholder,
  ariaLabel,
  columns,
  errors,
  errorId,
  className,
}: Readonly<QueryDslEditorProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const initialValueRef = useRef(value);
  const attributesCompartment = useRef(new Compartment());
  const placeholderCompartment = useRef(new Compartment());
  const initialPlaceholderRef = useRef(placeholder);

  const hasErrors = errors.length > 0;

  useEffect(
    function createEditor() {
      const container = containerRef.current;
      if (!container) return;

      function completionSource(
        context: CompletionContext,
      ): CompletionResult | null {
        const before = context.state.doc.sliceString(0, context.pos);
        const result = suggestDslCompletions(field, before, columnsRef.current);
        if (!result) return null;
        const typedSomething = result.from < context.pos;
        if (!typedSomething && !context.explicit) {
          // Open automatically after a separator, not on every keystroke.
          const previous = before.at(-1) ?? "";
          if (!/[\s(,]/.test(previous) && before.length > 0) return null;
        }
        return {
          from: result.from,
          // Keep the suggested order (catalog columns, then operators from
          // most to least common) instead of alphabetical.
          options: result.options.map((option, index) => ({
            ...option,
            boost: Math.max(-99, -index),
          })),
          validFor: /^(?:"(?:[^"]|"")*|[A-Za-z_][A-Za-z0-9_$]*)$/,
        };
      }

      const submit = () => {
        onSubmitRef.current();
        return true;
      };

      const view = new EditorView({
        parent: container,
        state: EditorState.create({
          doc: initialValueRef.current,
          extensions: [
            pgTheme,
            Prec.high(pgSingleLineTheme),
            dslLanguage,
            history(),
            singleLineFilter,
            autocompletion({ override: [completionSource], icons: false }),
            // The completion keymap runs at a higher precedence, so Enter
            // accepts an open completion and only applies otherwise.
            keymap.of([
              { key: "Enter", run: submit },
              { key: getShortcut("run-query").codeMirrorKey, run: submit },
            ]),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            placeholderCompartment.current.of(
              cmPlaceholder(initialPlaceholderRef.current),
            ),
            attributesCompartment.current.of([]),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onChangeRef.current(update.state.doc.toString());
              }
            }),
          ],
        }),
      });
      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
    },
    [field],
  );

  useEffect(
    function syncExternalValue() {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    },
    [value],
  );

  useEffect(
    function syncPlaceholder() {
      viewRef.current?.dispatch({
        effects: placeholderCompartment.current.reconfigure(
          cmPlaceholder(placeholder),
        ),
      });
    },
    [placeholder],
  );

  useEffect(
    function syncAccessibility() {
      const attributes: Record<string, string> = {
        "aria-label": ariaLabel,
        "aria-invalid": hasErrors ? "true" : "false",
      };
      if (hasErrors && errorId) attributes["aria-describedby"] = errorId;
      viewRef.current?.dispatch({
        effects: attributesCompartment.current.reconfigure(
          EditorView.contentAttributes.of(attributes),
        ),
      });
    },
    [ariaLabel, errorId, hasErrors],
  );

  useEffect(
    function markErrorRanges() {
      const view = viewRef.current;
      if (!view) return;
      const length = view.state.doc.length;
      const diagnostics: Diagnostic[] = errors.map((error) => {
        const from = Math.min(error.from, length);
        // Zero-width ranges (e.g. "expected a value" at the end) still get
        // a visible mark by covering the previous character.
        const to = Math.min(Math.max(error.to, from), length);
        const visibleFrom = from === to && from > 0 ? from - 1 : from;
        return {
          from: visibleFrom,
          to,
          severity: "error",
          message: error.message,
        };
      });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
    [errors],
  );

  return (
    <div
      ref={containerRef}
      data-testid={`query-dsl-${field}`}
      aria-invalid={hasErrors || undefined}
      className={cn(
        fieldClassName,
        "overflow-hidden focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/24 dark:focus-within:shadow-none dark:focus-within:ring-ring/48",
        hasErrors &&
          "border-destructive/36 ring-2 ring-destructive/16 dark:ring-destructive/24",
        className,
      )}
      style={{ minHeight: "32px" }}
    />
  );
}
