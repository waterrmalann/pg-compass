import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { resolve } from 'path';

/** Launch the Electron app from the compiled output directory. */
export async function launchElectron(): Promise<{
  app: ElectronApplication;
  window: Page;
}> {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../.vite/build/main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  return { app, window };
}
