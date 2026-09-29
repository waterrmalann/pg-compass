/**
 * Shared types for the database shell: a `psql` process in a pseudo-terminal,
 * bridged to an xterm.js terminal in the renderer.
 */

export interface ShellStartInput {
  /** Renderer-chosen identifier, unique per shell tab session. */
  sessionId: string;
  connectionId: string;
  cols: number;
  rows: number;
}

export interface ShellStartResult {
  /** Database psql connected to ("" when libpq picks its default). */
  database: string;
  /** True when the session starts with `default_transaction_read_only`. */
  readOnly: boolean;
}

export interface ShellWriteInput {
  sessionId: string;
  data: string;
}

export interface ShellResizeInput {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface ShellSessionInput {
  sessionId: string;
}

export interface ShellDataEvent {
  sessionId: string;
  data: string;
}

export interface ShellExitEvent {
  sessionId: string;
  exitCode: number;
}
