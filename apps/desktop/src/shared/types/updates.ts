/**
 * What the app knows about newer releases. See docs/decisions/AUTO_UPDATE_ADR.md.
 *
 * - `up-to-date`: no newer release is known (or no check has run).
 * - `available`: GitHub has a newer release than the running version.
 * - `ready`: Windows only. Squirrel has downloaded the update and it installs
 *   on restart. `version` is null when the release check did not run first.
 */
export type UpdateStatus =
  | { kind: "up-to-date" }
  | { kind: "available"; version: string; releaseUrl: string }
  | { kind: "ready"; version: string | null };
