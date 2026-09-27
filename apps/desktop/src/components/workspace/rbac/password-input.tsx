import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PASSWORD_CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";

/** Random password from the Web Crypto CSPRNG (`crypto.getRandomValues`). */
export function generateSecurePassword(length = 20): string {
  const values = new Uint32Array(length);
  globalThis.crypto.getRandomValues(values);
  return Array.from(
    values,
    (n) => PASSWORD_CHARSET[n % PASSWORD_CHARSET.length],
  ).join("");
}

interface PasswordInputProps {
  id: string;
  value: string;
  /** True when `value` came from Generate; shown in clear text with a copy button. */
  generated: boolean;
  required?: boolean;
  onChange: (value: string) => void;
  onGenerate: (value: string) => void;
}

/** Password field with a Generate action that swaps to Copy once generated. */
export function PasswordInput({
  id,
  value,
  generated,
  required,
  onChange,
  onGenerate,
}: Readonly<PasswordInputProps>) {
  async function handleCopy() {
    try {
      const result = await globalThis.window.clipboardApi.writeText(value);
      if (!result.success) {
        throw new Error(result.error ?? "Clipboard write failed.");
      }
      toast.success("Password copied to clipboard.");
    } catch (error) {
      toast.error("Copy failed", { description: (error as Error).message });
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Input
          id={id}
          type={generated ? "text" : "password"}
          className={generated ? "font-mono text-xs" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          required={required}
        />
        {generated ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy password"
                onClick={() => {
                  handleCopy().catch(() => undefined);
                }}
              >
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy password</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => onGenerate(generateSecurePassword())}
          >
            Generate
          </Button>
        )}
      </div>
      {generated && (
        <p className="text-xs text-muted-foreground">
          Copy the generated password now. It won&apos;t be shown again.
        </p>
      )}
    </>
  );
}
