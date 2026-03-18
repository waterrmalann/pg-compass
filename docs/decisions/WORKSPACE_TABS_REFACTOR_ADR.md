# Workspace Tabs Refactor

## Status

Accepted

## Context

The workspace tab system in `use-workspace.tsx` had grown to contain 6 structurally identical `open*Viewer` callbacks (~150 lines of copy-paste), a monolithic context, and a rendering approach that fully unmounted inactive tabs on every switch—losing fetched data, scroll position, and sub-tab selection.

We also evaluated mainstream routing libraries (TanStack Router, React Router) as potential replacements.

## Decision

1. **Collapse boilerplate:** Replace the 6 `open*Viewer` functions with a single generic `openTab(view: WorkspaceTabView, color?)`.
2. **Preserve inactive tab state:** Render all open tabs simultaneously using absolute positioning with `visible`/`invisible` toggling, instead of unmounting inactive tabs.
3. **No routing library:** TanStack Router and React Router model single-active-view navigation, not multi-tab document management. Layering tab state on top negates their value.
4. **Defer context splitting:** Keep a single `WorkspaceContext` unless profiling shows unnecessary re-renders at scale.

## Rationale

- **DX:** Adding a new view type now requires: 1 union member in `WorkspaceTabView`, 1 renderer entry in `TabViewRenderer`. Previously required 4+ locations.
- **UX:** Tab switching is now instant—no re-fetch, no lost scroll position, no sub-tab reset.
- **Simplicity:** A routing library adds dependency weight (20-45KB) and indirection for a problem better solved by a generic function and CSS visibility.

## Consequences

- Slightly higher memory usage since inactive tab DOM trees remain mounted. Acceptable for a desktop app with typically <20 tabs.
- The `useWorkspace()` context API surface shrank from 13 to 8 members.
- `openSchemaViewer(path, color)` → `openTab({ type: 'schema', path }, color)` at call sites. Slightly more verbose but uniform and self-describing.
