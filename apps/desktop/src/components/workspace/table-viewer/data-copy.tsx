import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ColumnInfo } from "@/shared/types/table-data";

const MASKED_VALUE = /^(?:\*{3,}|•{3,}|\[masked\]|\[unavailable\])$/i;

export function isCopyableValue(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "string" && MASKED_VALUE.test(value.trim()))
    return false;
  return true;
}

export function serializeCellValue(value: unknown): string | null {
  if (!isCopyableValue(value)) return null;
  if (value === null) return "NULL";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

export function serializeRow(
  columns: ColumnInfo[],
  row: Record<string, unknown>,
): string {
  const copy: Record<string, unknown> = {};
  for (const column of columns) {
    const value = row[column.name];
    if (!isCopyableValue(value)) continue;
    copy[column.name] =
      value instanceof Date
        ? value.toISOString()
        : typeof value === "bigint"
          ? value.toString()
          : value;
  }
  return JSON.stringify(copy);
}

async function copyText(text: string | null, successMessage: string) {
  if (text === null) {
    toast.error("This value is masked or unavailable and cannot be copied.");
    return;
  }
  try {
    const result = await globalThis.window.clipboardApi.writeText(text);
    if (!result.success) {
      throw new Error(result.error ?? "Clipboard write failed.");
    }
    toast.success(successMessage);
  } catch (error) {
    toast.error("Copy failed", { description: (error as Error).message });
  }
}

export function DataCopyButton({
  label,
  text,
  successMessage,
  className,
}: Readonly<{
  label: string;
  text: string | null;
  successMessage: string;
  className?: string;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={className}
          aria-label={label}
          disabled={text === null}
          onClick={(event) => {
            event.stopPropagation();
            void copyText(text, successMessage);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Copy className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
