/**
 * Multi-field row editor — a dialog that lets the user edit any subset of a
 * row's columns and Save them as one atomic UPDATE, or (in `insert` mode) fill
 * in a brand-new row and INSERT it.
 *
 * Composes over the Phase 1 edit registry: each column reuses its registered
 * `TypeEditor` for `toInput` / `validate` / `pgCast`, so type rules stay in a
 * single place. In `edit` mode PK columns render read-only (we do not allow PK
 * mutation); in `insert` mode every column is editable and any untouched field
 * is omitted from the statement so the database default applies.
 */

import { useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type {
  EditValidation,
  TypeEditor,
} from "@/components/workspace/renderers/edit-registry";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  ColumnInfo,
  UpdateRowFieldChange,
} from "@/shared/types/table-data";
import {
  editorFor,
  FieldEditor,
  formatPrimaryKeyValue,
  PrimaryKeyValue,
  type FieldDraft,
} from "./row-field-editor";

export type RowEditorMode = "edit" | "insert";

export interface RowEditDialogProps {
  columns: ColumnInfo[];
  /** Current values (edit mode). Omit / pass `{}` for insert mode. */
  row?: Record<string, unknown>;
  /** PK columns — locked in edit mode, editable in insert mode. */
  primaryKey: string[];
  /** PK values, edit mode only. */
  pkValues?: unknown[];
  schema: string;
  table: string;
  connectionId: string;
  /** `edit` (default) sends an UPDATE; `insert` sends an INSERT. */
  mode?: RowEditorMode;
  /** Called with the saved row (from `RETURNING *`). */
  onRowUpdated: (row: Record<string, unknown>) => void;
  onClose: () => void;
}

const EMPTY_ROW: Record<string, unknown> = {};

