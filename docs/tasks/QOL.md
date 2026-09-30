## Type Specific Inputs for Inline Edit

Inline edit for rows already show appropriate inputs for things like enums (dropdowns) instead of plain text inputs.

There are a few more cases we can show more appropriate inputs for better user experience:

- Date columns: instead of a plain text input, we can show a date picker, time picker (if needed) and a timezone picker (if needed). This column however should be accessible to power users who might just want to type in the ISO value directly, so we either show a toggle to switch between the input types or we can show the date picker by default and allow users to type in the ISO value directly in the same input if they prefer that.
- Foreign keys: See docs/tasks/ROW_EDIT_FK_TASK.md for details, but we can reuse the same code to show searchable dropdowns for foreign key columns in the inline edit, gracefully failing to plain text if the FK metadata is not available for some reason.
- Array and JSONB columns may be able to use our codemirror editor for syntax highlighting and better editing experience.

---

## Additional Quality-of-Life Improvements

> **Status:** Implemented on 2026-07-17. These are workflow improvements only; they do not expand PG Compass into a schema-management IDE.

The existing product already supports the core exploration flow: saved connections, schema/table/view navigation, tabbed viewers, paginated data, exports, and read-only ad-hoc SQL. The following additions remove friction from those established workflows. They should be delivered independently so that each remains small, testable, and easy to defer.

### 1. Search the sidebar tree

Add a compact, keyboard-focusable search field below the sidebar header. It should filter the connection tree by connection label, schema, table, and view name, matching case-insensitively and preserving the normal favourites grouping when no search is active.

- Search only currently connected instances. Load a connected instance's cached tree on demand; never connect to or query a disconnected saved connection, and do not run a database query on every keystroke.
- While searching, reveal only matching branches and their ancestors. A match should be openable using the same table/view navigation path as the normal tree.
- Show an explicit empty state that distinguishes “no saved connections” from “no matching relations”.
- `Escape` clears a focused search; add a platform-correct shortcut to focus it, provided it does not conflict with CodeMirror or native editing controls.

### 2. Preserve workspace context during a session

Returning to a relation should restore the user’s working context instead of starting over. Keep, at minimum, the active relation sub-tab, data-table/card preference, page size, and applied WHERE filter for every open relation tab while it remains open.

- State must be scoped to the specific connection + relation and must not leak to a similarly named table in another connection.
- Preserve it when changing workspace tabs or relation sub-tabs; clearing a filter remains an intentional reset.
- Do not persist query text or result rows to disk in this item. Query history, if added later, needs an explicit privacy decision.

### 3. Data-grid copy actions

Make copying inspected data deliberate and predictable instead of relying on browser text selection.

- Provide accessible actions to copy a cell value, a complete row, and a column name. Use a clear serialization rule: scalar cells copy their display-safe value; objects/arrays copy valid JSON; a row copies a JSON object with the displayed column names.
- Offer the actions from keyboard-accessible cell/row controls or a context menu, with tooltips and success/failure toasts.
- Avoid copying masked or unavailable values. Copying must not enter edit mode or trigger a database request.

### 4. Fix refresh semantics and feedback

**Bug:** the shared viewer-shell Refresh button currently calls only `refreshSchemaTree`. This updates sidebar/navigation metadata, but usually does not re-fetch the visible data, structure, indexes, constraints, triggers, types, or query result. The button therefore appears to do nothing in many views.

Define and implement an explicit refresh contract for every scope:

- **Connection refresh** re-fetches the sidebar schema tree and its derived relation counts.
- **Schema and relation-list refresh** re-fetches the schema tree and updates the currently visible list.
- **Table/view detail refresh** re-fetches metadata _and_ re-runs the active detail sub-tab's own loader. Data must retain its page, page size, view mode, and applied filter; Query must re-run the last successfully submitted SQL with its current pagination settings. Structure, indexes, constraints, triggers, and types must each reload their own metadata.
- Use an explicit refresh signal/callback owned by the active viewer rather than relying on incidental React remounts or cache changes. A background refresh must not reset unsaved editor text, filters, or tab selection.
- Disable and show progress only for the refresh action in progress, retain the previous successful content until replacement succeeds, and surface failures with an actionable toast/error state.
- Display a compact “last refreshed” timestamp or equivalent success feedback near the relevant result/list count. Label and tooltip metadata refresh separately where both actions are available so users know what will be reloaded.
- Add coverage for every viewer scope, including an assertion that clicking Refresh in a detail sub-tab invokes its data loader rather than only `refreshSchemaTree`.

