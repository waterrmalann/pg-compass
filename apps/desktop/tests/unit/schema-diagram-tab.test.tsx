import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS } from "@/shared/types/settings";
import type { DatabaseSchema } from "@/shared/types/connection";
import type { SchemaDiagram } from "@/shared/types/schema-diagram";
import { SchemaListViewer } from "@/components/workspace/schema-list-viewer";
import {
  defaultDiagramScope,
  findNextMatch,
} from "@/components/workspace/schema-diagram/schema-diagram-tab";
import {
  NODE_WIDTH,
  type DiagramNode,
} from "@/components/workspace/schema-diagram/diagram-model";

const openTab = vi.fn().mockResolvedValue(undefined);
const navigateToView = vi.fn().mockResolvedValue(undefined);
const refreshSchemaTreeWithStatus = vi.fn();
const getSchemaDiagram = vi.fn();
let schemaCache: Record<string, DatabaseSchema[]> = {};

vi.mock("@/hooks/use-psql-location", () => ({
  usePsqlLocation: () => ({ location: null, recheck: () => undefined }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: DEFAULT_APP_SETTINGS,
    updateSettings: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    schemaCache,
    refreshSchemaTreeWithStatus,
    openTab,
    navigateToView,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const PATH = { connectionId: "conn-1", connectionLabel: "Local" };

function schema(name: string, tables: string[]): DatabaseSchema {
  return { name, tables, views: [] };
}

function column(name: string, isPrimaryKey = false) {
  return {
    name,
    dataType: "integer",
    isNullable: !isPrimaryKey,
    isPrimaryKey,
    isUnique: false,
  };
}

const PUBLIC_DIAGRAM: SchemaDiagram = {
  tables: [
    {
      schema: "public",
      name: "users",
      columns: [column("id", true), column("team_id")],
    },
    {
      schema: "public",
      name: "orders",
      columns: [column("id", true), column("user_id")],
    },
    { schema: "public", name: "teams", columns: [column("id", true)] },
    { schema: "public", name: "settings", columns: [column("id", true)] },
  ],
  foreignKeys: [
    {
      name: "orders_user_id_fkey",
      sourceSchema: "public",
      sourceTable: "orders",
      sourceColumns: ["user_id"],
      targetSchema: "public",
      targetTable: "users",
      targetColumns: ["id"],
    },
    {
      name: "users_team_id_fkey",
      sourceSchema: "public",
      sourceTable: "users",
      sourceColumns: ["team_id"],
      targetSchema: "public",
      targetTable: "teams",
      targetColumns: ["id"],
    },
  ],
};

function ok<T>(data: T) {
  return { success: true, data };
}

async function openDiagram(user: ReturnType<typeof userEvent.setup>) {
  render(<SchemaListViewer path={PATH} />);
  await user.click(screen.getByRole("tab", { name: /Diagram/ }));
}

function card(qualifiedName: string): HTMLElement {
  return screen.getByRole("group", { name: `Table ${qualifiedName}` });
}

beforeEach(() => {
  schemaCache = {
    "conn-1": [
      schema("app", ["accounts"]),
      schema("empty", []),
      schema("public", ["users", "orders", "teams", "settings"]),
    ],
  };
  getSchemaDiagram.mockReset().mockResolvedValue(ok(PUBLIC_DIAGRAM));
  refreshSchemaTreeWithStatus
    .mockReset()
    .mockResolvedValue({ ok: true, data: [] });
  openTab.mockReset().mockResolvedValue(undefined);
  Object.assign(window, { connectionApi: { getSchemaDiagram } });
  // jsdom has no layout: give the canvas a size so tables are rendered.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1200,
    height: 800,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SchemaListViewer sub-tabs", () => {
  it("shows the schema list first and does not load the diagram until asked", async () => {
    const user = userEvent.setup();
    render(<SchemaListViewer path={PATH} />);

    expect(screen.getByRole("tab", { name: /Schemas/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Schema name")).toBeInTheDocument();
    expect(getSchemaDiagram).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: /Diagram/ }));
    await waitFor(() => expect(getSchemaDiagram).toHaveBeenCalledTimes(1));
  });

  it("keeps the loaded diagram when switching sub-tabs", async () => {
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.users" });

    await user.click(screen.getByRole("tab", { name: /Schemas/ }));
    await user.click(screen.getByRole("tab", { name: /Diagram/ }));

    expect(card("public.users")).toBeInTheDocument();
    expect(getSchemaDiagram).toHaveBeenCalledTimes(1);
  });

  it("reloads a loaded diagram on refresh and stamps the refresh", async () => {
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.users" });

    await user.click(
      screen.getByRole("button", {
        name: "Refresh connection schemas and the diagram",
      }),
    );

    await waitFor(() => expect(getSchemaDiagram).toHaveBeenCalledTimes(2));
    expect(refreshSchemaTreeWithStatus).toHaveBeenCalledWith("conn-1", true);
    expect(await screen.findByText(/Updated/)).toBeInTheDocument();
  });

  it("refreshes only the schema list while the diagram was never opened", async () => {
    const user = userEvent.setup();
    render(<SchemaListViewer path={PATH} />);

    await user.click(
      screen.getByRole("button", {
        name: "Refresh connection schemas and relation counts",
      }),
    );

    expect(await screen.findByText(/Updated/)).toBeInTheDocument();
    expect(getSchemaDiagram).not.toHaveBeenCalled();
  });
});

describe("SchemaDiagramTab", () => {
  it("opens on public, draws every table and relationship, and counts them", async () => {
    const user = userEvent.setup();
    await openDiagram(user);

    await screen.findByRole("group", { name: "Table public.users" });
    expect(getSchemaDiagram).toHaveBeenCalledWith({
      connectionId: "conn-1",
      schemas: ["public"],
    });
    expect(screen.getByLabelText("Diagram schema")).toHaveValue("public");
    expect(screen.getByText("4 tables · 2 relationships")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-diagram-table]")).toHaveLength(4);
    expect(document.querySelectorAll("[data-diagram-edge]")).toHaveLength(2);
    // Column markers from the legend vocabulary.
    expect(
      within(card("public.orders")).getByLabelText("Foreign key"),
    ).toBeInTheDocument();
    expect(
      within(card("public.orders")).getByLabelText("Primary key"),
    ).toBeInTheDocument();
  });

  it("loads every schema for All schemas and prefixes table names", async () => {
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.users" });
    getSchemaDiagram.mockResolvedValueOnce(
      ok({
        tables: [
          { schema: "app", name: "accounts", columns: [column("id", true)] },
        ],
        foreignKeys: [],
      }),
    );

    await user.selectOptions(
      screen.getByLabelText("Diagram schema"),
      "All schemas",
    );

    await waitFor(() =>
      expect(getSchemaDiagram).toHaveBeenLastCalledWith({
        connectionId: "conn-1",
        schemas: ["app", "empty", "public"],
      }),
    );
    const accounts = await screen.findByRole("group", {
      name: "Table app.accounts",
    });
    expect(accounts).toHaveTextContent("app.accounts");
  });

  it("fits the newly loaded schema, not the previous one, after a scope change", async () => {
    // Regression: the view used to fit while the old diagram was still shown.
    const manyTables = Array.from({ length: 80 }, (_, index) => ({
      schema: "public",
      name: `t${index}`,
      columns: [column("id", true)],
    }));
    getSchemaDiagram.mockResolvedValueOnce(
      ok({ tables: manyTables, foreignKeys: [] }),
    );
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.t0" });
    const canvas = () =>
      screen.getByRole("application", { name: "Schema diagram" });
    expect(Number(canvas().getAttribute("data-zoom"))).toBeLessThan(1);

    let resolveApp: (value: unknown) => void = () => undefined;
    getSchemaDiagram.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveApp = resolve;
      }),
    );
    await user.selectOptions(screen.getByLabelText("Diagram schema"), "app");

    // The previous schema's tables are not left on screen while loading.
    expect(screen.getByRole("status")).toHaveTextContent("Loading diagram");
    expect(
      screen.queryByRole("group", { name: "Table public.t0" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveApp(
        ok({
          tables: [
            { schema: "app", name: "accounts", columns: [column("id", true)] },
          ],
          foreignKeys: [],
        }),
      );
    });
    await screen.findByRole("group", { name: "Table app.accounts" });
    expect(Number(canvas().getAttribute("data-zoom"))).toBe(1);
  });

  it("shows an empty schema without failing", async () => {
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.users" });
    getSchemaDiagram.mockResolvedValueOnce(ok({ tables: [], foreignKeys: [] }));

    await user.selectOptions(screen.getByLabelText("Diagram schema"), "empty");

    expect(
      await screen.findByText("No tables in this schema."),
    ).toBeInTheDocument();
  });

  it("never queries a database that has no tables", async () => {
    schemaCache = { "conn-1": [schema("public", []), schema("app", [])] };
    const user = userEvent.setup();
    await openDiagram(user);

    expect(screen.getByText("No tables in this database.")).toBeInTheDocument();
    expect(getSchemaDiagram).not.toHaveBeenCalled();
  });

  it("shows a load failure with a working retry", async () => {
    getSchemaDiagram.mockResolvedValueOnce({
      success: false,
      error: "permission denied for schema public",
    });
    const user = userEvent.setup();
    await openDiagram(user);

    expect(
      await screen.findByText("Couldn't load the diagram."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("permission denied for schema public"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("group", { name: "Table public.users" }),
    ).toBeInTheDocument();
  });

  it("highlights a clicked table's relationships and clears with Escape", async () => {
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.users" });

    await user.click(within(card("public.users")).getByText("team_id"));

    expect(card("public.users")).toHaveAttribute("data-selected", "true");
    expect(card("public.settings")).toHaveClass("opacity-40");
    expect(card("public.orders")).not.toHaveClass("opacity-40");
    expect(card("public.teams")).not.toHaveClass("opacity-40");

    await user.keyboard("{Escape}");
    expect(card("public.users")).not.toHaveAttribute("data-selected");
    expect(card("public.settings")).not.toHaveClass("opacity-40");
  });

  it("opens a table from its card", async () => {
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.users" });

    await user.click(
      screen.getByRole("button", { name: "Open table public.orders" }),
    );

    expect(openTab).toHaveBeenCalledWith({
      type: "table-details",
      path: {
        connectionId: "conn-1",
        connectionLabel: "Local",
        schemaName: "public",
        tableName: "orders",
      },
    });
  });

  it("finds a table by name, cycling through matches", async () => {
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.users" });
    const find = screen.getByRole("textbox", { name: "Find table" });

    await user.type(find, "s{Enter}");
    expect(card("public.users")).toHaveAttribute("data-selected", "true");

    await user.type(find, "{Enter}");
    expect(card("public.orders")).toHaveAttribute("data-selected", "true");

    await user.clear(find);
    await user.type(find, "nothing{Enter}");
    expect(find).toHaveAttribute("aria-invalid", "true");
  });

  it("moves a dragged table and offers to reset the layout", async () => {
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.users" });
    const users = card("public.users");
    const before = users.style.transform;

    await user.pointer([
      {
        keys: "[MouseLeft>]",
        target: users,
        coords: { clientX: 10, clientY: 10 },
      },
      { target: users, coords: { clientX: 210, clientY: 110 } },
      {
        keys: "[/MouseLeft]",
        target: users,
        coords: { clientX: 210, clientY: 110 },
      },
    ]);

    expect(card("public.users").style.transform).not.toBe(before);
    // A drag is not a click: nothing is selected.
    expect(card("public.users")).not.toHaveAttribute("data-selected");

    await user.click(screen.getByRole("button", { name: "Reset layout" }));
    expect(card("public.users").style.transform).toBe(before);
  });

  it("zooms with the controls and the keyboard", async () => {
    const user = userEvent.setup();
    await openDiagram(user);
    await screen.findByRole("group", { name: "Table public.users" });
    const canvas = screen.getByRole("application", { name: "Schema diagram" });
    const zoom = () => Number(canvas.getAttribute("data-zoom"));
    const fitted = zoom();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom()).toBeCloseTo(Math.min(fitted * 1.25, 1.5));

    act(() => canvas.focus());
    await user.keyboard("-");
    expect(zoom()).toBeCloseTo(fitted);

    await user.keyboard("--0");
    expect(zoom()).toBeCloseTo(fitted);
  });
});

describe("defaultDiagramScope", () => {
  it("prefers public when it has tables", () => {
    expect(
      defaultDiagramScope([schema("app", ["a", "b"]), schema("public", ["c"])]),
    ).toBe("public");
  });

  it("falls back to the schema with the most tables", () => {
    expect(
      defaultDiagramScope([
        schema("public", []),
        schema("small", ["a"]),
        schema("large", ["a", "b", "c"]),
      ]),
    ).toBe("large");
  });

  it("is null when no schema has tables", () => {
    expect(defaultDiagramScope([schema("public", [])])).toBeNull();
  });
});

describe("findNextMatch", () => {
  const nodes: DiagramNode[] = ["users", "user_roles", "orders"].map(
    (name) => ({
      key: name,
      table: { schema: "public", name, columns: [] },
      width: NODE_WIDTH,
      height: 60,
    }),
  );

  it("matches the qualified name case-insensitively", () => {
    expect(findNextMatch(nodes, "PUBLIC.ORD", null)?.key).toBe("orders");
  });

  it("moves to the match after the selected table and wraps around", () => {
    expect(findNextMatch(nodes, "user", null)?.key).toBe("users");
    expect(findNextMatch(nodes, "user", "users")?.key).toBe("user_roles");
    expect(findNextMatch(nodes, "user", "user_roles")?.key).toBe("users");
  });

  it("returns null for a blank query or no match", () => {
    expect(findNextMatch(nodes, "  ", null)).toBeNull();
    expect(findNextMatch(nodes, "invoices", null)).toBeNull();
  });
});
