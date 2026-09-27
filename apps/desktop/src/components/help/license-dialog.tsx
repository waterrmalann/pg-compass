import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LICENSE_TEXT } from "@/shared/constants/help";

interface LicenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LicenseDialog({
  open,
  onOpenChange,
}: Readonly<LicenseDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-hidden sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>License</DialogTitle>
          <DialogDescription>
            PG Compass is released under the MIT License.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-72 rounded-lg border border-border bg-code">
          <pre className="p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {LICENSE_TEXT}
          </pre>
        </ScrollArea>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
