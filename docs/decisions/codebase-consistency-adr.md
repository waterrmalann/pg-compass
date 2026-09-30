# Codebase Consistency Enforcement

## Description

The desktop application had mixed filename and formatting conventions, non-blocking lint warnings, duplicated IPC contracts, and security-sensitive Electron defaults that were only implicit.

## Decision

- Project-authored desktop source and test files use kebab-case; conventional tool filenames and generated shadcn primitives are exempt.
- Prettier is the formatting authority, and lint fails on warnings.
- React code uses the shared accessibility rules, with narrowly documented exceptions for generated labels and intentional dialog autofocus.
- IPC channel names and renderer API types have one shared source of truth. Main-process handlers validate runtime input and reject calls outside the trusted main frame.
- Native save-dialog results become short-lived, operation-bound capabilities; export handlers cannot write to renderer-selected arbitrary paths.
- Data-tab filters, projections and sorts are a restricted query DSL that the main process parses, binds to catalog columns and compiles; no renderer-authored SQL fragment reaches Data-tab SQL. Filtered deletes recompile the filter inside the delete transaction and run one parameterized `DELETE`. (Updated 2026-09-30; filtered deletes previously captured primary keys from a free-form `WHERE` in a read-only transaction.)
- Every browser window explicitly enables isolation and sandboxing, blocks navigation and permissions, applies CSP, and allowlists external destinations.
- Production CSP permits only self-hosted scripts. Development additionally permits Vite's inline React Fast Refresh preamble and the configured dev-server WebSocket origin.

## Rationale

Automated checks prevent conventions and security boundaries from drifting as features are added. Central IPC contracts reduce mismatches between main, preload, and renderer code without introducing a new framework.

## Status

Accepted — 2026-07-17.

## Consequences

- New source files that violate kebab-case fail the root lint command.
- Accessibility defects and warnings block CI.
- IPC additions require a shared channel, API contract, runtime validator, and tests.
- Release builds must boot the packaged executable and receive a post-mount renderer signal before artifacts are published.
- Historical documentation filenames remain unchanged to avoid breaking existing task and ADR references.
