// Captures the landing-page product screenshots from a running PG Compass dev
// build over CDP. See ./README.md for the full workflow.
//
// Usage: node capture.mjs [scene ...]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve(import.meta.dirname, "../../src/assets/screenshots");
const wanted = process.argv.slice(2);
const viewport = { width: 1200, height: 750 };

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page = browser
  .contexts()[0]
  .pages()
  .find((candidate) => !candidate.url().startsWith("devtools"));

const cdp = await page.context().newCDPSession(page);

// Re-applied before every shot: reloads and window changes can drop it.
async function emulateViewport() {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...viewport,
    deviceScaleFactor: 2,
    mobile: false,
  });
}

const visible = page.locator('[aria-hidden="false"]');

async function settle() {
  await emulateViewport();
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('[role="status"]')].every(
          (element) => element.offsetParent === null,
        ),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.mouse.move(viewport.width - 4, viewport.height - 4);
  await page.waitForTimeout(600);
}

async function shoot(name) {
  await settle();
  const theme = await page.evaluate(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const file = path.join(outDir, `${name}-${theme}.png`);
  // Captured through CDP: Playwright's screenshot ignores the emulated size.
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  console.log("shot", path.basename(file));
}

async function setTheme(theme) {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("radio", { name: new RegExp(theme, "i") }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
}

async function reset() {
  await page.reload();
  await emulateViewport();
  await page.getByRole("button", { name: "Open Production" }).waitFor({ timeout: 30000 });
}

// Show the production tree with its shop tables and fold the other connection.
async function arrangeSidebar() {
  await page.getByRole("button", { name: "Collapse", exact: true }).nth(1).click();
  await page.getByRole("button", { name: "Expand schema shop" }).first().click();
}

async function openTable(connection, schema, table) {
  await page.getByRole("button", { name: `Open ${connection}` }).click();
  await visible.getByRole("row", { name: new RegExp(`^${schema}`) }).first().click({ timeout: 60000 });
  await visible.getByRole("row", { name: new RegExp(`^${table}\\b`) }).first().click({ timeout: 60000 });
  await visible.locator('[data-slot="table-cell"]').first().waitFor({ timeout: 30000 });
}

// Opening a table from the schema list leaves the list tabs open; close them
// so the tab strip only shows the tables.
async function closeTabsExcept(titles) {
  const tabs = page.locator("[data-active]");
  for (let index = (await tabs.count()) - 1; index >= 0; index -= 1) {
    const title = await tabs.nth(index).getAttribute("title");
    if (titles.includes(title)) continue;
    await tabs.nth(index).hover();
    await tabs.nth(index).getByRole("button", { name: `Close ${title}` }).click();
  }
}

async function selectTab(title) {
  await page.locator(`[data-active][title="${title}"] button`).first().click();
}

async function openWorkspace() {
  await reset();
  await openTable("Staging", "analytics", "events");
  await openTable("Production", "shop", "customers");
  await openTable("Production", "shop", "orders");
  await closeTabsExcept(["events", "customers", "orders"]);
  await arrangeSidebar();
  await closeTabsExcept(["events", "customers", "orders"]);
}

const scenes = {
  async data() {
    await selectTab("orders");
    await visible.getByRole("tab", { name: "Data" }).click();
    await shoot("data");
  },
  async cards() {
    await selectTab("customers");
    await visible.getByRole("tab", { name: "Data" }).click();
    await visible.getByRole("button", { name: "Card view" }).click();
    await shoot("cards");
    await visible.getByRole("button", { name: "Table view" }).click();
  },
  async structure() {
    await selectTab("customers");
    await visible.getByRole("tab", { name: "Structure" }).click();
    await shoot("structure");
    await visible.getByRole("tab", { name: "Data" }).click();
  },
  async query() {
    await selectTab("orders");
    await visible.getByRole("tab", { name: "Query" }).click();
    const editor = visible.locator("[data-query-editor] .cm-content");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await editor.fill(
      [
        "SELECT c.name, c.plan, count(o.id) AS orders, sum(o.total) AS spent",
        "FROM shop.orders o",
        "JOIN shop.customers c ON c.id = o.customer_id",
        "WHERE o.status <> 'refunded'",
        "GROUP BY c.id",
        "ORDER BY spent DESC",
        "LIMIT 25;",
      ].join("\n"),
    );
    await visible.getByRole("button", { name: "Run query" }).click();
    await visible.getByText(/rows returned/).waitFor({ timeout: 30000 });
    await shoot("query");
    await visible.getByRole("tab", { name: "Data" }).click();
  },
};

for (const theme of ["dark", "light"]) {
  await openWorkspace();
  await setTheme(theme);
  for (const [name, run] of Object.entries(scenes)) {
    if (wanted.length > 0 && !wanted.includes(name)) continue;
    await run();
  }
}

await setTheme("dark");
await cdp.send("Emulation.clearDeviceMetricsOverride");
await browser.close().catch(() => {});
process.exit(0);
