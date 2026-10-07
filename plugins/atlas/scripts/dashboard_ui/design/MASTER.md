# Atlas Command Center: design system (MASTER)

Status: design direction, ready to implement. Vanilla CSS + ES modules, no build step, no network at runtime.
Companions: `PAGES.md` (per-page wireframes and data contracts), `REFERENCES.md` (Mobbin evidence and skill-output decisions),
`contrast.py` (the palette source of truth; every ratio below is its output), `skill-output/` (raw ui-ux-pro-max runs).

Direction changes that supersede earlier drafts (from the user, 2026-10-07):
1. ONE shell. The product is the Atlas Command Center. The herdr-web-ui host rail (workspace list, a second ATLAS nav, Install app) is removed; nothing in this design assumes it exists.
2. Atlas's own sidebar is the single navigation, and it now also carries the live herdr tree (workspaces, agents, subagents).
3. A herdr terminal or chat for a pane opens as a drawer inside the Command Center. It is never a second app chrome.
4. Degraded states are honest and calm: one cause, one sentence, one primary action (section 9.14).

---

## 1. Product statement

- **Who:** engineers supervising many coding agents (omp, Claude Code, Codex, shells) across several projects at once, on one machine.
- **Primary job:** see what every agent and subagent is doing right now, steer them (prompt, message, assign, stop), and trust the results (health, evidence, history).
- **Success test:** from a cold open, within 5 seconds the user can answer: who needs me, who is working on what, did anything fail since I looked, and is the system itself healthy.
- **Not a goal:** marketing polish, onboarding tours, decorative charts.

## 2. Principles

1. **One surface for agents.** Colony, Herd, IRC and Work are four lenses on one entity (the agent). Same row, same inspector, same status vocabulary everywhere.
2. **Urgency sorts the world.** needs-input, then failed, then working, then idle, then done. Never alphabetical by default.
3. **Honest data.** Never print "never", "unknown", or an empty tile when the truth is "not measured" or "source missing". Say which source and what to do (9.14).
4. **Quiet chrome, loud state.** Neutral surfaces, one brand accent, six status colors that always travel with a glyph and a word.
5. **Live but calm.** One continuous animation in the whole UI (working cells). Everything else moves only in response to a person's action or to mark a real data change once.
6. **Keyboard first.** Every region reachable and operable without a pointer; the command palette can do everything the rail can.

## 3. Brand and the one memorable element

**Kept from today:** the Atlas hex-cube mark (`M12 2l9 5v10l-9 5-9-5V7z` outline plus `M12 12l9-5M12 12v10M12 12L3 7` inner edges, stroke 2, round joins) and the teal-green accent (dark `#2fbd9f`, light `#0c7d6c`). Favicon unchanged. Product name in UI: "Atlas Command Center" (rail header: mark + "Atlas", subtitle "Command Center" in `--text-dim`; document title `Atlas Command Center`, prefixed `(N) ` when N agents need input).

**Memorable element: the Fleet Strip** (hex cells). The brand mark is a hexagon; every agent is drawn as a hex cell in the same geometry as the mark. A single row of cells sits in the top bar on every page (and a honeycomb version on Overview/Agents). One glance = the whole fleet.

Why this and not something else: it is the only element that serves the primary job (see every agent now), it re-uses the brand shape so it is ownable rather than a generic dot row, and it is information, not decoration. Everything else in the UI stays plain.

Cell spec (pointy-top hex, same orientation as the mark):

| Variant | Size (w x h) | Where |
|---|---|---|
| strip | 22 x 25 | top bar, one per agent; subagents 14 x 16 attached after parent |
| comfortable grid | 56 x 64 | Overview honeycomb, Agents "Map" view |
| mini | 12 x 14 | rail tree glyph, table status column |

Geometry (viewBox `0 0 24 28`): `M12 1 L22.5 7 V21 L12 27 L1.5 21 V7 Z`. Fill = state color at 16% over the surface; outline = state color 1.5px.
State rendering (glyph and motion always accompany color):

| State | Fill/outline | Inner glyph | Motion |
|---|---|---|---|
| needs input | solid `--st-input`, ink text | `!` | one 600ms outline pulse on arrival, then static |
| failed | `--st-fail` | `x` | none |
| working | `--st-working` tint | none; outline has a travelling dash | the only continuous motion: stroke-dasharray 18 56, offset animates 2.4s linear infinite |
| idle (ready) | hollow, outline `--st-idle` | none | none |
| done | `--st-ok` tint | check | none |
| unknown / not measured | dashed outline `--st-idle` | `?` | none |

Ordering: needs input, failed, working, idle, done, unknown; ties by most recent state change. Overflow past 24 cells: remaining collapse into one cell-shaped chip `+N` with the dominant state color. Strip is `role="toolbar"`, roving tabindex, arrows move, Enter opens the inspector, each cell `aria-label="<agent> in <workspace>, <state>, <age>"`. Hover/focus popover (shows 300ms delay): agent name, kind, workspace, current task line, age.
Reduced motion: dash is static at 60% length; pulse becomes a 2px static outer ring for 1.5s.

### 3.1 Defaults deliberately rejected (frontend-design checklist)

