/**
 * Searchable dropdown for foreign-key columns.
 *
 * Two surfaces consume this:
 *
 *   1. `ForeignKeyPicker` — the headless-ish core: search input + scrollable
 *      result list.  Reports selection via `onPick(value, label)` and
 *      `onSetNull()`.  No save/cancel buttons; the host wires those.
 *
 *   2. `ForeignKeyModalEditor` — adapts the picker to the `TypeEditor`'s
 *      modal `Component` contract used by `EditableCell`: takes
 *      `initialValue` / `onSave` / `onCancel`, renders Save and Cancel
 *      buttons, and emits an `EditResult` to the host.
 *
 * `RowEditDialog` consumes `ForeignKeyPicker` directly inline and threads
 * picked values into its draft state.
 *
 * Search debounces at 200ms and cancels stale requests by tracking the
 * latest request id (no AbortController plumbing across IPC needed).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search as SearchIcon, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type {
  ForeignKeyOption,
  ForeignKeyRef,
} from "@/shared/types/table-data";
import type { EditResult, TypeEditorProps } from "./edit-registry";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 50;

interface ForeignKeyPickerProps {
  /** Currently-selected value (the FK value on the child row). */
  currentValue: unknown;
  /** Optional currently-selected label, for display only. */
  currentLabel?: string | null;
  foreignKey: ForeignKeyRef;
  connectionId: string;
  /** When true, Set NULL is offered. */
  allowNull: boolean;
  /** Called when the user picks an option. */
  onPick: (value: unknown, label: string | null) => void;
  /** Called when the user picks Set NULL. */
  onSetNull?: () => void;
  /** Optional escape hatch — host can swap to a plain editor. */
  onUseRaw?: () => void;
}

export function ForeignKeyPicker(props: Readonly<ForeignKeyPickerProps>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ForeignKeyOption[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const performSearch = useCallback(
    async (q: string) => {
      const myId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const response = await globalThis.window.tableDataApi.searchForeignKey({
          connectionId: props.connectionId,
          schema: props.foreignKey.schema,
          table: props.foreignKey.table,
          valueColumn: props.foreignKey.column,
          labelColumn: props.foreignKey.labelColumn,
          query: q,
          limit: SEARCH_LIMIT,
        });
        // Stale response — a newer search has fired; drop this one.
        if (myId !== requestIdRef.current) return;

        if (!response.success || !response.data) {
          setResults([]);
          setHasMore(false);
          setError(response.error ?? "Search failed");
          return;
        }
        setResults(response.data.options);
        setHasMore(response.data.hasMore);
      } catch (err) {
        if (myId !== requestIdRef.current) return;
        setError((err as Error).message);
        setResults([]);
        setHasMore(false);
      } finally {
        if (myId === requestIdRef.current) setLoading(false);
      }
    },
    [
      props.connectionId,
      props.foreignKey.schema,
      props.foreignKey.table,
      props.foreignKey.column,
      props.foreignKey.labelColumn,
    ],
  );

  // Debounced search.
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      void performSearch(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => globalThis.clearTimeout(timer);
  }, [query, performSearch]);

  return (
    <div className="flex flex-col gap-2" data-testid="fk-picker">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            props.foreignKey.labelColumn
              ? `Search ${props.foreignKey.table} by ${props.foreignKey.labelColumn} or ${props.foreignKey.column}…`
              : `Search ${props.foreignKey.table} by ${props.foreignKey.column}…`
          }
          className="pl-7 font-mono text-xs"
          data-testid="fk-search-input"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            {props.foreignKey.schema}.{props.foreignKey.table}
          </span>
          <span>
            {props.foreignKey.labelColumn
              ? `${props.foreignKey.labelColumn} · ${props.foreignKey.column}`
              : props.foreignKey.column}
          </span>
        </div>

        <ul className="max-h-72 overflow-y-auto" data-testid="fk-result-list">
          {props.allowNull ? (
            <li>
              <button
                type="button"
                onClick={() => props.onSetNull?.()}
                data-testid="fk-option-null"
                className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <span>(NULL)</span>
                <span className="font-sans text-[11px] text-subtle-foreground">
                  no reference
                </span>
              </button>
            </li>
          ) : null}

          {loading && results.length === 0 ? (
            <li className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Searching…
            </li>
          ) : null}

          {!loading && error ? (
            <li className="px-3 py-3 text-xs text-destructive-foreground">
              {error}
            </li>
          ) : null}

          {!loading && !error && results.length === 0 ? (
            <li className="px-3 py-3 text-xs text-muted-foreground">
              No matches.
            </li>
          ) : null}

          {results.map((opt, idx) => {
            const isCurrent = sameValue(opt.value, props.currentValue);
            return (
              <li key={`${String(opt.value)}-${String(idx)}`}>
                <button
                  type="button"
                  onClick={() => props.onPick(opt.value, opt.label)}
                  data-testid={`fk-option-${String(opt.value)}`}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 ${
                    isCurrent ? "bg-accent" : ""
                  }`}
                >
                  <span className="truncate">
                    {opt.label !== null ? (
                      <span className="font-medium">{opt.label}</span>
                    ) : (
                      <span className="text-muted-foreground">no label</span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {String(opt.value)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {hasMore ? (
          <div className="border-t border-border px-3 py-1.5 text-[11px] text-subtle-foreground">
            Showing {SEARCH_LIMIT} matches — refine your search to narrow
            further.
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Current:{" "}
          <span className="font-mono">
            {props.currentValue === null || props.currentValue === undefined
              ? "NULL"
              : String(props.currentValue)}
          </span>
          {props.currentLabel ? (
            <span className="ml-1">({props.currentLabel})</span>
          ) : null}
        </span>
        {props.onUseRaw ? (
          <button
            type="button"
            onClick={props.onUseRaw}
            className="text-[11px] underline-offset-2 hover:underline"
            data-testid="fk-use-raw"
          >
            Use raw value…
          </button>
        ) : null}
      </div>
    </div>
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined)
    return false;
  return String(a) === String(b);
}

// ---------------------------------------------------------------------------
// Modal adapter for `EditableCell` (kind: 'modal' Component).
// ---------------------------------------------------------------------------

interface ForeignKeyModalEditorProps extends TypeEditorProps {
  foreignKey: ForeignKeyRef;
  connectionId: string;
  allowNull: boolean;
}

export function ForeignKeyModalEditor(
  props: Readonly<ForeignKeyModalEditorProps>,
) {
  return (
    <div className="flex flex-col gap-3">
      <ForeignKeyPicker
        currentValue={props.initialValue}
        foreignKey={props.foreignKey}
        connectionId={props.connectionId}
        allowNull={props.allowNull}
        onPick={(value) => {
          const result: EditResult = {
            value,
            pgCast: props.foreignKey.valuePgCast,
          };
          props.onSave(result);
        }}
        onSetNull={() => {
          // The cell host treats `value: null` + the column's pgCast as the
          // FK editor's NULL signal; the wider Set-NULL switch lives in the
          // EditableCell's footer.  Emitting null here keeps the modal flow
          // simple and lets the server enforce nullability.
          const result: EditResult = {
            value: null,
            pgCast: props.foreignKey.valuePgCast,
          };
          props.onSave(result);
        }}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
