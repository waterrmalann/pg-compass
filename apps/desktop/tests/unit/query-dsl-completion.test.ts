import { describe, expect, it } from "vitest";
import { suggestDslCompletions } from "@/components/workspace/table-viewer/query-dsl-completion";
import type { QueryColumnMetadata } from "@/shared/query-dsl/types";

const COLUMNS: QueryColumnMetadata[] = [
  { name: "id", typeName: "int4", family: "numeric" },
  { name: "name", typeName: "text", family: "text" },
  { name: "is_active", typeName: "bool", family: "boolean" },
  { name: "tags", typeName: "_text", family: "other" },
  { name: "CreatedAt", typeName: "date", family: "temporal" },
  { name: "desc", typeName: "text", family: "text" },
];

function labels(
  field: "filter" | "projection" | "sort" | "skip" | "limit",
  text: string,
): string[] | null {
  return (
    suggestDslCompletions(field, text, COLUMNS)?.options.map(
      (option) => option.label,
    ) ?? null
  );
}

describe("suggestDslCompletions", () => {
  it("offers safely quoted columns where a predicate starts", () => {
    expect(labels("filter", "")).toEqual([
      "id",
      "name",
      "is_active",
      "tags",
      '"CreatedAt"',
      '"desc"',
    ]);
    expect(labels("filter", "id = 1 AND ")).toContain('"CreatedAt"');
    expect(labels("filter", "(")).toContain("id");
  });

  it("replaces the partially typed word, including an open quote", () => {
    expect(
      suggestDslCompletions("filter", "id = 1 AND na", COLUMNS)?.from,
    ).toBe(11);
    expect(
      suggestDslCompletions("filter", 'id = 1 AND "Crea', COLUMNS)?.from,
    ).toBe(11);
  });

  it("restricts operators by the column's type family", () => {
    expect(labels("filter", "name ")).toEqual([
      "=",
      "!=",
      ">",
      ">=",
      "<",
      "<=",
      "LIKE",
      "ILIKE",
      "IN",
      "NOT IN",
      "IS NULL",
      "IS NOT NULL",
    ]);
    expect(labels("filter", "id ")).not.toContain("LIKE");
    expect(labels("filter", "is_active ")).toEqual([
      "=",
      "!=",
      "IN",
      "NOT IN",
      "IS NULL",
      "IS NOT NULL",
    ]);
    expect(labels("filter", "tags ")).toEqual(["IS NULL", "IS NOT NULL"]);
  });

  it("suggests what can follow keywords and values", () => {
    expect(labels("filter", "name IS ")).toEqual(["NULL", "NOT NULL"]);
    expect(labels("filter", "name IS NOT ")).toEqual(["NULL"]);
    expect(labels("filter", "name NOT ")).toEqual(["IN"]);
    expect(labels("filter", "is_active = ")).toEqual(["TRUE", "FALSE"]);
    expect(labels("filter", "name = 'x' ")).toEqual(["AND", "OR"]);
    expect(labels("filter", "(id = 1) ")).toEqual(["AND", "OR"]);
    expect(labels("filter", "id IN (")).toBeNull();
    expect(labels("filter", "name = ")).toBeNull();
  });

  it("stays quiet inside strings and after invalid input", () => {
    expect(labels("filter", "name = 'Al")).toBeNull();
    expect(labels("filter", "name ; ")).toBeNull();
  });

  it("completes projection columns and AS", () => {
    expect(labels("projection", "")).toContain("id");
    expect(labels("projection", "id, ")).toContain("name");
    expect(labels("projection", "id ")).toEqual(["AS"]);
    expect(labels("projection", "id AS ")).toBeNull();
  });

  it("completes columns after - and nothing after an excluded column", () => {
    expect(labels("projection", "-")).toContain("name");
    expect(labels("projection", "-id, -")).toContain('"CreatedAt"');
    expect(labels("projection", "-id ")).toBeNull();
  });

  it("offers nothing for Skip and Limit", () => {
    expect(labels("skip", "")).toBeNull();
    expect(labels("limit", "1")).toBeNull();
  });

  it("completes sort columns and directions", () => {
    expect(labels("sort", "")).toContain("name");
    expect(labels("sort", "name ")).toEqual(["ASC", "DESC"]);
    expect(labels("sort", "name DESC, ")).toContain("id");
    expect(labels("sort", "name DESC ")).toBeNull();
  });
});
