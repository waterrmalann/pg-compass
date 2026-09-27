# DESIGN.md — Quiet Utility

A design language for calm, dense, tool-like software. It pairs a monochrome base with translucent layers, hairline borders and small, exact type. Colour appears only when it means something: a status, a priority or a deadline. The interface should get out of the way and leave the content in front.

Use this document as the source of truth when building any app or marketing site in this style. Tokens are given as CSS custom properties (Tailwind v4 / shadcn-compatible naming). Every primitive is defined in §2.1, so the document can be used without Tailwind.

> **v1.1:** adds colour primitives, a quieter validated chart palette, dashboard components (panel, stat tile, data table, chart, code block, top bar, sidebar, mobile drawer), button states, a legibility rule for small text, and the "normal is neutral" rule.

---

## 1. Principles

1. **Monochrome first, colour as signal.** Surfaces, text and controls are neutral. Hue is kept for meaning: red means overdue or destructive, amber means warning or high priority, green means success or done, blue means info. Never use colour for decoration.
2. **Layers are translucent, not tinted.** Hover fills, muted surfaces, borders and inputs are alpha blends of pure black (light mode) or pure white (dark mode). They sit correctly on any parent surface, so nested panels never need their own palette.
3. **Hairlines over boxes.** Structure comes from 1px low-contrast borders and dividers, not from heavy fills or big shadows. Many sections are just a divided list.
4. **Small, precise, medium-weight type.** Headings use weight 500 (sometimes 600), never 700+. Tracking is tight on display sizes. UI text sits at 12–14px, and metadata goes down to 10px.
5. **Show the product.** Marketing pages put real, working UI previews in front of illustrations. The preview frames use the same components as the app.
6. **Honest, two-beat copy.** Short declarative headlines ending in a period. Plain descriptions that also say what the product *doesn't* do.
7. **Dark mode is the hero.** Design and review in dark first. Light mode is fully supported and mirrors the same alpha logic.

---

## 2. Colour

### 2.1 Primitives

These are the only raw colours in the system. Semantic tokens (§2.2) point at them, and components use only the semantic tokens. If you use Tailwind v4, these match its default palette and you can skip this block.

```css
:root {
  /* Neutral scale */
  --color-white: #ffffff;
  --color-black: #000000;
  --color-neutral-50:  #fafafa;  /* light sidebar, text on dark primary */
  --color-neutral-100: #f5f5f5;  /* dark-mode foreground and primary */
  --color-neutral-300: #d4d4d4;  /* chart context series (light) */
  --color-neutral-400: #a3a3a3;  /* focus ring (light), chart ink (dark) */
  --color-neutral-500: #737373;  /* base for muted text, ring (dark) */
  --color-neutral-600: #525252;  /* chart ink (light) */
  --color-neutral-700: #404040;  /* chart context series (dark) */
  --color-neutral-800: #262626;  /* light-mode foreground and primary */
  --color-neutral-950: #0a0a0a;  /* base for dark surfaces */

  /* Status hues */
  --color-red-400:     #ff6467;
  --color-red-500:     #fb2c36;
  --color-red-700:     #c10007;
  --color-amber-400:   #ffb900;
  --color-amber-500:   #fe9a00;
  --color-amber-700:   #bb4d00;
  --color-emerald-400: #00d492;
  --color-emerald-500: #00bc7d;
  --color-emerald-700: #007a55;
  --color-blue-400:    #51a2ff;
  --color-blue-500:    #2b7fff;
  --color-blue-700:    #1447e6;

  /* Chart categorical steps (validated, see §2.4) */
  --viz-blue-l:    #2a78d6;  --viz-blue-d:    #3987e5;
  --viz-orange-l:  #eb6834;  --viz-orange-d:  #d95926;
  --viz-aqua-l:    #1baf7a;  --viz-aqua-d:    #199e70;
  --viz-violet-l:  #4a3aa7;  --viz-violet-d:  #9085e9;
  --viz-magenta-l: #e87ba4;  --viz-magenta-d: #d55181;
}
```

Resolved surface values (dark): sidebar ≈ `#111111`, page ≈ `#141414`, card ≈ `#191919`.

### 2.2 Semantic tokens

