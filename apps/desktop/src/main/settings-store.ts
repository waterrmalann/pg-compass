import Store from "electron-store";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsPatch,
} from "../shared/types/settings";
import { resolveStoreOptions } from "./store-config";

interface SettingsStoreSchema {
  settings: AppSettings;
}

const store = new Store<SettingsStoreSchema>({
  ...resolveStoreOptions({ name: "settings" }),
  defaults: {
    settings: DEFAULT_APP_SETTINGS,
  },
});

function mergeSettings(
  current: AppSettings,
  patch: AppSettingsPatch,
): AppSettings {
  return {
    general: {
      ...current.general,
      ...patch.general,
    },
    appearance: {
      ...current.appearance,
      ...patch.appearance,
    },
    privacy: {
      ...current.privacy,
      ...patch.privacy,
    },
  };
}

/** Stored settings over the defaults, so keys added later always exist. */
export function getSettings(): AppSettings {
  return mergeSettings(DEFAULT_APP_SETTINGS, store.get("settings"));
}

export function updateSettings(patch: AppSettingsPatch): AppSettings {
  const current = getSettings();
  const updated = mergeSettings(current, patch);
  store.set("settings", updated);
  return updated;
}
