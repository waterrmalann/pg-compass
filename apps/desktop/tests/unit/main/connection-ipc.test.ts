import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseEstimatedRowCount,
  getSchemaFilterSql,
  registerConnectionHandlers,
} from '../../../src/main/connection-ipc';

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted() for state that must exist when the factory runs.
// ---------------------------------------------------------------------------

const storeData = vi.hoisted(() => new Map<string, unknown>());

const mockIpcMain = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
}));

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

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

// pg mock — no live DB connections needed for handler registration tests.
vi.mock('pg', () => ({
  Client: vi.fn(),
  Pool: vi.fn(),
}));

import { ConnectionChannels } from '../../../src/shared/types/connection';

// ---------------------------------------------------------------------------
// Helper to extract a registered IPC handler by channel name
// ---------------------------------------------------------------------------

function getHandler(channel: string) {
  const calls = mockIpcMain.handle.mock.calls;
  const call = calls.find(([ch]: [string]) => ch === channel);
  if (!call) throw new Error(`No handler registered for channel: ${channel}`);
  return call[1];
}

// ---------------------------------------------------------------------------
// parseEstimatedRowCount
// ---------------------------------------------------------------------------

describe('parseEstimatedRowCount', () => {
  it('returns null for null input', () => {
    expect(parseEstimatedRowCount(null)).toBeNull();
  });

  it('returns the number when passed a positive integer', () => {
    expect(parseEstimatedRowCount(42)).toBe(42);
  });

  it('rounds floating-point numbers', () => {
    expect(parseEstimatedRowCount(42.7)).toBe(43);
    expect(parseEstimatedRowCount(42.2)).toBe(42);
  });

  it('parses a numeric string', () => {
    expect(parseEstimatedRowCount('100')).toBe(100);
  });

  it('returns null for NaN string', () => {
    expect(parseEstimatedRowCount('not-a-number')).toBeNull();
  });

  it('clamps negative values to 0', () => {
    expect(parseEstimatedRowCount(-5)).toBe(0);
  });

  it('returns 0 for zero', () => {
    expect(parseEstimatedRowCount(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getSchemaFilterSql
// ---------------------------------------------------------------------------

describe('getSchemaFilterSql', () => {
  it('returns empty string when internal schemas are included', () => {
    expect(getSchemaFilterSql(true, 'schema_name')).toBe('');
  });

  it('excludes pg_catalog and information_schema when filtering', () => {
    const sql = getSchemaFilterSql(false, 'schema_name');
    expect(sql).toContain("NOT IN ('pg_catalog', 'information_schema')");
    expect(sql).toContain('schema_name');
  });

  it('excludes pg_toast% schemas when filtering', () => {
    const sql = getSchemaFilterSql(false, 'schema_name');
    expect(sql).toContain("NOT LIKE 'pg_toast%'");
  });

  it('excludes pg_temp% schemas when filtering', () => {
    const sql = getSchemaFilterSql(false, 'schema_name');
    expect(sql).toContain("NOT LIKE 'pg_temp%'");
  });

  it('uses the provided column name in the filter', () => {
    const sql = getSchemaFilterSql(false, 'n.nspname');
    expect(sql).toContain('n.nspname');
  });
});

// ---------------------------------------------------------------------------
// registerConnectionHandlers — handler registration
// ---------------------------------------------------------------------------

describe('registerConnectionHandlers', () => {
  beforeEach(() => {
    storeData.clear();
    storeData.set('connections', []);
    vi.clearAllMocks();
    registerConnectionHandlers();
  });

  it('registers the get-all handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      ConnectionChannels.GET_ALL,
      expect.any(Function),
    );
  });

  it('registers the get-by-id handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      ConnectionChannels.GET_BY_ID,
      expect.any(Function),
    );
  });

  it('registers the create handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      ConnectionChannels.CREATE,
      expect.any(Function),
    );
  });

  it('registers the update handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      ConnectionChannels.UPDATE,
      expect.any(Function),
    );
  });

  it('registers the delete handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      ConnectionChannels.DELETE,
      expect.any(Function),
    );
  });

  it('registers the toggle-favourite handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      ConnectionChannels.TOGGLE_FAVOURITE,
      expect.any(Function),
    );
  });

  it('registers the test handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      ConnectionChannels.TEST,
      expect.any(Function),
    );
  });

  it('registers the get-schema-tree handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      ConnectionChannels.GET_SCHEMA_TREE,
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// registerConnectionHandlers — handler behaviour (get-all, create, delete)
// ---------------------------------------------------------------------------

describe('connections:get-all handler', () => {
  beforeEach(() => {
    storeData.clear();
    storeData.set('connections', []);
    vi.clearAllMocks();
    registerConnectionHandlers();
  });

  it('returns success with empty array when no connections exist', async () => {
    const handler = getHandler(ConnectionChannels.GET_ALL);
    const result = await handler({});
    expect(result).toEqual({ success: true, data: [] });
  });
});

describe('connections:create handler', () => {
  beforeEach(() => {
    storeData.clear();
    storeData.set('connections', []);
    vi.clearAllMocks();
    registerConnectionHandlers();
  });

  it('returns success with the new connection', async () => {
    const handler = getHandler(ConnectionChannels.CREATE);
    const input = {
      label: 'New Conn',
      favourite: false,
      mode: 'fields' as const,
      fields: { host: 'localhost', port: 5432, database: 'db', user: 'u', password: 'p' },
    };
    const result = await handler({}, input);
    expect(result.success).toBe(true);
    expect(result.data?.label).toBe('New Conn');
    expect(result.data?.id).toBeDefined();
  });
});

describe('connections:get-by-id handler', () => {
  beforeEach(() => {
    storeData.clear();
    storeData.set('connections', []);
    vi.clearAllMocks();
    registerConnectionHandlers();
  });

  it('returns failure when connection does not exist', async () => {
    const handler = getHandler(ConnectionChannels.GET_BY_ID);
    const result = await handler({}, 'nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('connections:toggle-favourite handler', () => {
  beforeEach(() => {
    storeData.clear();
    storeData.set('connections', []);
    vi.clearAllMocks();
    registerConnectionHandlers();
  });

  it('returns failure when connection does not exist', async () => {
    const handler = getHandler(ConnectionChannels.TOGGLE_FAVOURITE);
    const result = await handler({}, 'nonexistent');
    expect(result.success).toBe(false);
  });
});
