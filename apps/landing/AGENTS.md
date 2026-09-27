# Landing page

The marketing site for PG Compass, published to GitHub Pages at `/pg-compass` (see `.github/workflows/deploy.yml`). It is a single static Astro page styled with Tailwind v4.

## Design

- Follows `docs/DESIGN.md` (Quiet Utility). Its tokens live in `src/styles/global.css`, with the landing-only notes in §16 of that document.
- The one addition is the **brand blue** (`--brand`), which appears only on the logo, the download CTAs, the hero glow and the theme slider handle. Buttons, links and everything else stay monochrome.
- Dark is the default theme. The header toggle stores `pgc-theme` in `localStorage`, and an inline script in `Layout.astro` applies it before paint.
- Fonts are Geist and Geist Mono, self-hosted through `@fontsource-variable`. Icons come from `@lucide/astro`; the GitHub mark is inlined in `GitHubIcon.astro`.

## Structure

- `src/pages/index.astro` composes the sections in `src/components/`, in the order that §10 of DESIGN.md prescribes.
- `src/components/previews/` holds the interactive feature previews. They are built from the same recipes as the app, using the demo data in `src/lib/demo.ts`.
- `src/scripts/` holds the client-side behaviour: the header (theme and mobile drawer), the product tour, the tree preview, the theme slider, and the GitHub hydration.
- `src/scripts/github.ts` reads the latest release, repository stats, commits and contributors from the public GitHub API. Every element has a static fallback, so the page still works when the API is unavailable or rate limited.

## Screenshots

Product screenshots are captured from the real desktop app with the scripts in `scripts/screenshots/`; that folder's README has the steps. Retake them whenever the app's UI changes visibly. Astro converts them to responsive WebP at build time.

## Copy

Follow DESIGN.md §11: two-beat headlines ending in a full stop, sentence case, no exclamation marks. Only claim features the desktop app actually has, and check them against `docs/PROJECT_CONTEXT.md` and the code.
