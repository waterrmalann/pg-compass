import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  isCopyableValue,
  serializeCellValue,
  serializeRow,
} from "@/components/workspace/table-viewer/data-copy";
import {
  DateTimeEditor,
  isDateTimeType,
} from "@/components/workspace/renderers/date-time-editor";
import { filterConnectionTree } from "@/components/sidebar/sidebar-content";
import { matchesShortcut, shortcutLabel } from "@/shared/constants/shortcuts";
import type {
  ConnectionConfig,
  DatabaseSchema,
} from "@/shared/types/connection";

const connection: ConnectionConfig = {
  id: "conn-1",
  label: "Production",
  favourite: false,
  mode: "uri",
  uri: "postgresql://localhost/app",
};

const schemas: DatabaseSchema[] = [
  {
    name: "app",
    tables: ["users", "audit_log"],
    views: [{ name: "active_users", definition: null }],
  },
];

describe("QOL helpers", () => {
  it("filters sidebar branches by schema and relation names case-insensitively", () => {
    expect(
      filterConnectionTree(connection, schemas, "AUDIT").schemas[0]?.tables,
    ).toEqual(["audit_log"]);
    expect(
      filterConnectionTree(connection, schemas, "active").schemas[0]?.views,
    ).toHaveLength(1);
    expect(
      filterConnectionTree(connection, schemas, "production").schemas,
    ).toEqual(schemas);
    expect(filterConnectionTree(connection, schemas, "missing").matches).toBe(
      false,
    );
  });

  it("serializes cells and rows predictably while omitting unavailable values", () => {
    expect(serializeCellValue({ enabled: true }, "jsonb")).toBe(
      '{"enabled":true}',
    );
    expect(serializeCellValue([1, 2], "_int4")).toBe("[1,2]");
    expect(serializeCellValue(null, "text")).toBe("NULL");
    expect(isCopyableValue("[masked]")).toBe(false);
    expect(
      serializeRow(
        [
          { name: "id", dataType: "int4", dataTypeId: 23 },
          { name: "secret", dataType: "text", dataTypeId: 25 },
        ],
        { id: 1, secret: "[masked]" },
      ),
    ).toBe('{"id":1}');
  });

  it("renders picker-first timestamptz editing with a raw ISO escape hatch", () => {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <DateTimeEditor
          pgType="timestamptz"
          value="2026-07-17T12:30:00Z"
          onChange={onChange}
        />
      </TooltipProvider>,
    );

    expect(isDateTimeType("timestamptz")).toBe(true);
    expect(screen.getByLabelText("Timezone offset")).toHaveValue("Z");
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.getByLabelText("Raw date or time value")).toHaveValue(
      "2026-07-17T12:30:00Z",
    );
  });

  it("formats platform shortcut labels from the shared definitions", () => {
    const shortcut = {
      id: "test",
      label: "Test",
      category: "Workspace" as const,
      binding: { key: "k", modifier: "mod" as const },
      keys: { mac: ["⌘", "K"], windows: ["Ctrl", "K"] },
    };
    expect(shortcutLabel(shortcut, "mac")).toBe("⌘K");
    expect(shortcutLabel(shortcut, "windows")).toBe("Ctrl+K");
    expect(
      matchesShortcut(
        "sidebar-search",
        { key: "f", ctrlKey: true, metaKey: false, shiftKey: true },
        "windows",
      ),
    ).toBe(true);
  });
});

describe("copying date and timestamp values", () => {
  // `pg` builds date/timestamp Dates from LOCAL fields; a zone east of UTC
  // makes a UTC-based copy shift the value back by a day.
  beforeAll(() => {
    vi.stubEnv("TZ", "Asia/Kolkata");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("copies a date cell from its local calendar fields", () => {
    const localMidnight = new Date(2024, 0, 5);
    // Guard: the zone override must be active for this test to mean anything.
    expect(localMidnight.getTimezoneOffset()).toBe(-330);

    expect(serializeCellValue(localMidnight, "date")).toBe("2024-01-05");
  });

  it("copies a timestamp without time zone from its local fields", () => {
    const local = new Date(2024, 0, 5, 0, 15, 30, 120);

    expect(serializeCellValue(local, "timestamp")).toBe(
      "2024-01-05T00:15:30.120",
    );
  });

  it("copies timestamptz as an absolute UTC instant", () => {
    const instant = new Date("2024-01-05T00:15:30.000Z");

    expect(serializeCellValue(instant, "timestamptz")).toBe(
      "2024-01-05T00:15:30.000Z",
    );
  });

  it("formats each Date in a copied row by its column type", () => {
    const row = {
      born_on: new Date(2024, 0, 5),
      seen_at: new Date(2024, 0, 5, 0, 15, 30),
      placed_at: new Date("2024-01-05T00:15:30.000Z"),
    };

    expect(
      JSON.parse(
        serializeRow(
          [
            { name: "born_on", dataType: "date", dataTypeId: 1082 },
            { name: "seen_at", dataType: "timestamp", dataTypeId: 1114 },
            { name: "placed_at", dataType: "timestamptz", dataTypeId: 1184 },
          ],
          row,
        ),
      ),
    ).toEqual({
      born_on: "2024-01-05",
      seen_at: "2024-01-05T00:15:30",
      placed_at: "2024-01-05T00:15:30.000Z",
    });
  });
});
