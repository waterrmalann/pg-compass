import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataQuerySummary,
  formatSqlParameter,
} from "@/components/workspace/data-query-summary";

const QUERY = {
  filter: "status = 'it''s'",
  projection: "-notes",
  sort: "id DESC",
  skip: "10",
  limit: "",
};

function renderSummary() {
  return render(
    <DataQuerySummary
      connectionId="c1"
      schema="app"
      table="users"
      query={QUERY}
    />,
  );
}

describe("formatSqlParameter", () => {
  it.each([
    ["it's", "'it''s'"],
    [42, "42"],
    [true, "TRUE"],
    [false, "FALSE"],
    [null, "null"],
  ])("formats %j as %s", (value, expected) => {
    expect(formatSqlParameter(value)).toBe(expected);
  });
});

describe("DataQuerySummary", () => {
  const previewQuerySql = vi.fn();

  beforeEach(() => {
    previewQuerySql.mockReset();
    Object.assign(window, { tableDataApi: { previewQuerySql } });
  });

  it("lists every field and only builds SQL when the eye is pressed", async () => {
    previewQuerySql.mockResolvedValue({
      success: true,
      data: {
        sql: 'SELECT "id"\nFROM "app"."users"\nWHERE "status" = $1\nOFFSET $2',
        values: ["it's", 10],
      },
    });
    renderSummary();

    expect(screen.getByText("status = 'it''s'")).toBeInTheDocument();
    expect(screen.getByText("-notes")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(previewQuerySql).not.toHaveBeenCalled();

    const toggle = screen.getByRole("button", { name: "Show SQL" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);

    const sql = await screen.findByTestId("export-sql-preview");
    expect(sql).toHaveTextContent('WHERE "status" = $1');
    expect(screen.getByText("'it''s'")).toBeInTheDocument();
    expect(screen.getByText("$2")).toBeInTheDocument();
    expect(previewQuerySql).toHaveBeenCalledWith({
      connectionId: "c1",
      schema: "app",
      table: "users",
      query: QUERY,
    });

    const hide = screen.getByRole("button", { name: "Hide SQL" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(hide);
    expect(screen.queryByTestId("export-sql-preview")).toBeNull();
  });

  it("shows why the SQL could not be built", async () => {
    previewQuerySql.mockResolvedValue({
      success: false,
      error: 'Column "notes" does not exist.',
    });
    renderSummary();
    fireEvent.click(screen.getByRole("button", { name: "Show SQL" }));
    await waitFor(() =>
      expect(
        screen.getByText('Column "notes" does not exist.'),
      ).toBeInTheDocument(),
    );
  });
});
