import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * CodeMirror theme that reads from the app's CSS custom properties
 * so it automatically follows dark/light mode.
 */
const pgEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    fontFamily: 'var(--font-mono)',
    padding: '8px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'oklch(from var(--accent) l c h / 50%)',
  },
  '.cm-activeLine': {
    backgroundColor: 'oklch(from var(--accent) l c h / 20%)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'oklch(from var(--accent) l c h / 30%)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 4px',
    minWidth: '2em',
  },
  // Autocomplete tooltip
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) - 2px)',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    '& > ul': {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
    },
    '& > ul > li': {
      padding: '2px 8px',
    },
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: 'var(--accent-foreground)',
    },
  },
  '.cm-completionLabel': {
    fontFamily: 'var(--font-mono)',
  },
  '.cm-completionDetail': {
    fontStyle: 'normal',
    color: 'var(--muted-foreground)',
  },
  // Search panel
  '.cm-panels': {
    backgroundColor: 'var(--muted)',
    color: 'var(--foreground)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'oklch(from var(--ring) l c h / 30%)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'oklch(from var(--ring) l c h / 50%)',
  },
  // Placeholder
  '.cm-placeholder': {
    color: 'var(--muted-foreground)',
    fontFamily: 'var(--font-mono)',
  },
  // Focus ring
  '&.cm-focused': {
    outline: 'none',
  },
});

const pgHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'oklch(0.65 0.19 260)', fontWeight: '600' },
  { tag: tags.operatorKeyword, color: 'oklch(0.65 0.19 260)', fontWeight: '600' },
  { tag: tags.typeName, color: 'oklch(0.70 0.14 200)' },
  { tag: tags.string, color: 'oklch(0.72 0.17 150)' },
  { tag: tags.number, color: 'oklch(0.70 0.17 220)' },
  { tag: tags.bool, color: 'oklch(0.70 0.17 220)' },
  { tag: tags.null, color: 'oklch(0.70 0.17 220)', fontStyle: 'italic' },
  { tag: tags.operator, color: 'var(--foreground)' },
  { tag: tags.punctuation, color: 'var(--muted-foreground)' },
  { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: tags.labelName, color: 'oklch(0.75 0.15 50)' },
  { tag: tags.special(tags.string), color: 'oklch(0.72 0.17 150)' },
]);

export const pgTheme = [pgEditorTheme, syntaxHighlighting(pgHighlightStyle)];
