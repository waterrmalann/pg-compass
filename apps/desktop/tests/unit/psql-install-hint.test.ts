import { describe, expect, it } from "vitest";
import {
  psqlInstallHint,
  psqlSettingsPointer,
  psqlUnavailableMessage,
} from "@/components/workspace/shell/psql-install-hint";

describe("psql install hints", () => {
  it("gives platform-specific install steps", () => {
    expect(psqlInstallHint("darwin")).toMatch(/brew install libpq/);
    expect(psqlInstallHint("win32")).toMatch(/PostgreSQL installer/);
    expect(psqlInstallHint("linux")).toMatch(/apt install postgresql-client/);
  });

  it("points a failed search at install steps and the setting", () => {
    const message = psqlUnavailableMessage(
      { path: null, source: null, platform: "darwin", problem: "not found" },
      false,
    );
    expect(message).toBe(
      "psql not found. Install it with Homebrew (brew install libpq) or Postgres.app.",
    );
  });

  it("explains a bad configured path in its own words", () => {
    const problem = "No executable psql at /opt/psql.";
    expect(
      psqlUnavailableMessage(
        { path: null, source: null, platform: "linux", problem },
        true,
      ),
    ).toBe(problem);
  });

  it("points at the setting to change", () => {
    expect(psqlSettingsPointer(false)).toBe(
      "Or set its path in Settings → General.",
    );
    expect(psqlSettingsPointer(true)).toBe(
      "Fix or clear the psql path in Settings → General.",
    );
  });
});