| Tell | Decision |
|---|---|
| Near-black + single acid-green/vermilion accent | Accent is the user-mandated brand teal, but it is used for brand, focus, selection and primary action only. Status never uses it. Surfaces are cool slate steps, not tinted near-black, and status has six distinct hues. |
| Warm cream + serif + terracotta | not used |
| Hairline/zero-radius broadsheet | not used; radius is tiered by hierarchy (4/8/12) |
| Identical rounded SaaS cards with the same soft shadow | Flat regions use surface steps and 1px borders. Shadow only on floating layers (popover, drawer, palette). |
| Tracked ALL-CAPS eyebrow above every heading | none. Section titles are sentence case, weight 550. The only caps are the three-letter unit/shortcut keycaps. |
| Mono face for small data labels | Mono is reserved for machine text only: pane output, ids, hashes, paths, commands, IRC bodies from agents. Timestamps and counts use the sans with tabular numerals. |
| `→` appended to links, ` · ` joined meta strings, `WORD — fragment` labels | Links are underlined text or buttons; meta uses separate inline elements with gap; no spaced em dashes in UI strings. |
| Gradient washes, glassmorphism (the skill's top pick) | rejected: backdrop blur costs paint on a live-updating page and lowers text contrast; see REFERENCES.md |
| Fade/slide-up on every section, hover transition on every card | rejected; motion budget in 5.6 |
| Big number + gradient accent hero | KPI tiles show number + delta + sparkline + the thing to do about it |
| Numbered 01/02/03 markers on non-sequences | only the real sequences: improve loop stages, run steps |

## 4. One shell (and the framed fallback)

The Command Center is a single document with a single navigation. There is one shell:

```
data-shell="app"   (always)
```

Framed fallback (only if something still embeds `/ui/` in an iframe, for example the old host): `index.html` boot script sets `data-shell="framed"` when `window.self !== window.top` or the query has `?embed=1`. In `framed` the left rail and top bar are not rendered; a 40px context bar shows the page title, page filters, the Fleet Strip and the live pill. All other behaviour is identical. Theme/density arrive as `?theme=dark|light&density=compact|comfortable`. No postMessage protocol is part of the design: the product is the dashboard, not a guest in a host. (If the user later wants a host to keep control of theming, add `{type:"atlas:theme"}`; not designed here.)

Everything below describes the `app` shell.

## 5. Tokens

All tokens are CSS custom properties on `:root`. Theme: `html[data-theme="dark|light|system"]` (existing mechanism in `theme-boot.js`); density: `html[data-density="comfortable|compact"]`. Values are exact; implement as written.

### 5.1 Color (dark and light, measured)

Generated by `contrast.py`; ratios are WCAG 2.x against the surface-1 of the same theme. Rule: text pairs need 4.5, control edges and focus rings need 3.0.

| Role | Token | Dark | Light | Dark ratio vs surface-1 | Light ratio vs surface-1 | Use |
|---|---|---|---|---|---|---|
| bg | `--bg` | `#0c1215` | `#f2f6f7` | 1.07 | 1.09 | Canvas behind pages |
| chrome | `--chrome` | `#090e11` | `#e8eef0` | 1.10 | 1.17 | Rail and top bar (recedes behind the canvas) |
| s1 | `--surface-1` | `#121a1e` | `#ffffff` | 1.00 | 1.00 | Cards, tables, inspector |
| s2 | `--surface-2` | `#19232a` | `#edf2f4` | 1.10 | 1.13 | Hover rows, inputs, nested blocks |
| s3 | `--surface-3` | `#212e36` | `#e0e8eb` | 1.27 | 1.24 | Pressed, selected row, tab track |
| border | `--border` | `#263540` | `#d0dbdf` | 1.40 | 1.41 | Hairlines between regions (decorative; never the only carrier of meaning) |
| border-strong | `--border-strong` | `#62798a` | `#73868f` | 3.88 | 3.79 | Control edges: input, checkbox, outline button (3:1 required) |
| text | `--text` | `#e6edf0` | `#12222a` | 14.88 | 16.30 | Primary text |
| text-dim | `--text-dim` | `#9fb0b8` | `#465962` | 7.86 | 7.33 | Secondary text, meta |
| text-faint | `--text-faint` | `#8394a0` | `#566a74` | 5.63 | 5.66 | Tertiary: placeholders, timestamps |
| accent | `--accent` | `#2fbd9f` | `#0c7d6c` | 7.47 | 5.04 | Brand fill: primary button, selected-rail marker, hex mark |
| accent-hover | `--accent-hover` | `#4fd1b5` | `#096354` | 9.33 | 7.18 | Primary button hover |
| accent-ink | `--accent-ink` | `#05211b` | `#ffffff` | 1.04 | 1.00 | Text on --accent fills |
| accent-text | `--accent-text` | `#3fcfb0` | `#0a6e5f` | 9.03 | 6.16 | Accent as text/link/icon on surfaces |
| focus | `--focus` | `#7fe0cb` | `#0a6e5f` | 11.26 | 6.16 | Focus ring (2px, offset 2px) |
| ok | `--st-ok` | `#52c872` | `#17692f` | 8.27 | 6.78 | Succeeded, healthy, done |
| working | `--st-working` | `#62b8e6` | `#0a6396` | 7.98 | 6.49 | Agent running |
| input | `--st-input` | `#f2aa40` | `#8a4b00` | 8.89 | 6.80 | Needs input / blocked on a human |
| fail | `--st-fail` | `#ff7570` | `#ac211a` | 6.74 | 7.03 | Failed, errored |
| idle | `--st-idle` | `#93a4ac` | `#4f616a` | 6.83 | 6.46 | Ready / idle / not measured |
| sub | `--st-sub` | `#b5a3fa` | `#5b3bb8` | 8.04 | 7.60 | Subagent and channel (IRC) identity |

Special pairs (computed): accent-ink on accent = dark 7.18, light 5.04; text on bg = dark 15.94, light 14.99; text-dim on bg = dark 8.42, light 6.74; text-faint on surface-2 = dark 5.10, light 5.02.

Badge background = the status color mixed over the surface at 16% (`color-mix(in srgb, var(--st-x) 16%, var(--surface-1))`); badge text = the status color itself. Every one of those text-on-tint pairs is checked in Appendix A and passes 4.5 in both themes.

Rules:
- Text on accent fills is always `--accent-ink`. Accent as text is always `--accent-text`, never `--accent`.
- Disabled controls: 45% opacity, `cursor: not-allowed`, still shows its label; do not rely on color alone (add `aria-disabled`).
- `forced-colors: active`: status glyphs/borders use `CanvasText`/`Highlight`/`LinkText`; fills are dropped; outlines kept.

### 5.2 Status vocabulary (one vocabulary, every surface)

| State id | Word shown | Token | Glyph | Sources that map to it |
|---|---|---|---|---|
| `input` | Needs input | `--st-input` | filled hex with `!` | herd `blocked`; todo `blocked`; health `warn` |
| `fail` | Failed | `--st-fail` | hex with `x` | health `fail`; irc exit code != 0; findings open |
| `working` | Working | `--st-working` | hex with travelling outline | herd `working`; todo `in_progress` |
| `idle` | Ready | `--st-idle` | hollow hex | herd `idle`; todo `open` (shown as "Open" on the board) |
| `done` | Done | `--st-ok` | hex with check | herd `done`; todo `done`; health `ok` shows "Healthy" with the same glyph |
| `unknown` | Not measured | `--st-idle` dashed | hex with `?` | herd `unknown`; health `unknown` |

`warn` (health) uses `--st-input` with a triangle glyph; it is a different glyph from needs-input because it does not mean a human is awaited.

### 5.3 Typography

Two families, clearly distinct, both **vendored locally** (OFL 1.1; ship the license text next to the files). Nothing is fetched from a network. Files already exist in this repo at `plugins/atlas/colony/herdr-web-ui/src/fonts/` (to be copied, not linked, because that tree may go away):

| Role | Family | Files to vendor under `dashboard_ui/fonts/` | Weights |
|---|---|---|---|
| UI sans | **Pretendard Variable** (variable weight 45-920) | `PretendardVariable.subset.91.woff2` (ASCII, 38 KB), `.86` (< = ellipsis), `.83` (bullet), `.75` (arrows, box), `.71` (Latin-1 accents), `.78` (geometric marks): about 190 KB total, keep the upstream `unicode-range` per chunk | used at 450 body, 550 emphasis, 650 headings |
| Machine text | **JetBrains Mono** Regular | `JetBrainsMono-Regular.woff2` (92 KB) | 400 only; emphasis by color, never faux bold |
| Licenses | `OFL-Pretendard.txt`, `OFL-JetBrainsMono.txt` | copy from `THIRD_PARTY_NOTICES.md` sections | |

`@font-face` lives in `css/fonts.css` (new), `font-display: swap`, `src: local("JetBrains Mono Regular"), url(...)`. Family names: `"Pretendard Variable"` and `"JetBrains Mono Web"`.

Fallback stacks (used while fonts load and if the files are absent; they render acceptably on macOS, Windows, Linux with no network):

```
--font-sans: "Pretendard Variable", Pretendard, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: "JetBrains Mono Web", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
```

Honesty note: Pretendard is a neutral grotesque, not a distinctive face. The identity comes from the Fleet Strip, the tiered radii, tabular numerals and the restrained status system, not from a novelty typeface. Rejected alternatives: Fira Code + Fira Sans (ui-ux-pro-max's pick) because no local copy exists in the repo or on the machine, so it would need a new binary dependency or a network fetch.

Scale (px, line-height unitless; `--fs-*` replaces the old names, see 6):

| Token | Size | Line | Weight | Use |
|---|---|---|---|---|
| `--fs-2xs` | 11 | 1.35 | 550 | keycap text, unit suffix, chart ticks |
| `--fs-xs` | 12 | 1.4 | 450 | meta, timestamps, table header, badge text |
| `--fs-sm` | 13 | 1.45 | 450 | compact density body, table cells |
| `--fs-md` | 14 | 1.5 | 450 | comfortable density body |
| `--fs-lg` | 16 | 1.35 | 650 | card/section titles |
| `--fs-xl` | 20 | 1.3 | 650 | page title |
| `--fs-2xl` | 28 | 1.15 | 650 | KPI numerals (tabular) |

Body base is `--fs-md` in comfortable and `--fs-sm` in compact. Letter-spacing: `-0.01em` for `--fs-xl` and up, 0 elsewhere. Numerals: `font-variant-numeric: tabular-nums` on `.num`, tables, KPI, timestamps. Max prose line length 72ch; long agent text wraps inside its container, never widens the page.

### 5.4 Spacing, radius, elevation

Spacing (4px grid; names unchanged): `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 20, `--s-6` 24, `--s-8` 32, `--s-10` 40, `--s-12` 48.

Radius is tiered by hierarchy, not one value for everything:

| Token | px | Applies to |
|---|---|---|
| `--r-1` | 4 | keycaps, badges, chips, inline code, checkboxes |
| `--r-2` | 8 | buttons, inputs, rows, cards, tiles |
| `--r-3` | 12 | drawer inner panels, palette, modal, popover |
| `--r-pill` | 999 | count pills and the live pill only |
| hex | n/a | Fleet cells (path geometry in 3) |

Elevation: flat regions have no shadow (surface step + `--border`). Only floating layers:

| Token | Dark | Light | Used by |
|---|---|---|---|
| `--elev-1` | `0 6px 18px rgba(0,0,0,.40), 0 0 0 1px var(--border-strong)` | `0 6px 18px rgba(18,34,42,.14), 0 0 0 1px var(--border)` | popover, menu, tooltip |
| `--elev-2` | `-14px 0 36px rgba(0,0,0,.45)` | `-14px 0 36px rgba(18,34,42,.16)` | inspector drawer |
| `--elev-3` | `0 24px 64px rgba(0,0,0,.55), 0 0 0 1px var(--border-strong)` | `0 24px 64px rgba(18,34,42,.20), 0 0 0 1px var(--border)` | palette, modal |

Scrim: `--overlay` dark `rgba(3,7,9,.62)`, light `rgba(18,34,42,.38)`. Z-index: content 0, sticky headers 10, rail/topbar 20, popover 40, drawer 50, modal/palette 60, toast 70.

### 5.5 Density

| Token | Comfortable | Compact |
|---|---|---|
| `--fs-body` | 14 | 13 |
| `--ctl-h` (button/input) | 32 | 28 |
| `--row-h` (table/list row) | 40 | 30 |
| `--tree-row-h` (rail tree) | 36 | 28 |
| `--pad-card` | 16 | 12 |
| `--gap` (grid gap) | 16 | 12 |
| `--cell` (grid hex cell) | 56 x 64 | 44 x 50 |

Set by `prefs.density`; `data-density` on `<html>`. Default comfortable at widths below 1280, compact is a user choice (never automatic).

### 5.6 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 0ms | focus ring, color swaps |
| `--dur-fast` | 100ms | hover, press, checkbox |
| `--dur` | 160ms | tab underline, row highlight, popover |
| `--dur-slow` | 240ms | drawer and palette open (answers an action) |
| `--dur-live` | 600ms | one-shot "data changed" highlight on a row/tile |
| `--ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | enter/open (existing value kept) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | size/position change |
| `--ease-linear` | `linear` | the working-cell dash only |

Motion budget (anything not listed does not move): (1) working-cell dash (continuous); (2) drawer/palette/popover/menu open and close (user action); (3) toast in/out; (4) `data-fresh` highlight: when a live update changes a row, tile or feed item, its background flashes `--accent` at 12% fading to transparent over `--dur-live`, once; (5) tab underline slide. No staggered page-load reveals, no skeleton shimmer (skeletons are static blocks at 6% text opacity), no parallax, no hover lifts.
`prefers-reduced-motion: reduce`: all `--dur*` become 0ms except `--dur-live`, which becomes a static 1.5s `outline: 1.5px solid var(--accent)`; the working dash freezes; scroll is not smoothed.

### 5.7 Layout constants

`--rail-w` 232 (expanded) / 56 (collapsed); `--topbar-h` 52; `--inspector-w` 420 (>=1280), 480 (>=1920); `--content-max` 1320 for reading pages (Overview, Health, Improve, Settings, Projects), none for the Agents canvas (fluid, capped at 1920); `--page-pad` 24 (>=768) / 16 (<768); focus ring `outline: 2px solid var(--focus); outline-offset: 2px`.

## 6. Migration from `css/tokens.css`

Clean cutover: rename in one change across `css/*.css` and `js/**` (usage counts measured with `grep var(--x)` on `dashboard_ui/css` and `js`). No alias layer.

| Old | Uses | New | Note |
|---|---|---|---|
| `--bg` | 4 | `--bg` | value `#0e1213` -> `#0c1215` |
| (none) | 0 | `--chrome` | new: rail and topbar background |
| `--surface-1/2/3` | 21/20/11 | same names | new values |
| `--border`, `--border-strong` | 50/17 | same | border-strong darkened for 3:1 |
| `--text`, `--text-dim` | 23/51 | same | new values |
| (none) | 0 | `--text-faint` | new: tertiary text |
| `--accent` | 27 | `--accent` | same teal; light `#0c7d6c` unchanged |
| `--accent-ink` | 3 | `--accent-ink` | |
| (none) | 0 | `--accent-hover`, `--accent-text` | new |
| `--focus` | 7 | `--focus` | |
| `--ok` | 11 | `--st-ok` | |
| `--warn` | 12 | `--st-input` | amber now means needs-input; for health "warn" use `--st-input` with the triangle glyph |
| `--fail` | 17 | `--st-fail` | |
| `--working` | 3 | `--st-working` | meaning change: yellow `#f2c14e` -> blue `#62b8e6` (dark) |
| `--idle` | 7 | `--st-idle` | |
| `--info` | 4 | `--st-sub` | purple = subagent/channel identity |
| `--danger` | 1 | `--st-fail` | |
| `--shadow` | 5 | `--elev-1` or `--elev-3` by layer | |
| `--overlay` | 1 | `--overlay` | |
| `--s-1..--s-8` | many | same; add `--s-12` | |
| `--r-1/2/3` | 31/14/3 | same names | values 6/10/14 -> 4/8/12 |
| (none) | 0 | `--r-pill` | |
| `--font-sans`, `--font-mono` | 1/15 | same | new stacks (5.3) |
| `--fs-base/sm/xs/lg/xl/kpi` | 5/39/17/4/2/2 | `--fs-md/sm/xs/lg/xl/2xl`; add `--fs-2xs` | `--fs-base` 13 -> `--fs-md` 14 (comfortable) |
| `--lh` | 1 | per-scale line heights (5.3) | |
| `--pad-card`, `--pad-row`, `--gap`, `--ctl-h` | 7/4/12/10 | same names; add `--row-h`, `--tree-row-h`, `--cell` | |
| `--dur-fast`, `--dur`, `--ease` | 4/2/8 | same; add `--dur-instant`, `--dur-slow`, `--dur-live`, `--ease-in-out`, `--ease-linear` | |
| `--sidebar-w` | 1 | `--rail-w` | |
| `--topbar-h` | 3 | `--topbar-h` | 48 -> 52 |
| `--content-max` | 2 | same | |
| `--drawer-w` | 1 | `--inspector-w` | |

## 7. Layout model

### 7.1 Shell (>= 1280)

```
┌──────────────┬───────────────────────────────────────────────────────────┬─────────────────┐
│ ⬡ Atlas       │ Search or jump to  /     ⬡⬡⬡⬡⬡ ⬡⬡ +3   v10.3.0  ● Live 8s  [All clear] ☀ │                 │
│  Command Ctr │───────────────────────────────────────────────────────────┤  INSPECTOR      │
│ Project [All▾]│  Page title                          page filters  actions │  (drawer 420)   │
│ Observe       │                                                           │  tabs: Now │    │
│  Overview     │  MAIN CANVAS                                              │  Channel │     │
│  Activity     │  (scrolls; sticky page header)                            │  Tasks │        │
│  Health       │                                                           │  Terminal       │
│ Agents  3 2 1 │                                                           │  composer       │
│  Fleet        │                                                           │                 │
│  Board        │                                                           │                 │
│  Channel      │                                                           │                 │
│  Colony       │                                                           │                 │
│  ▾ Mac · host │                                                           │                 │
│   ▾ tech-tools│                                                           │                 │
│    ◔ omp  Fix…│                                                           │                 │
│ Improve       │                                                           │                 │
│ Configure     │                                                           │                 │
│  Projects     │                                                           │                 │
│  Settings     │                                                           │                 │
└──────────────┴───────────────────────────────────────────────────────────┴─────────────────┘
```

- **Rail** (`nav`, `--chrome` background, `--rail-w`): header (mark, "Atlas", "Command Center"), project switcher (native `<select>` styled; keyboard `p`), groups with sentence-case titles weight 550 `--text-dim`: Observe (Overview, Activity, Health), Agents (Fleet, Board, Channel, Colony, then the live tree), Improve, Configure (Projects, Settings). Selected item: 2px `--accent` bar at the left edge, `--surface-3` background, text `--text`. A collapse button reduces it to 56px icons; collapsed state persists in `localStorage` key `atlas.rail`.
- **Live tree** (inside the Agents group; replaces the herdr host rail): host row (machine label, `Host` word, reachability dot), under it each herdr workspace (label, pane count, roll-up mini hex), under each workspace its agents: mini hex + kind icon + title (ellipsis) + age; subagents indented one level, 12 x 14 hex. Rows are `role="treeitem"`; Up/Down move, Right/Left expand/collapse, Enter selects the agent (opens inspector, sets `#/agents?agent=<pane_id>`), `Shift+Enter` opens the Terminal tab. Roll-up order matches the Fleet Strip. Max height: fills remaining rail space and scrolls; the tree is the only scrolling region of the rail. If more than 40 agents: workspace rows collapse by default except the one with the selected agent.
- **Top bar** (`--topbar-h`, `--chrome`): left: command palette trigger (`/` or Mod+K). Center-left: Fleet Strip. Right: version chip (`Atlas 10.3.0`, from `GET /api/health` `version`), live pill, attention pill, theme toggle, density toggle. All five are tab stops in that order.
- **Live pill:** `● Live` (SSE connected, `--st-ok`) or `◌ Polling 8s` (fallback, `--st-idle`) or `● Reconnecting` (`--st-input`) or `● Offline` (`--st-fail`, with Retry). Text always visible at >=768; glyph only below. `role="status"`.
- **Attention pill:** `All clear` (`--st-ok` outline, check glyph) or `N need you` (`--st-input` fill-tint, count) where N = agents in `input` + overview `attention[]` of severity fail/warn. Click opens a popover list of those items (agent rows first, then attention items with their `action.target`).
- **Inspector** (right drawer, not modal at >=1280): pushes the canvas if the canvas would stay >= 720px wide, else overlays with scrim. Esc closes, focus returns to the invoker. It holds the agent detail (see 9.6) and any record detail from tables (finding, run, todo).

### 7.2 Responsive rules

| Width | Rail | Top bar | Canvas | Inspector | Tables | Agents canvas |
|---|---|---|---|---|---|---|
| 390 | hidden; bottom tab bar 56px: Overview, Agents, Activity, Health, More (sheet with the rest + project switcher) | 48px: mark, project select, palette icon button, attention pill (glyph+count). Fleet Strip moves to a horizontally scrolling band under the bar (height 40) | single column, `--page-pad` 16 | full-screen sheet from bottom, 92vh, drag handle, Back closes | collapse to stacked rows: primary cell on top, 2 meta cells below, rest behind a disclosure | 1 column of agent cards; lens switch is a segmented control under the title |
| 768 | collapsed 56px icon rail; tree is replaced by a flyout on the Agents icon | full, version chip hidden | single column up to 2-up KPI | overlay 420 with scrim | full tables, horizontal scroll inside the table wrapper only | 2 columns |
| 1280 | expanded 232 (user may collapse) | full | fluid; reading pages capped 1320 | docked 420 | full | 3 columns (min tile 300) |
| 1920 | expanded 232 | full | Agents fluid up to 1920; reading pages 1320 centered | docked 480 | full; Activity gets a split list/detail | 5 columns (min tile 320), "Map" honeycomb available |

No horizontal page scroll at any width; only table wrappers and the Fleet Strip band scroll. Minimum touch target 44 x 44 at <=768 (rows grow, glyph sizes do not).

## 8. Navigation model

One router, one set of ids. Hash routes (`#/<id>?<query>`) as today. Canonical ids, with aliases kept so existing deep links, host links and chords keep working:

| Page id | Label | Icon | Chord (`g` then) | Aliases (redirect, keep query) |
|---|---|---|---|---|
| `overview` | Overview | grid | `o` | |
| `agents` | Agents | hex | `a` | `herd` -> `agents?lens=fleet`, `colony` -> `agents?lens=colony`, `work` -> `agents?lens=board`, `irc` -> `agents?lens=channel` |
| `activity` | Activity | pulse | `l` (log) | |
| `health` | Health | heart | `h` | |
| `improve` | Improve | spark | `i` | |
| `projects` | Projects | folder | `p` | |
| `settings` | Settings | gear | `,` | |

Query params: `project=<root|all>`, `lens=fleet|board|channel|colony`, `agent=<pane_id|worker>` (opens inspector), `tab=now|channel|tasks|terminal`, `window=24h|7d|30d`, `q=`. The chords `g w`, `g i`, `g c` keep working as aliases (Work, Channel, Colony lenses); `g a` changes meaning from Activity to Agents (documented in the palette's recent-changes row once).

## 9. Components

Conventions for every interactive component: focus = the 2px ring; hover = `--surface-2`; pressed = `--surface-3`; disabled = 45% opacity; loading = `aria-busy="true"` with a static label change ("Saving"), no spinners except the 14px ring in buttons (static arc, no rotation under reduced motion).

### 9.1 Status dot / badge

- **Hex glyph** (`.hex`) 12 x 14 inline SVG; fill/outline by state (section 3).
- **Badge:** height 20, padding 0 8, `--r-1`, `--fs-xs` weight 550, gap 4 between glyph (10 px) and word. Background = tint (5.1), text/glyph = state color. Always shows the word (5.2). A bare glyph without a word is allowed only in the rail tree, Fleet Strip and table status column of widths < 768, and always has `aria-label` and a `title`.
- States: needs input, failed, working, ready, done, not measured, plus health: Healthy, Warning, Failing.

### 9.2 Agent row (list/table/rail)

Height `--row-h` (rail `--tree-row-h`). Columns, left to right: mini hex, kind icon 16 (omp, claude, codex, shell, unknown; inline SVG), name (title, 550, ellipsis) with workspace as `--text-dim` second line in comfortable density, state badge, task line (ellipsis, flex 1), project, age (`--text-dim`, tabular), overflow menu (Open terminal, Prompt, Message, Assign task, Stop). Selected: `--surface-3` + accent left bar. Hover reveals the menu button; it is always in the tab order. Live change: `data-fresh`.

### 9.3 Agent card (Fleet grid)

Width fluid (min 300), height 148 comfortable / 120 compact, `--r-2`, `--surface-1`, 1px `--border`, padding `--pad-card`.

```
┌────────────────────────────────────────────┐
│ ⬡ Fix terminal display issues in tmux     ⋯ │  hex 14x16, title 16/650 ellipsis, menu
│ omp · tech-tools · wA:p1                    │  kind icon, workspace, pane id (mono)
│ ┌──────────────────────────────────────┐   │
│ │ Editing src/PaneTerminal.tsx  (task)  │   │  now line: latest activity or todo content, 2 lines max
│ └──────────────────────────────────────┘   │
│ [Working] 4m        2 tasks · 3 msgs  [Open]│  badge, age, counts, primary action "Open terminal"
└────────────────────────────────────────────┘
```
Border color stays `--border` except needs-input/failed: 1px `--st-input`/`--st-fail`. Click on the card body opens the inspector; the primary button opens the Terminal tab directly.

### 9.4 Pane terminal tile

The real terminal is herdr-web-ui's pane view and only exists in the inspector's Terminal tab or the "Pane" full view (`?tab=terminal&agent=<pane>`), never as grid thumbnails (a live xterm per tile does not scale). Tile (in the Map and Colony lenses) is a static summary: 280 x 168, header (hex, name), body in `--font-mono` 12px showing the last known output lines if the peek endpoint exists (gap G1 in PAGES.md) else the title and cwd, footer buttons Open terminal, Prompt. Terminal tab body: one lazy `<iframe>` of `agents[].deep_link` (`herd.web_ui.url`), `sandbox="allow-scripts allow-same-origin allow-forms"`, `title`, `loading="lazy"`, 100% of the drawer body, mounted on first open, kept alive while the drawer is open, removed when it closes. Chat/Terminal switch is the iframe's own; the Command Center adds nothing around it except the tab bar and the composer below (9.12). This is the single permitted iframe in the product; if `web_ui.healthy` is false the tab shows the degraded state (9.14) instead.

### 9.5 Timeline / activity feed item

Row min-height 44, grid: time 56 (tabular, `--text-dim`), kind glyph 16, body (title 450, detail `--text-dim` clamped 2 lines), project chip, count `x3` when folded, chevron. Grouped by day with a sticky 28px day header (sentence case, weight 550, `--text-dim`). Status color only on the glyph and left 2px edge, never the row background. Click opens the inspector (record detail).

### 9.6 Inspector (drawer)

Width `--inspector-w`, `--surface-1`, `--elev-2` only when overlaying. Header 56: hex + name, state badge, close. Tabs (9.9): Now, Channel, Tasks, Terminal (agents); records use one Details tab. Body scrolls; composer (9.12) is pinned to the bottom for agents. Focus trap only when overlaying (modal behaviour at <1280).
- **Now:** state badge + age, kind, harness, workspace, cwd (mono, ellipsis with copy), latest task, last 5 activity items, run id link.
- **Channel:** IRC messages to/from this agent (9.11 compact), delivery status per message.
- **Tasks:** todos where owner/claimed_by/launch.target match; status badge; row menu: Start, Assign, Mark done.
- **Terminal:** 9.4.

### 9.7 KPI tile

Min 200 x 112, `--surface-1`, 1px `--border`, `--r-2`. Layout: label (`--fs-xs`, `--text-dim`), value (`--fs-2xl` tabular), delta chip (arrow glyph + number, color by good/bad, not by sign), 24px-high sparkline (SVG polyline, 1.5px, `--st-*` color of the tile state, last point dot), hint line (`--fs-xs`, 1 line, ellipsis, full text in `title`). Whole tile is a link to the page that explains it (`kpis[].id` -> target in PAGES.md). States: loading (static blocks), stale (value dim + "as of 14:02"), error (value replaced by "Not measured" + reason).

### 9.8 Table

`<table>` semantics, sticky header (28px), row `--row-h`, zebra none, row hover `--surface-2`, selected `--surface-3` + accent bar, sortable header buttons with `aria-sort`, numeric columns right-aligned tabular, column resize not supported, bulk actions bar replaces the header when rows are checked (checkbox column 36px). Empty body: 9.13. Keyboard: Arrow Up/Down move row focus, Enter opens the inspector, Space toggles selection, `/` focuses the table filter.

### 9.9 Tabs

Height 36 (compact 30), items padding 0 12, label `--fs-sm` 550, active: `--text` + 2px `--accent` underline sliding over `--dur`, inactive `--text-dim`. `role="tablist"`; Left/Right arrows, Home/End; panels `role="tabpanel"` with `aria-labelledby`. Counts as trailing pill (`--r-pill`, `--surface-3`).

### 9.10 Drawer / modal / popover / palette

- **Drawer:** 9.6. **Modal** (destructive confirms only): `--r-3`, `--elev-3`, 440 wide, title + body + two buttons (cancel left, action right; destructive action uses `--st-fail` fill with `--accent-ink`-equivalent ink `#1a0605`/`#ffffff`), focus trap, Esc cancels, initial focus on Cancel.
- **Popover/menu:** `--r-3`, `--elev-1`, min 180, items `--ctl-h`, arrow keys, type-ahead, Esc.
- **Command palette:** 640 wide, max-height 60vh, top at 14vh, `--r-3`, `--elev-3`. Input 48 high. Results grouped with sentence-case group titles: Agents (every pane, fuzzy, recent first), Go to (pages and lenses), Actions (Launch agent, Prompt agent, Post to channel, Add todo, Start terminal service, Refresh, Toggle theme, Toggle density), Projects. Row 40: icon, label, right-aligned hint/keycaps. Footer 32: `↑↓ navigate  ↵ select  esc close  ⇥ filter group`. Prefix filters: `>` actions, `@` agents, `#` pages, `/` focus search elsewhere. Opened with `/`, Mod+K. aria-pattern: combobox + listbox, `aria-activedescendant`.

### 9.11 Channel (IRC) message

Row: time 48, sender chip (agent name in its color: `--st-sub` for agents, `--text` for human, `--st-idle` for system), `to` as `@name` or `all`, body (`--font-mono` 13, wraps, preserves newlines, linkifies `wA:p1` pane ids into inspector links), delivery status icon (queued clock, read check, delivered double check, refused x) with `title` text. `kind: "exit"` renders as a compact event row: hex + "exited 0" or "exited 1, failed" with the error text. Day separators like the feed. Auto-scroll pins to bottom unless the user scrolled up; a "N new" button appears otherwise.

### 9.12 Composer

Pinned at the bottom of the inspector and of the Channel lens. Height 56 growing to 180 (the Channel lens uses `simple`: To select, one textarea, Send, no mode control; To = Everyone posts, To = a member prompts it). Left: mode segmented control `Prompt agent | Post to channel` (default Prompt when the selected agent is Ready, else Post). Textarea (Enter sends, Shift+Enter newline, IME-safe; Mod+Enter always sends), right: Send button (primary), counter appears at 6,000 of 8,000 chars (server limit `PROMPT_MAX` 8000).
- Prompt mode sends `POST /api/v2/herd/agents/<pane>/prompt`. Enabled only if the agent is Ready. If Working: control is disabled with the line "Working. Post to channel to leave a note it will read." and mode flips to Post. If Needs input: disabled with "Waiting on you in the terminal" and a primary "Open terminal" button.
- Post mode sends `POST /api/v2/irc {project,to,body,from:"human"}`; the response `delivered`/`next` becomes the inline status under the message.
- States: idle, sending (button label "Sending", textarea readonly), sent (message appears with `data-fresh`), error (inline under the field: error + `why` + `do` from the API envelope; text retained).

### 9.13 Empty, loading, error states

One component, `State`, 3 variants. Never an illustration. Left-aligned inside the container, max 56ch:
- **Empty:** title (16/650) states what is absent in the user's terms, one line of why/how it fills, one primary button or link. Example: "No agents running" / "Agents appear here when you start one in herdr or launch one from Atlas." / [Launch agent].
- **Loading:** structural skeleton of the real layout (static `--surface-2` blocks); `aria-busy`. If a first load exceeds 600ms the page title row shows "Loading Overview". After 8s: converts to error with Retry.
- **Error (a request failed):** title = `error` field humanised; line = `why`; second line = `do`; buttons: Retry (primary), Copy details (ghost). Never red-box full-width blocks with raw ids; the raw code goes in a `details` disclosure labelled "Technical details".
- **Stale:** keep old data, dim 20%, banner row "Showing data from 14:02. Reconnecting." with the live pill state.

### 9.14 Honest degraded states (herdr and daemon)

There are three independent layers; the UI names the first one that is down and nothing else:

1. **Atlas daemon** (this page's origin). If requests fail with network error: full-page State "Atlas isn't responding" / "The dashboard process stopped or restarted." / [Retry] and the command to start it in a copyable code block. This is the only case where the whole page is replaced.
2. **herdr server** (socket). `GET /api/v2/herd/agents` -> `herdr.reachable:false`, `reason`. Agents canvas and rail tree show State: "herdr isn't running" / "Atlas can't list agents without it. Atlas never starts herdr itself." / [Recheck]. Everything not agent-related (Overview, Activity, Health, Improve, Projects, Settings, Board, Channel) keeps working and shows no herdr message.
3. **herdr web UI** (terminal and chat service; optional). `web_ui.healthy:false`. The agent list is NOT affected and must render. Only the Terminal tab and the "Open terminal" actions show the inline state: "The terminal service isn't running. The agent list is live; terminals need it." / [Start terminal service] (`POST /api/v2/herd/ensure`) / secondary Recheck. No page-level banner, no red.

Rules: at most one status banner per page; severity color = `--st-input` (amber) for "can't do X right now", `--st-fail` only for data loss or a failed user action; no contradictory sentences (a layer that is up is never described as unavailable); technical ids such as `atlas_dashboard_unreachable` appear only inside "Technical details". The messages from the screenshot ("Agent list unavailable" + "herdr is running, but its web UI is not" + the red `atlas_dashboard_unreachable` block) are replaced by layer 3 alone.

### 9.15 Toast

Bottom-right (bottom-center on mobile), 360 max, `--surface-3`, `--r-2`, `--elev-1`, icon + one line + optional single action; 5s (errors 8s, hover pauses), stack of max 3, `role="status"`, errors `role="alert"`. Voice: "Prompt sent to omp in tech-tools", not "Success". Same verb the button used.

### 9.16 Buttons, inputs, chips, keycaps

- Button: height `--ctl-h`, padding 0 12, `--r-2`, `--fs-sm` 550. Primary = `--accent` fill + `--accent-ink`; secondary = `--surface-2` + 1px `--border-strong`; ghost = text only; destructive = `--st-fail`. Icon-only buttons are 32 x 32 (44 on touch) with `aria-label`.
- Input/select: height `--ctl-h`, `--surface-2`, 1px `--border-strong`, `--r-2`; error border `--st-fail` + message under. Placeholder `--text-faint`.
- Chip (filter): height 24, `--r-1`, `--surface-2`; selected = 1px `--accent` + `--accent-text`.
- Keycap: `--fs-2xs`, height 18, padding 0 5, `--r-1`, `--surface-3`, 1px `--border-strong`, never uppercase transform.

## 10. Interaction rules

### 10.1 Keyboard map

| Keys | Action |
|---|---|
| `/` or Mod+K | open command palette (when not typing in a field) |
| `g` then `o a l h i p ,` | go to Overview, Agents, Activity(log), Health, Improve, Projects, Settings |
| `g` then `w` / `c` / `n` | Agents lens: Board / Colony / Channel (`n` = notes; legacy `g i` is Improve) |
| `p` | focus project switcher |
| `[` / `]` | collapse/expand rail |
| `j` / `k` | next/previous row in the focused list or table |
| `Enter` | open inspector for the focused row; `Shift+Enter` open its Terminal tab |
| `t` | with an agent selected: open Terminal tab |
| `m` | with an agent selected: focus composer in Post mode |
| `.` | with an agent selected: open its row menu |
| `r` | refresh current page |
| `d` | toggle density; `Shift+d` toggle theme |
| `?` | shortcut sheet |
| `Esc` | close the top-most layer (popover, palette, modal, drawer), then clear selection |
| `1`..`9` | jump to the Nth cell of the Fleet Strip when the strip has focus |

Shortcuts are disabled inside inputs, textareas, contenteditable, and when the Terminal iframe is focused (the terminal owns every key; `Ctrl+Shift+\` returns focus to the page, advertised in the tab hint).

### 10.2 Focus and a11y

- Landmarks: `nav` (rail), `header` (top bar), `main`, `aside` (inspector). Skip link to `#page-root`. One `h1` per page.
- Focus ring on every control; never `outline: none` without replacement. Focus moves into the drawer on open and returns on close; palette returns focus too.
- Live regions: live pill and attention pill `role="status"`; toasts as 9.15. Row-level updates are NOT announced (too chatty); a single polite announcement "2 agents need input" when the needs-input count increases.
- Status never by color alone: glyph + word everywhere (9.1). Contrast gates in Appendix A.
- Touch targets 44 at <=768. Zoom to 200% without loss; layouts use `min()`/`minmax()` not fixed widths. `forced-colors` honoured.
- Tables have `caption` (visually hidden) and header scope; the Fleet Strip has a visually hidden text summary "3 working, 1 needs input, 2 ready".

### 10.3 Data and refresh

SSE `/api/v2/stream` events: `herd`, `agents`, `todos`, `irc`, `health`, `improve`; polling at `prefs.refresh_seconds` (default 8) when SSE is unavailable, and for `overview`, `activity`, `projects` always. A page applies a payload only if its stable JSON differs from the last, then marks changed rows `data-fresh`. Never replace the whole DOM when nothing changed (keeps scroll, open menus, text selection).

## 11. Offline and asset rules

- No CDN, no web font service, no remote images, no analytics. Everything under `/ui/` (fonts under `/ui/fonts/`).
- Icons: inline SVG via the existing `icon()` helper in `dom.js`, 16px grid, stroke 1.75, round caps/joins, `currentColor`. Source paths may be copied from Lucide (ISC license, same set the herdr-web-ui uses). Set: overview(grid), agents(hex), activity(pulse), health(heart-pulse), improve(sparkles), projects(folder-kanban), settings(gear), terminal, message-square, check, x, alert-triangle, clock, chevron-right/down, search, sun, moon, rows(density), panel-left(rail), copy, external-link, play, square(stop), send, filter, refresh, kind icons omp/claude/codex/shell/unknown (simple 16px monograms, not brand logos).
- Charts: hand-rolled SVG (sparkline polyline, bar series, stacked state bar). No chart library. Every chart has a text summary and a table fallback (`<details>` "Show data").
- `index.html`: no `document.write`-driven CSS list growth beyond adding `fonts` to the existing array.

## 12. Anti-patterns (do not ship)

1. A second navigation or a second app chrome anywhere (including inside the terminal drawer).
2. A page that shows `never`, `unknown`, `0` or an empty box where the truth is "not measured" or "source missing".
3. Contradictory messages on one screen; more than one banner; raw error ids in the primary message.
4. Color-only status; status words in ALL CAPS; status dots without labels.
5. Card-everything: wrapping every region in the same bordered, shadowed rounded box.
6. A live xterm or iframe per grid tile.
7. Animations on load, hover lifts, skeleton shimmer, continuous motion other than the working cell.
8. Mono face for UI labels; faux bold mono; letter-spaced caps eyebrows.
9. Horizontal page scroll; fixed pixel widths on content; sticky layers that cover focus.
10. Network fetches at runtime; `innerHTML` with data (keep `h()` text children as today).
11. Silent catches that hide a failed fetch as an empty list.

## 13. Handoff checklist for the implementer

- Replace `css/tokens.css` with 5.1-5.7 values (dark, light, system, comfortable/compact).
- Add `css/fonts.css` + `fonts/` (5.3). Add Fleet Strip + rail tree + inspector + palette components to `components.js`.
- Add the page set in `PAGES.md`; route aliases from section 8.
- Run `python3 design/contrast.py` after any palette change; it must print `ALL PAIRS PASS`.

---

## Appendix A. Contrast tables (computed)

Produced by `python3 design/contrast.py`; the full raw output is `skill-output/contrast.txt`. Result: ALL PAIRS PASS.

### Dark

| Pair | fg | bg | ratio | need | result |
|---|---|---|---|---|---|
| text on bg | #e6edf0 | #0c1215 | 15.94 | 4.5 | pass |
| text on s1 | #e6edf0 | #121a1e | 14.88 | 4.5 | pass |
| text on s2 | #e6edf0 | #19232a | 13.49 | 4.5 | pass |
| text on s3 | #e6edf0 | #212e36 | 11.76 | 4.5 | pass |
| text on chrome | #e6edf0 | #090e11 | 16.38 | 4.5 | pass |
| text-dim on bg | #9fb0b8 | #0c1215 | 8.42 | 4.5 | pass |
| text-dim on s1 | #9fb0b8 | #121a1e | 7.86 | 4.5 | pass |
| text-dim on s2 | #9fb0b8 | #19232a | 7.13 | 4.5 | pass |
| text-dim on s3 | #9fb0b8 | #212e36 | 6.21 | 4.5 | pass |
| text-dim on chrome | #9fb0b8 | #090e11 | 8.66 | 4.5 | pass |
| text-faint on bg | #8394a0 | #0c1215 | 6.03 | 4.5 | pass |
| text-faint on s1 | #8394a0 | #121a1e | 5.63 | 4.5 | pass |
| text-faint on s2 | #8394a0 | #19232a | 5.10 | 4.5 | pass |
| text-faint on chrome | #8394a0 | #090e11 | 6.20 | 4.5 | pass |
| accent-text on bg | #3fcfb0 | #0c1215 | 9.67 | 4.5 | pass |
| accent-text on s1 | #3fcfb0 | #121a1e | 9.03 | 4.5 | pass |
| accent-text on s2 | #3fcfb0 | #19232a | 8.18 | 4.5 | pass |
| accent-ink on accent (primary button) | #05211b | #2fbd9f | 7.18 | 4.5 | pass |
| accent-ink on accent-hover | #05211b | #4fd1b5 | 8.97 | 4.5 | pass |
| focus ring on bg (UI 3:1) | #7fe0cb | #0c1215 | 12.06 | 3.0 | pass |
| focus ring on s1 (UI 3:1) | #7fe0cb | #121a1e | 11.26 | 3.0 | pass |
| focus ring on s2 (UI 3:1) | #7fe0cb | #19232a | 10.21 | 3.0 | pass |
| focus ring on s3 (UI 3:1) | #7fe0cb | #212e36 | 8.90 | 3.0 | pass |
| border-strong on bg (control edge, UI 3:1) | #62798a | #0c1215 | 4.15 | 3.0 | pass |
| border-strong on s1 (control edge, UI 3:1) | #62798a | #121a1e | 3.88 | 3.0 | pass |
| border-strong on s2 (control edge, UI 3:1) | #62798a | #19232a | 3.51 | 3.0 | pass |
| ok text/glyph on s1 | #52c872 | #121a1e | 8.27 | 4.5 | pass |
| ok text on its tint over s1 | #52c872 | #1c362b | 6.12 | 4.5 | pass |
| ok text/glyph on s2 | #52c872 | #19232a | 7.50 | 4.5 | pass |
| ok text on its tint over s2 | #52c872 | #223d36 | 5.51 | 4.5 | pass |
| working text/glyph on s1 | #62b8e6 | #121a1e | 7.98 | 4.5 | pass |
| working text on its tint over s1 | #62b8e6 | #1f333e | 5.94 | 4.5 | pass |
| working text/glyph on s2 | #62b8e6 | #19232a | 7.24 | 4.5 | pass |
| working text on its tint over s2 | #62b8e6 | #253b48 | 5.29 | 4.5 | pass |
| input text/glyph on s1 | #f2aa40 | #121a1e | 8.89 | 4.5 | pass |
| input text on its tint over s1 | #f2aa40 | #363123 | 6.54 | 4.5 | pass |
| input text/glyph on s2 | #f2aa40 | #19232a | 8.06 | 4.5 | pass |
| input text on its tint over s2 | #f2aa40 | #3c392e | 5.83 | 4.5 | pass |
| fail text/glyph on s1 | #ff7570 | #121a1e | 6.74 | 4.5 | pass |
| fail text on its tint over s1 | #ff7570 | #38292b | 5.28 | 4.5 | pass |
| fail text/glyph on s2 | #ff7570 | #19232a | 6.11 | 4.5 | pass |
| fail text on its tint over s2 | #ff7570 | #3e3035 | 4.78 | 4.5 | pass |
| idle text/glyph on s1 | #93a4ac | #121a1e | 6.83 | 4.5 | pass |
| idle text on its tint over s1 | #93a4ac | #273035 | 5.22 | 4.5 | pass |
| idle text/glyph on s2 | #93a4ac | #19232a | 6.19 | 4.5 | pass |
| idle text on its tint over s2 | #93a4ac | #2d383f | 4.66 | 4.5 | pass |
| sub text/glyph on s1 | #b5a3fa | #121a1e | 8.04 | 4.5 | pass |
| sub text on its tint over s1 | #b5a3fa | #2c3041 | 5.97 | 4.5 | pass |
| sub text/glyph on s2 | #b5a3fa | #19232a | 7.29 | 4.5 | pass |
| sub text on its tint over s2 | #b5a3fa | #32374b | 5.37 | 4.5 | pass |

### Light

| Pair | fg | bg | ratio | need | result |
|---|---|---|---|---|---|
| text on bg | #12222a | #f2f6f7 | 14.99 | 4.5 | pass |
| text on s1 | #12222a | #ffffff | 16.30 | 4.5 | pass |
| text on s2 | #12222a | #edf2f4 | 14.45 | 4.5 | pass |
| text on s3 | #12222a | #e0e8eb | 13.13 | 4.5 | pass |
| text on chrome | #12222a | #e8eef0 | 13.91 | 4.5 | pass |
| text-dim on bg | #465962 | #f2f6f7 | 6.74 | 4.5 | pass |
| text-dim on s1 | #465962 | #ffffff | 7.33 | 4.5 | pass |
| text-dim on s2 | #465962 | #edf2f4 | 6.49 | 4.5 | pass |
| text-dim on s3 | #465962 | #e0e8eb | 5.90 | 4.5 | pass |
| text-dim on chrome | #465962 | #e8eef0 | 6.25 | 4.5 | pass |
| text-faint on bg | #566a74 | #f2f6f7 | 5.20 | 4.5 | pass |
| text-faint on s1 | #566a74 | #ffffff | 5.66 | 4.5 | pass |
| text-faint on s2 | #566a74 | #edf2f4 | 5.02 | 4.5 | pass |
| text-faint on chrome | #566a74 | #e8eef0 | 4.83 | 4.5 | pass |
| accent-text on bg | #0a6e5f | #f2f6f7 | 5.66 | 4.5 | pass |
| accent-text on s1 | #0a6e5f | #ffffff | 6.16 | 4.5 | pass |
| accent-text on s2 | #0a6e5f | #edf2f4 | 5.46 | 4.5 | pass |
| accent-ink on accent (primary button) | #ffffff | #0c7d6c | 5.04 | 4.5 | pass |
| accent-ink on accent-hover | #ffffff | #096354 | 7.18 | 4.5 | pass |
| focus ring on bg (UI 3:1) | #0a6e5f | #f2f6f7 | 5.66 | 3.0 | pass |
| focus ring on s1 (UI 3:1) | #0a6e5f | #ffffff | 6.16 | 3.0 | pass |
| focus ring on s2 (UI 3:1) | #0a6e5f | #edf2f4 | 5.46 | 3.0 | pass |
| focus ring on s3 (UI 3:1) | #0a6e5f | #e0e8eb | 4.96 | 3.0 | pass |
| border-strong on bg (control edge, UI 3:1) | #73868f | #f2f6f7 | 3.49 | 3.0 | pass |
| border-strong on s1 (control edge, UI 3:1) | #73868f | #ffffff | 3.79 | 3.0 | pass |
| border-strong on s2 (control edge, UI 3:1) | #73868f | #edf2f4 | 3.36 | 3.0 | pass |
| ok text/glyph on s1 | #17692f | #ffffff | 6.78 | 4.5 | pass |
| ok text on its tint over s1 | #17692f | #dae7de | 5.31 | 4.5 | pass |
| ok text/glyph on s2 | #17692f | #edf2f4 | 6.01 | 4.5 | pass |
| ok text on its tint over s2 | #17692f | #cbdcd4 | 4.75 | 4.5 | pass |
| working text/glyph on s1 | #0a6396 | #ffffff | 6.49 | 4.5 | pass |
| working text on its tint over s1 | #0a6396 | #d8e6ee | 5.09 | 4.5 | pass |
| working text/glyph on s2 | #0a6396 | #edf2f4 | 5.75 | 4.5 | pass |
| working text on its tint over s2 | #0a6396 | #c9dbe5 | 4.55 | 4.5 | pass |
| input text/glyph on s1 | #8a4b00 | #ffffff | 6.80 | 4.5 | pass |
| input text on its tint over s1 | #8a4b00 | #ece2d6 | 5.32 | 4.5 | pass |
| input text/glyph on s2 | #8a4b00 | #edf2f4 | 6.03 | 4.5 | pass |
| input text on its tint over s2 | #8a4b00 | #ddd7cd | 4.75 | 4.5 | pass |
| fail text/glyph on s1 | #ac211a | #ffffff | 7.03 | 4.5 | pass |
| fail text on its tint over s1 | #ac211a | #f2dbda | 5.33 | 4.5 | pass |
| fail text/glyph on s2 | #ac211a | #edf2f4 | 6.23 | 4.5 | pass |
| fail text on its tint over s2 | #ac211a | #e3d1d1 | 4.79 | 4.5 | pass |
| idle text/glyph on s1 | #4f616a | #ffffff | 6.46 | 4.5 | pass |
| idle text on its tint over s1 | #4f616a | #e3e6e7 | 5.15 | 4.5 | pass |
| idle text/glyph on s2 | #4f616a | #edf2f4 | 5.72 | 4.5 | pass |
| idle text on its tint over s2 | #4f616a | #d4dbde | 4.61 | 4.5 | pass |
| sub text/glyph on s1 | #5b3bb8 | #ffffff | 7.60 | 4.5 | pass |
| sub text on its tint over s1 | #5b3bb8 | #e5e0f4 | 5.90 | 4.5 | pass |
| sub text/glyph on s2 | #5b3bb8 | #edf2f4 | 6.74 | 4.5 | pass |
| sub text on its tint over s2 | #5b3bb8 | #d6d5ea | 5.27 | 4.5 | pass |

ALL PAIRS PASS