### 5. Interrupt a slow ad-hoc query

Long-running inspection queries should be stoppable without closing the app or disconnecting the entire connection.

- While a Query-tab request is running, replace or supplement Run with a Cancel control.
- Scope cancellation to that exact renderer-initiated query. Do not cancel other work sharing the connection pool.
- The UI should return to the last successful result (if one exists), explain that the query was cancelled, and remain ready to run another query.
- Cover the race where the query finishes just before cancellation and make cancellation idempotent.

### 6. Safer local connection management

Deleting a saved connection is recoverable only if the user still has its details. Add a confirmation dialog before removal, naming the connection and clarifying that the action removes local saved configuration only, not the PostgreSQL database.

- The destructive action must remain keyboard accessible, use the destructive button treatment, and require an explicit confirmation.
- If the connection has open workspace tabs, close or clearly mark those tabs as unavailable only after confirmation; never leave them able to issue requests against a deleted configuration.

### 7. Keyboard-shortcut discoverability

The implemented tab and editor shortcuts are useful but hidden. Add a small, searchable “Keyboard Shortcuts” reference reachable from Help and, where appropriate, Settings.

- Generate the visible platform labels from one shared shortcut definition so the reference cannot drift from the Electron accelerators.
- Include the current tab navigation, close tab, refresh, editor find, and query execution shortcuts, plus any shortcut introduced by these QOL items.
- The dialog must be fully keyboard navigable and should not steal shortcuts while a CodeMirror editor is actively handling them.

---

## Delivery Guardrails

- Keep the UI compact and data-first: toolbar actions should use existing shadcn button, tooltip, and menu patterns.
- Respect read-only mode. None of these improvements may add a write capability or weaken existing delete confirmation behavior.
- Use the existing typed preload/IPC boundary for clipboard, cancellation, and persisted state; renderer code must not gain Node or filesystem access.
- For each item, add focused unit coverage and at least one integration/E2E case where it crosses the Electron or PostgreSQL boundary.

---

## Implementation Summary

All items in this task are implemented:

- Inline editing uses picker-first date/time controls with timezone and raw-value modes, reuses the searchable foreign-key editor, and provides CodeMirror editing for arrays and JSON/JSONB.
- Sidebar search filters only connected instance trees by connection, schema, table, and view while preserving ancestors, normal navigation, explicit loading, retry, and empty states. It never connects to or queries disconnected saved instances.
- Relation tabs retain their active sub-tab, data view, page size, and applied filter for the lifetime of the open tab, scoped by the full workspace tab identity.
- Cell, row, and column-name copy actions use deterministic safe serialization, omit unavailable masked values, report success/failure, and cross a typed clipboard IPC boundary.
- Connection, schema/list, and table/view detail refreshes have explicit active-view callbacks, preserve successful content and working context during background refreshes, report failures, and show last-success feedback. Query refresh re-runs the last submitted SQL without replacing the editor draft.
- Query cancellation targets a renderer-generated query ID, uses PostgreSQL backend cancellation over a dedicated connection, handles pre-start and completion races idempotently, and retains the last successful result.
- Saved-connection deletion requires explicit destructive confirmation and closes affected workspace tabs only after successful local deletion.
- A keyboard-navigable shortcut reference is available from Help and Settings, with display labels and handlers sourced from shared platform-aware shortcut definitions.

The implementation includes focused coverage for the UI, workspace state, refresh contracts, typed IPC, copy serialization, query cancellation races, and type-specific editors. The Electron E2E flow also covers the new user-facing workflows; environment-dependent PostgreSQL cancellation and Electron E2E cases remain available for runs with their required external database configuration.

### Validation

- Unit: 299 passing.
- PGlite integration: 65 passing, 1 real-PostgreSQL-only cancellation case skipped.
- Electron E2E: 5 discovered and skipped because the external PostgreSQL E2E environment is not configured.
- TypeScript: passing.
- ESLint: passing with 6 existing warnings and no errors.
- Windows Electron production package: passing.
