# Landing screenshots

The product shots in `src/assets/screenshots/` are captured from the real desktop app, so they can be retaken whenever the UI changes. The demo database is "Tidewater Supply", a fictional outdoor-gear shop (`seed.sql`).

Run each step from the repository root, in separate terminals.

1. Start the seeded database. It serves PGlite on port 54330 and writes a PG Compass store with three connections to `.store/`:

   ```bash
   node apps/landing/scripts/screenshots/start-db.mjs
   ```

2. Start the desktop app against that store with remote debugging enabled. On Windows, piping `tail` keeps Forge's stdin open when the command runs in the background:

   ```bash
   PG_COMPASS_STORE_DIR="$PWD/apps/landing/scripts/screenshots/.store" pnpm --filter @pg-compass/desktop exec electron-forge start -- --remote-debugging-port=9333
   ```

3. Capture the scenes. This writes `data`, `cards`, `structure` and `query` in both themes at 1200×750 @2x. Pass scene names to capture only some of them:

   ```bash
   node apps/landing/scripts/screenshots/capture.mjs
   ```

Keep the app window visible while capturing: Chromium stops painting windows that are minimised or covered, and the capture will hang.

`public/og.png` is a 1200×630 crop of `data-dark.png`. Regenerate it with sharp after retaking the screenshots.
