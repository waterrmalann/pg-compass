import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { getRuntimeState, launchApp } from "./electron-app";

test.skip(
  !process.env.PG_COMPASS_TEST_ADMIN_DATABASE_URL &&
    !process.env.PG_COMPASS_TEST_DATABASE_URL,
  "Set PG_COMPASS_TEST_ADMIN_DATABASE_URL or PG_COMPASS_TEST_DATABASE_URL to run Electron E2E tests.",
);

test.describe.configure({ mode: "serial" });

test("explores, queries, exports, and updates settings in the real Electron app", async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Electron tests only run with Chromium",
  );

  const runtime = getRuntimeState(testInfo);
  const app = await launchApp({
    PG_COMPASS_STORE_DIR: runtime.storeDir,
    PG_COMPASS_TEST_SAVE_DIALOG_DIR: runtime.exportDir,
  });

  const page = await app.firstWindow();

  await expect(
    page.getByRole("button", { name: "Open E2E Database" }),
  ).toBeVisible();

  // Sidebar search only covers connected instances.
  const sidebarSearch = page.getByRole("textbox", { name: "Search sidebar" });
  await sidebarSearch.fill("users");
  await expect(page.getByText("No connected instances")).toBeVisible();
  await sidebarSearch.press("Escape");

  await page.getByRole("button", { name: "Open E2E Database" }).hover();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await sidebarSearch.fill("users");
  await expect(
    page.getByRole("button", { name: "Table users", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Table orders", exact: true }),
  ).toHaveCount(0);
  await sidebarSearch.press("Escape");
  await expect(sidebarSearch).toHaveValue("");

  await page.getByRole("button", { name: "Open E2E Database" }).hover();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Favourite" }).click();
  await expect(page.getByText("Favourites", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open E2E Database" }).click();
  await expect(page.getByText("Schema name")).toBeVisible();
  await page.getByRole("row", { name: /app/i }).click();
  await expect(page.getByRole("tab", { name: "Tables" })).toBeVisible();

  await page.getByRole("row", { name: /users/i }).click();
  await expect(page.getByRole("tab", { name: "Query" })).toBeVisible();

  await page
    .getByRole("button", { name: /refresh data and table metadata/i })
    .click();
  // The Rows panel stamps its own load; the top bar stamp appears on refresh.
  await expect(page.getByText(/Updated \d/)).toHaveCount(2);

  await page.getByRole("button", { name: "Card view" }).click();
  await expect(page.getByText("Document 1", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Structure" }).click();
  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.getByText("Document 1", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Types" }).click();
  await expect(page.getByRole("row", { name: /user_role/i })).toBeVisible();
  await page.getByRole("button", { name: /user_role/i }).click();
  await expect(page.getByText("admin", { exact: true })).toBeVisible();
  await expect(page.getByText("editor", { exact: true })).toBeVisible();
  await expect(page.getByText("viewer", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Triggers" }).click();
  await expect(
    page.getByRole("row", { name: /users_updated_trigger/i }),
  ).toBeVisible();
  await page
    .getByRole("switch", { name: "Disable trigger users_updated_trigger" })
    .click();
  const enableTriggerSwitch = page.getByRole("switch", {
    name: "Enable trigger users_updated_trigger",
  });
  await expect(enableTriggerSwitch).not.toBeChecked();
  await enableTriggerSwitch.click();
  await expect(
    page.getByRole("switch", { name: "Disable trigger users_updated_trigger" }),
  ).toBeChecked();

  await page.getByRole("tab", { name: "Query" }).click();
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByText(/rows returned/)).toBeVisible();

  const queryEditor = page.locator("[data-query-editor] .cm-content");
  await queryEditor.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await page.keyboard.type("SELECT pg_sleep(10)");
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Query cancelled.")).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Export selected query" }).click();
  await page.getByRole("button", { name: "Export" }).click();

  // The last successful query (the default LIMIT 100) is what gets exported.
  // Wait for the result: the temporary file exists long before it is done.
  await expect(page.getByText("Exported 100 rows")).toBeVisible();
  const exportedLines = fs
    .readFileSync(path.join(runtime.exportDir, "query-export.csv"), "utf8")
    .trimEnd()
    .split("\n");
  expect(exportedLines).toHaveLength(101);
  expect(exportedLines[0]).toMatch(/^id,email,display_name,/);
  expect(exportedLines[1]).toMatch(/^1,user1@example\.com,User 1,/);

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("radio", { name: /Light/ }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "General" }).click();
  await page.getByRole("button", { name: "View" }).click();
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();

  await app.close();
});
