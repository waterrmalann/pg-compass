/**
 * Cell wrapper that decides whether to render an editable affordance or a
 * plain, read-only display. The decision point is intentionally explicit and
 * centralised so there is a single place to audit the read-only-mode gate.
 *
 * When the cell is not editable (read-only mode on, no primary key, or the
 * type has no editor) we render the display renderer's output with no
 * wrapping interaction handlers at all — no `onDoubleClick`, no
 * `data-editable` attribute, no button role. A DOM snapshot in that state is
 * indistinguishable from the pre-edit implementation.
 *
 * When the cell IS editable, a double-click opens a dialog-backed editor.
 * Validation happens on the renderer side (via the edit registry) before we
 * ever hit the wire; the main process then re-checks the read-only gate and
 * applies an allow-listed `::cast` to the UPDATE.
 */

import { useState, useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { typeRegistry } from "@/components/workspace/renderers/type-registry";
import {
  editRegistry,
  type EditResult,
  type TypeEditor,
} from "@/components/workspace/renderers/edit-registry";
import { ForeignKeyModalEditor } from "@/components/workspace/renderers/foreign-key-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fieldClassName, Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ColumnInfo } from "@/shared/types/table-data";
import {
  DateTimeEditor,
  isDateTimeType,
} from "@/components/workspace/renderers/date-time-editor";
import {
  isStructuredEditType,
  StructuredValueEditor,
} from "@/components/workspace/renderers/structured-value-editor";
import { cn } from "@/lib/utils";

export interface EditableCellProps {
  col: ColumnInfo;
  value: unknown;
  /** When true, the cell renders without any edit affordance. */
  readOnly: boolean;
  /** `null` when the source relation has no PK (view / PK-less table). */
  primaryKey: string[] | null;
  /** PK values for this row, in the same order as `primaryKey`. */
  pkValues: unknown[];
  schema: string;
  table: string;
  connectionId: string;
  /** `cell` uses the compact display renderer; `card` uses the expanded one. */
  variant: "cell" | "card";
  /** Called with the new row (from RETURNING *) after a successful update. */
  onRowUpdated?: (row: Record<string, unknown>) => void;
  /**
   * Optional replacement for the default type-registry display. Used by the
   * card view to render structured JSON through `JsonTree` while keeping the
   * cell editable. When omitted, the type-registry renderer is used.
   */
  displayOverride?: ReactNode;
}

function renderDisplay(
  col: ColumnInfo,
  value: unknown,
  variant: "cell" | "card",
): ReactNode {
  const isNull = value === null || value === undefined;
  const renderer = isNull
    ? typeRegistry.get("__null__")
    : typeRegistry.get(col.dataType);
  return variant === "cell"
    ? renderer.renderCell(value)
    : renderer.renderCard(value);
}

// Types where a multi-line textarea is a meaningfully better input than
// <input>. Kept narrow on purpose — scalar types open in a compact dialog.
const MULTILINE_TYPES = new Set([
  "json",
  "jsonb",
  "xml",
  "text",
  "_text",
  "_varchar",
  "_int2",
  "_int4",
  "_int8",
]);

export function EditableCell(props: Readonly<EditableCellProps>) {
  const [isEditing, setIsEditing] = useState(false);

  const editable =
    !props.readOnly &&
    props.primaryKey !== null &&
    props.primaryKey.length > 0 &&
    !props.primaryKey.includes(props.col.name);

  const display =
    props.displayOverride ??
    renderDisplay(props.col, props.value, props.variant);

  if (!editable) {
    // No wrapper — the display is rendered bare, identical to the pre-edit
    // world. Zero edit affordances, zero handlers.
    return <>{display}</>;
  }

  return (
    <>
      <span
        data-testid="cell-editor-target"
        onDoubleClick={() => setIsEditing(true)}
        className="cursor-pointer"
      >
        {display}
      </span>
      {isEditing ? (
        <EditDialog
          {...props}
          primaryKey={props.primaryKey as string[]}
          onClose={() => setIsEditing(false)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// EditDialog — rendered only while `isEditing` is true.
// ---------------------------------------------------------------------------

interface EditDialogProps extends Omit<
  EditableCellProps,
  "readOnly" | "primaryKey"
> {
  primaryKey: string[];
  onClose: () => void;
}

function makeEnumEditor(labels: string[], pgCast: string): TypeEditor {
  const labelSet = new Set(labels);
  return {
    kind: "inline",
    toInput(value) {
      if (value === null || value === undefined) return labels[0] ?? "";
      return String(value);
    },
    validate(raw) {
      if (!labelSet.has(raw)) {
        return {
          ok: false,
          error: `Not a valid value for ${pgCast}: ${raw}`,
        };
      }
      return { ok: true, result: { value: raw, pgCast } };
    },
  };
}

function EditDialog(props: Readonly<EditDialogProps>) {
  const enumLabels = props.col.enumLabels;
  const fk = props.col.foreignKey;
  const connectionId = props.connectionId;
  const columnIsNullable = props.col.isNullable === true;
  // Resolution priority: FK ⇒ enum ⇒ type-registered ⇒ fallback. FK takes
  // precedence so a column that's both an enum and an FK (rare) still gets
  // the searchable dropdown.
  const editor: TypeEditor = fk
    ? {
        kind: "modal",
        toInput: (value) =>
          value === null || value === undefined ? "" : String(value),
        validate: (raw) => ({
          ok: true,
          result: { value: raw, pgCast: fk.valuePgCast },
        }),
        Component: (compProps) => (
          <ForeignKeyModalEditor
            {...compProps}
            foreignKey={fk}
            connectionId={connectionId}
            allowNull={columnIsNullable}
          />
        ),
      }
    : enumLabels && enumLabels.length > 0
      ? makeEnumEditor(enumLabels, props.col.enumPgCast ?? props.col.dataType)
      : editRegistry.get(props.col.dataType);
  const initialInput = editor.toInput(props.value);
  const [raw, setRaw] = useState(initialInput);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(
    function resetWhenOpening() {
      setRaw(initialInput);
      setError(null);
    },
    [initialInput],
  );

  async function persist(result: EditResult, setNull: boolean): Promise<void> {
    setSaving(true);
    try {
      const response = await globalThis.window.tableDataApi.updateCell({
        connectionId: props.connectionId,
        schema: props.schema,
        table: props.table,
        pkColumns: props.primaryKey,
        pkValues: props.pkValues,
        column: props.col.name,
        pgCast: result.pgCast,
        newValue: result.value,
        setNull,
      });
      if (!response.success || !response.data) {
        const message = response.error ?? "Unknown error";
        setError(message);
        toast.error("Update failed", { description: message });
        return;
      }
      props.onRowUpdated?.(response.data.row);
      toast.success("Row updated");
      props.onClose();
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast.error("Update failed", { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(): Promise<void> {
    const validated = editor.validate(raw);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    await persist(validated.result, false);
  }

  async function handleSetNull(): Promise<void> {
    // pgCast doesn't matter for a NULL write — the main process ignores it
    // and emits `col = NULL` directly — but keep the editor's declared cast
    // to remain consistent on the wire.
    const validated = editor.validate(raw);
    const pgCast = validated.ok ? validated.result.pgCast : props.col.dataType;
    await persist({ value: null, pgCast }, true);
  }

  const isModal = editor.kind === "modal";
  const ModalComponent = editor.Component;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) props.onClose();
      }}
    >
      <DialogContent
        data-testid="cell-editor"
        className={isModal ? "sm:max-w-2xl" : "sm:max-w-md"}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !isModal) {
            e.preventDefault();
            void handleSave();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{props.col.name}</span>
            <span className="rounded border border-border/70 bg-muted/55 px-1.5 py-0.5 font-mono text-[11px] font-normal text-subtle-foreground">
              {props.col.dataType}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Edit value for column {props.col.name} of type {props.col.dataType}.
          </DialogDescription>
        </DialogHeader>

        {isModal && ModalComponent ? (
          <ModalComponent
            initialValue={props.value}
            onSave={(result) => {
              void persist(result, false);
            }}
            onCancel={props.onClose}
          />
        ) : (
          <EditorBody
            pgType={props.col.dataType}
            enumLabels={props.col.enumLabels}
            raw={raw}
            onChange={setRaw}
            disabled={saving}
          />
        )}

        {error ? (
          <p className="text-xs text-destructive-foreground">{error}</p>
        ) : null}

        {!isModal || !ModalComponent ? (
          <DialogFooter className="gap-2">
            {columnIsNullable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="sm:mr-auto"
                disabled={saving}
                onClick={() => {
                  void handleSetNull();
                }}
              >
                Set NULL
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => {
                void handleSave();
              }}
            >
              {saving ? <Loader2 className="animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditorBody({
  pgType,
  enumLabels,
  raw,
  onChange,
  disabled,
}: Readonly<{
  pgType: string;
  enumLabels: string[] | undefined;
  raw: string;
  onChange: (next: string) => void;
  disabled: boolean;
}>) {
  if (pgType === "bool") {
    const checked = raw.trim().toLowerCase() === "true";
    return (
      <div
        data-testid="cell-bool-toggle"
        className="flex h-9 items-center justify-between rounded-lg border border-input bg-muted/40 px-3"
      >
        <Label htmlFor="cell-bool-switch" className="font-mono text-xs">
          {checked ? "True" : "False"}
        </Label>
        <Switch
          id="cell-bool-switch"
          checked={checked}
          onCheckedChange={(next) => onChange(next ? "true" : "false")}
          disabled={disabled}
          aria-label="Toggle boolean value"
        />
      </div>
    );
  }

  if (enumLabels && enumLabels.length > 0) {
    return (
      <select
        autoFocus
        value={raw}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        data-testid="cell-enum-select"
        className={cn(fieldClassName, "h-8 px-2.5 font-mono text-xs")}
      >
        {enumLabels.map((label) => (
          <option
            key={label}
            value={label}
            className="bg-popover text-popover-foreground"
          >
            {label}
          </option>
        ))}
      </select>
    );
  }
  if (MULTILINE_TYPES.has(pgType)) {
    if (isStructuredEditType(pgType)) {
      return (
        <StructuredValueEditor
          value={raw}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={`${pgType} value editor`}
        />
      );
    }
    return (
      <textarea
        autoFocus
        value={raw}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          fieldClassName,
          "min-h-32 resize-y px-2.5 py-2 font-mono text-xs",
        )}
        spellCheck={false}
      />
    );
  }
  if (isDateTimeType(pgType)) {
    return (
      <DateTimeEditor
        pgType={pgType}
        value={raw}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  return (
    <Input
      autoFocus
      value={raw}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="font-mono text-xs"
      spellCheck={false}
    />
  );
}
