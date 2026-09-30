import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTempDir } from "../support/store";

describe("settings-store", () => {
  beforeEach(() => {
    process.env.PG_COMPASS_STORE_DIR = createTempDir("pg-compass-settings-");
    vi.resetModules();
  });

  it("merges settings patches without dropping unrelated keys", async () => {
    const { getSettings, updateSettings } =
      await import("@/main/settings-store");

    updateSettings({
      appearance: { theme: "light" },
      general: { hideInternalSchemas: false },
    });

    expect(getSettings()).toMatchObject({
      appearance: { theme: "light" },
      general: { hideInternalSchemas: false, enableDevTools: true },
      privacy: { automaticUpdates: true },
    });
  });

  it("fills settings added after the file was written with defaults", async () => {
    const storeDir = process.env.PG_COMPASS_STORE_DIR ?? "";
    fs.writeFileSync(
      path.join(storeDir, "settings.json"),
      JSON.stringify({
        settings: {
          general: {
            readOnlyMode: true,
            shellAccess: true,
            enableDevTools: true,
            hideInternalSchemas: true,
          },
          appearance: { theme: "dark", sidebarWidth: 256, density: "compact" },
          privacy: { automaticUpdates: true },
        },
      }),
    );
    const { getSettings } = await import("@/main/settings-store");

    expect(getSettings().general).toMatchObject({
      readOnlyMode: true,
      shellAccess: true,
      psqlPath: "",
    });
  });
});
