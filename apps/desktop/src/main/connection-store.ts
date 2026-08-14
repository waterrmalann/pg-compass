import Store from "electron-store";
import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import type {
  ConnectionConfig,
  ConnectionInput,
} from "../shared/types/connection";
import { resolveStoreOptions } from "./store-config";

interface StoreSchema {
  connections: ConnectionConfig[];
}

const store = new Store<StoreSchema>({
  ...resolveStoreOptions({ name: "connections" }),
  defaults: {
    connections: [],
  },
});

// ---------------------------------------------------------------------------
// Credential encryption helpers
// ---------------------------------------------------------------------------

const ENCRYPTED_PREFIX = "esafe:";

function isSecureEncryptionAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return !(
    process.platform === "linux" &&
    safeStorage.getSelectedStorageBackend() === "basic_text"
  );
}

let warnedAboutPlaintextFallback = false;

function encryptField(value: string | undefined): string | undefined {
  if (!value) return value;
  if (!isSecureEncryptionAvailable()) {
    // Silent otherwise — this is a real security degradation (credentials
    // land in connections.json in plaintext), not just a missing feature.
    if (!warnedAboutPlaintextFallback) {
      warnedAboutPlaintextFallback = true;
      console.warn(
        "[connection-store] OS-backed credential encryption is unavailable " +
          "(safeStorage.isEncryptionAvailable() is false, or Linux is using " +
          "the basic_text secret-service backend) — connection passwords " +
          "and other secrets will be stored in plaintext.",
      );
    }
    return value;
  }
  const encrypted = safeStorage.encryptString(value);
  return ENCRYPTED_PREFIX + encrypted.toString("base64");
}

function decryptField(value: string | undefined): string | undefined {
  if (!value?.startsWith(ENCRYPTED_PREFIX)) return value;
  if (!isSecureEncryptionAvailable()) {
    throw new Error(
      "Saved credentials cannot be decrypted because secure OS credential storage is unavailable.",
    );
  }
  const base64 = value.slice(ENCRYPTED_PREFIX.length);
  return safeStorage.decryptString(Buffer.from(base64, "base64"));
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

/**
 * Strips secrets for list/display views. The URI's non-secret parts
 * (host/port/database/user) are kept for display by decrypting just long
 * enough to clear the embedded password; any consumer that needs the real
 * credentials (editing a connection, copying its connection string) must
 * fetch it individually via `getConnectionById`.
 */
function redactConnectionForList(connection: ConnectionConfig): ConnectionConfig {
  const redacted = structuredClone(connection);
  if (redacted.uri) {
    try {
      const decryptedUri = decryptField(redacted.uri);
      const url = new URL(decryptedUri!);
      url.password = "";
      redacted.uri = url.toString();
    } catch {
      // Can't reveal even the host/port without successfully decrypting —
      // omit the URI rather than leak the still-encrypted blob or throw.
      redacted.uri = undefined;
    }
  }
  if (redacted.fields) {
    redacted.fields = { ...redacted.fields, password: "" };
  }
  if (redacted.ssh) {
    redacted.ssh = {
      ...redacted.ssh,
      password: undefined,
      passphrase: undefined,
    };
  }
  return redacted;
}

/**
 * Get all saved connections for list/display views. Secrets (passwords,
 * the URI's embedded password, SSH password/passphrase) are redacted, not
 * decrypted — every saved connection's full credentials living in
 * renderer memory at once (rather than just the one currently open) is an
 * unnecessary exposure if the renderer is ever compromised. Callers that
 * need the real credentials (editing a connection, copying its connection
 * string) must fetch that one connection via `getConnectionById`.
 */
export function getAllConnections(): ConnectionConfig[] {
  return store.get("connections").map(redactConnectionForList);
}

/** Get a single connection by ID (with credentials decrypted). */
export function getConnectionById(id: string): ConnectionConfig | undefined {
  const connections = store.get("connections");
  const connection = connections.find((c) => c.id === id);
  return connection ? decryptConnection(connection) : undefined;
}

/** Create a new connection and return it (decrypted). */
export function createConnection(input: ConnectionInput): ConnectionConfig {
  const connection: ConnectionConfig = {
    ...input,
    id: randomUUID(),
  };
  const connections = store.get("connections");
  connections.push(encryptConnection(connection));
  store.set("connections", connections);
  return connection;
}

/** Update an existing connection by ID. Returns the updated connection (decrypted) or undefined. */
export function updateConnection(
  id: string,
  input: ConnectionInput,
): ConnectionConfig | undefined {
  const connections = store.get("connections");
  const index = connections.findIndex((c) => c.id === id);
  if (index === -1) return undefined;

  const updated: ConnectionConfig = { ...input, id };
  connections[index] = encryptConnection(updated);
  store.set("connections", connections);
  return updated;
}

/** Delete a connection by ID. Returns true if deleted. */
export function deleteConnection(id: string): boolean {
  const connections = store.get("connections");
  const filtered = connections.filter((c) => c.id !== id);
  if (filtered.length === connections.length) return false;
  store.set("connections", filtered);
  return true;
}

/** Toggle the favourite status of a connection. Returns the updated connection or undefined. */
export function toggleFavourite(id: string): ConnectionConfig | undefined {
  const connections = store.get("connections");
  const index = connections.findIndex((c) => c.id === id);
  if (index === -1) return undefined;

  const connection = connections[index]!;
  connection.favourite = !connection.favourite;
  store.set("connections", connections);
  return decryptConnection(connection);
}
