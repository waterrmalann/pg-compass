import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronUp,
  Lock,
  RotateCcw,
  Search,
  SquareTerminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import {
  useTerminalSession,
  type ShellStatus,
} from "@/components/workspace/shell/use-terminal-session";
import { useSettings } from "@/hooks/use-settings";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";
import type { DatabaseViewerPath } from "@/shared/types/workspace";

/**
 * A psql session in an embedded terminal. psql itself provides history,
 * completion, multiline editing and the pager; this view only hosts it.
 */
export function ShellViewer({ path }: Readonly<{ path: DatabaseViewerPath }>) {
  const { openTab } = useWorkspace();
  const { settings, updateSettings } = useSettings();
  // Turning shell access off leaves open tabs in place but locks them.
  const accessOff = !settings.general.shellAccess;
  const session = useTerminalSession(path.connectionId, accessOff);

  return (
    <ViewerShell
      breadcrumb={[
        {
          label: path.connectionLabel,
          view: { type: "schema-list", path },
        },
        { label: "Shell" },
      ]}
      // Open beside the shell rather than replacing its tab (and session).
      onNavigateToView={(view) => void openTab(view)}
      shellPath={path}
    >
      <Panel className="h-full">
        <PanelHeader className="min-h-10 gap-2 px-3">
          <SquareTerminal />
          <PanelTitle>psql</PanelTitle>
          <ShellStatusLine status={session.status} />
          <div className="ml-auto flex items-center gap-1">
            {session.findOpen ? (
              <ShellFindBar
                onNext={session.findNext}
                onPrevious={session.findPrevious}
                onClose={session.closeFind}
              />
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={session.openFind}
                aria-label="Find in terminal"
                title="Find in terminal"
              >
                <Search />
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={session.restart}
              disabled={accessOff || session.status.kind === "starting"}
              title="Start a new psql session in this tab"
            >
              <RotateCcw />
              Restart
            </Button>
          </div>
        </PanelHeader>
        {accessOff ? (
          <ShellAccessOffNote
            onTurnOn={() =>
              void updateSettings({ general: { shellAccess: true } })
            }
          />
        ) : null}
        <div
          className={cn(
            "min-h-0 flex-1 bg-card py-2 pl-3 pr-1 transition-opacity duration-150",
            accessOff && "opacity-64",
          )}
          aria-disabled={accessOff || undefined}
        >
          <div
            ref={session.containerRef}
            data-terminal
            className="h-full w-full"
          />
        </div>
      </Panel>
    </ViewerShell>
  );
}

function ShellAccessOffNote({ onTurnOn }: Readonly<{ onTurnOn: () => void }>) {
  return (
    <div
      role="note"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning-foreground"
    >
      <TriangleAlert className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">
        Shell access is off, so this terminal can&apos;t be used. Turn it on to
        type in psql again.
      </p>
      <Button type="button" variant="outline" size="xs" onClick={onTurnOn}>
        Turn on
      </Button>
    </div>
  );
}

function ShellStatusLine({ status }: Readonly<{ status: ShellStatus }>) {
  if (status.kind === "starting") {
    return <span className="text-xs text-muted-foreground">Starting…</span>;
  }
  if (status.kind === "exited") {
    return (
      <span className="text-xs text-muted-foreground">
        Exited with code {status.exitCode}
      </span>
    );
  }
  if (status.kind === "error") {
    return <Badge variant="destructive">Not connected</Badge>;
  }

  return (
    <>
      {status.database ? (
        <span className="truncate font-mono text-xs text-muted-foreground">
          {status.database}
        </span>
      ) : null}
      {status.readOnly ? (
        <Badge
          variant="default"
          title="Read-only mode starts every transaction read-only. SET default_transaction_read_only = off still overrides it in this session."
        >
          <Lock />
          Read-only by default
        </Badge>
      ) : null}
    </>
  );
}

function ShellFindBar({
  onNext,
  onPrevious,
  onClose,
}: Readonly<{
  onNext: (term: string) => void;
  onPrevious: (term: string) => void;
  onClose: () => void;
}>) {
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(function focusOnOpen() {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.shiftKey) {
      onPrevious(term);
      return;
    }
    onNext(term);
  }

  return (
    <div className="flex items-center gap-0.5">
      <Input
        ref={inputRef}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find"
        aria-label="Find in terminal"
        className="h-6 w-44 px-2 font-mono text-xs"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => onPrevious(term)}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => onNext(term)}
        aria-label="Next match"
        title="Next match (Enter)"
      >
        <ChevronDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onClose}
        aria-label="Close find"
        title="Close find (Escape)"
      >
        <X />
      </Button>
    </div>
  );
}
