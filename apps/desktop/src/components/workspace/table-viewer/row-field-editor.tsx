import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  editRegistry,
  type TypeEditor,
} from "@/components/workspace/renderers/edit-registry";
import { ForeignKeyPicker } from "@/components/workspace/renderers/foreign-key-editor";
import {
  DateTimeEditor,
  isDateTimeType,
} from "@/components/workspace/renderers/date-time-editor";
import {
  isStructuredEditType,
  StructuredValueEditor,
} from "@/components/workspace/renderers/structured-value-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ColumnInfo } from "@/shared/types/table-data";

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
  "geometry",
  "geography",
]);

export interface FieldDraft {
  raw: string;
  setNull: boolean;
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
        return { ok: false, error: `Not a valid value for ${pgCast}: ${raw}` };
      }
      return { ok: true, result: { value: raw, pgCast } };
    },
  };
}

function makeForeignKeyEditor(pgCast: string): TypeEditor {
  return {
    kind: "inline",
    toInput: (value) =>
      value === null || value === undefined ? "" : String(value),
    validate: (raw) => ({
      ok: true,
      result: { value: raw, pgCast },
    }),
  };
}

export function editorFor(column: ColumnInfo): TypeEditor {
  if (column.foreignKey) {
    return makeForeignKeyEditor(column.foreignKey.valuePgCast);
  }
  if (column.enumLabels && column.enumLabels.length > 0) {
    return makeEnumEditor(
      column.enumLabels,
      column.enumPgCast ?? column.dataType,
    );
  }
  return editRegistry.get(column.dataType);
}

export function formatPrimaryKeyValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

export function PrimaryKeyValue({ value }: Readonly<{ value: unknown }>) {
  if (value === null || value === undefined) {
    return (
      <span className="font-mono text-xs italic text-muted-foreground">
        NULL
      </span>
    );
  }
  return (
    <span className="block truncate font-mono text-xs text-muted-foreground">
      {String(value)}
    </span>
  );
}

interface FieldEditorProps {
  column: ColumnInfo;
  rawValue: string;
  setNull: boolean;
  disabled: boolean;
  connectionId: string;
  onChange: (raw: string) => void;
}

export function FieldEditor(props: Readonly<FieldEditorProps>): ReactNode {
  if (props.setNull) {
    return (
      <div
        data-testid={`null-pill-${props.column.name}`}
        className="rounded-md border border-dashed border-muted-foreground/40 px-2 py-1 text-center font-mono text-xs italic text-muted-foreground"
      >
        NULL
      </div>
    );
  }

  if (props.column.foreignKey) {
    return (
      <ForeignKeyFieldEditor
        column={props.column}
        rawValue={props.rawValue}
        connectionId={props.connectionId}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    );
  }

  const enumLabels = props.column.enumLabels;
  if (enumLabels && enumLabels.length > 0) {
    return (
      <select
        value={props.rawValue}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.disabled}
        data-testid={`row-enum-${props.column.name}`}
        className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
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

  if (props.column.dataType === "bool") {
    const checked = props.rawValue.trim().toLowerCase() === "true";
    return (
      <div className="flex h-8 items-center justify-between rounded-md border border-input bg-muted/30 px-2">
        <span className="font-mono text-xs">{checked ? "True" : "False"}</span>
        <Switch
          checked={checked}
          onCheckedChange={(next) => props.onChange(next ? "true" : "false")}
          disabled={props.disabled}
          aria-label={`Toggle ${props.column.name}`}
        />
      </div>
    );
  }

  if (MULTILINE_TYPES.has(props.column.dataType)) {
    if (isStructuredEditType(props.column.dataType)) {
      return (
        <StructuredValueEditor
          value={props.rawValue}
          onChange={props.onChange}
          disabled={props.disabled}
          ariaLabel={`${props.column.name} structured value`}
        />
      );
    }
    return (
      <textarea
        value={props.rawValue}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.disabled}
        className="min-h-16 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        spellCheck={false}
      />
    );
  }

  if (isDateTimeType(props.column.dataType)) {
    return (
      <DateTimeEditor
        pgType={props.column.dataType}
        value={props.rawValue}
        onChange={props.onChange}
        disabled={props.disabled}
      />
    );
  }

  return (
    <Input
      value={props.rawValue}
      onChange={(event) => props.onChange(event.target.value)}
      disabled={props.disabled}
      className="h-8 font-mono text-xs"
      spellCheck={false}
    />
  );
}

interface ForeignKeyFieldEditorProps {
  column: ColumnInfo;
  rawValue: string;
  disabled: boolean;
  connectionId: string;
  onChange: (raw: string) => void;
}

function ForeignKeyFieldEditor(props: Readonly<ForeignKeyFieldEditorProps>) {
  const foreignKey = props.column.foreignKey!;
  const [open, setOpen] = useState(false);
  const [lastLabel, setLastLabel] = useState<string | null>(null);
  // `lastLabel` only reflects what was picked in *this* dialog session — if
  // `rawValue` changes for any other reason (e.g. a "Revert" button resetting
  // the draft), the label is stale and must be dropped rather than shown next
  // to a value it no longer describes.
  const pickedValueRef = useRef<string | null>(null);
  useEffect(() => {
    if (props.rawValue !== pickedValueRef.current) {
      setLastLabel(null);
    }
  }, [props.rawValue]);
  const display = props.rawValue === "" ? "(unset)" : props.rawValue;

  return (
    <>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setOpen(true)}
        data-testid={`fk-trigger-${props.column.name}`}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2 text-left text-xs hover:bg-muted/40 disabled:opacity-50"
      >
        <span className="truncate">
          {lastLabel ? <span className="font-medium">{lastLabel}</span> : null}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {display}
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-testid={`fk-picker-dialog-${props.column.name}`}
          className="sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle className="text-sm">
              Pick {props.column.name}
            </DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              References {foreignKey.schema}.{foreignKey.table}.
              {foreignKey.column}
            </DialogDescription>
          </DialogHeader>
          <ForeignKeyPicker
            currentValue={props.rawValue === "" ? null : props.rawValue}
            currentLabel={lastLabel}
            foreignKey={foreignKey}
            connectionId={props.connectionId}
            allowNull={false}
            onPick={(value, label) => {
              const nextRaw =
                value === null || value === undefined ? "" : String(value);
              pickedValueRef.current = nextRaw;
              props.onChange(nextRaw);
              setLastLabel(label);
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
