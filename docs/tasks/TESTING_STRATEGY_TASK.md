# Testing Strategy Task

## Status: Completed

## Overview
Implement a comprehensive testing strategy for the `apps/desktop` Electron application covering unit tests for the main process, preload script, and a Playwright E2E configuration for integration smoke tests.

## Implementation Details

### Test Runner: Vitest 2.1.9
Chosen for compatibility with Vite 5 (the current build tool). Vitest 4.x requires Vite 6+.

### Test Structure
```
apps/desktop/
├── vitest.config.ts              # Multi-project vitest config
├── playwright.config.ts          # Playwright E2E config
├── tests/
│   ├── unit/
│   │   ├── main/
│   │   │   ├── pg-utils.test.ts        (14 tests)
│   │   │   ├── connection-store.test.ts (18 tests)
│   │   │   ├── settings-store.test.ts   (9 tests)
│   │   │   ├── connection-ipc.test.ts   (24 tests)
│   │   │   └── table-data-ipc.test.ts   (26 tests)
│   │   └── preload/
│   │       └── preload.test.ts          (15 tests)
│   └── e2e/
│       ├── helpers.ts            # Electron launch helper
│       └── app-launch.spec.ts    # App smoke tests
```

### Test Coverage (106 unit tests)

| Module | Tests | Coverage Areas |
|--------|-------|----------------|
| `pg-utils.ts` | 14 | `buildPgConfig` (URI/fields/SSL), `quoteIdent` escaping, pool management |
| `connection-store.ts` | 18 | CRUD operations, encryption bypass in tests, URI mode |
| `settings-store.ts` | 9 | Get/update settings, partial patches, persistence |
| `connection-ipc.ts` | 24 | Handler registration, `parseEstimatedRowCount`, `getSchemaFilterSql`, IPC responses |
| `table-data-ipc.ts` | 26 | `ensureArray`, `isReadOnlyQuery`, handler registration, read-only guard |
| `preload.ts` | 15 | `contextBridge` exposure, all API channel forwarding |

### NPM Scripts Added
```json
"test": "vitest run",
"test:watch": "vitest",
"test:main": "vitest run --project main",
"test:preload": "vitest run --project preload",
"test:coverage": "vitest run --coverage",
"test:e2e": "playwright test"
```

### Production Code Changes
The following private helpers were exported to enable direct unit testing:
- `parseEstimatedRowCount` in `connection-ipc.ts`
- `getSchemaFilterSql` in `connection-ipc.ts`
- `ensureArray` in `table-data-ipc.ts`
- `isReadOnlyQuery` in `table-data-ipc.ts`

### Mocking Strategy
Each test file defines its own `vi.mock()` calls. `vi.hoisted()` is used for mock state variables (e.g., `storeData`) that need to exist inside hoisted `vi.mock()` factory closures.

- `electron`: Mocked via `vi.mock('electron', ...)` with `vi.hoisted()` for stable references
- `electron-store`: Mocked with an in-memory `Map`-based implementation via `vi.hoisted()`
- `pg`: Mocked with `vi.fn()` constructors to prevent actual DB connections

### E2E Tests (Playwright 1.58.2)
Located in `tests/e2e/`. Require the app to be built first (`electron-forge make`).
Tests are NOT run by vitest — only by `playwright test`.
