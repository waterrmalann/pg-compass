import { useEffect, useState, type KeyboardEvent } from "react";
import { CircleAlert, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { psqlUnavailableMessage } from "@/components/workspace/shell/psql-install-hint";
import { usePsqlLocation } from "@/hooks/use-psql-location";
import { useSettings } from "@/hooks/use-settings";
import type { PsqlLocation } from "@/shared/types/shell";

const SOURCE_LABELS = {
  setting: "this path",
  path: "your PATH",
  common: "a standard install folder",
} as const;

/**
 * Settings → General row for the psql the shell starts. Blank means search
 * PATH and the usual install folders; a path is used as is.
 */
export function PsqlPathSetting() {
  const { settings, updateSettings } = useSettings();
  const savedPath = settings.general.psqlPath;
  const [draft, setDraft] = useState(savedPath);
  const { location } = usePsqlLocation();

  useEffect(
    function syncDraftWithSavedPath() {
      setDraft(savedPath);
    },
    [savedPath],
  );

  function save(nextPath: string) {
    const trimmed = nextPath.trim();
    setDraft(trimmed);
    if (trimmed === savedPath) return;
    void updateSettings({ general: { psqlPath: trimmed } });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      save(draft);
      return;
    }
    if (event.key === "Escape") {
      setDraft(savedPath);
    }
  }

  async function browse() {
    const result = await globalThis.window.connectionApi.showOpenFileDialog({
      title: "Choose psql",
      defaultPath: savedPath || undefined,
    });
    if (result.success && result.data) save(result.data);
  }

  return (
    <div className="flex flex-col gap-2.5 py-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor="psql-path" className="text-[13px] font-medium">
          psql path
        </label>
        <p className="max-w-[52ch] text-xs leading-5 text-muted-foreground">
          The psql the shell starts. Leave blank to search your PATH and the
          usual install folders.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id="psql-path"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => save(draft)}
          onKeyDown={handleKeyDown}
          placeholder="Search automatically"
          spellCheck={false}
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void browse()}
        >
          <FolderOpen />
          Browse
        </Button>
        {savedPath ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => save("")}
          >
            Clear
          </Button>
        ) : null}
      </div>
      <PsqlStatus location={location} hasConfiguredPath={savedPath !== ""} />
    </div>
  );
}

function PsqlStatus({
  location,
  hasConfiguredPath,
}: Readonly<{ location: PsqlLocation | null; hasConfiguredPath: boolean }>) {
  if (!location) {
    return <p className="text-xs text-muted-foreground">Looking for psql…</p>;
  }

  if (!location.path) {
    return (
      <p
        role="status"
        className="flex items-start gap-1.5 text-xs leading-5 text-warning-foreground"
      >
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {psqlUnavailableMessage(location, hasConfiguredPath)}
      </p>
    );
  }

  const source = location.source ? SOURCE_LABELS[location.source] : "";
  return (
    <p role="status" className="text-xs leading-5 text-muted-foreground">
      Using <span className="font-mono text-foreground">{location.path}</span>
      {source ? ` from ${source}.` : "."}
    </p>
  );
}
