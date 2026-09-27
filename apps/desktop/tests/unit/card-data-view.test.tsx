import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CardDataView } from "@/components/workspace/table-viewer/card-data-view";
import type { EditContext } from "@/components/workspace/table-viewer/data-tab";

vi.mock("@/hooks/use-density", () => ({
  useDensity: () => "compact",
}));

const editContext: EditContext = {
  connectionId: "connection-1",
  schema: "shop",
  table: "customers",
  readOnly: true,
  primaryKey: null,
  onRowUpdated: () => undefined,
};

describe("CardDataView", () => {
  it("renders timestamp values as text instead of an empty object", () => {
    const createdAt = new Date("2026-09-26T18:40:00.000Z");

    render(
      <TooltipProvider>
        <CardDataView
          columns={[
            {
              name: "created_at",
              dataTypeId: 1184,
              dataType: "timestamptz",
            },
          ]}
          rows={[{ created_at: createdAt }]}
          editContext={editContext}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText("{}")).toBeNull();
    expect(screen.getByText(/2026-09-26/)).toBeTruthy();
  });
});
