import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ClipboardPaste } from "lucide-react";
import { parseEnvBlock, type ParsedEnvConnection } from "./parse-env-block";

interface ConnectionEnvImportProps {
  onExtract: (parsed: ParsedEnvConnection) => void;
}

export function ConnectionEnvImport({
  onExtract,
}: Readonly<ConnectionEnvImportProps>) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  function handleExtract() {
    onExtract(parseEnvBlock(text));
    setText("");
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title="Fill the form from environment variables"
      >
        <ClipboardPaste />
        Paste .env
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Paste from .env</DialogTitle>
            <DialogDescription>
              Paste PG*, POSTGRES_*, DATABASE_* or DB_* variables (or a
              postgres:// DATABASE_URL) and matching fields will be filled in.
              Commented lines and unrelated keys are ignored.
            </DialogDescription>
          </DialogHeader>

          <textarea
            aria-label="Environment variables"
            className={cn(
              fieldClassName,
              "min-h-48 w-full resize-y px-2.5 py-2 font-mono text-xs leading-5",
            )}
            placeholder={
              "POSTGRES_HOST=localhost\nPOSTGRES_PORT=5432\nPOSTGRES_DB=mydb\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD=secret"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleExtract}
              disabled={!text.trim()}
            >
              Fill fields
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
