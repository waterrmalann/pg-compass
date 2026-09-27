import { cn } from "@/lib/utils";

export const COLOR_OPTIONS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface ConnectionColorPickerProps {
  value: string | undefined;
  onChange: (color: string | undefined) => void;
}

export function ConnectionColorPicker({
  value,
  onChange,
}: Readonly<ConnectionColorPickerProps>) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] leading-none font-medium">Color</span>
      <div className="flex items-center gap-1" role="group" aria-label="Color">
        {COLOR_OPTIONS.map((c) => {
          const selected = value === c;
          return (
            <button
              key={c}
              type="button"
              className={cn(
                "flex size-6 cursor-pointer items-center justify-center rounded-md outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                selected && "bg-accent",
              )}
              onClick={() => onChange(selected ? undefined : c)}
              aria-label={`Select color ${c}`}
              aria-pressed={selected}
            >
              <span
                className={cn(
                  "size-3 rounded-full",
                  selected &&
                    "ring-2 ring-foreground/70 ring-offset-2 ring-offset-popover",
                )}
                style={{ backgroundColor: c }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