```css
:root {
  --radius: 0.625rem; /* 10px */

  --background:            #ffffff;
  --foreground:            var(--color-neutral-800);            /* #262626 */
  --card:                  #ffffff;
  --card-foreground:       var(--color-neutral-800);
  --popover:               #ffffff;
  --popover-foreground:    var(--color-neutral-800);

  --primary:               var(--color-neutral-800);            /* near-black */
  --primary-foreground:    var(--color-neutral-50);
  --secondary:             color-mix(in oklab, #000 4%, transparent);
  --secondary-foreground:  var(--color-neutral-800);
  --muted:                 color-mix(in oklab, #000 4%, transparent);
  --muted-foreground:      color-mix(in srgb, var(--color-neutral-500) 90%, #000); /* ≈ #686868 */
  --subtle-foreground:     color-mix(in srgb, var(--foreground) 72%, transparent); /* text <12px and text on muted fills */
  --accent:                color-mix(in oklab, #000 4%, transparent);   /* hover fill */
  --accent-foreground:     var(--color-neutral-800);

  --border:                color-mix(in oklab, #000 8%, transparent);
  --input:                 color-mix(in oklab, #000 10%, transparent);
  --ring:                  var(--color-neutral-400);

  --destructive:           var(--color-red-500);        /* #fb2c36 */
  --destructive-foreground:var(--color-red-700);        /* #c10007 */
  --warning:               var(--color-amber-500);      /* #fe9a00 */
  --warning-foreground:    var(--color-amber-700);      /* #bb4d00 */
  --success:               var(--color-emerald-500);    /* #00bc7d */
  --success-foreground:    var(--color-emerald-700);    /* #007a55 */
  --info:                  var(--color-blue-500);       /* #2b7fff */
  --info-foreground:       var(--color-blue-700);       /* #1447e6 */

  --sidebar:               var(--color-neutral-50);
  --sidebar-foreground:    color-mix(in srgb, var(--color-neutral-800) 64%, var(--sidebar));
  --sidebar-primary:       var(--color-neutral-800);
  --sidebar-primary-foreground: var(--color-neutral-50);
  --sidebar-accent:        color-mix(in oklab, #000 4%, transparent);
  --sidebar-accent-foreground: var(--color-neutral-800);
  --sidebar-border:        color-mix(in oklab, #000 6%, transparent);
  --sidebar-ring:          var(--color-neutral-400);

  --code:                  #ffffff;
  --code-foreground:       var(--foreground);
  --code-highlight:        color-mix(in oklab, #000 4%, transparent);

  /* Charts: see §2.4 for rules */
  --chart-ink:     var(--color-neutral-600);  /* single-series default */
  --chart-context: var(--color-neutral-300);  /* comparison / previous period */
  --chart-grid:    color-mix(in oklab, #000 6%, transparent);
  --chart-1: var(--viz-blue-l);
  --chart-2: var(--viz-orange-l);
  --chart-3: var(--viz-aqua-l);
  --chart-4: var(--viz-violet-l);
  --chart-5: var(--viz-magenta-l);
}

.dark {
  --background:            color-mix(in srgb, var(--color-neutral-950) 96%, #fff); /* ≈ #141414 */
  --foreground:            var(--color-neutral-100);                               /* #f5f5f5 */
  --card:                  color-mix(in srgb, var(--background) 98%, #fff);        /* ≈ #191919 */
  --card-foreground:       var(--color-neutral-100);
  --popover:               color-mix(in srgb, var(--background) 98%, #fff);
  --popover-foreground:    var(--color-neutral-100);

  --primary:               var(--color-neutral-100);   /* inverted: light button on dark */
  --primary-foreground:    var(--color-neutral-800);
  --secondary:             color-mix(in oklab, #fff 4%, transparent);
  --secondary-foreground:  var(--color-neutral-100);
  --muted:                 color-mix(in oklab, #fff 4%, transparent);
  --muted-foreground:      color-mix(in srgb, var(--color-neutral-500) 90%, #fff); /* ≈ #818181 */
  --accent:                color-mix(in oklab, #fff 4%, transparent);
  --accent-foreground:     var(--color-neutral-100);

  --border:                color-mix(in oklab, #fff 6%, transparent);
  --input:                 color-mix(in oklab, #fff 8%, transparent);
  --ring:                  var(--color-neutral-500);

  --destructive:           color-mix(in srgb, var(--color-red-500) 90%, #fff);
  --destructive-foreground:var(--color-red-400);       /* #ff6467 */
  --warning-foreground:    var(--color-amber-400);     /* #ffb900 */
  --success-foreground:    var(--color-emerald-400);   /* #00d492 */
  --info-foreground:       var(--color-blue-400);      /* #51a2ff */

  --sidebar:               color-mix(in srgb, var(--color-neutral-950) 97%, #fff); /* ≈ #111111 */
  --sidebar-foreground:    color-mix(in srgb, var(--color-neutral-100) 64%, var(--sidebar));
  --sidebar-primary:       var(--color-neutral-100);
  --sidebar-primary-foreground: var(--color-neutral-800);
  --sidebar-accent:        color-mix(in oklab, #fff 4%, transparent);
  --sidebar-accent-foreground: var(--color-neutral-100);
  --sidebar-border:        color-mix(in oklab, #fff 5%, transparent);
  --sidebar-ring:          var(--color-neutral-400);

  --code:                  color-mix(in srgb, var(--background) 98%, #fff);
  --code-highlight:        color-mix(in oklab, #fff 4%, transparent);

  --chart-ink:     var(--color-neutral-400);
  --chart-context: var(--color-neutral-700);
  --chart-grid:    color-mix(in oklab, #fff 6%, transparent);
  --chart-1: var(--viz-blue-d);
  --chart-2: var(--viz-orange-d);
  --chart-3: var(--viz-aqua-d);
  --chart-4: var(--viz-violet-d);
  --chart-5: var(--viz-magenta-d);
}
```

`--subtle-foreground` is written the same way in both modes, so it follows `--foreground` automatically (≈ `#b8b8b8` on dark chips, ≈ `#606060` on light ones).

**If you theme with `prefers-color-scheme`** instead of a `.dark` class, put the `.dark` block under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` and repeat it under `:root[data-theme="dark"]` so a manual toggle wins in both directions.

### 2.3 How colour is used

- **Surface stack (dark):** sidebar `#111` → page `#141414` → card/popover `#191919`. The steps are only about 1–2% in lightness. Borders do most of the separation.
- **The `*-foreground` status colours are for text and icons. The base status colours are for fills at low alpha.** A status chip is `bg-destructive/10 text-destructive-foreground`, never a solid red block.
- **Opacity modifiers on tokens are part of the vocabulary:** `border-border/70`, `border-border/30`, `bg-muted/40`, `bg-muted/55`, `bg-card/90`, `bg-background/85`, `hover:bg-accent/60`. Soften borders on nested content (70%) and on very large surfaces like the footer (30%).
- **Label colours** (tags like "urgent", "hr", "sales") are shown as a 6px dot (`size-1.5 rounded-full`) inside a neutral chip. The chip itself stays neutral.
- **Priority** is shown as a small icon in a status colour inside a neutral chip: chevron-down in blue/muted for low, chevron-up in amber for medium, double chevron in amber for high, and a red alert icon for urgent.
- **Gradients** are only near-invisible depth cues, for example `bg-linear-to-b from-muted/20 to-background` behind a board, or a `from-muted/25` 40px fade under a column header.
- **Normal is neutral.** A healthy, on-track or default state gets no colour: a neutral chip, or no chip at all. Only deviations get colour (warning, destructive, and info for "in progress"). Success green is kept for a *change* worth celebrating (a job finished, a check that just passed), not for resting "OK" states. A screen where everything is fine should look almost entirely grey.

### 2.4 Chart colour

Charts follow the same restraint as the rest of the UI. Pick the colour by the job the chart does:

