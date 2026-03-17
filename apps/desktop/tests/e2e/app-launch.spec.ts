import { test, expect } from '@playwright/test';
import { launchElectron } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let window: Page;

test.beforeEach(async () => {
  ({ app, window } = await launchElectron());
});

test.afterEach(async () => {
  await app.close();
});

test('application launches and shows main window', async () => {
  const isVisible = await app.evaluate(async ({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    return mainWindow?.isVisible() ?? false;
  });
  expect(isVisible).toBe(true);
});

test('main window has a non-empty title', async () => {
  const title = await window.title();
  expect(title).toBeTruthy();
});

test('renderer loads the React app root element', async () => {
  const rootEl = await window.locator('#root').count();
  expect(rootEl).toBeGreaterThan(0);
});

test('app version is accessible from main process', async () => {
  const version = await app.evaluate(async ({ app: electronApp }) => {
    return electronApp.getVersion();
  });
  expect(version).toMatch(/\d+\.\d+\.\d+/);
});
