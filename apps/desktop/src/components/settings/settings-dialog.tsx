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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  icon: typeof Settings;
}> = [
  { id: "general", label: "General", icon: Settings },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "privacy", label: "Privacy", icon: Shield },
];

export function SettingsDialog({
  open,
  onOpenChange,
}: Readonly<SettingsDialogProps>) {
  const [category, setCategory] = useState<SettingsCategory>("general");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton
      >
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure app-wide behavior and interface preferences.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="flex min-h-115 flex-col sm:min-h-120 sm:flex-row">
          <aside className="w-full border-b bg-muted/20 p-2 sm:w-56 sm:border-r sm:border-b-0 sm:p-3">
            <nav className="flex gap-1 sm:flex-col">
              {categories.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant={category === id ? "secondary" : "ghost"}
                  className="justify-start gap-2"
                  onClick={() => setCategory(id)}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                </Button>
              ))}
            </nav>
          </aside>

          <section className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-5">
            {category === "general" && <GeneralSettingsPanel />}
            {category === "appearance" && <AppearanceSettingsPanel />}
            {category === "privacy" && <PrivacySettingsPanel />}
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
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">General</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Control core behavior and power-user tooling.
      </p>

      <SettingToggleRow
        label="Set Read-Only Mode"
        description="Limit PG Compass to read operations. Inline cell edits are hidden and write requests are rejected at the main process."
        checked={settings.general.readOnlyMode}
        onCheckedChange={(checked) =>
          updateSettings({ general: { readOnlyMode: checked } })
        }
      />

      <div className="mt-2 flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3">
        <div>
          <p className="text-sm font-medium">Keyboard Shortcuts</p>
          <p className="text-xs text-muted-foreground">
            Browse and search platform-specific workspace and editor commands.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard className="size-4" />
          View
        </Button>
      </div>
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />

      <SettingToggleRow
        label="Enable Shell Access"
        description="Allow opening a terminal connected to your PostgreSQL database (coming soon)."
        checked={settings.general.shellAccess}
        onCheckedChange={(checked) =>
          updateSettings({ general: { shellAccess: checked } })
        }
      />

      <SettingToggleRow
        label="Enable DevTools"
        description="Allow toggling Electron DevTools with Ctrl+Shift+I (Cmd+Option+I on macOS)."
        checked={settings.general.enableDevTools}
        onCheckedChange={(checked) =>
          updateSettings({ general: { enableDevTools: checked } })
        }
      />

      <SettingToggleRow
        label="Hide Internal Schemas"
        description="Hide pg_catalog, information_schema, and temporary/internal schemas in the sidebar tree."
        checked={settings.general.hideInternalSchemas}
        onCheckedChange={(checked) =>
          updateSettings({ general: { hideInternalSchemas: checked } })
        }
      />

    </div>
  );
}

function AppearanceSettingsPanel() {
  const { settings, setTheme, updateSettings } = useSettings();
  const density = settings.appearance.density ?? "compact";

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">Appearance</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Choose how PG Compass should render across light and dark environments.
      </p>

      <Tabs value={settings.appearance.theme}>
        <TabsList className="grid w-full grid-cols-1 gap-2 bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto sm:grid-cols-3">
          <ThemeCard
            value="light"
            title="Light"
            description="Bright interface for daylight work."
            onSelect={setTheme}
            icon={<Sun className="size-4" />}
          >
            <ThemeLightPreview />
          </ThemeCard>

          <ThemeCard
            value="dark"
            title="Dark"
            description="Low-glare interface for focused sessions."
            onSelect={setTheme}
            icon={<Moon className="size-4" />}
          >
            <ThemeDarkPreview />
          </ThemeCard>

          <ThemeCard
            value="system"
            title="System"
            description="Follow your operating system preference."
            onSelect={setTheme}
            icon={<Monitor className="size-4" />}
          >
            <ThemeSystemPreview />
          </ThemeCard>
        </TabsList>
      </Tabs>

      <Separator className="my-4" />

      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Density</p>
          <p className="text-xs text-muted-foreground">
            Row spacing for data tables and the card viewer. Compact fits more
            rows on screen; comfortable adds breathing room.
          </p>
        </div>
        <DensitySelector
          value={density}
          onChange={(next) => updateSettings({ appearance: { density: next } })}
        />
      </div>
    </div>
  );
}

const DENSITY_OPTIONS: Array<{ value: DensityPreference; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
];

function DensitySelector({
  value,
  onChange,
}: Readonly<{
  value: DensityPreference;
  onChange: (value: DensityPreference) => void;
}>) {
  return (
    <div
      role="radiogroup"
      aria-label="Density"
      className="flex shrink-0 gap-1.5"
    >
      {DENSITY_OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              selected
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function PrivacySettingsPanel() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">Privacy</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Define how the app behaves for maintenance and telemetry-related
        features.
      </p>

      <SettingToggleRow
        label="Enable Automatic Updates"
        description="Allow PG Compass to automatically check for and install updates (coming soon)."
        checked={settings.privacy.automaticUpdates}
        onCheckedChange={(checked) =>
          updateSettings({ privacy: { automaticUpdates: checked } })
        }
      />
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
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  );
}

function ThemeCard({
  value,
  title,
  description,
  icon,
  onSelect,
  children,
}: Readonly<{
  value: ThemePreference;
  title: string;
  description: string;
  icon: ReactNode;
  onSelect: (theme: ThemePreference) => Promise<void>;
  children: ReactNode;
}>) {
  return (
    <TabsTrigger
      value={value}
      onClick={() => {
        void onSelect(value);
      }}
      className={cn(
        "h-auto min-h-40 w-full min-w-0 flex-col items-start justify-start gap-3 rounded-lg border border-border bg-card p-3 text-left whitespace-normal wrap-break-word data-[state=active]:border-primary data-[state=active]:bg-accent/40",
      )}
    >
      <div className="flex w-full items-center gap-2 text-sm font-semibold">
        {icon}
        <span className="whitespace-normal wrap-break-word">{title}</span>
      </div>
      {children}
      <p className="w-full text-xs text-muted-foreground whitespace-normal wrap-break-word">
        {description}
      </p>
    </TabsTrigger>
  );
}

function ThemeLightPreview() {
  return (
    <div className="w-full rounded-md border border-zinc-200 bg-white p-2">
      <div className="mb-2 h-2 w-12 rounded bg-zinc-300" />
      <div className="space-y-1">
        <div className="h-1.5 rounded bg-zinc-200" />
        <div className="h-1.5 w-4/5 rounded bg-zinc-200" />
      </div>
    </div>
  );
}

function ThemeDarkPreview() {
  return (
    <div className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2">
      <div className="mb-2 h-2 w-12 rounded bg-zinc-500" />
      <div className="space-y-1">
        <div className="h-1.5 rounded bg-zinc-700" />
        <div className="h-1.5 w-4/5 rounded bg-zinc-700" />
      </div>
    </div>
  );
}

function ThemeSystemPreview() {
  return (
    <div className="grid w-full grid-cols-2 gap-1 rounded-md border border-border p-1">
      <div className="rounded-sm border border-zinc-200 bg-white p-1">
        <div className="h-1 rounded bg-zinc-200" />
      </div>
      <div className="rounded-sm border border-zinc-700 bg-zinc-900 p-1">
        <div className="h-1 rounded bg-zinc-700" />
      </div>
    </div>
  );
}
