import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownUp,
  CircleAlert,
  Columns3,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EMPTY_DATA_QUERY } from "@/shared/query-dsl/parser";
import type {
  BoundPathSegment,
  DataQueryInput,
  QueryColumnMetadata,
  QueryDslError,
  QueryDslField,
} from "@/shared/query-dsl/types";
import { QueryDslEditor } from "./query-dsl-editor";

type ErrorsByField = Record<QueryDslField, QueryDslError[]>;

type LoadJsonKeys = (
  column: string,
  path: BoundPathSegment[],
) => Promise<string[]>;

const NO_ERRORS: QueryDslError[] = [];
const OPTION_FIELDS = ["projection", "sort", "skip", "limit"] as const;

function groupErrors(errors: QueryDslError[]): ErrorsByField {
  const grouped: ErrorsByField = {
    filter: NO_ERRORS,
    projection: NO_ERRORS,
    sort: NO_ERRORS,
    skip: NO_ERRORS,
    limit: NO_ERRORS,
  };
  for (const error of errors) {
    grouped[error.field] = [...grouped[error.field], error];
  }
  return grouped;
}

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
  field: "filter" | "projection" | "sort";
  icon: ReactNode;
  value: string;
  placeholder: string;
  ariaLabel: string;
  columns: QueryColumnMetadata[];
  loadJsonKeys?: LoadJsonKeys;
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
  loadJsonKeys,
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
          loadJsonKeys={loadJsonKeys}
          errors={errors}
          errorId={errorId}
          className="h-8 pl-6"
        />
      </div>
      <FieldErrors id={errorId} errors={errors} />
    </div>
  );
}

/** Skip/Limit input. Its errors render under the whole options row. */
function CountField({
  field,
  label,
  placeholder,
  value,
  hasErrors,
  errorId,
  onChange,
}: Readonly<{
  field: "skip" | "limit";
  label: string;
  placeholder: string;
  value: string;
  hasErrors: boolean;
  errorId: string;
  onChange: (field: QueryDslField, value: string) => void;
}>) {
  return (
    <div className="w-28 shrink-0">
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          {label}
        </span>
        <Input
          value={value}
          onChange={(event) => onChange(field, event.target.value)}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={hasErrors || undefined}
          aria-describedby={hasErrors ? errorId : undefined}
          className="h-8 pl-12 font-mono text-[12.5px]"
        />
      </div>
    </div>
  );
}

interface DataQueryToolbarProps {
  /** Last applied query; drafts start from it. */
  activeQuery: DataQueryInput;
  errors: QueryDslError[];
  columns: QueryColumnMetadata[];
  /** Object keys at a JSON column or path, for completion after a dot. */
  loadJsonKeys?: LoadJsonKeys;
  /** Validate and run the draft. The parent decides whether it becomes active. */
  onApply: (draft: DataQueryInput) => void;
  /** A field was edited; errors pointing into it are now stale. */
  onFieldEdited: (field: QueryDslField) => void;
  /** Rendered at the end of the first row (the view switcher). */
  trailing?: ReactNode;
}

/**
 * Filter, Project, Sort, Skip and Limit for the Data tab. Drafts and the
 * options row's open state live here so typing and toggling never
 * re-render the results grid. Filter stays visible; the rest sit behind
 * Query options.
 */
