import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StructureTab } from "@/components/workspace/table-viewer/structure-tab";
import type { ColumnStructure } from "@/shared/types/table-data";

function column(overrides: Partial<ColumnStructure>): ColumnStructure {
  return {
    name: "column",
    dataType: "text",
    udtName: "text",
    isNullable: false,
    columnDefault: null,
    ordinalPosition: 1,
    characterMaxLength: null,
    numericPrecision: null,
    numericScale: null,
    sampleValues: [],
    ...overrides,
  };
}

describe("StructureTab type labels", () => {
  beforeEach(() => {
    Object.assign(window, {
      tableDataApi: {
        getStructure: vi.fn().mockResolvedValue({
          success: true,
          data: [
            column({
              name: "id",
              dataType: "integer",
              udtName: "int4",
              numericPrecision: 32,
              numericScale: 0,
            }),
            column({
              name: "status",
              dataType: "USER-DEFINED",
              udtName: "order_status",
            }),
            column({ name: "tags", dataType: "ARRAY", udtName: "_text" }),
            column({
              name: "total",
              dataType: "numeric",
              udtName: "numeric",
              numericPrecision: 10,
              numericScale: 2,
            }),
            column({
              name: "code",
              dataType: "character varying",
              udtName: "varchar",
              characterMaxLength: 12,
            }),
            column({
              name: "placed_at",
              dataType: "timestamp with time zone",
              udtName: "timestamptz",
              sampleValues: [new Date("2026-09-26T18:40:00.000Z")],
            }),
          ],
        }),
      },
    });
  });

  it("shows declared type names instead of catalog placeholders", async () => {
    render(<StructureTab connectionId="conn-1" schema="shop" table="orders" />);

    expect(await screen.findByText("integer")).toBeTruthy();
    expect(screen.getByText("order_status")).toBeTruthy();
    expect(screen.getByText("text[]")).toBeTruthy();
    expect(screen.getByText("numeric(10,2)")).toBeTruthy();
    expect(screen.getByText("character varying(12)")).toBeTruthy();
    expect(screen.getByText("2026-09-26T18:40:00.000Z")).toBeTruthy();
    expect(screen.queryByText("USER-DEFINED")).toBeNull();
  });
});
