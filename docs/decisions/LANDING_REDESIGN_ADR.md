# ADR: Landing page on Quiet Utility with a brand accent

## Title

Rebuild `apps/landing` on `docs/DESIGN.md`, keeping the logo blue as a brand accent

## Status

Accepted

## Decision

1. The landing page is rebuilt from scratch on the Quiet Utility tokens, type scale and component recipes. It replaces the previous JetBrains Mono / Instrument Serif styling, custom palette, grid background and uppercase labels.
2. The PG Compass blue stays as the page's single brand accent (`--brand`), limited to the logo, the download CTAs, the slider handle, text selection and the hero glow. This is a deliberate exception to DESIGN.md §13, recorded in §16.
3. The page is split into Astro components with typed client scripts. The feature previews are interactive HTML built from the design recipes, not images.
4. Product screenshots are regenerated from the real desktop app by a committed script (seeded PGlite plus CDP capture), in both themes. They replace the hand-made PNGs and the 6 MB GIF.
5. Fonts are self-hosted with `@fontsource-variable/*`, and icons come from `@lucide/astro`, the same families as the desktop app.

## Rationale

- The landing page should look like the product it advertises. The app already follows DESIGN.md.
- The logo blue is the one recognisable brand asset. Confining it to download actions makes the main action obvious without colouring the rest of the page.
- Scripted screenshots stay accurate as the UI evolves, and they use believable demo data instead of test fixtures.

## Consequences

- Any new landing UI uses the DESIGN.md recipes. Blue beyond the listed places needs a new decision.
- Visible desktop UI changes should be followed by a screenshot reshoot (`apps/landing/scripts/screenshots/README.md`).
- The page ships about 2.4 MB, down from roughly 10 MB, and works without the GitHub API.
