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
  if (level === "readonly") return "Read Only";
  if (level === "readwrite") return "Read + Write";
  return "No Access";
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

/**
 * Runs an IPC mutation, toasts the result, and calls back after success so the
 * caller can refresh its snapshot. Returns the success flag.
 */
export function useRbacMutation(
  onAfterSuccess: () => void,
): {
  busy: boolean;
  run: (
    label: string,
    fn: () => Promise<IpcResult<unknown>>,
    options?: { suppressToast?: boolean },
  ) => Promise<boolean>;
} {
  const [busy, setBusy] = useState(false);
  async function run(
    label: string,
    fn: () => Promise<IpcResult<unknown>>,
    options?: { suppressToast?: boolean },
  ): Promise<boolean> {
    setBusy(true);
    try {
      const result = await fn();
      if (result.success) {
        if (!options?.suppressToast) toast.success(label);
        onAfterSuccess();
        return true;
      }
      toast.error(label, { description: result.error });
      return false;
    } catch (err) {
      toast.error(label, { description: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}