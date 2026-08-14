import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DATE_TYPES = new Set(["date"]);
const TIME_TYPES = new Set(["time", "timetz"]);
const TIMESTAMP_TYPES = new Set(["timestamp", "timestamptz"]);

export function isDateTimeType(pgType: string): boolean {
  return (
    DATE_TYPES.has(pgType) ||
    TIME_TYPES.has(pgType) ||
    TIMESTAMP_TYPES.has(pgType)
  );
}

function pickerValue(raw: string, pgType: string): string {
  if (DATE_TYPES.has(pgType)) return raw.slice(0, 10);
  if (TIME_TYPES.has(pgType))
    return raw.match(/^\d{2}:\d{2}(?::\d{2})?/)?.[0] ?? "";
  const normalized = raw.replace(" ", "T");
  return (
    normalized.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/)?.[0] ?? ""
  );
}

function detectedOffset(raw: string): string {
  return raw.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? "Z";
}

function withTimezone(value: string, offset: string): string {
  if (!value) return "";
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return `${withSeconds}${offset}`;
}

export function DateTimeEditor({
  pgType,
  value,
  onChange,
  disabled,
}: Readonly<{
  pgType: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}>) {
  const [rawMode, setRawMode] = useState(false);
  // Derived from `value` (like `visualValue` below) rather than local state:
  // `value` is the single source of truth, so this always reflects the
  // current field even when it changes externally (e.g. a "Revert" button
  // resetting the draft) instead of going stale and combining with a
  // picker edit to silently shift the saved instant to the wrong offset.
  const timezone = useMemo(() => detectedOffset(value), [value]);
  const inputType = DATE_TYPES.has(pgType)
    ? "date"
    : TIME_TYPES.has(pgType)
      ? "time"
      : "datetime-local";
  const needsTimezone = pgType === "timetz" || pgType === "timestamptz";
  const visualValue = useMemo(
    () => pickerValue(value, pgType),
    [pgType, value],
  );

  if (rawMode) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="h-8 flex-1 font-mono text-xs"
          aria-label="Raw date or time value"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setRawMode(false)}
          disabled={disabled}
        >
          Picker
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type={inputType}
        step="1"
        value={visualValue}
        disabled={disabled}
        className="h-8 min-w-0 flex-1 font-mono text-xs"
        aria-label={`${pgType} picker`}
        onChange={(event) => {
          const next = event.target.value;
          onChange(needsTimezone ? withTimezone(next, timezone) : next);
        }}
      />
      {needsTimezone ? (
        <select
          value={timezone}
          disabled={disabled}
          aria-label="Timezone offset"
          className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs"
          onChange={(event) => {
            onChange(withTimezone(visualValue, event.target.value));
          }}
        >
          {[
            "Z",
            "-08:00",
            "-05:00",
            "+00:00",
            "+01:00",
            "+05:30",
            "+08:00",
            "+10:00",
          ].map((offset) => (
            <option key={offset} value={offset}>
              {offset === "Z" ? "UTC" : `UTC${offset}`}
            </option>
          ))}
        </select>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setRawMode(true)}
        disabled={disabled}
      >
        Raw
      </Button>
    </div>
  );
}
