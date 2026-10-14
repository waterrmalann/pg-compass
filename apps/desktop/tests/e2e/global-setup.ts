import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import type { FullConfig } from "@playwright/test";
import {
  buildConnectionFromUrl,
  createSeededDatabase,
  hasPostgresTestConfig,
} from "../support/postgres";
import { writeStoreFiles } from "../support/store";

export default async function globalSetup(config: FullConfig) {
  if (!hasPostgresTestConfig()) {
    return;
  }

  const seeded = await createSeededDatabase();
  const storeDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pg-compass-e2e-store-"),
  );
  const exportDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pg-compass-e2e-export-"),
  );
  const connection = buildConnectionFromUrl(seeded.connectionUrl, {
    label: "E2E Database",
  });

  writeStoreFiles(storeDir, { connections: [connection] });

  execSync("pnpm exec electron-forge package", {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  const runtimeStatePath = String(config.metadata.runtimeStatePath);
  fs.mkdirSync(path.dirname(runtimeStatePath), { recursive: true });
  fs.writeFileSync(
    runtimeStatePath,
    JSON.stringify(
      {
        storeDir,
        exportDir,
        connection,
      },
      null,
      2,
    ),
    "utf8",
  );

  // Playwright awaits a returned function as the global teardown. An "exit"
  // handler can't run async work, so the database used to be left behind.
  return async () => {
    await seeded.cleanup();
  };
}
