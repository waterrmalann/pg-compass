import fs from "node:fs";
import path from "node:path";
import {
  test,
  expect,
  _electron as electron,
  type TestInfo,
} from "@playwright/test";

function getRuntimeState(testInfo: TestInfo) {
  const runtimeStatePath = String(testInfo.config.metadata.runtimeStatePath);
  return JSON.parse(fs.readFileSync(runtimeStatePath, "utf8")) as {
    storeDir: string;
    exportDir: string;
  };
}

function getExecutablePath(): string {
  const appRoot = process.cwd();

  if (process.platform === "win32") {
    return path.join(appRoot, "out", "PG Compass-win32-x64", "pg-compass.exe");
  }

  if (process.platform === "darwin") {
    return path.join(
      appRoot,
      "out",
      "PG Compass-darwin-arm64",
      "PG Compass.app",
      "Contents",
      "MacOS",
      "PG Compass",
    );
  }

  return path.join(appRoot, "out", "PG Compass-linux-x64", "pg-compass");
}

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
  const app = await electron.launch({
    executablePath: getExecutablePath(),
    env: {
      ...process.env,
      PG_COMPASS_STORE_DIR: runtime.storeDir,
      PG_COMPASS_TEST_SAVE_DIALOG_DIR: runtime.exportDir,
    },
  });

  const page = await app.firstWindow();

  await expect(
    page.getByRole("button", { name: "Open E2E Database" }),
  ).toBeVisible();

  const sidebarSearch = page.getByRole("textbox", { name: "Search sidebar" });
  await sidebarSearch.fill("users");
  await expect(page.getByRole("button", { name: "Table users" })).toBeVisible();
  await sidebarSearch.press("Escape");
  await expect(sidebarSearch).toHaveValue("");

  await page.getByRole("button", { name: "Open E2E Database" }).hover();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Favourite" }).click();

  await page.getByRole("button", { name: "Open E2E Database" }).click();
  await expect(page.getByText("Schema name")).toBeVisible();
  await page.getByRole("row", { name: /app/i }).click();
  await expect(page.getByRole("tab", { name: "Tables" })).toBeVisible();

  await page.getByRole("row", { name: /users/i }).click();
  await expect(page.getByRole("tab", { name: "Query" })).toBeVisible();

  await page
    .getByRole("button", { name: /refresh data and table metadata/i })
    .click();
  await expect(page.getByText(/Updated \d/)).toBeVisible();

  await page.getByRole("button", { name: "Card view" }).click();
  await expect(page.getByText("Document 1")).toBeVisible();
  await page.getByRole("tab", { name: "Structure" }).click();
  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.getByText("Document 1")).toBeVisible();

  await page.getByRole("tab", { name: "Types" }).click();
  await expect(page.getByRole("row", { name: /user_role/i })).toBeVisible();
  await page.getByRole("button", { name: /user_role/i }).click();
  await expect(page.getByText("admin")).toBeVisible();
  await expect(page.getByText("editor")).toBeVisible();
  await expect(page.getByText("viewer")).toBeVisible();

  await page.getByRole("tab", { name: "Triggers" }).click();
  await expect(
    page.getByRole("row", { name: /users_updated_trigger/i }),
  ).toBeVisible();
  await page
    .getByRole("switch", { name: "Disable trigger users_updated_trigger" })
    .click();
  await expect(page.getByRole("row", { name: /Disabled/i })).toBeVisible();
  await page
    .getByRole("switch", { name: "Enable trigger users_updated_trigger" })
    .click();
  await expect(page.getByRole("row", { name: /Enabled/i })).toBeVisible();

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

  await expect
    .poll(() => fs.readdirSync(runtime.exportDir).length)
    .toBeGreaterThan(0);

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
