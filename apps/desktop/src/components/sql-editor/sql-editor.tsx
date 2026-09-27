import { useRef } from "react";
import { fieldClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCodemirror, type CompletionSchema } from "./use-codemirror";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  schema?: CompletionSchema;
  minHeight?: string;
  singleLine?: boolean;
  className?: string;
  readOnly?: boolean;
}

export function SqlEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  schema,
  minHeight,
  singleLine = false,
  className,
  readOnly = false,
}: Readonly<SqlEditorProps>) {
  const containerRef = useRef<HTMLDivElement>(null);

  useCodemirror(containerRef, {
    value,
    onChange,
    onSubmit,
    placeholder,
    schema,
    singleLine,
    readOnly,
  });

  const defaultMinHeight = singleLine ? "32px" : "96px";

  return (
    <div
      ref={containerRef}
      className={cn(
        singleLine
          ? cn(
              fieldClassName,
              "overflow-hidden focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/24 dark:focus-within:shadow-none dark:focus-within:ring-ring/48",
            )
          : "overflow-hidden bg-code [&_.cm-editor]:resize-y [&_.cm-editor]:overflow-auto",
        className,
      )}
      style={{ minHeight: minHeight ?? defaultMinHeight }}
    />
  );
}

export type { CompletionSchema, CompletionColumn } from "./use-codemirror";
