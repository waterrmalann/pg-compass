import { useId, type ReactNode } from "react";
import {
  ArrowDownUp,
  CircleAlert,
  Columns3,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  DataQueryInput,
  QueryColumnMetadata,
  QueryDslError,
  QueryDslField,
} from "@/shared/query-dsl/types";
import { QueryDslEditor } from "./query-dsl-editor";

function FieldErrors({
  id,
  errors,
}: Readonly<{ id: string; errors: QueryDslError[] }>) {
  if (errors.length === 0) return null;
  return (
    <div id={id} role="alert" className="flex flex-col gap-0.5">
      {errors.map((error) => (
        <p
          key={`${error.code}-${String(error.from)}`}
          className="flex items-start gap-1.5 text-xs text-destructive-foreground"
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{error.message}</span>
        </p>
      ))}
    </div>
  );
}

interface DslFieldProps {
  field: QueryDslField;
  icon: ReactNode;
  value: string;
  placeholder: string;
  ariaLabel: string;
  columns: QueryColumnMetadata[];
  errors: QueryDslError[];
  onChange: (field: QueryDslField, value: string) => void;
  onApply: () => void;
}

function DslField({
  field,
  icon,
  value,
  placeholder,
  ariaLabel,
  columns,
  errors,
  onChange,
  onApply,
}: Readonly<DslFieldProps>) {
  const errorId = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="relative min-w-0">
        <span className="pointer-events-none absolute top-1/2 left-2.5 z-10 -translate-y-1/2 text-muted-foreground [&_svg]:size-3.5">
          {icon}
        </span>
        <QueryDslEditor
          field={field}
          value={value}
          onChange={(next) => onChange(field, next)}
          onSubmit={onApply}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
          columns={columns}
          errors={errors}
          errorId={errorId}
          className="h-8 pl-6"
        />
      </div>
      <FieldErrors id={errorId} errors={errors} />
    </div>
  );
}

interface DataQueryToolbarProps {
  draft: DataQueryInput;
  activeQuery: DataQueryInput;
  errors: QueryDslError[];
  columns: QueryColumnMetadata[];
  optionsOpen: boolean;
  onOptionsOpenChange: (open: boolean) => void;
  onDraftChange: (field: QueryDslField, value: string) => void;
  onApply: () => void;
  onClear: () => void;
  /** Rendered at the end of the first row (the view switcher). */
  trailing?: ReactNode;
}

/**
 * Filter, Project and Sort inputs for the Data tab. Filter stays visible;
 * Project and Sort live in a collapsible second row behind Query options.
 */
export function DataQueryToolbar({
  draft,
  activeQuery,
  errors,
  columns,
  optionsOpen,
  onOptionsOpenChange,
  onDraftChange,
  onApply,
  onClear,
  trailing,
}: Readonly<DataQueryToolbarProps>) {
  const optionsRowId = useId();
  const errorsFor = (field: QueryDslField) =>
    errors.filter((error) => error.field === field);

  const activeOptionCount =
    (activeQuery.projection.trim() ? 1 : 0) + (activeQuery.sort.trim() ? 1 : 0);
  const showActiveCount = !optionsOpen && activeOptionCount > 0;
  const optionsErrorCount =
    errorsFor("projection").length + errorsFor("sort").length;
  const optionsLabel =
    activeOptionCount > 0
      ? `Query options, ${String(activeOptionCount)} active`
      : "Query options";

  const hasAnyText =
    [draft.filter, draft.projection, draft.sort].some((text) => text.trim()) ||
    [activeQuery.filter, activeQuery.projection, activeQuery.sort].some(
      (text) => text.trim(),
    );

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
        className="flex items-start gap-2"
      >
        <DslField
          field="filter"
          icon={<Search />}
          value={draft.filter}
          placeholder="Filter — e.g. status = 'active' AND score > 10"
          ariaLabel="Filter"
          columns={columns}
          errors={errorsFor("filter")}
          onChange={onDraftChange}
          onApply={onApply}
        />
        <Button
          type="button"
          variant="outline"
          aria-expanded={optionsOpen}
          aria-controls={optionsOpen ? optionsRowId : undefined}
          aria-label={optionsLabel}
          title={optionsLabel}
          onClick={() => onOptionsOpenChange(!optionsOpen)}
          className={cn(
            showActiveCount || optionsErrorCount > 0 ? "px-2" : "w-8 px-0",
          )}
        >
          <SlidersHorizontal />
          {showActiveCount ? (
            <span
              aria-hidden="true"
              className="rounded bg-muted px-1 font-mono text-[11px] text-subtle-foreground"
            >
              {activeOptionCount}
            </span>
          ) : null}
          {!optionsOpen && optionsErrorCount > 0 ? (
            <CircleAlert
              aria-hidden="true"
              className="text-destructive-foreground"
            />
          ) : null}
        </Button>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {hasAnyText ? (
          <Button type="button" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        ) : null}
        {trailing}
      </form>

      {optionsOpen ? (
        <div id={optionsRowId} className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <DslField
              field="projection"
              icon={<Columns3 />}
              value={draft.projection}
              placeholder="Project — e.g. id, name AS label"
              ariaLabel="Project"
              columns={columns}
              errors={errorsFor("projection")}
              onChange={onDraftChange}
              onApply={onApply}
            />
            <DslField
              field="sort"
              icon={<ArrowDownUp />}
              value={draft.sort}
              placeholder="Sort — e.g. created_at DESC, name"
              ariaLabel="Sort"
              columns={columns}
              errors={errorsFor("sort")}
              onChange={onDraftChange}
              onApply={onApply}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Project and Sort take comma-separated columns. Sort accepts ASC,
            DESC, 1 or -1. Projected rows are read-only. Without a primary key,
            rows with equal sort values can move between pages.
          </p>
        </div>
      ) : null}
    </div>
  );
}
