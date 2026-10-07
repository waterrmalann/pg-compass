import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  // Specs share one store dir (see global-setup), so files must not overlap.
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  metadata: {
    runtimeStatePath: path.resolve(".test-runtime/e2e-state.json"),
  },
});
