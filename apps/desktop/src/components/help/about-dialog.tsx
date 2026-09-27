import { ArrowUpRight, Compass } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GITHUB_REPO_URL } from "@/shared/constants/help";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const APP_DESCRIPTION =
  "A lightweight, fast, and intuitive database viewer for PostgreSQL — inspired by MongoDB Compass.";

const WEBSITE_URL = "https://github.com/waterrmalann/pg-compass";

export function AboutDialog({
  open,
  onOpenChange,
}: Readonly<AboutDialogProps>) {
  const appVersion = __APP_VERSION__;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Compass className="size-5" strokeWidth={2.25} />
          </div>
          <DialogTitle>PG Compass</DialogTitle>
          <DialogDescription>{APP_DESCRIPTION}</DialogDescription>
        </DialogHeader>

        <dl className="divide-y divide-border border-y border-border text-[13px]">
          <div className="flex h-10 items-center justify-between">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-mono text-xs">{appVersion}</dd>
          </div>
          <div className="flex h-10 items-center justify-between">
            <dt className="text-muted-foreground">License</dt>
            <dd className="text-xs">MIT</dd>
          </div>
        </dl>

        <div className="flex flex-col items-start gap-1 pb-1">
          <a
            href={WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Website
            <ArrowUpRight className="size-3.5" />
          </a>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Source on GitHub
            <ArrowUpRight className="size-3.5" />
          </a>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
