import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types/settings';

// ---------------------------------------------------------------------------
// Mock electron-store with an in-memory implementation via vi.hoisted() so
// the factory closure can reference `storeData` without TDZ issues.
// ---------------------------------------------------------------------------

const storeData = vi.hoisted(() => new Map<string, unknown>());

vi.mock('electron-store', () => {
  const Store = vi.fn().mockImplementation((opts: { defaults?: Record<string, unknown> }) => {
    if (opts?.defaults) {
      for (const [key, value] of Object.entries(opts.defaults)) {
        if (!storeData.has(key)) storeData.set(key, value);
      }
    }
    return {
      get: vi.fn((key: string) => storeData.get(key)),
      set: vi.fn((key: string, value: unknown) => storeData.set(key, value)),
    };
  });
  return { default: Store };
});

// electron is only needed for safeStorage in connection-store.ts; settings-store
// does not use it, but we mock it defensively in case it gets transitively imported.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

import { getSettings, updateSettings } from '../../../src/main/settings-store';

beforeEach(() => {
  storeData.clear();
  storeData.set('settings', structuredClone(DEFAULT_APP_SETTINGS));
});

// ---------------------------------------------------------------------------
// getSettings
// ---------------------------------------------------------------------------

describe('getSettings', () => {
  it('returns the default settings', () => {
    const settings = getSettings();
    expect(settings).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('returns the dark theme by default', () => {
    const settings = getSettings();
    expect(settings.appearance.theme).toBe('dark');
  });

  it('returns the default sidebar width', () => {
    const settings = getSettings();
    expect(settings.appearance.sidebarWidth).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe('updateSettings', () => {
  it('applies a partial appearance patch', () => {
    const updated = updateSettings({ appearance: { theme: 'light' } });
    expect(updated.appearance.theme).toBe('light');
    expect(updated.appearance.sidebarWidth).toBe(256);
  });

  it('applies a partial general patch', () => {
    const updated = updateSettings({ general: { readOnlyMode: true } });
    expect(updated.general.readOnlyMode).toBe(true);
    expect(updated.general.enableDevTools).toBe(DEFAULT_APP_SETTINGS.general.enableDevTools);
  });

  it('applies a partial privacy patch', () => {
    const updated = updateSettings({ privacy: { automaticUpdates: false } });
    expect(updated.privacy.automaticUpdates).toBe(false);
  });

  it('persists changes so getSettings reflects the update', () => {
    updateSettings({ appearance: { theme: 'system' } });
    const settings = getSettings();
    expect(settings.appearance.theme).toBe('system');
  });

  it('does not modify unrelated settings when patching one section', () => {
    updateSettings({ appearance: { sidebarWidth: 320 } });
    const settings = getSettings();
    expect(settings.general).toEqual(DEFAULT_APP_SETTINGS.general);
    expect(settings.privacy).toEqual(DEFAULT_APP_SETTINGS.privacy);
  });

  it('supports updating multiple sections at once', () => {
    const updated = updateSettings({
      appearance: { theme: 'light' },
      general: { readOnlyMode: true },
    });
    expect(updated.appearance.theme).toBe('light');
    expect(updated.general.readOnlyMode).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// getSettings
// ---------------------------------------------------------------------------

describe('getSettings', () => {
  it('returns the default settings', () => {
    const settings = getSettings();
    expect(settings).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('returns the dark theme by default', () => {
    const settings = getSettings();
    expect(settings.appearance.theme).toBe('dark');
  });

  it('returns the default sidebar width', () => {
    const settings = getSettings();
    expect(settings.appearance.sidebarWidth).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe('updateSettings', () => {
  it('applies a partial appearance patch', () => {
    const updated = updateSettings({ appearance: { theme: 'light' } });
    expect(updated.appearance.theme).toBe('light');
    expect(updated.appearance.sidebarWidth).toBe(256);
  });

  it('applies a partial general patch', () => {
    const updated = updateSettings({ general: { readOnlyMode: true } });
    expect(updated.general.readOnlyMode).toBe(true);
    expect(updated.general.enableDevTools).toBe(DEFAULT_APP_SETTINGS.general.enableDevTools);
  });

  it('applies a partial privacy patch', () => {
    const updated = updateSettings({ privacy: { automaticUpdates: false } });
    expect(updated.privacy.automaticUpdates).toBe(false);
  });

  it('persists changes so getSettings reflects the update', () => {
    updateSettings({ appearance: { theme: 'system' } });
    const settings = getSettings();
    expect(settings.appearance.theme).toBe('system');
  });

  it('does not modify unrelated settings when patching one section', () => {
    updateSettings({ appearance: { sidebarWidth: 320 } });
    const settings = getSettings();
    expect(settings.general).toEqual(DEFAULT_APP_SETTINGS.general);
    expect(settings.privacy).toEqual(DEFAULT_APP_SETTINGS.privacy);
  });

  it('supports updating multiple sections at once', () => {
    const updated = updateSettings({
      appearance: { theme: 'light' },
      general: { readOnlyMode: true },
    });
    expect(updated.appearance.theme).toBe('light');
    expect(updated.general.readOnlyMode).toBe(true);
  });
});
