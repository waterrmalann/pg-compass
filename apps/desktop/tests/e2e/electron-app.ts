import fs from "node:fs";
import path from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type TestInfo,
} from "@playwright/test";
import type { ConnectionConfig } from "@/shared/types/connection";

export type E2ERuntimeState = {
  storeDir: string;
  exportDir: string;
  /** The seeded database's saved connection. */
  connection: ConnectionConfig;
};

export function getRuntimeState(testInfo: TestInfo): E2ERuntimeState {
  const runtimeStatePath = String(testInfo.config.metadata.runtimeStatePath);
  return JSON.parse(
    fs.readFileSync(runtimeStatePath, "utf8"),
  ) as E2ERuntimeState;
}

/**
 * Launches the production main bundle (`.vite/build/main.js`, built by
 * `electron-forge package` in global setup) with the unfused Electron from
 * node_modules. The packaged binary disables the inspect fuse, which
 * Playwright needs to attach, so it is only covered by the smoke spec.
 */
export async function launchApp(
  env: Record<string, string>,
): Promise<ElectronApplication> {
  const mainBundlePath = path.join(process.cwd(), ".vite", "build", "main.js");
  if (!fs.existsSync(mainBundlePath)) {
    throw new Error(
      `Main bundle was not found at ${mainBundlePath}. Run electron-forge package first.`,
    );
  }

  const sandboxArguments = process.platform === "linux" ? ["--no-sandbox"] : [];
  const inheritedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      inheritedEnv[key] = value;
    }
  }

  return electron.launch({
    args: [...sandboxArguments, mainBundlePath],
    env: { ...inheritedEnv, ...env },
  });
}