| Situation | Colour |
|---|---|
| One series (the common case) | `--chart-ink` for every mark. No legend; the panel title names the series. |
| One series plus a comparison (previous period, target, average) | Current = `--chart-ink`, comparison = `--chart-context`. The legend uses dots. |
| One highlighted item among many (the selected bar, the anomaly) | That item in `--chart-1`, the rest in `--chart-context`. |
| 2–5 separate series (reads vs writes, per region) | `--chart-1 … --chart-5` **in order, never skipped or cycled**. More than 5 → fold into "Other" or use small multiples. |
| A value that *means* good or bad (error rate, failed jobs) | The status tokens (`--destructive`, `--warning`), always with an icon or label. Never mix status and categorical colours in one chart. |
| Magnitude on a heat grid | One hue ramp: `--chart-1` at 12% → 100% opacity over the surface. |

The categorical order (blue, orange, aqua, violet, magenta) is validated for colour-vision deficiency. Adjacent pairs clear ΔE 9.2 (light) and 9.4 (dark), and the normal-vision floor ΔE ≥ 19.7. Keep the order. In light mode, aqua and magenta sit below 3:1 contrast on white, so charts that use slot 3 or 5 must show direct value labels or offer a table view.

Also:

- Text in and around charts (axis labels, values, legends) uses the text tokens, never the series colour.
- Status green, amber and red never appear as ordinary series colours.
- The hue for a series is the same in light and dark mode. Only the step changes.

---

## 3. Typography

### 3.1 Families

