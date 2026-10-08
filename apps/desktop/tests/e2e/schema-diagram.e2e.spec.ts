import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { getRuntimeState, launchApp } from "./electron-app";
import {
  buildDiagramFixture,
  buildShopSchemaSql,
} from "../support/diagram-fixture";

test.skip(
  !process.env.PG_COMPASS_TEST_ADMIN_DATABASE_URL &&
    !process.env.PG_COMPASS_TEST_DATABASE_URL,
  "Set PG_COMPASS_TEST_ADMIN_DATABASE_URL or PG_COMPASS_TEST_DATABASE_URL to run Electron E2E tests.",
);

test.describe.configure({ mode: "serial" });

const BULK_SCHEMA = "erd_bulk";
const OTHER_SCHEMA = "erd_other";
const SHOP_SCHEMA = "shop";
/** Foreign keys declared in buildShopSchemaSql. */
const SHOP_TABLE_COUNT = 12;
const SHOP_RELATIONSHIP_COUNT = 12;
const BULK = buildDiagramFixture({
  schema: BULK_SCHEMA,
  otherSchema: OTHER_SCHEMA,
  tableCount: 1500,
});
/** Set to a directory to save screenshots of the diagram (for docs/PRs). */
const SCREENSHOT_DIR = process.env.PG_COMPASS_E2E_SCREENSHOT_DIR;

const count = (value: number) => new Intl.NumberFormat("en-US").format(value);

/** "1,512 tables · …" → 1512 */
function parseLeadingCount(text: string | null): number {
  return Number((text ?? "").split(" ")[0]!.replaceAll(",", ""));
}

async function withSeededClient(
  testInfo: Parameters<typeof getRuntimeState>[0],
  run: (client: Client) => Promise<void>,
) {
  const { connection } = getRuntimeState(testInfo);
  const client = new Client(connection.fields);
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  const testInfo = test.info();
  test.setTimeout(180_000);
  if (SCREENSHOT_DIR) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await withSeededClient(testInfo, async (client) => {
    await client.query(buildShopSchemaSql(SHOP_SCHEMA));
    for (const batch of BULK.batches) await client.query(batch);
  });
});

