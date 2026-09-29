import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { currentShortcutPlatform } from "@/shared/constants/shortcuts";
import { buildTerminalTheme } from "./terminal-theme";

export type ShellStatus =
  | { kind: "starting" }
  | { kind: "running"; database: string; readOnly: boolean }
  | { kind: "exited"; exitCode: number }
  | { kind: "error"; message: string };

const TERMINAL_FONT_SIZE = 12.5;
const TERMINAL_FONT =
  '"Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

/** Dim grey status lines printed by the app, not by psql. */
function appLine(text: string): string {
  return `\r\n\x1b[90m${text}\x1b[0m\r\n`;
}

function errorLine(text: string): string {
  return `\x1b[31m${text}\x1b[0m\r\n`;
}

/**
 * Copy and paste follow the platform: on macOS the Edit menu's ⌘C/⌘V reach
 * xterm's own clipboard handlers. Elsewhere Ctrl+C copies when there is a
 * selection (and sends ^C to psql otherwise), Ctrl+Shift+C always copies, and
 * Ctrl+V / Ctrl+Shift+V fall through to the browser's paste. ⌘F / Ctrl+F
 * opens the find bar instead of reaching psql.
 */
function handleTerminalKey(
  event: KeyboardEvent,
  terminal: Terminal,
  onFind: () => void,
): boolean {
  if (event.type !== "keydown") return true;
  const isMac = currentShortcutPlatform() === "mac";
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  const key = event.key.toLowerCase();

  if (modifier && !event.shiftKey && !event.altKey && key === "f") {
    event.preventDefault();
    onFind();
    return false;
  }
  if (isMac) return true;

  const wantsCopy =
    event.ctrlKey && key === "c" && (event.shiftKey || terminal.hasSelection());
  if (wantsCopy) {
    event.preventDefault();
    const selection = terminal.getSelection();
    if (selection) void globalThis.window.clipboardApi.writeText(selection);
    terminal.clearSelection();
    return false;
  }
  if (event.ctrlKey && key === "v") {
    return false;
  }
  return true;
}

/**
 * Owns one xterm.js terminal and the psql session behind it. Each start uses
 * a fresh session id, so output from a previous (restarted) psql is ignored.
 */
export function useTerminalSession(connectionId: string) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<ShellStatus>({ kind: "starting" });
  const [findOpen, setFindOpen] = useState(false);

  const stopSession = useCallback(() => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) void globalThis.window.shellApi.kill({ sessionId });
  }, []);

  const startSession = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    stopSession();

    const sessionId = globalThis.crypto.randomUUID();
    sessionIdRef.current = sessionId;
    setStatus({ kind: "starting" });

    const result = await globalThis.window.shellApi.start({
      sessionId,
      connectionId,
      cols: terminal.cols,
      rows: terminal.rows,
    });
    if (sessionIdRef.current !== sessionId) return;

    if (!result.success) {
      sessionIdRef.current = null;
      terminal.write(errorLine(result.error ?? "Could not start psql."));
      setStatus({ kind: "error", message: result.error ?? "" });
      return;
    }
    setStatus({ kind: "running", ...result.data });
    terminal.focus();
  }, [connectionId, stopSession]);

  const restart = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.reset();
    void startSession();
  }, [startSession]);

  useEffect(
    function setupTerminal() {
      const container = containerRef.current;
      if (!container) return;

      let disposed = false;
      const terminal = new Terminal({
        fontFamily: TERMINAL_FONT,
        fontSize: TERMINAL_FONT_SIZE,
        lineHeight: 1.4,
        cursorBlink: true,
        scrollback: 5_000,
        allowProposedApi: false,
        theme: buildTerminalTheme(container),
      });
      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminalRef.current = terminal;
      searchRef.current = searchAddon;

      terminal.attachCustomKeyEventHandler((event) =>
        handleTerminalKey(event, terminal, () => setFindOpen(true)),
      );
      const inputSubscription = terminal.onData((data) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        void globalThis.window.shellApi.write({ sessionId, data });
      });
      const removeDataListener = globalThis.window.shellApi.onData((event) => {
        if (event.sessionId === sessionIdRef.current)
          terminal.write(event.data);
      });
      const removeExitListener = globalThis.window.shellApi.onExit((event) => {
        if (event.sessionId !== sessionIdRef.current) return;
        sessionIdRef.current = null;
        terminal.write(appLine(`psql exited with code ${event.exitCode}.`));
        setStatus({ kind: "exited", exitCode: event.exitCode });
      });

      function fitAndResize() {
        if (disposed || container?.offsetWidth === 0) return;
        fitAddon.fit();
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        void globalThis.window.shellApi.resize({
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
      let frame = 0;
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(fitAndResize);
      });

      // Follow the app theme (a `dark` class toggled on <html>).
      const themeObserver = new MutationObserver(() => {
        terminal.options.theme = buildTerminalTheme(container);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      // Measure cells with the real font, not a fallback that loads later.
      const fontReady = document.fonts
        .load(`${TERMINAL_FONT_SIZE}px "Geist Mono Variable"`)
        .catch(() => undefined);
      void fontReady.then(() => {
        if (disposed) return;
        terminal.open(container);
        fitAddon.fit();
        resizeObserver.observe(container);
        void startSession();
      });

      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        themeObserver.disconnect();
        inputSubscription.dispose();
        removeDataListener();
        removeExitListener();
        stopSession();
        terminal.dispose();
        terminalRef.current = null;
        searchRef.current = null;
      };
    },
    [startSession, stopSession],
  );

  const findNext = useCallback((term: string) => {
    if (term) searchRef.current?.findNext(term);
  }, []);

  const findPrevious = useCallback((term: string) => {
    if (term) searchRef.current?.findPrevious(term);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    searchRef.current?.clearDecorations();
    terminalRef.current?.clearSelection();
    terminalRef.current?.focus();
  }, []);

  return {
    containerRef,
    status,
    restart,
    findOpen,
    openFind: () => setFindOpen(true),
    closeFind,
    findNext,
    findPrevious,
  };
}
