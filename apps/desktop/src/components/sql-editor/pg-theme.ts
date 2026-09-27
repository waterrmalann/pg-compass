import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * CodeMirror chrome that reads the app's CSS custom properties, so it follows
 * dark/light mode. Mirrors the code block recipe in docs/DESIGN.md §9.19.
 */
const pgEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontSize: "12.5px",
    fontFamily: "var(--font-mono)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "20px",
  },
  ".cm-content": {
    caretColor: "var(--foreground)",
    fontFamily: "var(--font-mono)",
    padding: "12px 0",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    {
      backgroundColor:
        "color-mix(in oklab, var(--foreground) 14%, transparent) !important",
    },
  ".cm-activeLine": {
    backgroundColor: "var(--code-highlight)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "color-mix(in oklab, var(--muted-foreground) 60%, transparent)",
    border: "none",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 0 0 12px",
    minWidth: "2ch",
    textAlign: "right",
  },
  // Autocomplete and lint tooltips are popovers (§6).
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow:
      "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    padding: "4px",
    "& > ul": {
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
    },
    "& > ul > li": {
      padding: "3px 8px",
      borderRadius: "calc(var(--radius) - 2px)",
      color: "var(--muted-foreground)",
    },
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--foreground)",
    },
  },
  ".cm-completionLabel": {
    fontFamily: "var(--font-mono)",
  },
  ".cm-completionDetail": {
    fontStyle: "normal",
    color: "var(--subtle-foreground)",
    marginLeft: "8px",
  },
  ".cm-diagnostic": {
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    padding: "6px 10px",
  },
  ".cm-diagnostic-error": {
    borderLeft: "2px solid var(--destructive)",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--destructive)",
    textUnderlineOffset: "3px",
  },
  // Search panel
  ".cm-panels": {
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--border)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklab, var(--warning) 22%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklab, var(--warning) 40%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 8%, transparent)",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
    fontFamily: "var(--font-mono)",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

// Mostly monochrome syntax so code reads like the rest of the UI (§9.19).
const pgHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--foreground)", fontWeight: "500" },
  {
    tag: tags.operatorKeyword,
    color: "var(--foreground)",
    fontWeight: "500",
  },
  {
    tag: [tags.name, tags.variableName, tags.propertyName],
    color: "color-mix(in oklab, var(--foreground) 85%, transparent)",
  },
  { tag: tags.typeName, color: "var(--foreground)" },
  { tag: tags.function(tags.variableName), color: "var(--foreground)" },
  { tag: tags.string, color: "var(--success-foreground)" },
  { tag: tags.special(tags.string), color: "var(--success-foreground)" },
  { tag: tags.number, color: "var(--info-foreground)" },
  { tag: tags.bool, color: "var(--info-foreground)" },
  { tag: tags.null, color: "var(--info-foreground)" },
  { tag: tags.operator, color: "var(--muted-foreground)" },
  { tag: tags.punctuation, color: "var(--muted-foreground)" },
  { tag: tags.comment, color: "var(--muted-foreground)" },
  { tag: tags.labelName, color: "var(--foreground)" },
  { tag: tags.invalid, textDecoration: "underline wavy var(--destructive)" },
]);

export const pgTheme = [pgEditorTheme, syntaxHighlighting(pgHighlightStyle)];

/**
 * Single-line (filter) editors sit inside a 32px field. Sizing lives here
 * rather than in Tailwind classes because CodeMirror injects its styles
 * unlayered at runtime, which outranks Tailwind's utilities layer.
 */
export const pgSingleLineTheme = EditorView.theme({
  "&": {
    maxHeight: "30px",
  },
  ".cm-scroller": {
    scrollbarWidth: "none",
  },
  ".cm-content": {
    padding: "5px 0",
  },
  ".cm-line": {
    padding: "0 8px",
  },
});