export function DataQueryToolbar({
  activeQuery,
  errors,
  columns,
  loadJsonKeys,
  onApply,
  onFieldEdited,
  trailing,
}: Readonly<DataQueryToolbarProps>) {
  const optionsRowId = useId();
  const skipErrorId = useId();
  const limitErrorId = useId();
  const [draft, setDraft] = useState<DataQueryInput>(activeQuery);
  const [optionsOpen, setOptionsOpen] = useState(() =>
    OPTION_FIELDS.some((field) => activeQuery[field].trim() !== ""),
  );
  const errorsByField = useMemo(() => groupErrors(errors), [errors]);
  const hasOptionErrors = OPTION_FIELDS.some(
    (field) => errorsByField[field].length > 0,
  );

  // An error in a hidden field must be visible to be fixed. Keyed on the
  // errors array so every Apply that reports one reopens the row, even if
  // the user collapsed it while an earlier error was showing.
  useEffect(() => {
    if (hasOptionErrors) setOptionsOpen(true);
  }, [errors, hasOptionErrors]);

  function handleChange(field: QueryDslField, value: string) {
    setDraft((previous) =>
      previous[field] === value ? previous : { ...previous, [field]: value },
    );
    onFieldEdited(field);
  }

  function handleApply() {
    onApply(draft);
  }

  function handleClear() {
    setDraft(EMPTY_DATA_QUERY);
    onApply(EMPTY_DATA_QUERY);
  }

  const activeOptionCount = OPTION_FIELDS.filter(
    (field) => activeQuery[field].trim() !== "",
  ).length;
  const showActiveCount = !optionsOpen && activeOptionCount > 0;
  const optionsLabel =
    activeOptionCount > 0
      ? `Query options, ${String(activeOptionCount)} active`
      : "Query options";

  const hasAnyText = [draft, activeQuery].some((query) =>
    Object.values(query).some((text) => text.trim() !== ""),
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleApply();
      }}
      className="flex shrink-0 flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <DslField
          field="filter"
          icon={<Search />}
          value={draft.filter}
          placeholder="Filter — e.g. status = 'active' AND score > 10"
          ariaLabel="Filter"
          columns={columns}
          loadJsonKeys={loadJsonKeys}
          errors={errorsByField.filter}
          onChange={handleChange}
          onApply={handleApply}
        />
        <Button
          type="button"
          variant="outline"
          aria-expanded={optionsOpen}
          aria-controls={optionsRowId}
          aria-label={optionsLabel}
          title={optionsLabel}
          onClick={() => setOptionsOpen((open) => !open)}
          className={cn(
            showActiveCount || (!optionsOpen && hasOptionErrors)
              ? "px-2"
              : "w-8 px-0",
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
          {!optionsOpen && hasOptionErrors ? (
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
          <Button type="button" variant="ghost" onClick={handleClear}>
            Clear
          </Button>
        ) : null}
        {trailing}
      </div>

      {/* Kept mounted while hidden so opening it is instant and its
          editors keep their undo history. */}
      <div
        id={optionsRowId}
        hidden={!optionsOpen}
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-start gap-2">
          <DslField
            field="projection"
            icon={<Columns3 />}
            value={draft.projection}
            placeholder="Project — e.g. id, name AS label or -notes"
            ariaLabel="Project"
            columns={columns}
            loadJsonKeys={loadJsonKeys}
            errors={errorsByField.projection}
            onChange={handleChange}
            onApply={handleApply}
          />
          <DslField
            field="sort"
            icon={<ArrowDownUp />}
            value={draft.sort}
            placeholder="Sort — e.g. created_at DESC, name"
            ariaLabel="Sort"
            columns={columns}
            loadJsonKeys={loadJsonKeys}
            errors={errorsByField.sort}
            onChange={handleChange}
            onApply={handleApply}
          />
          <CountField
            field="skip"
            label="Skip"
            placeholder="0"
            value={draft.skip}
            hasErrors={errorsByField.skip.length > 0}
            errorId={skipErrorId}
            onChange={handleChange}
          />
          <CountField
            field="limit"
            label="Limit"
            placeholder="All"
            value={draft.limit}
            hasErrors={errorsByField.limit.length > 0}
            errorId={limitErrorId}
            onChange={handleChange}
          />
        </div>
        <FieldErrors id={skipErrorId} errors={errorsByField.skip} />
        <FieldErrors id={limitErrorId} errors={errorsByField.limit} />
        <p className="text-xs text-muted-foreground">
          Project lists columns or JSON paths (payload.status) to keep, or
          -column to drop one. Sort accepts ASC, DESC, 1 or -1. Skip and Limit
          narrow the result but never what Delete removes. Projected rows are
          read-only. Without a primary key, rows with equal sort values can move
          between pages.
        </p>
      </div>
    </form>
  );
}
