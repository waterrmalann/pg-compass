# Testing Strategy

## Status

Accepted

## Context

PG Compass had no automated testing despite having meaningful logic in:
- Electron main-process PostgreSQL access
- preload IPC contracts
- renderer state hooks and workspace behavior
- desktop-only user flows that a browser-only harness would miss

The repository also needs a repeatable TDD rule for future desktop features.

## Decision

1. Use `Vitest` for unit and integration testing in `apps/desktop`.
2. Use `Playwright` against the real Electron app, not only the renderer in a browser.
3. Use two database-backed integration tiers:
   - PGlite for the fast default integration suite
   - real PostgreSQL for the authoritative integration suite and E2E coverage
4. Enforce risk-based coverage for high-value areas rather than a single blunt repo-wide threshold.
5. Require new desktop features and bug fixes to extend the automated test suite as part of delivery.

## Rationale

- The codebase is split cleanly across main, preload, renderer, and shared layers, which maps well to a test pyramid.
- Browser-only tests would miss preload, IPC wiring, native dialog behavior, and Electron lifecycle concerns.
- PGlite provides a very fast local loop while preserving real SQL execution through a PostgreSQL-compatible socket.
- A real PostgreSQL suite is still needed for authoritative coverage because PG Compass depends on `pg`, metadata introspection, and export behavior that should be validated against the canonical server.
- A risk-based coverage policy protects core logic without incentivizing low-value assertion spam.

## Consequences

- Local setup now includes a no-install fast integration path plus optional PostgreSQL environment variables for authoritative runs.
- Playwright runs package the desktop app before launching tests, which is slower but closer to shipped behavior. How the packaged build is launched is recorded in [E2E_LAUNCH_ADR.md](./E2E_LAUNCH_ADR.md).
- Future feature work should begin with a failing low-level test and add higher-level coverage when the user flow changes.
