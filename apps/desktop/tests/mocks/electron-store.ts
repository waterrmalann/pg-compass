import { vi } from 'vitest';

const store = new Map<string, unknown>();

const ElectronStore = vi.fn().mockImplementation(() => ({
  get: vi.fn((key: string, defaultValue?: unknown) =>
    store.has(key) ? store.get(key) : defaultValue,
  ),
  set: vi.fn((key: string, value: unknown) => {
    store.set(key, value);
  }),
  delete: vi.fn((key: string) => {
    store.delete(key);
  }),
  has: vi.fn((key: string) => store.has(key)),
  clear: vi.fn(() => store.clear()),
}));

export default ElectronStore;

/** Reset the backing Map between tests. */
export function resetStore(): void {
  store.clear();
}
