import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { AccessLevel } from "@/shared/types/roles";
import type { IpcResult } from "@/shared/types/ipc";

export function unwrap<T>(result: IpcResult<T>): T {
  if (result.success) return result.data;
  throw new Error(result.error);
}

export function formatBool(value: boolean): string {
  return value ? "yes" : "no";
}

export function formatLevel(level: AccessLevel): string {
  if (level === "readonly") return "Read only";
  if (level === "readwrite") return "Read + write";
  return "No access";
}

/** PostgreSQL's NAMEDATALEN - 1: identifiers are truncated beyond this many bytes. */
const MAX_PG_NAME_BYTES = 63;

/**
 * Role and database names may be any non-empty string of at most 63 bytes
 * (UTF-8) without a NUL character; the main process quotes them as
 * identifiers, so no character-class restriction is needed.
 */
export function isValidPgName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.includes("\0")) return false;
  const byteLength = new TextEncoder().encode(name).length;
  return byteLength <= MAX_PG_NAME_BYTES;
}

export function Field({
  label,
  htmlFor,
  children,
}: Readonly<{
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function LoadingState({ label }: Readonly<{ label: string }>) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: Readonly<{ message: string; onRetry?: () => void }>) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

/** Explains why mutation controls are disabled while read-only mode is on. */
export function ReadOnlyNotice({ action }: Readonly<{ action: string }>) {
  return (
    <p className="text-xs text-muted-foreground">
      Read-only mode is on. Turn it off in Settings to {action}.
    </p>
  );
}

type RbacMutationRunner = (
  label: string,
  fn: () => Promise<IpcResult<unknown>>,
  options?: RbacMutationOptions,
) => Promise<boolean>;

interface RbacMutationOptions {
  suppressToast?: boolean;
  /** Runs after a successful mutation, before `onAfterSuccess` refreshes. */
  onSuccess?: () => void;
}

/**
 * Runs an IPC mutation, toasts the result, and calls back after success so the
 * caller can refresh its snapshot. `busy` is true while a mutation runs.
 */
export function useRbacMutation(onAfterSuccess: () => void): {
  busy: boolean;
  run: RbacMutationRunner;
} {
  const [busy, setBusy] = useState(false);

  async function run(
    label: string,
    fn: () => Promise<IpcResult<unknown>>,
    options?: RbacMutationOptions,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const result = await fn();
      if (!result.success) {
        toast.error(label, { description: result.error });
        return false;
      }
      if (!options?.suppressToast) toast.success(label);
      options?.onSuccess?.();
      onAfterSuccess();
      return true;
    } catch (err) {
      toast.error(label, { description: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, run };
}
