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
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <ClipboardPaste className="size-4" />
        Paste from .env
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extract from .env</DialogTitle>
            <DialogDescription>
              Paste POSTGRES_*, PG*, or DATABASE_URL variables and matching
              fields will be filled in automatically.
            </DialogDescription>
          </DialogHeader>

          <textarea
            className="min-h-48 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
            <Button type="button" onClick={handleExtract} disabled={!text.trim()}>
              Extract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
