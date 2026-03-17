# Testing Strategy ADR

## Title
Unit and E2E Testing Infrastructure for the Desktop Application

## Status
Accepted

## Context
The `apps/desktop` Electron application had no test infrastructure. A testing strategy was needed to validate the correctness of the main process IPC handlers, utility functions, preload script channel forwarding, and overall application launch.

## Decision

### Unit Tests — Vitest 2.1.9
- **Multi-project config** with separate `main` and `preload` projects, both running in the `node` environment.
- Vitest 2.x chosen over 4.x because the project uses Vite 5, and Vitest 4.x requires Vite 6+.
- Each test file declares its own `vi.mock()` calls (not relying on setup files) to ensure proper hoisting behaviour.
- `vi.hoisted()` is used for mock state variables (e.g., `storeData`) that need to be accessible inside hoisted `vi.mock()` factory functions.

### E2E Tests — Playwright 1.58.2
- Playwright's `_electron` module launches the compiled app directly via its `.vite/build/main.js` entry point.
- E2E tests are kept separate from unit tests and require a prior build step.
- Configuration in `playwright.config.ts` at `apps/desktop/`.

### Exported Test Helpers
The following private helpers were given `export` access to allow direct unit testing without re-implementing their logic in tests:
- `parseEstimatedRowCount`, `getSchemaFilterSql` from `connection-ipc.ts`
- `ensureArray`, `isReadOnlyQuery` from `table-data-ipc.ts`

## Rationale
- Vitest integrates with Vite's module system, enabling proper TypeScript path alias resolution (`@/*`) without additional configuration.
- Separating unit tests from E2E prevents slow Playwright tests from blocking the fast feedback loop of unit testing.
- Direct export of pure helper functions reduces test complexity compared to testing them through IPC handler stubs.

## Consequences
- All unit tests (`pnpm test`) run in under 1 second, providing fast feedback.
- E2E tests require a build first and are run separately via `pnpm test:e2e`.
- The four exported helpers now form a semi-public internal API; callers outside of tests should still treat them as internal.
