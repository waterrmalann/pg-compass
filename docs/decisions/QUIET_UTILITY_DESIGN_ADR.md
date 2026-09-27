# ADR: Quiet Utility design system

## Title

Adopt `docs/DESIGN.md` (Quiet Utility) as the desktop app's design system

## Status

Accepted

## Decision

`docs/DESIGN.md` replaces the former `docs/DESIGN_SYSTEM.md` as the single source of truth for UI work. The desktop renderer implements it as follows:

1. **Tokens** in `apps/desktop/src/index.css` are the §2.1 primitives and §2.2 semantic tokens verbatim: translucent `muted`/`accent`/`border` alphas, `subtle-foreground` for text under 12px, status tokens (`destructive`, `warning`, `success`, `info` + `*-foreground`), `code` and chart tokens. Dark mode stays the default and is still applied with the `.dark` class.
2. **Fonts** are Geist and Geist Mono, bundled via `@fontsource-variable/*` so the app stays offline and CSP-friendly.
3. **Primitives** in `components/ui/` are restyled to the §9 recipes, plus four new ones: `Panel` (§9.15), `SegmentedControl` (§9.2), `EmptyState`/`LoadingState` and `Kbd` (§9.3).
4. **Shell** follows §9.21/§9.22: sidebar nav rows and tree, a 44px top bar with a `/` breadcrumb, and a segmented sub-view switcher. Workspace content sits in panels.
5. **Connection colours** become 6px dots (the §2.3 label-tag rule) instead of tinted text and accent bars. Workspace tabs keep a light tint of the connection colour, because it's the quickest way to tell tabs from different databases apart.
6. **CodeMirror** uses the mostly monochrome §9.19 syntax palette. Sizing that must beat CodeMirror's runtime styles lives in CodeMirror themes, not Tailwind classes.

## Rationale

- The previous shadcn neutral defaults carried a blue sidebar accent and solid, colourful badges. That conflicts with "monochrome first, colour as signal".
- Alpha-based layers let nested panels, dialogs and the sidebar share one palette.
- Shared primitives (`Panel`, `SegmentedControl`, `EmptyState`) replace a dozen hand-rolled variants of the same patterns.

## Consequences

- New UI must use semantic tokens and the §9 recipes. No new hues outside status meaning, and no text below 10px or 10-11px text in `muted-foreground`.
- User-picked connection colours are the one decorative hue. They appear as dots, plus a tint on workspace tabs.
- Microcopy is sentence case ("New connection", "Run query"), and tests select by those names.
