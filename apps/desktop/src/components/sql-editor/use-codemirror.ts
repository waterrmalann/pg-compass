import { useEffect, useRef, useMemo } from 'react';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { sql, PostgreSQL, type SQLNamespace } from '@codemirror/lang-sql';
import { autocompletion, type Completion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { linter, type Diagnostic } from '@codemirror/lint';
import { pgTheme } from './pg-theme';

export interface CompletionColumn {
  name: string;
  type?: string;
}

export interface CompletionSchema {
  schemas: string[];
  tables: Record<string, string[]>;
  columns: Record<string, CompletionColumn[]>;
  /** When set, columns of this table are completed at the top level. */
  defaultTable?: string;
  /** When set, tables of this schema are completed at the top level. */
  defaultSchema?: string;
}

interface UseCodemirrorOptions {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  schema?: CompletionSchema;
  singleLine?: boolean;
  readOnly?: boolean;
}

/** PostgreSQL identifiers need double-quoting when they aren't simple lowercase. */
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function buildColumnCompletions(cols: CompletionColumn[]): (string | Completion)[] {
  return cols.map((col) => {
    const needsQuote = !SAFE_IDENT.test(col.name);
    if (!needsQuote && !col.type) return col.name;
    return {
      label: col.name,
      type: 'property',
      ...(needsQuote && { apply: `"${col.name}"` }),
      ...(col.type && { detail: col.type }),
    } as Completion;
  });
}

/**
 * Transforms our CompletionSchema into a nested SQLNamespace for @codemirror/lang-sql.
 * Uses Completion objects to auto-quote identifiers and show column types.
 */
function buildSqlNamespace(schema?: CompletionSchema): SQLNamespace {
  if (!schema) return {};

  const ns: Record<string, SQLNamespace> = {};

  for (const schemaName of schema.schemas) {
    const schemaTables = schema.tables[schemaName] ?? [];
    const tableMap: Record<string, SQLNamespace> = {};

    for (const tableName of schemaTables) {
      const qualifiedKey = `${schemaName}.${tableName}`;
      const rawCols = schema.columns[qualifiedKey] ?? [];
      const colCompletions = buildColumnCompletions(rawCols);

      const needsQuote = !SAFE_IDENT.test(tableName);
      if (needsQuote) {
        tableMap[tableName] = {
          self: { label: tableName, type: 'type', apply: `"${tableName}"` },
          children: colCompletions,
        };
      } else {
        tableMap[tableName] = colCompletions;
      }
    }

    const needsQuote = !SAFE_IDENT.test(schemaName);
    if (needsQuote) {
      ns[schemaName] = {
        self: { label: schemaName, type: 'namespace', apply: `"${schemaName}"` },
        children: tableMap,
      };
    } else {
      ns[schemaName] = tableMap;
    }
  }

  return ns;
}

/**
 * Linter that flags double-quoted strings used as values in SQL.
 * In PostgreSQL, double quotes are for identifiers ("column_name"),
 * while single quotes are for string values ('hello').
 * Detects patterns like: = "value", <> "value", LIKE "value", IN ("a", "b")
 */
const VALUE_POSITION_PATTERN =
  /(?:=|<>|!=|>=?|<=?|LIKE|ILIKE|SIMILAR\s+TO|IN\s*\()\s*"([^"]*)"|(,)\s*"([^"]*)"/gi;

const sqlValueQuoteLinter = linter((view) => {
  const doc = view.state.doc.toString();
  const diagnostics: Diagnostic[] = [];

  let match: RegExpExecArray | null;
  VALUE_POSITION_PATTERN.lastIndex = 0;
  while ((match = VALUE_POSITION_PATTERN.exec(doc)) !== null) {
    // Find the double-quoted portion within the match
    const fullMatch = match[0];
    // The quoted string starts at the last " in the prefix up to the closing "
    const quoteStart = match.index + fullMatch.lastIndexOf('"', fullMatch.length - 2);
    const quoteEnd = match.index + fullMatch.length;
    const innerValue = match[1] ?? match[3] ?? '';

    diagnostics.push({
      from: quoteStart,
      to: quoteEnd,
      severity: 'warning',
      message: `Use single quotes for string values: '${innerValue}' instead of "${innerValue}".\nDouble quotes are for identifiers in PostgreSQL.`,
      actions: [
        {
          name: 'Fix: use single quotes',
          apply: (view, from, to) => {
            view.dispatch({
              changes: { from, to, insert: `'${innerValue}'` },
            });
          },
        },
      ],
    });
  }

  return diagnostics;
});

export function useCodemirror(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseCodemirrorOptions,
) {
  const {
    value,
    onChange,
    onSubmit,
    placeholder,
    schema,
    singleLine = false,
    readOnly = false,
  } = options;

  // Stable refs to avoid recreating the editor when callbacks change
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const viewRef = useRef<EditorView | null>(null);
  const sqlCompartment = useRef(new Compartment());

  const sqlNamespace = useMemo(() => buildSqlNamespace(schema), [schema]);
  const defaultTable = schema?.defaultTable;
  const defaultSchema = schema?.defaultSchema;

  // Create the editor once on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const submitKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onSubmitRef.current?.();
          return true;
        },
      },
    ]);

    const singleLineKeymap = singleLine
      ? keymap.of([
          {
            key: 'Enter',
            run: () => true, // consume Enter to prevent newlines, but autocomplete still works
          },
        ])
      : [];

    const extensions: Extension[] = [
      pgTheme,
      history(),
      autocompletion({
        activateOnTyping: true,
      }),
      highlightSelectionMatches(),
      submitKeymap,
      singleLineKeymap,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      sqlCompartment.current.of(
        sql({
          dialect: PostgreSQL,
          upperCaseKeywords: true,
          schema: sqlNamespace,
          defaultTable,
          defaultSchema,
        }),
      ),
      sqlValueQuoteLinter,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const doc = update.state.doc.toString();
          onChangeRef.current(doc);
        }
      }),
      EditorState.readOnly.of(readOnly),
    ];

    if (!singleLine) {
      extensions.push(lineNumbers());
    }

    if (placeholder) {
      extensions.push(cmPlaceholder(placeholder));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: container,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only run on mount — value synced via separate effect
  }, [containerRef, singleLine, readOnly]);

  // Sync external value → CM state (only when value differs from CM doc)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: value,
        },
      });
    }
  }, [value]);

  // Reconfigure SQL language when schema changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: sqlCompartment.current.reconfigure(
        sql({
          dialect: PostgreSQL,
          upperCaseKeywords: true,
          schema: sqlNamespace,
          defaultTable,
          defaultSchema,
        }),
      ),
    });
  }, [sqlNamespace, defaultTable, defaultSchema]);

  return viewRef;
}
