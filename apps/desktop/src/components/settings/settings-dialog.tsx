import { useState, type ReactNode } from "react";
import {
  Keyboard,
  Monitor,
  Moon,
  Palette,
  Settings,
  Shield,
  Sun,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import type {
  DensityPreference,
  ThemePreference,
} from "@/shared/types/settings";
import { KeyboardShortcutsDialog } from "@/components/help/keyboard-shortcuts-dialog";

type SettingsCategory = "general" | "appearance" | "privacy";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const categories: Array<{
  id: SettingsCategory;
  label: string;
  description: string;
  icon: typeof Settings;
}> = [
  {
    id: "general",
    label: "General",
    description: "Core behavior and power-user tooling.",
    icon: Settings,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme and data density.",
    icon: Palette,
  },
  {
    id: "privacy",
    label: "Privacy",
    description: "Maintenance and update behavior.",
    icon: Shield,
  },
];

export function SettingsDialog({
  open,
  onOpenChange,
}: Readonly<SettingsDialogProps>) {
  const [category, setCategory] = useState<SettingsCategory>("general");
  const active = categories.find((item) => item.id === category)!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[min(560px,85vh)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton
      >
        <div className="flex min-h-0 flex-col sm:flex-row">
          <aside className="flex shrink-0 flex-col border-b border-sidebar-border bg-sidebar p-2 sm:w-52 sm:border-r sm:border-b-0">
            <DialogTitle className="flex h-9 items-center px-2 text-[13px] font-medium">
              Settings
            </DialogTitle>
            <DialogDescription className="sr-only">
              Configure app-wide behavior and interface preferences.
            </DialogDescription>
            <nav className="mt-1 flex gap-px sm:flex-col">
              {categories.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-current={category === id ? "page" : undefined}
                  onClick={() => setCategory(id)}
                  className={cn(
                    "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    category === id
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </nav>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex h-13 shrink-0 flex-col justify-center border-b border-border px-6 pr-14">
              <h3 className="text-sm font-medium">{active.label}</h3>
              <p className="text-xs text-muted-foreground">
                {active.description}
              </p>
            </header>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6">
              {category === "general" && <GeneralSettingsPanel />}
              {category === "appearance" && <AppearanceSettingsPanel />}
              {category === "privacy" && <PrivacySettingsPanel />}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GeneralSettingsPanel() {
  const { settings, updateSettings } = useSettings();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <div className="divide-y divide-border">
      <SettingToggleRow
        label="Read-only mode"
        description="Limit PG Compass to read operations. Inline cell edits are hidden and write requests are rejected at the main process."
        checked={settings.general.readOnlyMode}
        onCheckedChange={(checked) =>
          updateSettings({ general: { readOnlyMode: checked } })
        }
      />

      <SettingRow
        label="Keyboard shortcuts"
        description="Browse and search platform-specific workspace and editor commands."
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard />
          View
        </Button>
      </SettingRow>
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />

      <SettingToggleRow
        label="Shell access"
        description="Allow Open shell to run psql, the PostgreSQL command-line client, in a terminal tab. psql can also run local commands with \!."
        checked={settings.general.shellAccess}
        onCheckedChange={(checked) =>
          updateSettings({ general: { shellAccess: checked } })
        }
      />

      <SettingToggleRow
        label="DevTools"
        description="Allow toggling Electron DevTools with Ctrl+Shift+I (Cmd+Option+I on macOS)."
        checked={settings.general.enableDevTools}
        onCheckedChange={(checked) =>
          updateSettings({ general: { enableDevTools: checked } })
        }
      />

      <SettingToggleRow
        label="Hide internal schemas"
        description="Hide pg_catalog, information_schema, and temporary or internal schemas in the sidebar tree."
        checked={settings.general.hideInternalSchemas}
        onCheckedChange={(checked) =>
          updateSettings({ general: { hideInternalSchemas: checked } })
        }
      />
    </div>
  );
}

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  title: string;
  description: string;
  icon: ReactNode;
  preview: ReactNode;
}> = [
  {
    value: "light",
    title: "Light",
    description: "Bright interface for daylight work.",
    icon: <Sun />,
    preview: <ThemePreview tone="light" />,
  },
  {
    value: "dark",
    title: "Dark",
    description: "Low-glare interface for focused sessions.",
    icon: <Moon />,
    preview: <ThemePreview tone="dark" />,
  },
  {
    value: "system",
    title: "System",
    description: "Follow your operating system.",
    icon: <Monitor />,
    preview: (
      <div className="grid h-16 grid-cols-2 overflow-hidden rounded-md border border-border">
        <ThemePreview tone="light" bare />
        <ThemePreview tone="dark" bare />
      </div>
    ),
  },
];

const DENSITY_OPTIONS: Array<{ value: DensityPreference; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
];

function AppearanceSettingsPanel() {
  const { settings, setTheme, updateSettings } = useSettings();
  const density = settings.appearance.density ?? "compact";

  return (
    <div className="divide-y divide-border">
      <div className="flex flex-col gap-3 py-4">
        <SettingText
          label="Theme"
          description="Choose how PG Compass renders across light and dark environments."
        />
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {THEME_OPTIONS.map((option) => {
            const selected = settings.appearance.theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  void setTheme(option.value);
                }}
                className={cn(
                  "flex cursor-pointer flex-col gap-2.5 rounded-lg border bg-background p-2.5 text-left shadow-xs/5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-ring/60 bg-accent"
                    : "border-border hover:bg-muted/40",
                )}
              >
                {option.preview}
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
                    {option.icon}
                    {option.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <SettingRow
        label="Density"
        description="Row spacing for data tables and the card viewer. Compact fits more rows on screen; comfortable adds breathing room."
      >
        <SegmentedControl
          ariaLabel="Density"
          value={density}
          onValueChange={(next) =>
            updateSettings({ appearance: { density: next } })
          }
          options={DENSITY_OPTIONS}
        />
      </SettingRow>
    </div>
  );
}

function PrivacySettingsPanel() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="divide-y divide-border">
      <SettingToggleRow
        label="Check for updates automatically"
        description="Checks GitHub for a new release at launch and every few hours. On Windows, updates download in the background and install when you restart. When this is off, PG Compass only checks when you choose Help → Check for Updates."
        checked={settings.privacy.automaticUpdates}
        onCheckedChange={(checked) =>
          updateSettings({ privacy: { automaticUpdates: checked } })
        }
      />
    </div>
  );
}

function SettingText({
  label,
  description,
}: Readonly<{ label: string; description: string }>) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-[13px] font-medium">{label}</p>
      <p className="max-w-[52ch] text-xs leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: Readonly<{ label: string; description: string; children: ReactNode }>) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <SettingText label={label} description={description} />
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: Readonly<{
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}>) {
  return (
    <SettingRow label={label} description={description}>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </SettingRow>
  );
}

// Theme previews intentionally use fixed neutral values: they demonstrate a
// theme other than the active one, so they cannot inherit the active tokens.
function ThemePreview({
  tone,
  bare = false,
}: Readonly<{ tone: "light" | "dark"; bare?: boolean }>) {
  const isDark = tone === "dark";
  return (
    <div
      className={cn(
        "flex w-full gap-1.5 p-1.5",
        bare ? "h-full" : "h-16 rounded-md border",
        isDark ? "border-white/10 bg-[#141414]" : "border-black/10 bg-white",
      )}
    >
      <div
        className={cn(
          "flex w-1/3 flex-col gap-1 rounded-sm p-1",
          isDark ? "bg-[#111111]" : "bg-[#fafafa]",
        )}
      >
        <div
          className={cn(
            "h-1 w-3/4 rounded-full",
            isDark ? "bg-white/30" : "bg-black/25",
          )}
        />
        <div
          className={cn(
            "h-1 w-1/2 rounded-full",
            isDark ? "bg-white/15" : "bg-black/10",
          )}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1 py-1">
        <div
          className={cn(
            "h-1 w-2/3 rounded-full",
            isDark ? "bg-white/30" : "bg-black/25",
          )}
        />
        <div
          className={cn(
            "h-1 rounded-full",
            isDark ? "bg-white/10" : "bg-black/10",
          )}
        />
        <div
          className={cn(
            "h-1 w-4/5 rounded-full",
            isDark ? "bg-white/10" : "bg-black/10",
          )}
        />
      </div>
    </div>
  );
}
