import { Button } from "@/components/ui/button";
import type { AccessLevel } from "@/shared/types/roles";
import { formatLevel } from "./shared";

export const ACCESS_LEVELS: AccessLevel[] = ["none", "readonly", "readwrite"];

/** Segmented No access / Read only / Read + write picker. */
export function AccessLevelControl({
  value,
  disabled,
  onChange,
  size = "sm",
  label,
}: Readonly<{
  value: AccessLevel;
  disabled?: boolean;
  onChange: (level: AccessLevel) => void;
  size?: "sm" | "xs";
  /** Accessible name for the group, e.g. the database or table name. */
  label: string;
}>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-border"
    >
      {ACCESS_LEVELS.map((level) => {
        const active = value === level;
        return (
          <Button
            key={level}
            type="button"
            variant={active ? "default" : "ghost"}
            size={size}
            disabled={disabled}
            onClick={() => onChange(level)}
            className="rounded-none border-0"
            aria-pressed={active}
          >
            {formatLevel(level)}
          </Button>
        );
      })}
    </div>
  );
}
