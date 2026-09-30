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

test("filters, projects, sorts and exports with the Data tab query DSL", async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Electron tests only run with Chromium",
  );

  const runtime = getRuntimeState(testInfo);
  const exportDir = fs.mkdtempSync(path.join(runtime.exportDir, "dsl-"));
  const app = await electron.launch({
    executablePath: getExecutablePath(),
    env: {
      ...process.env,
      PG_COMPASS_STORE_DIR: runtime.storeDir,
      PG_COMPASS_TEST_SAVE_DIALOG_DIR: exportDir,
    },
  });
  const page = await app.firstWindow();

  await page.getByRole("button", { name: "Open E2E Database" }).click();
  await page.getByRole("row", { name: /app/i }).click();
  await page.getByRole("row", { name: /^users/i }).click();
  const rowCount = page.locator('[data-slot="panel-count"]');
  await expect(rowCount).toHaveText("120");

  const filter = page.getByRole("textbox", { name: "Filter" });
  await filter.click();
  await page.keyboard.type("id >=");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    'Expected a value after ">=".',
  );
  await expect(rowCount).toHaveText("120");

  await page.keyboard.type(" 1 AND status = 'inactive' AND id <= 30");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(rowCount).toHaveText("4");

  await page.getByRole("button", { name: "Query options" }).click();
  await page.getByRole("textbox", { name: "Project" }).click();
  await page.keyboard.type("id, display_name AS name");
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Sort" }).click();
  await page.keyboard.type("id -1");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByRole("button", { name: "Read-only" })).toBeVisible();
  // Earlier tabs stay mounted but hidden; only the visible grid counts.
  // A leading action column, then the projected columns in order.
  const headers = page.locator("thead th").filter({ visible: true });
  await expect(headers).toHaveCount(3);
  await expect(headers.nth(1)).toContainText("id");
  await expect(headers.nth(2)).toContainText("name");
  await expect(
    page.locator("tbody tr").filter({ visible: true }).first(),
  ).toContainText("28");
  await expect(rowCount).toHaveText("4");

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Export selected query" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  // The export streams to a temporary file and renames it when done.
  await expect(page.getByText("Exported 4 rows")).toBeVisible();
  const exported = fs.readFileSync(path.join(exportDir, "users.csv"), "utf8");
  expect(exported.trim().split("\n")).toEqual([
    "id,name",
    "28,User 28",
    "21,User 21",
    "14,User 14",
    "7,User 7",
  ]);

  await app.close();
});