test.afterAll(async () => {
  const testInfo = test.info();
  await withSeededClient(testInfo, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS ${SHOP_SCHEMA} CASCADE`);
    for (const batch of BULK.dropBatches) await client.query(batch);
  });
});

async function openDatabaseDiagram(
  testInfo: Parameters<typeof getRuntimeState>[0],
): Promise<{ app: ElectronApplication; page: Page; openedAt: number }> {
  const runtime = getRuntimeState(testInfo);
  const app = await launchApp({ PG_COMPASS_STORE_DIR: runtime.storeDir });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });

  const connectionButton = page.getByRole("button", {
    name: "Open E2E Database",
  });
  await connectionButton.hover();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await connectionButton.click();
  const openedAt = Date.now();
  await page.getByRole("tab", { name: /Diagram/ }).click();
  if (SCREENSHOT_DIR) {
    // Keep the connection toast out of the screenshots.
    await expect(page.getByText(/^Connected to/)).toBeHidden({
      timeout: 15_000,
    });
  }
  return { app, page, openedAt };
}

async function setTheme(page: Page, theme: "Dark" | "Light") {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("radio", { name: new RegExp(theme) }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
}

const tableCards = (page: Page) => page.locator("[data-diagram-table]");
const canvas = (page: Page) =>
  page.getByRole("application", { name: "Schema diagram" });

async function zoomOf(page: Page): Promise<number> {
  return Number(await canvas(page).getAttribute("data-zoom"));
}

test("draws a 1,500-table schema, keeping off-screen tables out of the DOM", async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Electron tests only run with Chromium",
  );
  const { app, page, openedAt } = await openDatabaseDiagram(testInfo);

  // The largest schema opens by default when public has no tables.
  await expect(page.getByLabel("Diagram schema")).toHaveValue(BULK_SCHEMA);
  await expect(
    page.getByText(
      `${count(BULK.tableCount)} tables · ${count(BULK.drawnRelationshipCount)} relationships`,
    ),
  ).toBeVisible({ timeout: 20_000 });
  await expect(tableCards(page).first()).toBeVisible();
  // Includes waiting out the connection toast when taking screenshots.
  const loadMs = Date.now() - openedAt;
  testInfo.annotations.push({ type: "load-ms", description: String(loadMs) });
  expect(loadMs).toBeLessThan(SCREENSHOT_DIR ? 20_000 : 10_000);

  if (SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "large-schema-overview-dark.png"),
    });
  }

  // Find jumps to a table and selects it; at that zoom only nearby tables
  // are rendered.
  const find = page.getByRole("textbox", { name: "Find table" });
  await find.fill("t_0751");
  await find.press("Enter");
  const target = page.getByRole("group", {
    name: `Table ${BULK_SCHEMA}.t_0751`,
  });
  await expect(target).toHaveAttribute("data-selected", "true");
  await expect(target).toBeInViewport();
  const renderedNearby = await tableCards(page).count();
  expect(renderedNearby).toBeGreaterThan(0);
  expect(renderedNearby).toBeLessThan(BULK.tableCount / 10);

  if (SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "large-schema-find-dark.png"),
    });
  }

  // Opening a table from the diagram opens its table tab.
  await page
    .getByRole("button", { name: `Open table ${BULK_SCHEMA}.t_0751` })
    .click();
  await expect(page.getByRole("tab", { name: "Structure" })).toBeVisible();

  await app.close();
});

test("explores a schema: zoom, pan, drag, select, all schemas", async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Electron tests only run with Chromium",
  );
  const { app, page } = await openDatabaseDiagram(testInfo);
  await setTheme(page, "Dark");

  await page.getByLabel("Diagram schema").selectOption(SHOP_SCHEMA);
  await expect(
    page.getByText(
      `${SHOP_TABLE_COUNT} tables · ${SHOP_RELATIONSHIP_COUNT} relationships`,
    ),
  ).toBeVisible();
  await expect(tableCards(page)).toHaveCount(SHOP_TABLE_COUNT);
  await expect(page.locator("[data-diagram-edge]")).toHaveCount(
    SHOP_RELATIONSHIP_COUNT,
  );

  // Referenced tables sit left of the tables that reference them.
  const box = async (name: string) =>
    (await page
      .getByRole("group", { name: `Table ${SHOP_SCHEMA}.${name}` })
      .boundingBox())!;
  expect((await box("customers")).x).toBeLessThan((await box("orders")).x);
  expect((await box("orders")).x).toBeLessThan((await box("order_items")).x);

  if (SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "shop-dark.png") });
  }

  // Selecting a table highlights its relationships and dims the rest.
  const orders = page.getByRole("group", {
    name: `Table ${SHOP_SCHEMA}.orders`,
  });
  await orders.getByText("status").click();
  await expect(orders).toHaveAttribute("data-selected", "true");
  await expect(
    page.getByRole("group", { name: `Table ${SHOP_SCHEMA}.coupons` }),
  ).toHaveClass(/opacity-40/);
  if (SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "shop-selected-dark.png"),
    });
  }
  await page.keyboard.press("Escape");
  await expect(orders).not.toHaveAttribute("data-selected", "true");

  // Wheel zoom toward the pointer.
  const canvasBox = (await canvas(page).boundingBox())!;
  const center = {
    x: canvasBox.x + canvasBox.width / 2,
    y: canvasBox.y + canvasBox.height / 2,
  };
  const fittedZoom = await zoomOf(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(fittedZoom);

  // Drag a table by its header; Reset layout puts it back.
  await page.getByRole("button", { name: "Fit diagram to view" }).click();
  const before = await box("settings");
  await page.mouse.move(before.x + 40, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + 140, before.y + 92, { steps: 5 });
  await page.mouse.up();
  const after = await box("settings");
  expect(after.x - before.x).toBeGreaterThan(80);
  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect
    .poll(async () => (await box("settings")).x)
    .toBeCloseTo(before.x, 0);

  // Pan by dragging empty canvas (zoomed out so the corner is empty).
  for (let step = 0; step < 6; step += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  const settingsBefore = await box("settings");
  await page.mouse.move(canvasBox.x + 8, canvasBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 108, canvasBox.y + 58, { steps: 5 });
  await page.mouse.up();
  const settingsAfter = await box("settings");
  expect(settingsAfter.x - settingsBefore.x).toBeCloseTo(100, 0);
  expect(settingsAfter.y - settingsBefore.y).toBeCloseTo(50, 0);

  // All schemas: names gain their schema, cross-schema keys get edges.
  await page
    .getByLabel("Diagram schema")
    .selectOption({ label: "All schemas" });
  const summary = page.getByText(/ tables · .* relationships$/);
  await expect
    .poll(async () => parseLeadingCount(await summary.textContent()))
    .toBeGreaterThan(BULK.tableCount + SHOP_TABLE_COUNT);
  const find = page.getByRole("textbox", { name: "Find table" });
  await find.fill(`${OTHER_SCHEMA}.audit`);
  await find.press("Enter");
  const audit = page.getByRole("group", {
    name: `Table ${OTHER_SCHEMA}.audit`,
  });
  await expect(audit).toHaveAttribute("data-selected", "true");
  await expect(audit).toContainText(`${OTHER_SCHEMA}.audit`);
  await expect(
    page.locator("[data-diagram-edge='audit_store_id_fkey']"),
  ).toHaveCount(1);

  if (SCREENSHOT_DIR) {
    await page.getByLabel("Diagram schema").selectOption(SHOP_SCHEMA);
    await expect(tableCards(page)).toHaveCount(SHOP_TABLE_COUNT);
    await find.fill("");
    await setTheme(page, "Light");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "shop-light.png"),
    });
    await page.getByRole("tab", { name: /Schemas/ }).click();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "schemas-tab-light.png"),
    });
    await setTheme(page, "Dark");
  }

  await app.close();
});
