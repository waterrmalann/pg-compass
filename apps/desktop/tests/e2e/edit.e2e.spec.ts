import fs from "node:fs";
import path from "node:path";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { DEFAULT_APP_SETTINGS } from "@/shared/types/settings";

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

async function launch(runtime: {
  storeDir: string;
  exportDir: string;
}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: getExecutablePath(),
    env: {
      ...process.env,
      PG_COMPASS_STORE_DIR: runtime.storeDir,
      PG_COMPASS_TEST_SAVE_DIALOG_DIR: runtime.exportDir,
    },
  });
  const page = await app.firstWindow();
  return { app, page };
}

function writeSettings(storeDir: string, readOnlyMode: boolean): void {
  fs.writeFileSync(
    path.join(storeDir, "settings.json"),
    JSON.stringify(
      {
        settings: {
          ...DEFAULT_APP_SETTINGS,
          general: { ...DEFAULT_APP_SETTINGS.general, readOnlyMode },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function openUsersDataTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open E2E Database" }).click();
  await expect(page.getByText("Schema name")).toBeVisible();
  await page.getByRole("row", { name: /app/i }).click();
  await expect(page.getByRole("tab", { name: "Tables" })).toBeVisible();
  await page.getByRole("row", { name: /users/i }).click();
  await expect(page.getByRole("tab", { name: "Data" })).toBeVisible();
  await page.getByRole("tab", { name: "Data" }).click();
}

test.skip(
  !process.env.PG_COMPASS_TEST_ADMIN_DATABASE_URL &&
    !process.env.PG_COMPASS_TEST_DATABASE_URL,
  "Set PG_COMPASS_TEST_ADMIN_DATABASE_URL or PG_COMPASS_TEST_DATABASE_URL to run Electron E2E tests.",
);

test.describe.configure({ mode: "serial" });

test("read-only mode hides every edit affordance", async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Electron tests only run with Chromium",
  );
  const runtime = getRuntimeState(testInfo);
  writeSettings(runtime.storeDir, true);

  const { app, page } = await launch(runtime);
  try {
    await openUsersDataTab(page);

    // Table view
    await expect(
      page.locator('[data-testid="cell-editor-target"]'),
    ).toHaveCount(0);
    const firstCell = page.locator("td").first();
    await firstCell.dblclick({ force: true });
    await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Card view
    await page.getByRole("button", { name: "Card view" }).click();
    await expect(
      page.locator('[data-testid="cell-editor-target"]'),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("edits apply when read-only mode is off", async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Electron tests only run with Chromium",
  );
  const runtime = getRuntimeState(testInfo);
  writeSettings(runtime.storeDir, false);

  const { app, page } = await launch(runtime);
  try {
    await openUsersDataTab(page);

    // Table view: double-click should reveal an edit target and (eventually)
    // an editor. This test fails until EditableCell is wired into table-data-view.
    const targets = page.locator('[data-testid="cell-editor-target"]');
    await expect(targets.first()).toBeVisible();
    await targets.first().dblclick();
    await expect(page.locator('[data-testid="cell-editor"]')).toBeVisible();
  } finally {
    await app.close();
  }
});

test("views expose no edit affordance even when read-only mode is off", async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Electron tests only run with Chromium",
  );
  const runtime = getRuntimeState(testInfo);
  writeSettings(runtime.storeDir, false);

  const { app, page } = await launch(runtime);
  try {
    await page.getByRole("button", { name: "Open E2E Database" }).click();
    await expect(page.getByText("Schema name")).toBeVisible();
    await page.getByRole("row", { name: /app/i }).click();
    await page.getByRole("tab", { name: "Views" }).click();
    await page.getByRole("row", { name: /active_users/i }).click();
    await page.getByRole("tab", { name: "Data" }).click();

    await expect(
      page.locator('[data-testid="cell-editor-target"]'),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add data" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Update" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("delete confirmation dialog contains wide table previews", async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Electron tests only run with Chromium",
  );
  const runtime = getRuntimeState(testInfo);
  writeSettings(runtime.storeDir, false);

  const { app, page } = await launch(runtime);
  try {
    await page.setViewportSize({ width: 900, height: 700 });
    await openUsersDataTab(page);

    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByTestId("delete-data-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("delete-preview-table-scroll")).toBeVisible();

    const dialogMetrics = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(dialogMetrics.left).toBeGreaterThanOrEqual(15);
    expect(dialogMetrics.right).toBeLessThanOrEqual(
      dialogMetrics.viewportWidth - 15,
    );
    expect(dialogMetrics.scrollWidth).toBeLessThanOrEqual(
      dialogMetrics.clientWidth + 1,
    );

    const previewMetrics = await page
      .getByTestId("delete-preview-table-scroll")
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });

    expect(previewMetrics.left).toBeGreaterThanOrEqual(dialogMetrics.left);
    expect(previewMetrics.right).toBeLessThanOrEqual(dialogMetrics.right);
    expect(previewMetrics.scrollWidth).toBeGreaterThan(
      previewMetrics.clientWidth,
    );
    expect(previewMetrics.right).toBeLessThanOrEqual(
      previewMetrics.viewportWidth - 15,
    );
  } finally {
    await app.close();
  }
});
