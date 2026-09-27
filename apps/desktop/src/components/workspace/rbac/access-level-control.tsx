import { SegmentedControl } from "@/components/ui/segmented-control";
import type { AccessLevel } from "@/shared/types/roles";
import { formatLevel } from "./shared";

export const ACCESS_LEVELS: AccessLevel[] = ["none", "readonly", "readwrite"];

const ACCESS_LEVEL_OPTIONS = ACCESS_LEVELS.map((level) => ({
  value: level,
  label: formatLevel(level),
}));

/** Segmented No access / Read only / Read + write picker. */
export function AccessLevelControl({
  value,
  disabled,
  onChange,
  label,
}: Readonly<{
  value: AccessLevel;
  disabled?: boolean;
  onChange: (level: AccessLevel) => void;
  /** Accessible name for the group, e.g. the database or table name. */
  label: string;
}>) {
  return (
    <SegmentedControl
      ariaLabel={label}
      value={value}
      onValueChange={onChange}
      options={ACCESS_LEVEL_OPTIONS}
      disabled={disabled}
    />
  );
}
