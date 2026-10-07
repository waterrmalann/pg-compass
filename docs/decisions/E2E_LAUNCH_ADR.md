# E2E Electron Launch

## Status

Accepted

## Context

The packaged app disables the `EnableNodeCliInspectArguments` fuse (see `forge.config.ts`). Playwright's `_electron.launch()` attaches through the inspector, so it hung and timed out when pointed at the packaged binary.

## Decision

1. Playwright scenario specs launch the production main bundle (`.vite/build/main.js`, built by `electron-forge package` in global setup) with the unfused Electron from `node_modules`, via the shared `tests/e2e/electron-app.ts` helper.
2. The packaged, fused binary stays covered by the smoke spec, which spawns it directly without Playwright attaching.
3. Release fuses are never relaxed for tests, and no E2E-only package variant is built.
4. E2E specs run with a single worker because they share one store directory.

## Rationale

- Keeps release hardening intact with no env-flag branch in `forge.config.ts` that could leak into a release build.
- Scenario specs still exercise the exact main, preload and renderer bundles that ship.
- One package step serves both the smoke spec and the scenario specs.

## Consequences

- Scenario specs run with `app.isPackaged === false` and without asar or fuse enforcement, so packaging-only behaviour (asar loading, fuses, the auto-updater) is not covered there. The smoke spec is the guard for the packaged binary.
- The E2E suite runs serially, which is slower but deterministic.
