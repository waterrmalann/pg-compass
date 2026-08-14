import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsPatch,
  type ThemePreference,
} from "@/shared/types/settings";

interface SettingsContextValue {
  settings: AppSettings;
  loading: boolean;
  refresh: () => Promise<void>;
  updateSettings: (patch: AppSettingsPatch) => Promise<AppSettings | null>;
  setTheme: (theme: ThemePreference) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function resolveSystemTheme(): "light" | "dark" {
  return globalThis.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function SettingsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const result = await globalThis.window.settingsApi.get();
    if (result.success && result.data) {
      setSettings(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(
    function loadSettings() {
      refresh();
    },
    [refresh],
  );

  useEffect(
    function watchSystemTheme() {
      const preference = settings.appearance.theme;
      let mediaQuery: MediaQueryList | null = null;

      const apply = (theme: "dark" | "light") => {
        document.documentElement.classList.toggle("dark", theme === "dark");
      };

      if (preference === "system") {
        mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");

        const applyFromMedia = () => {
          apply(mediaQuery?.matches ? "dark" : "light");
        };

        applyFromMedia();

        const onChange = () => applyFromMedia();
        mediaQuery.addEventListener("change", onChange);
        return () => mediaQuery?.removeEventListener("change", onChange);
      } else {
        apply(preference);
      }
    },
    [settings.appearance.theme],
  );

  const updateSettings = useCallback(
    async (patch: AppSettingsPatch): Promise<AppSettings | null> => {
      const result = await globalThis.window.settingsApi.update(patch);
      if (result.success && result.data) {
        setSettings(result.data);
        return result.data;
      }

      // Settings toggles aren't applied optimistically, so on failure the
      // control just snaps back to its old value — without this, that
      // happens with zero explanation of why the change didn't take.
      toast.error("Failed to save settings", {
        description: result.error,
      });
      return null;
    },
    [],
  );

  const setTheme = useCallback(
    async (theme: ThemePreference): Promise<void> => {
      await updateSettings({ appearance: { theme } });
    },
    [updateSettings],
  );

  const value = useMemo(
    () => ({
      settings,
      loading,
      refresh,
      updateSettings,
      setTheme,
    }),
    [settings, loading, refresh, updateSettings, setTheme],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }

  return context;
}

export { resolveSystemTheme };
