export type ThemePreference = "light" | "dark" | "system";

/** Row/cell density for data tables and the card viewer. */
export type DensityPreference = "compact" | "comfortable";

export interface GeneralSettings {
  readOnlyMode: boolean;
  shellAccess: boolean;
  /** Absolute path to psql; empty means search PATH and common locations. */
  psqlPath: string;
  enableDevTools: boolean;
  hideInternalSchemas: boolean;
}

export interface AppearanceSettings {
  theme: ThemePreference;
  sidebarWidth: number;
  density: DensityPreference;
}

export interface PrivacySettings {
  automaticUpdates: boolean;
}

export interface AppSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  privacy: PrivacySettings;
}

export interface AppSettingsPatch {
  general?: Partial<GeneralSettings>;
  appearance?: Partial<AppearanceSettings>;
  privacy?: Partial<PrivacySettings>;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  general: {
    readOnlyMode: false,
    shellAccess: false,
    psqlPath: "",
    enableDevTools: true,
    hideInternalSchemas: true,
  },
  appearance: {
    theme: "dark",
    sidebarWidth: 256,
    density: "compact",
  },
  privacy: {
    automaticUpdates: true,
  },
};
