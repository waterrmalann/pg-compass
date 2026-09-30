# Data Exports ✅

**Status:** Implemented  
**Relevance:** When viewing entries of a database (card view, table view, from data tab or query tab).

Above the table/cards, there should be an "Export" button that opens a dropdown with three options:

- "Export all"
- "Export selected query".
- "SQL Dump"

## Exports

When either option is selected, a modal should appear with two tab-style radio buttons for the export formats:

- CSV
- JSON

The modal is same for both "Export all" and "Export selected query", but the query will also display in the modal for "Export selected query".

When you click export, it will then show the file save prompt which you can use to save it.

## SQL Dumps

Unlike exporting, this doesn't require a modal. When you click "SQL Dump", it should immediately show the file save prompt. Once you select the location, it should start the export process and show a toast with the progress of the export.

We want a COPY-to stdout implementation for SQL dumps. This is a more efficient way to export data from PostgreSQL databases, especially for large datasets, as it allows us to stream the data directly to a file without loading it all into memory at once.

```
const stream = client.query(copyTo('COPY users TO STDOUT'));

stream.pipe(file);
```

## Implementation

> [!IMPORTANT]
> This is not a frontend only feature. Ensure that the connection with Electron backend and PG Database for the actual export.

- When possible, stream the file to the location with a small toast that shows the progress at the DB-level to avoid putting load on the db. The toast should only dismiss once all entries are exported (show the count of entries in the toast). Use the existing toast system for this.
- Ensure that the query is ran properly without pagination and that all entries are exported (in the case of "Export all").
- We may need to use `pg-copy-stream` for this, but ensure that the implementation is efficient and does not cause performance issues, especially with large datasets.
- Cover all edge cases when handling this.

## Implementation Notes

### Backend (Main Process)

- **IPC Channels** added to `TableDataChannels`: `EXPORT_DATA` and `SQL_DUMP`
- **CSV/JSON export** uses PostgreSQL server-side cursors (`DECLARE CURSOR` / `FETCH 1000`) to stream data in batches without loading all rows into memory
- **SQL Dump** uses `pg-copy-streams` (`COPY ... TO STDOUT`) piped directly to a file stream for maximum efficiency
- **File save dialog** is invoked from the main process using `dialog.showSaveDialog` with the parent window reference
- Both export paths run inside read-only transactions for consistency
- Partial files are cleaned up on error

### Frontend (Renderer)

- **ExportDropdown** component provides three options: "Export all", "Export selected query" (only shown when query results exist), and "SQL Dump"
- **ExportDialog** is a modal with a tab-style format selector (CSV / JSON) and shows the query text for query-based exports
- SQL Dump bypasses the modal and shows a toast with progress via `toast.loading()` / `toast.success()`
- Export button is placed in the toolbar of both the Data tab and the Query tab's results area
