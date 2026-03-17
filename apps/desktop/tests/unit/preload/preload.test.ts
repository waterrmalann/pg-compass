import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ConnectionChannels } from '../../../src/shared/types/connection';
import { SettingsChannels } from '../../../src/shared/types/settings';
import { TableDataChannels } from '../../../src/shared/types/table-data';

// ---------------------------------------------------------------------------
// Mocks — defined via vi.hoisted() so they're available when the factory runs.
// ---------------------------------------------------------------------------

const mockContextBridge = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
}));

const mockIpcRenderer = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: mockContextBridge,
  ipcRenderer: mockIpcRenderer,
}));

// Load the preload script AFTER mocks are in place.
beforeAll(async () => {
  await import('../../../src/preload');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExposedApi(name: string): Record<string, (...args: unknown[]) => unknown> {
  const calls = mockContextBridge.exposeInMainWorld.mock.calls;
  const call = calls.find(([n]: [string]) => n === name);
  if (!call) throw new Error(`API not exposed: ${name}`);
  return call[1] as Record<string, (...args: unknown[]) => unknown>;
}

// ---------------------------------------------------------------------------
// contextBridge exposure
// ---------------------------------------------------------------------------

describe('preload contextBridge', () => {
  it('exposes connectionApi to the main world', () => {
    const names = mockContextBridge.exposeInMainWorld.mock.calls.map(([n]: [string]) => n);
    expect(names).toContain('connectionApi');
  });

  it('exposes settingsApi to the main world', () => {
    const names = mockContextBridge.exposeInMainWorld.mock.calls.map(([n]: [string]) => n);
    expect(names).toContain('settingsApi');
  });

  it('exposes tableDataApi to the main world', () => {
    const names = mockContextBridge.exposeInMainWorld.mock.calls.map(([n]: [string]) => n);
    expect(names).toContain('tableDataApi');
  });
});

// ---------------------------------------------------------------------------
// connectionApi channel forwarding
// ---------------------------------------------------------------------------

describe('connectionApi', () => {
  it('getAll invokes the correct channel', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: [] });
    const api = getExposedApi('connectionApi');
    await (api.getAll as () => Promise<unknown>)();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(ConnectionChannels.GET_ALL);
  });

  it('getById invokes the correct channel with the id', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: {} });
    const api = getExposedApi('connectionApi');
    await (api.getById as (id: string) => Promise<unknown>)('conn-1');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(ConnectionChannels.GET_BY_ID, 'conn-1');
  });

  it('create invokes the correct channel with the input', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: {} });
    const api = getExposedApi('connectionApi');
    const input = { label: 'Test', favourite: false, mode: 'uri' as const, uri: 'postgres://x' };
    await (api.create as (input: unknown) => Promise<unknown>)(input);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(ConnectionChannels.CREATE, input);
  });

  it('delete invokes the correct channel with the id', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: true });
    const api = getExposedApi('connectionApi');
    await (api.delete as (id: string) => Promise<unknown>)('conn-1');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(ConnectionChannels.DELETE, 'conn-1');
  });

  it('toggleFavourite invokes the correct channel', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: {} });
    const api = getExposedApi('connectionApi');
    await (api.toggleFavourite as (id: string) => Promise<unknown>)('conn-1');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(ConnectionChannels.TOGGLE_FAVOURITE, 'conn-1');
  });

  it('test invokes the correct channel', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: true });
    const api = getExposedApi('connectionApi');
    await (api.test as (id: string) => Promise<unknown>)('conn-1');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(ConnectionChannels.TEST, 'conn-1');
  });

  it('getSchemaTree invokes the correct channel', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: [] });
    const api = getExposedApi('connectionApi');
    await (api.getSchemaTree as (id: string) => Promise<unknown>)('conn-1');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
      ConnectionChannels.GET_SCHEMA_TREE,
      'conn-1',
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// settingsApi channel forwarding
// ---------------------------------------------------------------------------

describe('settingsApi', () => {
  it('get invokes the correct channel', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: {} });
    const api = getExposedApi('settingsApi');
    await (api.get as () => Promise<unknown>)();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(SettingsChannels.GET);
  });

  it('update invokes the correct channel with the patch', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: {} });
    const api = getExposedApi('settingsApi');
    const patch = { appearance: { theme: 'dark' as const } };
    await (api.update as (patch: unknown) => Promise<unknown>)(patch);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(SettingsChannels.UPDATE, patch);
  });
});

// ---------------------------------------------------------------------------
// tableDataApi channel forwarding
// ---------------------------------------------------------------------------

describe('tableDataApi', () => {
  it('getRows invokes the correct channel', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: {} });
    const api = getExposedApi('tableDataApi');
    const params = { connectionId: 'c', schema: 's', table: 't', page: 1, pageSize: 25 };
    await (api.getRows as (p: unknown) => Promise<unknown>)(params);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(TableDataChannels.GET_ROWS, params);
  });

  it('executeQuery invokes the correct channel', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: {} });
    const api = getExposedApi('tableDataApi');
    const params = { connectionId: 'c', sql: 'SELECT 1', page: 1, pageSize: 25 };
    await (api.executeQuery as (p: unknown) => Promise<unknown>)(params);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(TableDataChannels.EXECUTE_QUERY, params);
  });

  it('getStructure invokes the correct channel', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: [] });
    const api = getExposedApi('tableDataApi');
    const params = { connectionId: 'c', schema: 's', table: 't' };
    await (api.getStructure as (p: unknown) => Promise<unknown>)(params);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(TableDataChannels.GET_STRUCTURE, params);
  });
});
