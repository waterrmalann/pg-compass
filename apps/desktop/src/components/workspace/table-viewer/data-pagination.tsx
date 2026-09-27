import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100] as const;

interface DataPaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  disabled?: boolean;
}

export function DataPagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  disabled = false,
}: Readonly<DataPaginationProps>) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          {start.toLocaleString()}–{end.toLocaleString()} of{" "}
          {totalCount.toLocaleString()}
        </span>
        <label className="flex items-center gap-1.5">
          Rows per page
          <select
            className={cn(fieldClassName, "h-7 w-auto px-1.5 text-xs")}
            value={pageSize}
            disabled={disabled}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
            }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(1)}
          aria-label="First page"
        >
          <ChevronsLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-14 text-center font-mono text-[11px] text-subtle-foreground tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          aria-label="Last page"
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  );
}
