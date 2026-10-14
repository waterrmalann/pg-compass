import fs from "node:fs";
import path from "node:path";
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { Client } from "pg";
import {
  getRuntimeState,
  launchApp,
  type E2ERuntimeState,
} from "./electron-app";
import { DEFAULT_APP_SETTINGS } from "@/shared/types/settings";

async function launch(runtime: {
  storeDir: string;
  exportDir: string;
}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchApp({
    PG_COMPASS_STORE_DIR: runtime.storeDir,
    PG_COMPASS_TEST_SAVE_DIALOG_DIR: runtime.exportDir,
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

async function readDisplayName(
  runtime: E2ERuntimeState,
  userId: number,
): Promise<string> {
  const client = new Client(runtime.connection.fields);
  await client.connect();
  try {
    const result = await client.query<{ display_name: string }>(
      "SELECT display_name FROM app.users WHERE id = $1",
      [userId],
    );
    return result.rows[0]!.display_name;
  } finally {
    await client.end();
  }
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
    const dataCell = page.getByText("user2@example.com", { exact: true });
    await expect(dataCell).toBeVisible();
    await expect(
      page.locator('[data-testid="cell-editor-target"]'),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit row" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add data" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toBeDisabled();
    await dataCell.dblclick();
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

    const target = page
      .locator('[data-testid="cell-editor-target"]')
      .filter({ hasText: /^User 2$/ });
    await target.dblclick();
    const editor = page.locator('[data-testid="cell-editor"]');
    await expect(editor).toBeVisible();
    await editor.getByRole("textbox").fill("Edited in E2E");
    await editor.getByRole("button", { name: "Save" }).click();

    await expect(editor).toHaveCount(0);
    await expect(
      page
        .locator('[data-testid="cell-editor-target"]')
        .filter({ hasText: /^Edited in E2E$/ }),
    ).toBeVisible();
    expect(await readDisplayName(runtime, 2)).toBe("Edited in E2E");
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

    // The preview box is the only scroll container, so the header sticks.
    const headerOffsets = await page
      .getByTestId("delete-preview-table-scroll")
      .evaluate((element) => {
        const header = element.querySelector("thead");
        if (!header) throw new Error("Preview table has no header.");
        const offsetBefore =
          header.getBoundingClientRect().top -
          element.getBoundingClientRect().top;
        element.scrollTop = element.scrollHeight;
        const offsetAfter =
          header.getBoundingClientRect().top -
          element.getBoundingClientRect().top;
        return { offsetBefore, offsetAfter, scrollTop: element.scrollTop };
      });

    expect(headerOffsets.scrollTop).toBeGreaterThan(0);
    expect(headerOffsets.offsetAfter).toBeCloseTo(
      headerOffsets.offsetBefore,
      0,
    );
  } finally {
    await app.close();
  }
});

test("Data tab grid scrolls in one box and keeps its header and gutter stuck", async ({
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
    await page.setViewportSize({ width: 900, height: 700 });
    await openUsersDataTab(page);

    const scroll = page.locator('[data-testid="table-data-scroll"]:visible');
    await expect(scroll.getByRole("row").nth(1)).toBeVisible();

    // The grid's box is the only scroll container, so it takes both axes and
    // the sticky header and gutter stick to it.
    const metrics = await scroll.evaluate((element) => {
      const header = element.querySelector("thead");
      const gutter = element.querySelector("thead th");
      const firstColumn = element.querySelector("thead th:nth-child(2)");
      const rowGutter = element.querySelector("tbody tr:last-child td");
      if (!header || !gutter || !firstColumn || !rowGutter) {
        throw new Error("Data grid has no header or rows.");
      }
      const box = element.getBoundingClientRect();
      const before = {
        headerTop: header.getBoundingClientRect().top - box.top,
        gutterLeft: gutter.getBoundingClientRect().left - box.left,
        rowGutterLeft: rowGutter.getBoundingClientRect().left - box.left,
        firstColumnLeft: firstColumn.getBoundingClientRect().left - box.left,
      };
      element.scrollTop = element.scrollHeight;
      element.scrollLeft = element.scrollWidth;
      const after = {
        headerTop: header.getBoundingClientRect().top - box.top,
        gutterLeft: gutter.getBoundingClientRect().left - box.left,
        rowGutterLeft: rowGutter.getBoundingClientRect().left - box.left,
        firstColumnLeft: firstColumn.getBoundingClientRect().left - box.left,
      };
      return {
        before,
        after,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
      };
    });

    expect(metrics.scrollTop).toBeGreaterThan(0);
    expect(metrics.scrollLeft).toBeGreaterThan(0);
    expect(metrics.after.headerTop).toBeCloseTo(metrics.before.headerTop, 0);
    expect(metrics.after.gutterLeft).toBeCloseTo(metrics.before.gutterLeft, 0);
    expect(metrics.after.rowGutterLeft).toBeCloseTo(
      metrics.before.rowGutterLeft,
      0,
    );
    expect(metrics.after.firstColumnLeft).toBeLessThan(
      metrics.before.firstColumnLeft,
    );
  } finally {
    await app.close();
  }
});
