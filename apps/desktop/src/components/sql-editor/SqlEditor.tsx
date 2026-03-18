import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { useCodemirror, type CompletionSchema } from './use-codemirror';

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

  const defaultMinHeight = singleLine ? '32px' : '96px';

  return (
    <div
      ref={containerRef}
      className={cn(
        'overflow-hidden rounded-md border border-input bg-background text-xs focus-within:ring-1 focus-within:ring-ring',
        singleLine && '[&_.cm-editor]:max-h-8 [&_.cm-content]:py-1 [&_.cm-content]:px-2 [&_.cm-line]:leading-5.5',
        !singleLine && '[&_.cm-editor]:resize-y [&_.cm-editor]:overflow-auto',
        className,
      )}
      style={{ minHeight: minHeight ?? defaultMinHeight }}
    />
  );
}

export type { CompletionSchema, CompletionColumn } from './use-codemirror';
