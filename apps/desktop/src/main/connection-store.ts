import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import { safeStorage } from 'electron';
import type {
  ConnectionConfig,
  ConnectionInput,
} from '../shared/types/connection';

interface StoreSchema {
  connections: ConnectionConfig[];
}

const store = new Store<StoreSchema>({
  name: 'connections',
  defaults: {
    connections: [],
  },
});

// ---------------------------------------------------------------------------
// Credential encryption helpers
// ---------------------------------------------------------------------------

const ENCRYPTED_PREFIX = 'esafe:';

function encryptField(value: string | undefined): string | undefined {
  if (!value || !safeStorage.isEncryptionAvailable()) return value;
  const encrypted = safeStorage.encryptString(value);
  return ENCRYPTED_PREFIX + encrypted.toString('base64');
}

function decryptField(value: string | undefined): string | undefined {
  if (!value?.startsWith(ENCRYPTED_PREFIX)) return value;
  if (!safeStorage.isEncryptionAvailable()) return value;
  const base64 = value.slice(ENCRYPTED_PREFIX.length);
  return safeStorage.decryptString(Buffer.from(base64, 'base64'));
}

function encryptConnection(connection: ConnectionConfig): ConnectionConfig {
  const encrypted = structuredClone(connection);
  if (encrypted.uri) {
    encrypted.uri = encryptField(encrypted.uri);
  }
  if (encrypted.fields?.password) {
    encrypted.fields.password = encryptField(encrypted.fields.password)!;
  }
  if (encrypted.ssh?.password) {
    encrypted.ssh.password = encryptField(encrypted.ssh.password);
  }
  if (encrypted.ssh?.passphrase) {
    encrypted.ssh.passphrase = encryptField(encrypted.ssh.passphrase);
  }
  return encrypted;
}

function decryptConnection(connection: ConnectionConfig): ConnectionConfig {
  const decrypted = structuredClone(connection);
  if (decrypted.uri) {
    decrypted.uri = decryptField(decrypted.uri);
  }
  if (decrypted.fields?.password) {
    decrypted.fields.password = decryptField(decrypted.fields.password)!;
  }
  if (decrypted.ssh?.password) {
    decrypted.ssh.password = decryptField(decrypted.ssh.password);
  }
  if (decrypted.ssh?.passphrase) {
    decrypted.ssh.passphrase = decryptField(decrypted.ssh.passphrase);
  }
  return decrypted;
}

/** Get all saved connections (with credentials decrypted). */
export function getAllConnections(): ConnectionConfig[] {
  return store.get('connections').map(decryptConnection);
}

/** Get a single connection by ID (with credentials decrypted). */
export function getConnectionById(
  id: string,
): ConnectionConfig | undefined {
  const connections = store.get('connections');
  const connection = connections.find((c) => c.id === id);
  return connection ? decryptConnection(connection) : undefined;
}

/** Create a new connection and return it (decrypted). */
export function createConnection(
  input: ConnectionInput,
): ConnectionConfig {
  const connection: ConnectionConfig = {
    ...input,
    id: randomUUID(),
  };
  const connections = store.get('connections');
  connections.push(encryptConnection(connection));
  store.set('connections', connections);
  return connection;
}

/** Update an existing connection by ID. Returns the updated connection (decrypted) or undefined. */
export function updateConnection(
  id: string,
  input: ConnectionInput,
): ConnectionConfig | undefined {
  const connections = store.get('connections');
  const index = connections.findIndex((c) => c.id === id);
  if (index === -1) return undefined;

  const updated: ConnectionConfig = { ...input, id };
  connections[index] = encryptConnection(updated);
  store.set('connections', connections);
  return updated;
}

/** Delete a connection by ID. Returns true if deleted. */
export function deleteConnection(id: string): boolean {
  const connections = store.get('connections');
  const filtered = connections.filter((c) => c.id !== id);
  if (filtered.length === connections.length) return false;
  store.set('connections', filtered);
  return true;
}

/** Toggle the favourite status of a connection. Returns the updated connection or undefined. */
export function toggleFavourite(
  id: string,
): ConnectionConfig | undefined {
  const connections = store.get('connections');
  const index = connections.findIndex((c) => c.id === id);
  if (index === -1) return undefined;

  const connection = connections[index]!;
  connection.favourite = !connection.favourite;
  store.set('connections', connections);
  return connection;
}
