import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionConfig, ConnectionInput } from '../../../src/shared/types/connection';

// ---------------------------------------------------------------------------
// Mock electron-store with an in-memory implementation using vi.hoisted() so
// the factory closure can safely reference `storeData`.
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

// safeStorage.isEncryptionAvailable returns false so credentials are stored
// as plain text in the in-memory store during tests.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

import {
  getAllConnections,
  getConnectionById,
  createConnection,
  updateConnection,
  deleteConnection,
  toggleFavourite,
} from '../../../src/main/connection-store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return {
    label: 'Local Dev',
    favourite: false,
    mode: 'fields',
    fields: {
      host: 'localhost',
      port: 5432,
      database: 'dev',
      user: 'postgres',
      password: 'secret',
    },
    ...overrides,
  };
}

beforeEach(() => {
  storeData.clear();
  storeData.set('connections', []);
});

// ---------------------------------------------------------------------------
// getAllConnections
// ---------------------------------------------------------------------------

describe('getAllConnections', () => {
  it('returns an empty array when no connections exist', () => {
    expect(getAllConnections()).toEqual([]);
  });

  it('returns all stored connections', () => {
    createConnection(makeInput({ label: 'A' }));
    createConnection(makeInput({ label: 'B' }));
    expect(getAllConnections()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// createConnection
// ---------------------------------------------------------------------------

describe('createConnection', () => {
  it('returns the created connection with an assigned id', () => {
    const conn = createConnection(makeInput());
    expect(conn.id).toBeDefined();
    expect(typeof conn.id).toBe('string');
    expect(conn.label).toBe('Local Dev');
  });

  it('persists the connection so it can be retrieved', () => {
    const conn = createConnection(makeInput());
    const all = getAllConnections();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(conn.id);
  });

  it('assigns unique ids to each new connection', () => {
    const a = createConnection(makeInput({ label: 'A' }));
    const b = createConnection(makeInput({ label: 'B' }));
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// getConnectionById
// ---------------------------------------------------------------------------

describe('getConnectionById', () => {
  it('returns the connection with matching id', () => {
    const conn = createConnection(makeInput());
    const found = getConnectionById(conn.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(conn.id);
  });

  it('returns undefined for an unknown id', () => {
    expect(getConnectionById('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateConnection
// ---------------------------------------------------------------------------

describe('updateConnection', () => {
  it('updates the label of an existing connection', () => {
    const conn = createConnection(makeInput());
    const updated = updateConnection(conn.id, makeInput({ label: 'Updated' }));
    expect(updated).toBeDefined();
    expect(updated!.label).toBe('Updated');
    expect(updated!.id).toBe(conn.id);
  });

  it('returns undefined for an unknown id', () => {
    expect(updateConnection('nonexistent', makeInput())).toBeUndefined();
  });

  it('persists the updated connection', () => {
    const conn = createConnection(makeInput());
    updateConnection(conn.id, makeInput({ label: 'New Label' }));
    const found = getConnectionById(conn.id);
    expect(found!.label).toBe('New Label');
  });
});

// ---------------------------------------------------------------------------
// deleteConnection
// ---------------------------------------------------------------------------

describe('deleteConnection', () => {
  it('returns true when the connection is deleted', () => {
    const conn = createConnection(makeInput());
    expect(deleteConnection(conn.id)).toBe(true);
  });

  it('removes the connection from the store', () => {
    const conn = createConnection(makeInput());
    deleteConnection(conn.id);
    expect(getAllConnections()).toHaveLength(0);
  });

  it('returns false for an unknown id', () => {
    expect(deleteConnection('nonexistent')).toBe(false);
  });

  it('only removes the targeted connection', () => {
    const a = createConnection(makeInput({ label: 'A' }));
    const b = createConnection(makeInput({ label: 'B' }));
    deleteConnection(a.id);
    const remaining = getAllConnections();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// toggleFavourite
// ---------------------------------------------------------------------------

describe('toggleFavourite', () => {
  it('returns undefined for an unknown id', () => {
    expect(toggleFavourite('nonexistent')).toBeUndefined();
  });

  it('sets favourite to true when it was false', () => {
    const conn = createConnection(makeInput({ favourite: false }));
    const result = toggleFavourite(conn.id);
    // toggleFavourite returns the raw stored item (encrypted form in prod)
    // so we check via getConnectionById which decrypts
    const found = getConnectionById(conn.id);
    expect(found!.favourite).toBe(true);
  });

  it('sets favourite to false when it was true', () => {
    const conn = createConnection(makeInput({ favourite: true }));
    toggleFavourite(conn.id);
    const found = getConnectionById(conn.id);
    expect(found!.favourite).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// URI connection mode
// ---------------------------------------------------------------------------

describe('URI mode connection', () => {
  it('stores and retrieves a URI-based connection', () => {
    const input: ConnectionInput = {
      label: 'Remote',
      favourite: false,
      mode: 'uri',
      uri: 'postgresql://admin:secret@db.example.com:5432/prod',
    };
    const conn = createConnection(input);
    const found = getConnectionById(conn.id);
    expect(found!.mode).toBe('uri');
    expect(found!.uri).toBe('postgresql://admin:secret@db.example.com:5432/prod');
  });
});
