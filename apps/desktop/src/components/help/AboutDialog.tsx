import { ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { GITHUB_REPO_URL } from '@/shared/constants/help';

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const APP_DESCRIPTION =
  'A lightweight, fast, and intuitive database viewer for PostgreSQL — inspired by MongoDB Compass.';

const WEBSITE_URL = 'https://github.com/waterrmalann/pg-compass';

export function AboutDialog({ open, onOpenChange }: Readonly<AboutDialogProps>) {
  const appVersion = __APP_VERSION__;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>About PG Compass</DialogTitle>
          <DialogDescription>{APP_DESCRIPTION}</DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono text-xs">{appVersion}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">License</span>
            <span className="text-xs">MIT</span>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <a
              href={WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3" />
              Website
            </a>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3" />
              GitHub Repository
            </a>
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
