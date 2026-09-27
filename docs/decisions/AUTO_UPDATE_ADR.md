# Auto Update ADR

## Description

Users should learn about, and on Windows receive, new releases without watching GitHub. The app otherwise makes no network requests apart from the user's databases, so update checks must be visible, limited and easy to turn off.

## Decision

One setting, **Check for updates automatically** (Settings → Privacy, `privacy.automaticUpdates`), on by default, controls two mechanisms. Both live in the main process and share a 4-hour interval.

1. **Release check (all platforms).** At launch and every 4 hours, the app reads the latest release from the GitHub API and compares its tag with the running version. When a newer one exists, a banner at the top of the window says so and links to the release. Closing the banner hides that message for the session only. It comes back on the next launch.
2. **In-place updates (Windows).** On Squirrel installs, `update-electron-app` points Electron's `autoUpdater` at `update.electronjs.org`, which serves the Squirrel files from our GitHub Releases. The update downloads in the background. The banner then offers **Restart to update**, which replaces `update-electron-app`'s native dialog.

**Help → Check for Updates…** runs the release check on demand, even with the setting off, and answers in a native dialog. On Windows with automatic updates on, it also starts a Squirrel check.

Turning the setting off stops both timers straight away. Development (unpackaged) builds never check on their own. Squirrel is skipped on the first run after install, when it holds a lock.

## Rationale

- `update.electronjs.org` is free for public GitHub repositories and needs no infrastructure beyond the release assets we already publish.
- Electron's `autoUpdater` does not support Linux. A self-updating AppImage would mean moving from Forge to electron-builder, and `.deb` updates would need an apt repository. A release notice covers Linux at almost no cost.
- The release check also covers Windows before Squirrel has the update, and Windows runs that are not Squirrel installs.
- The banner fits the Quiet Utility shell better than a modal, and it doesn't interrupt work.

## Status

Accepted.

## Consequences

- Each Windows release must upload `RELEASES` and the `.nupkg` next to `Setup.exe` (see `GITHUB_RELEASES_ADR.md`).
- Update checks contact `api.github.com` and, on Windows, `update.electronjs.org`, which see the user's IP address, platform and app version. The landing page FAQ says this and says how to turn it off.
- Unauthenticated GitHub API calls are limited to 60 an hour per IP. At one check every 4 hours this is not a concern.
- Windows builds are not code-signed. Update integrity rests on HTTPS and the checksums in `RELEASES`. Signing (and notarization, if macOS ships) is still worth adding.
- Users on 0.9.8 or earlier must install the first version that has the updater by hand.
- Re-enabling the setting within a session registers `update-electron-app`'s logging listeners again. This is harmless because the setting rarely changes.
