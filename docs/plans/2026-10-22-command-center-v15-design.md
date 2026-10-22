# Command Center v15: design

> Withdrawn 2026-10-22 in atlas 15.0.1. The code this describes was reverted to the 13.0.0 dashboard (commit 5aa2c48f). Kept as history.

Status: APPROVED by the user on 2026-10-22 (after the builder check).
Direction A ("Band and Rail") was picked by the user from two mockups. Vocabulary decision: keep the
terminal's words (seats, colony, channel, steer) in the web UI.

Reference mockup (throwaway, example data): https://claude.ai/artifact/LRNAHfehc5XrUYFPuy6tJ3
Research inputs: .atlas/.run/cc15-identity-inventory.md, .atlas/.run/cc15-design-brief.md

## Intent

Replace the dashboard_ui frontend so the Command Center is recognisably
the Atlas terminal band given a room, not a generic SaaS dashboard. v13
and v14 share the sidebar + cards + tables genre with Linear, Vercel,
Sentry and every other dev tool; the user rejected v14 as visually
identical to v13. Identity has to come from structure and metaphor, which
Atlas already owns in plugins/atlas/mod/band.tsx, theme.ts, the TUI and
the `ATLAS | <glyph> <phase> | <state>` header.

## Goals

1. One glance answers: what phase is the current wave in, who is working,
   who needs me, what gate is open. All four live on the first screen.
2. Every visual element on the Run page has a terminal ancestor: band
   title row, chevron phase rail with a lit current pill, lanes with
   state glyph + role char + tool + elapsed bar, channel ticker, gate
   chips, steer input.
3. Steering is first-class: every agent surface has an input that posts
   a note to the lead or a seat, using the same board/channel mechanism
   the TUI's STEER region uses.
4. Keyboard first: `/` palette, single-key jumps that mirror the TUI
   keymap (1/2/3 region focus, f filter, i steer, h hold, esc).
5. Dark and light from one token set; light derives from the same tokens
   (mockup B is the light reference for tone only, not structure).

## Non-goals

- No framework migration. Stay vanilla ES modules + CSS, served by
  atlas_dashboard.py, no build step, no runtime network.
- No backend redesign. v15 consumes the existing v2 API (SSE stream,
  agents, herd, todos, irc, health, improve, channels, colony, term).
  New endpoints only where the Run page has no source (see "Data gaps").
- No TUI or mod changes. The web UI follows them, not the reverse.
- No marketing surfaces: no hero, no empty-state illustrations, no
  onboarding tour.

## Anti-goals (would make this a failure even if it works)

- It still reads as a dashboard: cards with equal weight, a KPI row on
  top, a nav rail of icons.
- Color used decoratively. Teal means live/brand, amber means needs you,
  red means failed, green means passed. Nothing else is colored.
- Motion on high-frequency actions (navigation, palette, drawer). The
  only animations are the lit-pill shimmer, the working-seat spinner and
  the needs-you pulse, all off under prefers-reduced-motion.
- Vocabulary drift from the terminal: the UI says seats, colony, channel,
  steer, wave, gate, finding, lead, worker. Not roster, lens, agent pool.

## Constraints

- Characters: U.S. keyboard in copy; glyphs are the single-cell set from
  mod/theme.ts (phase: research o-ring, theory diamond, test flask,
  validate list, implement hammer, verify check, done flag, blocked
  square; state: running triangle, idle ring, input hollow diamond,
  failed square, parked dot, finished disc). Exact codepoints come from
  theme.ts, not reinvented.
- Fonts vendored locally (OFL): the mockup uses IBM Plex Mono + IBM Plex
  Sans. Builder may keep Geist (already vendored) if Plex cannot be
  vendored within size budget; mono is mandatory for every fact column.