```css
--font-sans:    "Geist", "Geist Variable", ui-sans-serif, system-ui, sans-serif;
--font-heading: var(--font-sans);
--font-mono:    "Geist Mono", "Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

Loading: Google Fonts serves the family as `Geist` / `Geist Mono` (`https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap`). The npm package `@fontsource-variable/geist` registers it as `Geist Variable`. The stack above covers both.

Geist is a neo-grotesk with a technical feel. If it isn't available, fall back to Inter with `font-feature-settings: "ss01", "cv11"`. Use mono for keyboard shortcuts, IDs in code contexts, CLI snippets and numeric columns.

### 3.2 Scale

| Role | Size / line-height | Weight | Tracking | Notes |
|---|---|---|---|---|
| Display / H1 | 36px → 48px (md) / 1.06 | 500 | −0.025em | `text-balance`, max ~2 lines |
| Feature H2 | `clamp(26px, 2.7vw, 34px)` / 1.2 | 500 | −0.035em | `text-balance` |
| Section H2 | 24px → 30px / 1.33 | 500 | −0.025em | FAQ, resource lists |
| Story H2 | 30px → 36px / 1.2 | 600 | −0.025em | Long-form or personal sections |
| Entity title (in-app) | 24–32px / 1.15 | 600 | −0.02em | Task or document title inside detail views |
| Page title (in-app) | 24px / 1.25 | 500 | −0.025em | Top of an app screen, one per screen. Can be a two-beat sentence ("Replica is healthy. Two tables need a vacuum.") |
| Metric | 28px / 1.1 | 500 | −0.02em | Stat tiles. `font-variant-numeric: tabular-nums`. Unit follows in `muted-foreground` at 60% of the size ("48.2 GB") |
| Panel title | 14px / 20px | 500 | 0 | Panel headers, often with a count badge |
| Table header | 12px / 16px | 500 | 0 | `muted-foreground`, sentence case, no uppercase |
| Data cell | 13px / 20px | 400 | 0 | Numbers right-aligned with `tabular-nums`. Identifiers and SQL in mono |
| H3 / item title | 16px / 1.5 | 500 | −0.025em | FAQ questions, list titles |
| Lead paragraph | 18px / 1.7 | 400 | 0 | `muted-foreground`, max-width ~34rem |
| Body (marketing) | 15px / 1.8 | 400 | 0 | `muted-foreground`, `text-pretty` |
| Body (UI) | 14px / 1.43 | 400–500 | 0 | Default app text |
| Small / button | 14px / 20px | 500 | 0 | Buttons, nav links, footer headings |
| Caption / eyebrow | 12px / 16px | 400 | 0 | `muted-foreground`, sentence case, **not** uppercase |
| Micro / meta | 10–11px / 1.5 | 400–500 | 0 | IDs (`WEB-24`), chip text, preview hints. Colour: `--subtle-foreground`, never `muted-foreground` (see §12) |

### 3.3 Rules

- Headings are **sentence case with a trailing period** when they are statements: "Big tasks. Clear next steps."
- Eyebrows are small muted sentence-case text (e.g. "Subtasks & context"), 18px above the heading. They are never all-caps, and have no letter-spacing or colour.
- Keep the hierarchy mostly through **size and colour** (foreground vs muted-foreground), not weight. The whole system uses three weights: 400, 500 and 600.
- Line length: marketing copy blocks max 360–490px wide; lead paragraphs about 560px.

---

## 4. Spacing & layout

- **Base unit:** 4px (`--spacing: 0.25rem`). Common steps: 2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 48, 64, 80.
- **Containers:** content max `72rem` (1152px). Narrow prose `42rem`. Copy columns `360px`.
- **Page gutters:** 24px (`px-6`) on marketing, 16px (`px-4`) on the header at mobile.
- **Section rhythm:**
  - Hero: `pt-14 pb-16 → md:pt-20 md:pb-20 → lg:pt-24`
  - Standard section: `py-16 → md:py-24`
  - Closing/social section: `py-20 → md:py-28`
  - Feature rows: 80px vertical padding, separated by a 1px `border-top`
- **Feature row grid:** `grid-template-columns: 0.85fr 1.3fr; gap: 80px; align-items: center`. Alternate rows reverse to `1.3fr 0.85fr`. At ≤1024px the gap goes to 40px, and at mobile it collapses to a single column with a 32px gap.
- **App density:** toolbars 44px tall (`h-11`), controls 24–32px, card padding 12px, list-row padding `6px 12px`.

---

## 5. Radius

```css
--radius:     0.625rem;                 /* 10px, the base */
--radius-sm:  calc(var(--radius) - 4px) /* 6px  */
--radius-md:  calc(var(--radius) - 2px) /* 8px  */
--radius-lg:  var(--radius)             /* 10px */
--radius-xl:  calc(var(--radius) + 4px) /* 14px */
--radius-2xl: 1rem                      /* 16px */
```

| Element | Radius |
|---|---|
| Buttons, segmented control shell, cards | `lg` (10px) |
| Segment items, small buttons, menu items, count badges | `md` (8px) |
| Meta chips / tags | 4px (`rounded`) |
| Checkboxes | 4px |
| Board columns, app frames, modals | `xl` (12–14px) |
| Feature preview panels | 8px |
| Avatars, status dots | full |

Nested radii follow the inner-radius rule: an inner element is 2px smaller than its container when it is inset by 2px (e.g. `rounded-lg` shell with `p-0.5` → `rounded-md` items).

---

## 6. Elevation & depth

Depth comes from light **edges**, not from drop shadows.

| Level | Recipe | Use |
|---|---|---|
| Flat | none | Most surfaces |
| Hairline lift | `box-shadow: 0 1px 2px rgb(0 0 0 / 0.05)` (`shadow-xs/5`) | Cards, columns, outline buttons |
| Top highlight (dark) | `::before { box-shadow: 0 -1px color-mix(in oklab, #fff 6%, transparent) }` | Buttons and inputs in dark mode. Simulates a lit top edge |
| Inner shine (primary) | `inset 0 1px 0 color-mix(in oklab, #fff 16%, transparent)` | Primary buttons |
| Panel | `0 20px 50px -30px rgb(0 0 0 / 0.25)` | Feature preview panels |
| Popover | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` (`shadow-lg`) | Tooltips, menus, dropdowns |
| Floating | `0 25px 50px -12px rgb(0 0 0 / 0.25)` (`shadow-2xl`) + `ring-1 ring-black/5` | App window frame, drawers, dragged items |
| Glow | `0 0 80px 8px color-mix(in srgb, var(--foreground) 7%, transparent)` | The single hero product screenshot. Used once per page |

Glass: the sticky header and board canvases use `bg-background/85 backdrop-blur-md` (or `bg-card/70 backdrop-blur`) with `supports-[backdrop-filter]` fallbacks.

---

## 7. Motion

| Token | Value | Use |
|---|---|---|
| Default | `150ms cubic-bezier(0.4, 0, 0.2, 1)` | Colour, opacity and shadow transitions |
| Snappy out | `160ms cubic-bezier(0.23, 1, 0.32, 1)` | Press feedback (`active:scale-[0.97]`), click pulses |
| Glide | `700ms cubic-bezier(0.77, 0, 0.175, 1)` | Scripted demo cursors, large positional moves |
| Card settle | `300ms ease-out` | Column/card border and background changes |
| Drawer | `200ms cubic-bezier(0.23, 1, 0.32, 1)` (scrim 150ms fade) | Mobile navigation, side sheets |

- Hover states change **fill or colour only**. No lifts, no scale-ups.
- Secondary affordances show up on hover (`opacity-0 → group-hover:opacity-100`, 150ms). Examples: "Add task" at the foot of a column, row detail text, arrows.
- Demo UIs may animate a fake cursor (move, press, drag, poof) to show interactions. Pause on focus, and offer a play/pause control.
- `prefers-reduced-motion`: remove transforms and scripted cursors, keep opacity fades at ≤160ms.

---

## 8. Iconography

- Outline icons with a thin stroke (Lucide-style), 1.5–2px stroke, `size-3.5`/`size-4` (14–16px) in UI, 12px inside chips.
- Icons inherit `currentColor`, which is usually `muted-foreground`, turning `foreground` on hover or active.
- Frequent motifs: dashed circle (backlog), open circle (to do), half/dotted circle (in progress), check circle (done), chevrons for priority, calendar, sliders (subtasks), check-square (checklist progress), `↗` arrow for outbound links, `→` arrow on primary CTAs.
- Inside buttons, trim icon margins (`[&_svg]:-mx-0.5`) so optical padding stays even.

---

## 9. Components

Class recipes assume Tailwind v4 with the tokens above.

### 9.1 Button

Base: `relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border text-sm font-medium outline-none transition-shadow cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-64 disabled:pointer-events-none`

Touch: on `pointer-coarse`, add an `::after` hit area of at least 44×44px.

| Size | Height | Padding X | Text |
|---|---|---|---|
| xs | 24px | 8px | 12px |
| sm | 28px | 10px | 12px |
| default | 32px | 10px | 14px |
| lg | 40px | 14px | 14px |
| xl (hero CTA) | 48px | 20px | 14px |

| Variant | Rest | Hover | Pressed (`:active`, `[data-pressed]`) |
|---|---|---|---|
| **Primary** | `bg-primary text-primary-foreground border-primary shadow-xs` + inset `0 1px 0 #fff/16%`. Dark: a near-white button on a near-black page. Light: near-black on white. | `bg-primary/90` (border too) | `bg-primary/85`, inset highlight removed, `scale(0.98)` |
| **Outline** | `bg-background border-border shadow-xs/5` (dark: bg `#fff/2.5%`, border `#fff/8%`, `::before` top highlight `#fff/6%`) | `bg-accent/50` | `bg-accent`, top highlight removed |
| **Secondary** | `bg-secondary text-secondary-foreground border-transparent` | `bg-secondary/80` | `bg-accent` |
| **Ghost** | `border-transparent text-muted-foreground` (or foreground when it's the only label) | `bg-accent text-foreground` | `bg-accent/80` |
| **Destructive** | `bg-destructive text-white border-destructive` (reserve for confirmations) | `bg-destructive/90` | `bg-destructive/85` |
| **Link** | `text-muted-foreground`, often with a trailing `↗` (14px) | `text-foreground underline underline-offset-4` | none |

Disabled: `opacity: 0.64; pointer-events: none` for every variant. Icon-only buttons are square (width = height) with the same variants, most often ghost.

**Primary button rule.** A screen's header or top bar has **at most one** primary button, the main action for that screen. A self-contained tool panel inside the screen (a query editor, a composer, a form in a dialog) may have its own primary for *its* action (Run, Send, Save), at size `sm` or `xs`. Everything else is outline, ghost or link.

Hero pattern: a full-width stack on mobile of **Primary (with →)** above **Outline**, and under them a 12px muted reassurance line ("14-day trial. No credit card required.").

### 9.2 Segmented control / view switcher

- Shell: `inline-flex h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5`
- Item: `inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors`
  - Inactive: `text-muted-foreground hover:bg-accent/60 hover:text-foreground`
  - Active: `bg-accent text-foreground`
- Each item has a 12–14px leading icon.

**Underline tabs** (marketing scene switchers): 12px muted text, `min-h-10 px-3 rounded-md`, hover `bg-muted`. The active item turns `text-foreground` with a 1px foreground underline inset 12px from each side.

### 9.3 Chips, badges & tags

| Kind | Recipe |
|---|---|
| **Meta chip** (date, subtasks, checklist) | `inline-flex h-5.5 items-center gap-1 rounded border border-border/70 bg-muted/55 px-2 text-[11px]` in `--subtle-foreground` + 12px icon |
| **Label tag** | Meta chip + leading `size-1.5 rounded-full` dot in the label colour, text `text-foreground/90 font-medium` |
| **Status chip** | `flex h-5.5 items-center gap-1 rounded px-2 text-[11px] font-medium bg-{status}/10 text-{status}-foreground` + 12px status icon (e.g. overdue date → destructive; due soon → warning). Only for deviations; see "Normal is neutral" (§2.3) |
| **Count badge** | `rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium` in `--subtle-foreground` |
| **Keyboard hint** | `inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[11px]` in `--subtle-foreground` (e.g. `⌘K`) |

### 9.4 Avatar

- `inline-flex size-5 items-center justify-center rounded-full bg-muted border border-border/30 text-[10px] font-medium` in `--subtle-foreground`, with initials (2 letters, uppercase).
- Sizes: 16, 20, 32px in UI. For community/sponsor grids, 64–80px with `border border-border/70 opacity-80 hover:opacity-100`.

### 9.5 Card (item card)

```
group relative w-full rounded-lg border border-border bg-background p-3 text-left
shadow-xs/5 transition-colors hover:bg-muted/40
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
```
Anatomy, top to bottom:
1. Row: ID (`text-[11px]` in `--subtle-foreground`, e.g. `ABC-12`) on the left, assignee avatar (20px) on the right.
2. Title: `text-sm font-medium text-foreground`, wraps to 2 lines max.
3. Tags row: label tags.
4. Meta row: priority chip, then count chips, then the date chip, gap 6px.

### 9.6 Column / panel container

```
flex flex-col rounded-xl border border-border/70 bg-muted/40 dark:bg-card/90
shadow-xs/5 transition-all duration-300 ease-out hover:border-border/90
```
- Header: `px-3 py-2 border-b border-border/60`, status icon + `text-sm font-medium` title + count badge.
- Body: `p-2`, cards stacked with `gap-2`.
- Footer: `border-t border-border/60 p-1.5`, ghost row button "+ Add item" (`text-xs text-muted-foreground`). Shown on hover at `md+`, always shown on touch.

### 9.7 List row / menu item

- `flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground`
- Interactive rows in previews use a `::before` layer filled with `--accent` at opacity 0, which goes to 1 on hover or focus-within with `border-radius: 6px`. This keeps the text layer from repainting.
- Selected: `bg-accent text-foreground`.

### 9.8 Inputs

- `h-8 rounded-lg border border-input bg-background px-2.5 text-sm shadow-xs/5 placeholder:text-muted-foreground`
- Dark: top-edge highlight `::before 0 -1px #fff/6%`, hidden while focused, invalid or disabled.
- Focus: `ring-2 ring-ring/24` (dark `ring-ring/48`) with the border moving to `ring`. Invalid: `border-destructive/36 ring-destructive/16` (dark `/24`).
- Checkbox: 16px, 4px radius, `border-input`. Checked: `bg-primary text-primary-foreground` with a check glyph. A completed item's label becomes `line-through text-muted-foreground`.

### 9.9 Header (marketing)

`sticky top-0 z-50 h-16 border-b bg-background/85 px-4 md:px-6 backdrop-blur-md`
- Left: wordmark (logo glyph + name, ~24px tall).
- Centre/left: nav links `text-sm font-medium text-muted-foreground hover:text-primary px-2 py-1.5`. Dropdown for resources.
- Right: search trigger with a `⌘K` hint, plus a Primary `sm/default` "Get started" button. On mobile: the button plus a hamburger (ghost icon button).

### 9.10 Footer

`border-t border-border/30 bg-sidebar/70 px-6 py-12 sm:py-16`
- First column: wordmark + one-line tagline (`text-sm text-muted-foreground`).
- Link columns: heading `text-sm font-medium text-foreground`, links `text-sm text-muted-foreground hover:text-foreground`, 12px vertical gap.
- Bottom bar: copyright + small social icons, muted.

### 9.11 Product preview frame (marketing)

Two tiers:

**Hero app window:** `overflow-hidden rounded-xl border border-border/70 bg-background shadow-2xl ring-1 ring-black/5` plus the page's single **glow**. Inside it is a real app shell:
- Top bar: `h-11 border-b border-border/80 bg-card px-2`, breadcrumb `Workspace / Project` (the parent in muted, the current page in foreground 500), and a segmented view switcher.
- Filter bar: an outline `h-7` button with a filter icon.
- Canvas: `bg-linear-to-b from-muted/20 to-background`, columns laid out horizontally with `gap-3 p-3`.
- Below the frame: underline scene tabs + a play/pause button.

**Feature preview panel:** `rounded-[8px] border border-border bg-background overflow-hidden shadow-[0_20px_50px_-30px_rgb(0_0_0/0.25)]`
- Header: `min-h-12 px-4 py-2.5 border-b text-[13px] font-medium text-muted-foreground`. Shows the entity ID on the left and actions on the right.
- Property strip: inline status, priority, assignee and date, each as icon + 12px label.
- Body: `p-6 flex flex-col gap-7`. Entity title in 32px/600/−0.02em, description in 15.5px/1.72 muted.
- Footer: `min-h-14 px-6 py-3 border-t text-[11px] text-muted-foreground` with an invitation to interact ("Try checking off a subtask.").
- The preview must be **interactive**: checkboxes toggle, rows hover, and buttons press with `scale(0.97)`.

### 9.12 FAQ / divided list

- Wrapper: `divide-y border-y` (or items with `border-t`), no card background.
- Item: `flex items-start justify-between gap-6 py-6`.
- Question: `text-base font-medium`. Answer: `text-[15px] leading-[1.75] text-muted-foreground`, max ~65ch.
- Follow-up: a link button with `↗` ("Read the installation guide ↗"), `text-sm text-foreground`, underline on hover.

### 9.13 Link list (resources)

- Each row: title `text-sm font-medium text-foreground`, description `text-sm text-muted-foreground` on the next line, and a `↗` icon right-aligned in muted. Rows are separated by `border-t` with `py-5`.
- The whole row is the hit target. On hover the arrow turns foreground, and the row may take `bg-muted/40`.

### 9.14 Personal / story block

A single-column prose section (`max-w-2xl`): 600-weight H2, then 2–4 paragraphs of `text-base leading-relaxed text-muted-foreground`, signed with an avatar (96–128px, `rounded-full border border-border/70`) plus name and role.

### 9.15 Panel (dashboard card)

The basic container for anything on an app dashboard.

```
rounded-xl border border-border bg-card shadow-xs/5 overflow-hidden
```
- **Header:** `flex items-center gap-2 min-h-11 px-4 border-b border-border`. It holds a 14px muted icon, the panel title (14px/500), an optional count badge, and on the right either a muted 12px note ("Sorted by size") or ghost `xs` actions.
- **Body:** `p-4`. Lists and tables go edge to edge with no body padding, and their rows carry the 16px inset.
- **Footer (optional):** `px-4 py-2.5 border-t border-border text-[12px] text-muted-foreground`. Use it for a one-line explanation of the data ("Durations over 1 s are marked red.").
- In light mode the panel is white on white, so the border does all the work. Don't add a grey page background to compensate.
- Dashboard grid: `gap-4` (16px) between panels, `gap-6` between groups. Panels in a row share one height.

### 9.16 Stat tile

A panel with no header, for a single headline number.

```
rounded-xl border border-border bg-card p-4 shadow-xs/5 flex flex-col gap-3
```
1. **Label row:** 12px `muted-foreground` label on the left, 14px muted icon on the right.
2. **Value:** the Metric role (28px/500, tabular). A unit or denominator follows in `muted-foreground` at 60% size ("38 / 200", "184 ms").
3. **Sparkline (optional):** 32px tall, full width. A 1.5px `--chart-ink` stroke, area fill of the ink at 8%, and a 4px end dot in `--foreground` with a 2px `--card` ring. No axes.
4. **Footer row:** a meta chip with the delta ("+1.4 GB") plus a 12px muted context line ("in the last 7 days"). The delta chip is neutral unless the change is bad: then it's a status chip (warning or destructive). Good changes stay neutral.

Tiles sit in a row of 4 on desktop, 2 on tablet and 2 (compact) or 1 on phones.

### 9.17 Data table

```
table: w-full border-collapse text-[13px]
thead th: h-9 px-4 text-left text-[12px] font-medium text-muted-foreground border-b border-border
tbody td: h-10 px-4 border-b border-border/70 (none on the last row)
tbody tr: transition-colors hover:bg-muted/40; selected → bg-accent
```
- Numbers are right-aligned with `tabular-nums`, and their header is right-aligned too. Identifiers, SQL and paths are in mono at 12.5px.
- Qualified names split tone: `schema.` in `muted-foreground`, the name in foreground 500.
- **Inline bar (optional):** a 48×4px track (`bg-muted`, radius 2px) with a `--chart-ink` fill, placed before a size value to show relative magnitude.
- **Status column:** a status chip only where something needs attention. Leave healthy rows empty or show a muted "—".
- **Sort:** the active header is foreground with a 12px chevron. Inactive headers show the chevron on hover only.
- **Overflow:** the table scrolls horizontally inside the panel (`overflow-x: auto`), never the page. The first column can be `position: sticky; left: 0` with a `--card` background.
- **Density:** `h-8` rows for dense variants, `h-12` when rows have two lines.

### 9.18 Chart

Charts live inside a panel (§9.15). Colour rules are in §2.4.

- **Headline:** above the plot, the total or current value in the Metric role (or 20px/500), followed by a 12px muted caption ("queries in the last 24 hours").
- **Plot:** 180–240px tall on desktop, 160px on phones.
- **Gridlines:** horizontal only, 1px `--chart-grid`, 3–4 lines. There's no vertical grid and no chart border.
- **Axes:** labels are 10–11px mono in `--subtle-foreground`, and only every 3rd–6th x label is shown. There's no axis line apart from the zero baseline (1px `--border`).
- **Bars:** width ≤ 60% of the slot, with the data end rounded 2px and anchored to the baseline. Keep a 2px `--card` gap between stacked segments and between adjacent bars.
- **Lines:** 1.5–2px stroke, no area fill (or 8% of the series colour for a single series), and no point markers except on hover.
- **Legend:** only for 2+ series. Put it top-right in the panel header: 8px dots plus a 12px `muted-foreground` label.
- **Hover:** hovering a bar or column shows a 1px `--border` vertical crosshair and a tooltip. The tooltip is a popover: `rounded-lg border bg-popover shadow-lg px-2.5 py-2 text-[12px]`, with the time in muted and each series as dot + label + right-aligned tabular value.
- **No dual y-axes.** Two measures of different scale go in two charts.

### 9.19 Code block & syntax

```
container: rounded-lg border border-border bg-code overflow-hidden
code:      font-mono text-[12.5px] leading-[20px] p-3, tab-size 2, overflow-x auto
gutter:    line numbers right-aligned, min-width 2ch, text-muted-foreground/60, pr-3
current line: bg-code-highlight
```
Syntax colours stay mostly monochrome, so the code reads like the rest of the UI:

| Token | Colour |
|---|---|
| Keywords (`SELECT`, `const`, `if`) | `--foreground`, weight 500 |
| Identifiers, columns, variables | `--foreground` at 85% |
| Functions | `--foreground` |
| Strings | `--success-foreground` |
| Numbers, booleans, `NULL` | `--info-foreground` |
| Comments | `--muted-foreground` (no italics) |
| Operators, punctuation | `--muted-foreground` |
| Errors / invalid | wavy underline in `--destructive` |

Code editor chrome: a header with the file name (12px mono muted) on the right and a toolbar underneath the code (`border-t px-3 py-2`) holding the Run primary (`sm`), a Format ghost and a `⌘↵` keyboard hint. The result area below starts as a 12px muted placeholder line.

### 9.20 Mobile navigation drawer

Below 768px the sidebar leaves the layout and becomes a drawer:
- **Trigger:** a ghost icon button (menu icon) at the left of the top bar. The top bar keeps the page title, the screen's primary action (as an icon button, or `sm`) and at most one more icon button. Everything else moves into the drawer or an overflow menu.
- **Drawer:** fixed, full height, `width: min(288px, 85vw)`, `bg-sidebar border-r border-sidebar-border shadow-2xl`, sliding in from the left with `transform` over 200ms `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Scrim:** `bg-black/40 backdrop-blur-[2px]`, fading in over 150ms. Tapping it closes the drawer.
- **Behaviour:** Escape closes it, focus moves into the drawer on open and back to the trigger on close, the body doesn't scroll while it's open, and the drawer has `aria-modal="true"` with a close button in its header.
- Segmented view switchers that don't fit collapse into a native `<select>` styled as an outline button, or scroll horizontally inside their shell.

### 9.21 Top bar (app)

`sticky top-0 z-20 flex h-11 items-center gap-2 px-3 border-b border-border bg-background/85 backdrop-blur-md`
- **Left:** a breadcrumb. Ancestors are 13px `muted-foreground` (mono for connection or resource names), separated by a muted `/`. The current page is 13px foreground 500.
- **Middle:** a segmented view switcher (§9.2), if the screen has views.
- **Right:** in order, icon buttons (theme toggle, notifications), then outline actions, then the one primary. Top-bar buttons are size `sm` (28px) and icon buttons are 28×28.
- **Below 1024px:** the view switcher and secondary actions move out of the top bar into a toolbar row directly under the page title (`flex flex-wrap items-center gap-2 mt-3`). The top bar keeps the breadcrumb (or just the current page on phones), icon buttons and the primary.

### 9.22 Sidebar (app)

- `width: 256px` on desktop (`240px` at 1024–1279px), `bg-sidebar border-r border-sidebar-border`, `p-2`, scrolling on its own.
- **Top:** wordmark row (`h-11 px-2`), then a switcher card (workspace or connection: `rounded-lg border border-sidebar-border bg-background/40 p-2`, 13px/500 name, 11px subtle line under it, chevrons-up-down icon right), then a search trigger styled as an input with a `⌘K` hint.
- **Nav items:** `flex h-8 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`, 16px icon, optional right-aligned count in 11px mono `--subtle-foreground`. Active: `bg-sidebar-accent text-sidebar-accent-foreground`.
- **Section label:** `mt-4 mb-1 px-2 text-[12px] text-muted-foreground`, sentence case, with an optional right-aligned note.
- **Tree:** rows `h-7 text-[12.5px]`, 16px indent per level, a 12px chevron for expandable nodes, mono names for resources (tables, files), right-aligned 11px mono counts.
- Below 768px it becomes the drawer in §9.20.

---

## 10. Page patterns

### Marketing landing (in order)
1. **Sticky glass header**
2. **Hero:** left-aligned H1 (two lines, balanced), muted lead, stacked CTAs (primary with arrow + outline), 12px reassurance line, small muted text links with icons (e.g. source repo, launch page ↗).
3. **Live product window** with glow and scene switcher.
4. **Feature rows** (3×), alternating copy and preview. Each row has an eyebrow, a two-beat H2, a 15px description, an optional `link ↗`, and an interactive preview panel. Rows are divided by hairlines.
5. **Ownership/secondary pair:** two short columns (H3 16px/500 + 14px muted paragraph + link).
6. **FAQ** ("Before you get started"): section H2 + one-line subtitle + divided list.
7. **Resource list** ("Make it your own"): eyebrow + H2 + divided link list.
8. **Story** block.
9. **Community/sponsor avatar grid.**
10. **Footer** on the sidebar tone.

### App shell
- Sidebar: `bg-sidebar`, `border-sidebar-border`, text `sidebar-foreground` (64% blend, so inactive items recede). The active item uses `bg-sidebar-accent text-sidebar-accent-foreground`, radius `md`.
- Main: `bg-background`, a 44px top bar with breadcrumb and view switcher, then content.
- Detail views: large 600-weight title, property strip, rich text body, sub-item checklist with a progress ring and count (`1/2`).

---

## 11. Voice & content

- **Headlines:** short, concrete, two beats, full stop. "Big tasks. Clear next steps." · "From pull request to done." · "See what's holding things up."
- **Hero line:** a wry, self-aware promise, e.g. "[Tool] that doesn't become the [job]."
- **Body:** plain, factual and second-person. State limits openly ("Budgeting and burndown reports are outside its current scope.").
- **Microcopy:** sentence case, no exclamation marks, no emoji. CTA labels are verb-first ("Get started", "Try the cloud version", "Self-host").
- **Demo data:** use playful but believable fictional content (a fictional office, realistic task names) so previews feel lived-in.

---

## 12. Accessibility

- Focus is always visible: `outline-2 outline-ring outline-offset-2…4` or `ring-2 ring-ring`. Never remove focus without replacing it.
- Minimum touch target 44×44px on coarse pointers (via `::after` expansion, so compact visuals are kept).
- **Small-text rule:** `muted-foreground` (≈ #818181 on #141414, ≈ #686868 on #fff) is for text **12px and up** on plain surfaces. Text **below 12px**, or any text on a `muted`/`accent` fill, uses `--subtle-foreground` (foreground at 72%, ≥ 5.5:1 in both modes). No text is ever smaller than 10px, and chip text is 11px.
- Status is never colour-only: status chips carry an icon or a word, and chart series have a legend or direct labels.
- Toggle-style buttons expose `aria-pressed`. Invalid fields expose `aria-invalid` and get destructive ring styling from it.
- Respect `prefers-reduced-motion` (see §7). Autoplaying demos need a pause control.

---

## 13. Do / Don't

**Do**
- Build every nested surface from `muted`, `accent` and `border` alphas.
- Keep one primary button per screen header (tool panels may have their own, see §9.1).
- Leave healthy states grey. Colour is for what needs attention.
- Default every chart to one neutral ink series. Reach for categorical colour only when there are separate series.
- Use 10–12px metadata generously. Density is a feature.
- Let hairline dividers structure long pages.
- Show real, interactive UI in marketing.

**Don't**
- Don't introduce a brand accent colour for buttons or links. Primary is neutral (inverted).
- Don't use bold (700) headings, all-caps eyebrows or wide letter-spacing.
- Don't stack shadows or add hover lifts.
- Don't fill status chips with solid colour.
- Don't colour chart series green, amber or red unless they *mean* good, warning or bad.
- Don't set 10–11px text in `muted-foreground`.
- Don't use illustrations, 3D blobs or stock photography.
- Don't use large radii (>16px) on anything but avatars.

---

## 14. Tailwind v4 starter

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: "Geist", "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", "Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-heading: var(--font-sans);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-subtle-foreground: var(--subtle-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-info: var(--info);
  --color-info-foreground: var(--info-foreground);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-chart-ink: var(--chart-ink);
  --color-chart-context: var(--chart-context);
  --color-chart-grid: var(--chart-grid);
}

/* paste the --viz-* primitives from §2.1 (Tailwind already has the others), then the :root and .dark blocks from §2.2 */

@layer base {
  * { @apply border-border outline-ring/50; }
  html { @apply antialiased; }
  body { @apply bg-background text-foreground font-sans; }
  h1, h2, h3 { @apply font-heading text-balance; }
  p { text-wrap: pretty; }
}
```

Component primitives map cleanly onto shadcn/ui or Base UI–style headless components. Restyle them with the recipes in §9 rather than using their defaults.

---

## 15. PG Compass application notes

How the desktop app (`apps/desktop`) applies this system. Tokens live in `src/index.css`; primitives live in `src/components/ui/`.

**Shell.** A resizable sidebar (256px default, 240px to 45vw) on the `sidebar` tone, then the workspace: a 40px tab strip (also `sidebar` tone, active tab lifted onto `background`), a 44px top bar (§9.21) with the `/` breadcrumb and a `sm` outline Refresh, then content padded 16px. Table and view tabs put their sub-views (Data, Structure, Indexes…) in a segmented switcher (§9.2) under the top bar.

**Primitives beyond shadcn.**

| Component | Use |
|---|---|
| `Panel`, `PanelHeader`, `PanelTitle`, `PanelCount`, `PanelFooter` | Every workspace table, result set and grouped list (§9.15). Pagination is the panel footer. |
| `SegmentedControl` | Any 2–4 option mode switch (view mode, export format, connection mode, backup source, access level). Segments are `aria-pressed` buttons. |
| `EmptyState`, `LoadingState` | Centered empty, error and loading placeholders. |
| `Kbd` | Keyboard hints (sidebar search, run query). |
| `fieldClassName` (from `input.tsx`) | Shared field recipe for native `select`, `textarea` and editor containers. |

**Data grids.** Column headers show the name in 12.5px mono foreground over the type in 11px mono `subtle-foreground`. Values are 12.5px mono. Row and cell actions (copy, edit) are `icon-xs` ghost buttons revealed on hover. Unknown values render as a muted `—`.

**Density.** Settings → Appearance → Density (`compact` default | `comfortable`). Compact switches every workspace table to the `h-8` dense row via `[data-density="compact"]` on the workspace root (unlayered CSS in `index.css`). The card viewer reads `useDensity()` directly.

**Connection colours.** A user-picked connection colour is data, and it helps tell databases apart when several are open, so it's the one decorative hue allowed. It appears as a 6px dot beside the connection name (sidebar row, workspace tab, the sidebar's Users section header). Workspace tabs from a coloured connection also carry a light tint: a 9% fill with a 22% border when inactive, and a 16% fill over `background` with a 45% border when active. The colour reaches CSS through the `--tab-tint` variable. It never tints text, and fills never appear outside the tab strip.

**Tool screens.** Users and roles, and the Database manager, are built from panels: a role list panel beside a role detail panel (identity header, segmented sub-views, panel content), and form panels whose primary action sits in the panel footer. Role, database and table names are mono. A destructive confirmation (restore over a database) uses a `destructive/10` tint note with a warning icon, never a red border.

**Intentional exceptions.** Theme-picker previews use fixed neutral values because they show a theme other than the active one.

**CodeMirror.** The SQL editor uses the §9.19 syntax palette through `pg-theme.ts`. CodeMirror injects its styles unlayered at runtime, so editor sizing lives in CodeMirror themes (`Prec.high` for overrides), not in Tailwind classes.

---

## 16. PG Compass landing notes

How the marketing site (`apps/landing`) applies this system. Tokens live in `src/styles/global.css`.

**Brand blue.** The landing page keeps PG Compass's logo blue as its one brand accent, an intentional exception to "Don't introduce a brand accent colour" (§13). It is `--brand` (`#1d6fd6` light, `#4aa8ff` dark, with `--brand-foreground` for text on it). It appears only on the logo, the version dot, the hero and closing download CTAs (`.btn-brand`), the theme slider handle, the text selection, and a 9–10% tint in the single hero glow. Nav buttons, links, previews and status colours stay neutral. The desktop app does not use it.

**Layout.** The page follows §10: a sticky glass header, a left-aligned hero with the brand CTA above an outline GitHub button, and the hero app window (a real screenshot in a window frame) with underline scene tabs and a play/pause control. After that come three feature rows with interactive previews, a dark/light comparison slider, a secondary grid, the download link list with a release panel, the FAQ, open-source stats and commits, a closing CTA, and a footer on the sidebar tone.

**Previews.** The feature previews (connection tree with tinted tabs, table/card switch, query runner) are hand-built HTML using the §9 recipes and demo data, not images. Screenshots come from the real app (`scripts/screenshots`), in both themes, and the page swaps them with the active theme.
