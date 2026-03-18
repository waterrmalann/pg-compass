import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LICENSE_TEXT } from '@/shared/constants/help';

interface LicenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LicenseDialog({ open, onOpenChange }: Readonly<LicenseDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>License</DialogTitle>
          <DialogDescription>
            PG Compass is released under the MIT License.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-72 rounded-md border bg-muted/30 p-4">
          <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
            {LICENSE_TEXT}
          </pre>
        </ScrollArea>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
