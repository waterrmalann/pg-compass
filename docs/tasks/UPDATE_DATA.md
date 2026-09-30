Similar to how `docs/tasks/DELETE_DATA.md` outlines the requirements and implementation notes for the delete data feature, Update data follows the similar flow:

Bulk updates on current filter.

The modal will show

1. Heading with "Update X documents"
2. A filter input (read-only) that shows the current filter applied to the data. This will help users understand what data they are about to update.
3. Update query input (we will use our DSL for this) in left pane
4. A preview in the right pane (sample of upto 5 documents, handle case where fewer or no docs) with asmall diff view that shows the current values and the new values side by side. This will give users a clear idea of what data they are about to update and how it will change.