- Tokens: one css/tokens.css. Colors come from the BRAND table in
  mod/contract.ts:103-105 (accent #2fbd9f, focus #7fe0cb, bg #0c1215,
  surface #121a1e, text #e6edf0, dim #9fb0b8, ok #52c872, working
  #62b8e6, input #f2aa40, fail #ff7570, idle #93a4ac, subagent #b5a3fa)
  so the web and the terminal paint the same colors. Light values are
  the v14 light set adjusted to the same roles.
- Contrast: text 4.5:1, control edges and focus rings 3:1, in both
  themes. Run the contrast check script before merging a palette.
- Accessibility: every region is a landmark with a label; every control
  is keyboard reachable with a visible focus ring; status is never color
  alone (glyph or word always present).
- Responsive: 1440 is the design width; at under 1100 the needs-you
  column drops below; at under 700 the three columns stack and the band
  rail scrolls horizontally. No horizontal page scroll.
- States: every data region renders loading (skeleton rows in mono),
  empty (one line, mono, what would appear here), error (one line plus
  Retry), success.

## Information architecture (decided)

Six top-level routes in the band's title row, replacing v14's nine:

| v15 | Absorbs from v14 | Content |
|---|---|---|
| Run (default) | Overview, Activity (live part), Colony | band, seats rail, channel feed + steer, needs you, gates, last-7-days table |
| Agents | Agents, Terminal | seats as full rows with the live terminal/peek drawer; hold, kill, attach |
| Board | Board | todo board for the selected lead, same columns as atlas_todo |
| Channels | Channels, Activity (history part) | every channel, newest at bottom, filters by seat, search |
| Health | Health, Improve, doctor findings | attention items, silent failures, doctor ledger, improve loop |
| Settings | Settings, Projects | all 71 controls from v14 kept, grouped; projects list moves here |

Old hashes redirect (#/overview -> #/run, #/activity -> #/channels,
#/improve -> #/health, #/projects -> #/settings#projects, #/colony and
#/terminal -> #/agents).

## Run page regions (decided; see mockup)

1. Band, two rows, sticky.
   Row 1: hex-cube mark + ATLAS, `| mission control . <project> . <branch>
   . wave N of M`, then the six route tabs and the `/` key hint.
   Row 2: phase rail of chevron pills (past = check + name, current = lit
   teal pill with diamond + NAME n/m and a slow shimmer, future = dim),
   then live counts (working, needs you, failed, parked) and the clock.
   Under 80 "columns" (700px) the rail collapses to the current pill only,
   mirroring band.tsx narrowRow.
2. Seats rail (left, 272px). Groups per colony: `diamond <project> /
   <lead>` with age. Seat row: state glyph, role char (L I V E R from
   roles.ts), name, age; second line: tool (mcp prefix stripped), elapsed
   bar (8 cells, filled/empty squares, color by state), spinner or state
   word. Selected seat has a 2px teal inset. Bottom: machine line
   (hostname, leads/seats, db, version, port, live dot, as-of time).
   Click a seat: center column filters to it and steer targets it.
3. Channel (center). Header: `CHANNEL #<project>@<branch>/<lead>` with
   hints. Feed rows: mono timestamp gutter (72px), kind glyph column
   (24px, L lead / I implementer / V verifier / E explorer / > you /
   diamond needs / dot system), message with colored sender name and mono
   code spans. Phase-change rows are mono and dim with the phase name
   lit. Needs-input rows carry a 2px amber inset. Day marks between days.
   Steer bar at the bottom: target chip (`@seat`, `@lead`, `@all`), input,
   key hints (enter send, h hold, esc back). Posts via the existing board
   note mechanism.
4. Needs you (right, 336px). Items: title, one-line detail, mono
   state line (hollow diamond waiting + duration + what it blocks; square
   failing; triangle warning + occurrences + age), two stacked buttons
   (Answer/Hold for agent questions, Open/Dismiss for health items).
   Amber inset; red inset for failing. "N more in Health" link.
5. Gates. Chips for the definition-of-done letters the completion gate
   evaluates, each check (green) or hollow diamond (amber) with a short
   name. Source: the same evaluation the Stop hook runs, exposed read-only.
6. Last 7 days. Mono table: metric, n, 13-cell bar, delta vs prior 7d.
   Rows: runs, dispatches, silent failures, tool errors, doctor findings.
   No sparkline chart on Run; the activity chart lives in Health.

## Data gaps (builder must confirm against atlas_dashboard.py)

- Wave number, phase and n/m for the band: today the band reads them from
  the orchestrator's header line and the todo board. The web UI needs the
  same source: read the lead session's last ATLAS header via the existing
  session/transcript route, or add `/api/v2/wave` returning
  {project, branch, lead, wave, of, phase, n, m}. Builder's call; prefer
  reuse.
- Gate chips: expose the completion gate's per-letter result read-only
  (`/api/v2/gates?session=`), computed by the same code the Stop hook runs.
- Elapsed bar and tool per seat: present in herd/agents payloads per the
  TUI; confirm field names.

## Settings (kept from v14, restyled)

Every control keeps its v14 behavior and persistence; the layout changes
to the v15 type and rule system (no cards). Preference rows paint before
API-backed rows, as fixed in v14. The theme row emits the local event so
the band repaints immediately.

## What is left to the builder

- Exact codepoints and the spinner frame tables: copy from theme.ts.
- Skeleton row shapes per region.
- Palette (`/`) command list and the fuzzy matcher.
- Drawer implementation for the Agents page (reuse v14 agent-drawer.js if
  it fits the rules; otherwise rewrite).
- Whether to vendor IBM Plex or keep Geist (see Constraints).
- Test shape: node test files next to modules as in v14, plus one
  contract test that the UI glyph table equals theme.ts's.

## Calls made after the builder check (my calls, not the user's)

The builder check (.atlas/.run/cc15-builder-check.md) raised ten
questions. None needs the user; each is settled here.

1. Wave source: the persisted colony wave record
   (atlas_dash_colony.py:565-588, the `wave` key build_colony already
   emits). band.tsx's spawn-burst heuristic stays terminal-only.
2. Steer route: the same board-note POST the TUI STEER region uses,
   with X-Atlas-Token loaded from the atlas-token meta exactly as v14
   does. Builder names the route in the plan.
3. Role letters: a UI table keyed by atlas role name (lead L,
   implementer I, verifier V, explorer E, runner R, docs-curator D,
   test-engineer T, other: first letter), guarded by a contract test.
   State glyphs: copy STATE_GLYPH from mod/theme.ts (inventory cites
   theme.ts:32-42); phase glyphs: CONTRACT_GLYPH (theme.ts:228).
4. Needs-you fields: builder confirms from the herd/agents payload. If
   waiting-since is absent the line shows the state word without a
   duration (v14's documented limitation) rather than a guessed time.
5. Gates: scope is the lead session. Reuse atlas_gates.completion_group
   (atlas_gates.py:74) behind a new read-only `/api/v2/gates?session=`.
6. Selected lead: default is the most recently active lead of the
   selected project; the choice persists in localStorage per project.
7. Contrast check: restore dashboard_ui/design/contrast.py from HEAD
   (it is deleted in the working tree) and run it on the v15 palette.
8. Last 7 days: the v14 Overview already renders these five numbers and
   deltas, so the route exists; builder reuses it.
9. Mark: hex cube in the web band (the existing web mark); the diamond
   remains the terminal's single-cell stand-in. Both are "the mark".
10. Empty, loading and error copy: builder decides from the mockup.
Also: the TUI binds both `i` and `m` to steer (atlas_tui.py:73-82);
the web UI binds both.

## As built (2026-10-22, main at 4a8d5593)

Deviations from the design above:

- Title row: the band shows project, branch and lead, with no wave number.
- Phase n/m is not wired; the shell passes `header=null` (`js/app.js:49-50`, `js/run-data.js:37`).
- Gates line shape is `{id,label,ok,detail,fix}` (`atlas_gates.py` completion lines), not the guessed letter/passed/message form; `toGates` was amended to match.
- A project selector sits in the band.
- Region states (loading, empty, error) live in one shared module, `js/region-state.js`.
- Keys were built in two parts: 7a modules (`keys.js`, `palette.js`), 7b wiring into run and shell.
- `ui.css` was kept rather than replaced.
