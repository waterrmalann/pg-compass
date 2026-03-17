import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ensureArray,
  isReadOnlyQuery,
  registerTableDataHandlers,
} from '../../../src/main/table-data-ipc';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockIpcMain = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
}));

vi.mock('pg', () => ({
  Pool: vi.fn(),
}));

import { TableDataChannels } from '../../../src/shared/types/table-data';

// ---------------------------------------------------------------------------
// ensureArray
// ---------------------------------------------------------------------------

describe('ensureArray', () => {
  it('returns an array unchanged', () => {
    expect(ensureArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('parses a PostgreSQL array string', () => {
    expect(ensureArray('{a,b,c}')).toEqual(['a', 'b', 'c']);
  });

  it('parses a PostgreSQL array string with quoted values', () => {
    expect(ensureArray('{"hello world","foo"}')).toEqual(['hello world', 'foo']);
  });

  it('returns an empty array for an empty pg array string', () => {
    expect(ensureArray('{}')).toEqual([]);
  });

  it('returns an empty array for null', () => {
    expect(ensureArray(null)).toEqual([]);
  });

  it('returns an empty array for undefined', () => {
    expect(ensureArray(undefined)).toEqual([]);
  });

  it('returns an empty array for a number', () => {
    expect(ensureArray(42)).toEqual([]);
  });

  it('returns an empty array for an object', () => {
    expect(ensureArray({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isReadOnlyQuery
// ---------------------------------------------------------------------------

describe('isReadOnlyQuery', () => {
  it('accepts a SELECT statement', () => {
    expect(isReadOnlyQuery('SELECT * FROM users')).toBe(true);
  });

  it('accepts a lowercase select statement', () => {
    expect(isReadOnlyQuery('select id from orders')).toBe(true);
  });

  it('accepts a CTE starting with WITH', () => {
    expect(isReadOnlyQuery('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true);
  });

  it('accepts a with keyword in lowercase', () => {
    expect(isReadOnlyQuery('with cte as (select 1) select * from cte')).toBe(true);
  });

  it('accepts statements with leading whitespace', () => {
    expect(isReadOnlyQuery('  SELECT 1')).toBe(true);
  });

  it('rejects an INSERT statement', () => {
    expect(isReadOnlyQuery('INSERT INTO users VALUES (1)')).toBe(false);
  });

  it('rejects an UPDATE statement', () => {
    expect(isReadOnlyQuery('UPDATE users SET name = $1')).toBe(false);
  });

  it('rejects a DELETE statement', () => {
    expect(isReadOnlyQuery('DELETE FROM users WHERE id = 1')).toBe(false);
  });

  it('rejects a DROP statement', () => {
    expect(isReadOnlyQuery('DROP TABLE users')).toBe(false);
  });

  it('rejects a CREATE statement', () => {
    expect(isReadOnlyQuery('CREATE TABLE foo (id INT)')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isReadOnlyQuery('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registerTableDataHandlers — handler registration
// ---------------------------------------------------------------------------

describe('registerTableDataHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerTableDataHandlers();
  });

  it('registers the get-rows handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      TableDataChannels.GET_ROWS,
      expect.any(Function),
    );
  });

  it('registers the get-structure handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      TableDataChannels.GET_STRUCTURE,
      expect.any(Function),
    );
  });

  it('registers the get-indexes handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      TableDataChannels.GET_INDEXES,
      expect.any(Function),
    );
  });

  it('registers the get-constraints handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      TableDataChannels.GET_CONSTRAINTS,
      expect.any(Function),
    );
  });

  it('registers the execute-query handler', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      TableDataChannels.EXECUTE_QUERY,
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// execute-query handler — read-only validation (no DB required)
// ---------------------------------------------------------------------------

describe('table-data:execute-query handler — read-only guard', () => {
  function getHandler(channel: string) {
    const calls = mockIpcMain.handle.mock.calls;
    const call = calls.find(([ch]: [string]) => ch === channel);
    if (!call) throw new Error(`No handler for channel: ${channel}`);
    return call[1];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    registerTableDataHandlers();
  });

  it('returns failure for a non-SELECT query', async () => {
    const handler = getHandler(TableDataChannels.EXECUTE_QUERY);
    const result = await handler({}, {
      connectionId: 'any',
      sql: 'DELETE FROM users',
      page: 1,
      pageSize: 25,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('SELECT');
  });

  it('returns failure for an INSERT query', async () => {
    const handler = getHandler(TableDataChannels.EXECUTE_QUERY);
    const result = await handler({}, {
      connectionId: 'any',
      sql: 'INSERT INTO users VALUES (1)',
      page: 1,
      pageSize: 25,
    });
    expect(result.success).toBe(false);
  });
});
