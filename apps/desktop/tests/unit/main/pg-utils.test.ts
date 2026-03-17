import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPgConfig, quoteIdent, destroyPool, destroyAllPools } from '../../../src/main/pg-utils';
import type { ConnectionConfig } from '../../../src/shared/types/connection';

// ---------------------------------------------------------------------------
// Mock electron-store and electron so that connection-store (a transitive
// dependency of pg-utils) can be imported in the Node test environment.
// ---------------------------------------------------------------------------

vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  })),
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUriConnection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    label: 'Test URI',
    favourite: false,
    mode: 'uri',
    uri: 'postgresql://user:pass@localhost:5432/mydb',
    ...overrides,
  };
}

function makeFieldsConnection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-2',
    label: 'Test Fields',
    favourite: false,
    mode: 'fields',
    fields: {
      host: 'localhost',
      port: 5432,
      database: 'mydb',
      user: 'user',
      password: 'pass',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildPgConfig
// ---------------------------------------------------------------------------

describe('buildPgConfig', () => {
  it('returns connectionString when mode is uri', () => {
    const config = buildPgConfig(makeUriConnection());
    expect(config).toEqual({
      connectionString: 'postgresql://user:pass@localhost:5432/mydb',
    });
  });

  it('returns field-based config when mode is fields', () => {
    const config = buildPgConfig(makeFieldsConnection());
    expect(config).toMatchObject({
      host: 'localhost',
      port: 5432,
      database: 'mydb',
      user: 'user',
      password: 'pass',
    });
  });

  it('throws when mode is fields but fields are missing', () => {
    const conn: ConnectionConfig = {
      id: 'bad',
      label: 'Bad',
      favourite: false,
      mode: 'fields',
    };
    expect(() => buildPgConfig(conn)).toThrow('Connection fields are required');
  });

  it('includes ssl config when ssl is enabled', () => {
    const conn = makeFieldsConnection({
      ssl: {
        enabled: true,
        rejectUnauthorized: false,
        ca: 'ca-cert',
      },
    });
    const config = buildPgConfig(conn);
    expect(config).toHaveProperty('ssl');
    expect((config as Record<string, unknown>).ssl).toMatchObject({
      rejectUnauthorized: false,
      ca: 'ca-cert',
    });
  });

  it('omits ssl config when ssl is disabled', () => {
    const conn = makeFieldsConnection({
      ssl: { enabled: false },
    });
    const config = buildPgConfig(conn);
    expect(config).not.toHaveProperty('ssl');
  });

  it('includes cert and key in ssl config when provided', () => {
    const conn = makeFieldsConnection({
      ssl: {
        enabled: true,
        rejectUnauthorized: true,
        cert: 'client-cert',
        key: 'client-key',
      },
    });
    const config = buildPgConfig(conn);
    expect((config as Record<string, unknown>).ssl).toMatchObject({
      cert: 'client-cert',
      key: 'client-key',
    });
  });

  it('defaults rejectUnauthorized to true when not specified', () => {
    const conn = makeFieldsConnection({
      ssl: { enabled: true },
    });
    const config = buildPgConfig(conn);
    expect((config as Record<string, unknown>).ssl).toMatchObject({
      rejectUnauthorized: true,
    });
  });
});

// ---------------------------------------------------------------------------
// quoteIdent
// ---------------------------------------------------------------------------

describe('quoteIdent', () => {
  it('wraps identifier in double quotes', () => {
    expect(quoteIdent('tablename')).toBe('"tablename"');
  });

  it('escapes embedded double quotes', () => {
    expect(quoteIdent('table"name')).toBe('"table""name"');
  });

  it('handles identifiers with spaces', () => {
    expect(quoteIdent('my table')).toBe('"my table"');
  });

  it('handles identifiers with multiple double quotes', () => {
    expect(quoteIdent('a"b"c')).toBe('"a""b""c"');
  });

  it('handles an empty string', () => {
    expect(quoteIdent('')).toBe('""');
  });
});

// ---------------------------------------------------------------------------
// destroyPool / destroyAllPools (smoke tests — no live DB needed)
// ---------------------------------------------------------------------------

describe('destroyPool', () => {
  it('resolves without error for an unknown connection ID', async () => {
    await expect(destroyPool('nonexistent-id')).resolves.toBeUndefined();
  });
});

describe('destroyAllPools', () => {
  it('resolves without error when there are no pools', async () => {
    await expect(destroyAllPools()).resolves.toBeUndefined();
  });
});