export function RowEditDialog(props: Readonly<RowEditDialogProps>) {
  const mode: RowEditorMode = props.mode ?? "edit";
  const isInsert = mode === "insert";
  const row = props.row ?? EMPTY_ROW;

  const pkSet = useMemo(() => new Set(props.primaryKey), [props.primaryKey]);

  // In insert mode every column is editable; in edit mode PK columns are locked.
  const editableColumns = isInsert
    ? props.columns
    : props.columns.filter((c) => !pkSet.has(c.name));

  const editors = useMemo(() => {
    const map = new Map<string, TypeEditor>();
    for (const col of editableColumns) {
      map.set(col.name, editorFor(col));
    }
    return map;
  }, [editableColumns]);

  const initialInputs = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of editableColumns) {
      map.set(col.name, editors.get(col.name)!.toInput(row[col.name]));
    }
    return map;
  }, [editableColumns, editors, row]);

  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  /**
   * Whether a column carries a value to send. Insert mode: any touched draft,
   * including an empty string or explicit NULL. Edit mode: a draft that differs from the
   * original (or a NULL on a column that wasn't already NULL).
   */
  function isFieldSet(col: string, draft: FieldDraft | undefined): boolean {
    if (draft === undefined) return false;
    if (isInsert) {
      return true;
    }
    if (draft.setNull) {
      return row[col] !== null && row[col] !== undefined;
    }
    return draft.raw !== initialInputs.get(col);
  }

  const changedColumns = Object.entries(drafts).filter(([col, draft]) =>
    isFieldSet(col, draft),
  );
  const changeCount = changedColumns.length;

  function setDraftRaw(col: string, raw: string) {
    setDrafts((prev) => ({
      ...prev,
      [col]: { raw, setNull: false },
    }));
    setErrors((prev) => ({ ...prev, [col]: null }));
  }

  function setDraftNull(col: string) {
    const initial = initialInputs.get(col) ?? "";
    setDrafts((prev) => ({
      ...prev,
      [col]: { raw: initial, setNull: true },
    }));
    setErrors((prev) => ({ ...prev, [col]: null }));
  }

  function revertField(col: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
    setErrors((prev) => ({ ...prev, [col]: null }));
  }

  function handleClose() {
    if (saving) return;
    if (changeCount > 0) {
      const ok = globalThis.window.confirm(
        isInsert
          ? `Discard this new row?`
          : `Discard ${String(changeCount)} unsaved change${changeCount === 1 ? "" : "s"}?`,
      );
      if (!ok) return;
    }
    props.onClose();
  }

  async function handleSave() {
    if (savingRef.current) return;
    if (!isInsert && changeCount === 0) return;
    const validatedChanges: UpdateRowFieldChange[] = [];
    const nextErrors: Record<string, string | null> = {};
    let firstError: string | null = null;

    for (const [col, draft] of changedColumns) {
      const colInfo = editableColumns.find((c) => c.name === col)!;
      const editor = editors.get(col)!;
      if (draft.setNull) {
        const fallbackCast = colInfo.enumPgCast ?? colInfo.dataType;
        validatedChanges.push({
          column: col,
          pgCast: fallbackCast,
          newValue: null,
          setNull: true,
        });
        continue;
      }
      const validation: EditValidation = editor.validate(draft.raw);
      if (!validation.ok) {
        nextErrors[col] = validation.error;
        firstError = firstError ?? validation.error;
        continue;
      }
      validatedChanges.push({
        column: col,
        pgCast: validation.result.pgCast,
        newValue: validation.result.value,
        setNull: false,
      });
    }

    if (firstError) {
      setErrors((prev) => ({ ...prev, ...nextErrors }));
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const response = isInsert
        ? await globalThis.window.tableDataApi.insertRow({
            connectionId: props.connectionId,
            schema: props.schema,
            table: props.table,
            changes: validatedChanges,
          })
        : await globalThis.window.tableDataApi.updateRow({
            connectionId: props.connectionId,
            schema: props.schema,
            table: props.table,
            pkColumns: props.primaryKey,
            pkValues: props.pkValues ?? [],
            changes: validatedChanges,
          });
      if (!response.success || !response.data) {
        const message = response.error ?? "Unknown error";
        toast.error(isInsert ? "Insert failed" : "Update failed", {
          description: message,
        });
        return;
      }
      props.onRowUpdated(response.data.row);
      toast.success(
        isInsert
          ? "Row inserted"
          : changeCount === 1
            ? "Row updated"
            : `${String(changeCount)} fields updated`,
      );
      props.onClose();
    } catch (err) {
      toast.error(isInsert ? "Insert failed" : "Update failed", {
        description: (err as Error).message,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const saveDisabled = saving || (!isInsert && changeCount === 0);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent
        data-testid="row-editor"
        data-mode={mode}
        className="sm:max-w-2xl"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void handleSave();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{isInsert ? "Insert row" : "Edit row"}</span>
            <span className="rounded border border-border/70 bg-muted/55 px-1.5 py-0.5 font-mono text-[11px] font-normal text-subtle-foreground">
              {props.schema}.{props.table}
            </span>
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {isInsert
              ? "Leave a field blank to use its column default."
              : props.primaryKey
                  .map(
                    (col, index) =>
                      `${col} = ${formatPrimaryKeyValue((props.pkValues ?? [])[index])}`,
                  )
                  .join(", ")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="flex flex-col gap-2">
            {props.columns.map((col) => {
              const isPk = !isInsert && pkSet.has(col.name);
              const draft = drafts[col.name];
              const original = initialInputs.get(col.name);
              const changed = !isPk && isFieldSet(col.name, draft);
              return (
                <div
                  key={col.name}
                  data-testid={`row-field-${col.name}`}
                  data-changed={changed ? "true" : "false"}
                  className={`grid grid-cols-[10rem_1fr_auto] items-start gap-3 rounded-lg border px-2.5 py-1.5 transition-colors duration-150 ${
                    changed ? "border-border bg-accent" : "border-transparent"
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-xs leading-5">
                      {col.name}
                    </span>
                    <span className="font-mono text-[11px] text-subtle-foreground">
                      {col.dataType}
                      {pkSet.has(col.name) ? " · pk" : ""}
                    </span>
                  </div>
                  <div className="min-w-0">
                    {isPk ? (
                      <PrimaryKeyValue value={row[col.name]} />
                    ) : (
                      <FieldEditor
                        column={col}
                        rawValue={draft?.raw ?? original ?? ""}
                        setNull={draft?.setNull ?? false}
                        disabled={saving}
                        connectionId={props.connectionId}
                        onChange={(raw) => setDraftRaw(col.name, raw)}
                      />
                    )}
                    {errors[col.name] ? (
                      <p className="mt-1 text-[11px] text-destructive-foreground">
                        {errors[col.name]}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {!isPk ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="mt-0.5"
                          disabled={saving || !changed}
                          onClick={() => revertField(col.name)}
                          aria-label={`Revert ${col.name}`}
                          data-testid={`revert-${col.name}`}
                        >
                          <RotateCcw />
                        </Button>
                        {col.isNullable === true ? (
                          <Button
                            type="button"
                            variant={draft?.setNull ? "secondary" : "ghost"}
                            size="sm"
                            className="mt-0.5 px-2 font-mono text-[11px]"
                            disabled={saving}
                            onClick={() => setDraftNull(col.name)}
                            data-testid={`setnull-${col.name}`}
                          >
                            NULL
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {changeCount === 0
              ? isInsert
                ? "All defaults"
                : "No changes"
              : `${String(changeCount)} field${changeCount === 1 ? "" : "s"} ${isInsert ? "set" : "changed"}`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saveDisabled}
            onClick={() => {
              void handleSave();
            }}
            data-testid="row-editor-save"
          >
            {saving ? (
              <Loader2 className="animate-spin" />
            ) : isInsert ? (
              "Insert"
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
