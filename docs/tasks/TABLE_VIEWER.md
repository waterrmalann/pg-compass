# Table Viewer & View Viewer

> **Status:** Complete

When a user clicks on a table in the left sidebar (or from the schema listing view), they are taken to the table viewer page (currently placeholder page).

This page will need to have multiple tabs to show different aspects of the table. The tabs will be as follows:

## Data Tab

Shows all the rows in the table with pagination (upto 100 rows per page, can be selected from 25, 50, 75, 100). There is an alternate view where the documents are shown in a card view (which better represents JSONB columns as its more natural).

There should be a small query input box where the users can run only WHERE clause queries on the table. For example, if the user types `id > 10`, it should run `SELECT * FROM table WHERE id > 10` and show the results in the same way as normal data tab (pagination, card view, etc.). This allows users to quickly filter data without having to go to the query tab.

In card view, while it resembles a JSON. It should actually be rendered as react components with proper tree like structure so that nested fields can be expanded and collapsed. Arrays when expanded show indices as keys, and if there are more than 50 elements, it should show a "[ ...200 items]" button like that which shows the whole array when clicked.

**Architectural Note:**

The renderer for our card view should be extensible to support various types. For example we may enable pg extensions that introduce new types. We should be able to plug right into it with a component that can render this in the card properly (maybe pg geography is shown like a JSONB and so on). This requires a central place where we can register custom component renderers for different types for both card view and table view. Follow SOLID principles and open-closed principle to make it easy to add new renderers without modifying existing code. This will make our codebase more maintainable and scalable as we add support for more types in the future.

## Structure Tab

Shows the table structure with column names, data types, and other metadata.

Basically a `DESCRIBE table` command output but in a more user-friendly way. It should also show the sample data for each column (maybe first 5 rows) to give users an idea of what kind of data is in each column.

Ensure the query is not taxing on the database. We can use `LIMIT 5` to get sample data for each column without putting too much load on the database.

## Indexes Tab

Shows the indexes on the table with their definitions. It's type and size is also shown. Usage statistics is also shown if available.

## Constraints Tab

Shows the constraints on the table with their definitions.

Ensure it is organized for better user experience. For example, we can group constraints by type (primary key, foreign key, unique, check, etc.) and show them in separate sections. This will make it easier for users to understand the constraints on the table at a glance.

Also make sure it is not taxing on the database.

## Query Tab

Shows a simple SQL editor where users can run queries on the table and preview output in the same way like the data tab (pagination, card view, etc.).

This tab will only support READ queries (SELECT statements) to ensure that users do not accidentally run destructive queries on the database. We can use a simple SQL parser to validate the queries before running them and show an error message if the query is not a SELECT statement.

It can however support more complex SELECT queries with JOINs, subqueries, CTEs, etc. to allow users to explore the data in more depth. We can also provide some query templates or examples to help users get started with writing their own queries.

---

> [!IMPORTANT]
> Ensure that no queries run on the table viewer page are taxing on the database. For example, if the table has millions of rows, we should not run a `SELECT * FROM table` query to show the data. Instead, we should use pagination and limit the number of rows returned to a reasonable number (like 100). Similarly, for the structure tab, we should not run a `DESCRIBE table` query that returns all columns if there are many columns. Instead, we can show a sample of the columns with their metadata and sample data.

## View Viewer

Works exactly like the table viewer but for views. It has the same tabs as the table viewer (Data, Structure, Indexes, Constraints, Query) but the data tab runs the query that defines the view to show the data instead of running a `SELECT * FROM view` query. The structure tab shows the columns and their data types as defined in the view. The indexes and constraints tabs show any indexes or constraints defined on the view (if supported by PostgreSQL). The query tab allows users to run SELECT queries on the view to explore the data further.

See if reusable components can be created for the table viewer and view viewer since they share a lot of functionality. This will help reduce code duplication and make our codebase more maintainable. We can have a common base component that handles the shared logic and then have specific components for tables and views that extend this base component to handle any specific differences between them.

But do not stuff the base component with too much logic that is only relevant for one of them. Follow SOLID principles and ensure that the base component is only responsible for the shared functionality and does not have any logic that is specific to either tables or views. This will make our codebase more maintainable and easier to understand in the long run.
