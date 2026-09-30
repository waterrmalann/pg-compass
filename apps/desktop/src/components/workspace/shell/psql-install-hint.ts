import type { PsqlLocation } from "@/shared/types/shell";

/** One-line, platform-specific way to get the psql client. */
export function psqlInstallHint(platform: string): string {
  if (platform === "darwin") {
    return "Install it with Homebrew (brew install libpq) or Postgres.app.";
  }
  if (platform === "win32") {
    return "Install it with the PostgreSQL installer from postgresql.org. The Command Line Tools component is enough.";
  }
  return "Install it with your package manager, for example sudo apt install postgresql-client or sudo dnf install postgresql.";
}

/**
 * Why the shell cannot start. A bad configured path explains itself; a
 * failed search gets install steps for the platform.
 */
export function psqlUnavailableMessage(
  location: PsqlLocation,
  hasConfiguredPath: boolean,
): string {
  if (hasConfiguredPath && location.problem) return location.problem;
  return `psql not found. ${psqlInstallHint(location.platform)}`;
}

/** Where to fix it, for messages shown outside the Settings dialog. */
export function psqlSettingsPointer(hasConfiguredPath: boolean): string {
  if (hasConfiguredPath) {
    return "Fix or clear the psql path in Settings → General.";
  }
  return "Or set its path in Settings → General.";
}
