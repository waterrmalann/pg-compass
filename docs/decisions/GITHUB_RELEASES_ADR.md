# ADR: GitHub Releases for Desktop

## Title

Automated Windows and Linux desktop builds and GitHub Releases via CI

## Status

Accepted

## Decision

A GitHub Actions workflow (`.github/workflows/release-desktop.yml`) automates building and releasing the desktop app for Windows and Linux:

1. **Triggers**: Version tags (`v*`) and manual `workflow_dispatch`.
2. **Parallel builds**: `build-windows` (Squirrel `.exe`) and `build-linux` (`.deb` + `.AppImage`) run concurrently.
3. **Artifacts**: Every build uploads artifacts to the workflow run for download/testing.
4. **Releases**: A separate `release` job runs only on tagged pushes (`v*`), collects artifacts from both builds, and creates a single GitHub Release with all platform installers. Windows releases also carry Squirrel's `RELEASES` file and `.nupkg`, which in-place updates download (see `AUTO_UPDATE_ADR.md`).

## Rationale

- Parallel jobs keep build times short — each platform builds independently.
- A dedicated `release` job ensures one tag produces one release with all platform artifacts.
- Squirrel (Windows), `.deb`, and AppImage cover the most common distribution formats — AppImage is universal (no install required), `.deb` covers Debian/Ubuntu.
- `softprops/action-gh-release` is the most widely adopted action for creating releases and handles file globbing well.

## Consequences

- Desktop release builds run only for version tags and manual dispatches, avoiding duplicate builds when a release commit and its tag are pushed together.
- Linux smoke tests disable Chromium's sandbox for the test process only because hosted runners cannot launch the packaged SUID helper reliably; production builds retain Electron's sandbox defaults.
- Releases are only created for `v*` tags. To release, first run `pnpm version:bump <patch|minor|major|x.y.z>` to keep app version files in sync, then run `git tag v0.x.0 && git push origin v0.x.0`.
- Removing `RELEASES` or the `.nupkg` from a release breaks Windows auto-updates for users on older versions. The landing page's download matcher only picks `Setup.exe`, so the extra assets don't show up there.
- macOS can be added as another parallel job later. It would need code signing and notarization for auto-updates.
