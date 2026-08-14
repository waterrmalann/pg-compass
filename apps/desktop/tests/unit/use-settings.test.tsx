import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { DEFAULT_APP_SETTINGS } from "@/shared/types/settings";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("useSettings", () => {
  beforeEach(() => {
    const matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    vi.stubGlobal("matchMedia", matchMedia);
    Object.assign(window, {
      settingsApi: {
        get: vi.fn().mockResolvedValue({
          success: true,
          data: DEFAULT_APP_SETTINGS,
        }),
        update: vi.fn().mockResolvedValue({
          success: true,
          data: {
            ...DEFAULT_APP_SETTINGS,
            appearance: {
              ...DEFAULT_APP_SETTINGS.appearance,
              theme: "light",
            },
          },
        }),
      },
    });
  });

  it("loads settings and updates the theme", async () => {
    const { result } = renderHook(() => useSettings(), {
      wrapper: SettingsProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.appearance.theme).toBe("dark");

    await act(async () => {
      await result.current.setTheme("light");
    });

    await waitFor(() =>
      expect(result.current.settings.appearance.theme).toBe("light"),
    );
  });

  it("surfaces an error toast and returns null when saving settings fails", async () => {
    Object.assign(window, {
      settingsApi: {
        get: vi.fn().mockResolvedValue({
          success: true,
          data: DEFAULT_APP_SETTINGS,
        }),
        update: vi.fn().mockResolvedValue({
          success: false,
          error: "disk full",
        }),
      },
    });

    const { result } = renderHook(() => useSettings(), {
      wrapper: SettingsProvider,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.updateSettings({
        appearance: { theme: "light" },
      });
    });

    expect(returned).toBeNull();
    // The setting stays unchanged rather than silently appearing to apply.
    expect(result.current.settings.appearance.theme).toBe("dark");
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to save settings",
      expect.objectContaining({ description: "disk full" }),
    );
  });
});
