/**
 * Hover affordance that opens the row editor.
 *
 * The gating contract mirrors `EditableCell`: when read-only mode is on or
 * the relation has no primary key, this component returns `null` outright —
 * no wrapping element, no hidden placeholder, no event handlers.  Callers
 * can render it unconditionally and trust that nothing reaches the DOM in
 * the gated states.
 */

import { useState } from "react";
import { Pencil } from "lucide-react";
import { RowEditDialog } from "@/components/workspace/table-viewer/row-edit-dialog";
import type { ColumnInfo } from "@/shared/types/table-data";

export interface RowEditButtonProps {
  columns: ColumnInfo[];
  row: Record<string, unknown>;
  /** When true, the button is not rendered. */
  readOnly: boolean;
  /** `null` (or empty) when the source relation has no PK. */
  primaryKey: string[] | null;
  schema: string;
  table: string;
  connectionId: string;
  /** Called with the post-update row (from RETURNING *). */
  onRowUpdated: (row: Record<string, unknown>) => void;
  /** Optional className for the wrapping span (positioning, sizing). */
  className?: string;
}

export function RowEditButton(props: Readonly<RowEditButtonProps>) {
  const [open, setOpen] = useState(false);

  const editable =
    !props.readOnly && props.primaryKey !== null && props.primaryKey.length > 0;

  if (!editable) return null;

  const pk = props.primaryKey as string[];
  const pkValues = pk.map((col) => props.row[col]);

  return (
    <>
      <button
        type="button"
        data-testid="row-edit-button"
        aria-label="Edit row"
        onClick={() => setOpen(true)}
        className={
          props.className ??
          "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
      >
        <Pencil className="size-3" />
      </button>
      {open ? (
        <RowEditDialog
          columns={props.columns}
          row={props.row}
          primaryKey={pk}
          pkValues={pkValues}
          schema={props.schema}
          table={props.table}
          connectionId={props.connectionId}
          onRowUpdated={props.onRowUpdated}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
