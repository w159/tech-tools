# Atlas terminal UI (2026-11-10, Atlas 17.4.0; revision 4, 2026-11-11)

Revision 4 (2026-11-11) updates the sections below marked "Rev 4" to the code at HEAD. Where the older layout text (the
`mission-layout.ts` runs, the `starting` state, the `Subagents block is dropped` note) disagrees with the Rev 4 sections,
the Rev 4 sections win.

The Mission Control band (Claude Code), the mission panel (omp), the sidebar, toasts and the doctor report. This spec
replaces the 17.3.0 display, which the owner found confusing.

## What was wrong

A live 17.3.0 session (150x45 pane) showed:

- Task progress three times: the TODO tree said 1/1, a `board` bar said 6/6 and a `tasks` bar said 6/6.
- Gate results three times: `g: core ✗4` in the sidebar, `gates ✖4` in the band title, and `✖4` again in the core row.
- Jargon with no labels: `CONTRACT hdr 2/2 ev 7/7 ✖4   VERDICT ✔1 ✖0 ?0 ⚠0`.
- Decoration that carried no meaning: a violet-to-sky gradient title bar, a different hue for every phase, character
  faces per worker (`◔_◔`), an elapsed bar that filled over two minutes and a sparkline with no axis or label.
- Two hand-synced renderers (band.tsx, mission-panel.ts) that had already drifted twice.

## Principles

Taken from GitHub's Primer CLI guidelines, clig.dev and Evil Martians' progress-display research:

1. One fact, one place. Task progress lives in the header, checks in the footer, each worker in its own row.
2. Colour adds meaning, never carries it alone. Green, amber and red mean ok, needs attention and failed. Violet is
   the one accent and marks what is happening now. Everything structural is muted or dim grey. Every coloured mark is
   paired with a word (`✓ completion`, `✗ tripwire`, `waiting`, `failed`).
3. Motion means work in progress. A spinner appears only next to something running right now: the current step and
   each worker with a tool in flight. Idle panels do not move.
4. Plain words over codes. `verdicts  1 verified · 1 refuted`, not `VERDICT ✔1 ✖1`.
5. Hierarchy from weight and spacing: a raised header row, bold for names and the current step, blank rows to breathe
   when there is room.
6. Degrade in a fixed order. Under a tight row budget: blank rows go first, then the message, then the footer, then
   workers past a `+N more` row. Under a tight width: role column, then step names shorten to three letters, then to
   marks; the current step keeps its name.

## Layout

One layout module, `plugins/atlas/mod/mission-layout.ts`, produces tone-tagged runs. `mod/band.tsx` (Claude Code) and
`omp/mission-panel.ts` (omp) are adapters that paint those runs, so the two harnesses print the same text by
construction. `contracts/band-golden.ts` asserts it on both.

Running, 120 columns:

    ◆ ATLAS   tech-tools@main  ·  implement/medium               1 of 6 tasks ━━━━━━━━━━━━━━━━   01:15
    ✓ research ─ ✓ theory ─ ✓ test ─ ⠋ implement ─ ○ verify ─ ○ done

    ⠋ explorer-1    explorer    Grep  src/auth                                                    1m15s
    ⠋ impl-auth     implementer thinking   last Edit auth/middleware.ts                           1m10s

    impl-auth → lead-eed839   need a decision on the token ttl                                    14:06
    checks  ✓ completion  ✗ tripwire  ✓ routing

Idle:

    ◆ ATLAS   tech-tools@main  ·  idle                                  6 of 6 tasks ━━━━━━━━━━━━━━━━
    ✓ research ─ ✓ theory ─ ✓ test ─ ✓ implement ─ ✓ verify ─ ✓ done     last run  3 workers · 1m31s · all ok
    contract  header 3/4 · evidence none   verdicts  1 verified · 1 refuted   offload  17.9k → 608 (30x)   ...
    checks  ✓ completion  ✗ tripwire  ✓ routing                r: route  t: team  c: channel  g: gates  o: board

Rows:

| Row | Content | Notes |
|---|---|---|
| Header | brand, project, scope or `idle`, `blocked · needs you` when blocked; right: `N of M tasks` and a thin bar, elapsed clock while running | raised background; the bar turns green when complete |
| Stepper | `✓ done ─ ⠋ current ─ ○ next` | full names, then three letters, then marks; idle shows the last run on the right |
| Workers | status mark, name, role (100+ cols), activity in words, elapsed | failed and waiting sort first; a finished worker stays 15 s with `✓ finished` |
| Message | newest channel message `from → to   text   hh:mm` | one row, not two |
| Footer | `checks  ✓ id ...`; only failures when tight; Claude Code adds the key buttons while idle | omp has no keys |
| Core (idle) | `contract`, `verdicts`, `offload`, `route` with dim labels | colour only when something is off; evidence joins the contract group when the row has room, at about 123 columns and up |

Worker states: `running` (green spinner, tool and target), `thinking` (grey spinner, last tool dimmed), `starting`
(`◌`), `waiting` (amber `○`), `failed` (red `✗`), `finished` (green `✓`).

Below 80 columns the band is one row: `◆ ATLAS  implement · 1/6 tasks · 2 working · 1 failing`.

## Palette

One restrained palette (critique 25). Accent `#af87ff` (141), ok `#87d787` (114), warn `#d7af5f` (179), error
`#ff5f5f` (203), neutrals 236 `#303030` (rules), 240 `#585858` (dim: the brand mark, rules, idle gate segment), 245
`#8a8a8a` (secondary text), 252 `#d0d0d0` (body). Panel `#181825`, raised header `#1e1e2e`. Defined once in
`PALETTES` and `PALETTE5` (`mod/atlas-ui.ts`); `mod/palette.test.ts` fails on any other literal colour in a surface
file. `◆ ATLAS` appears only on the band chip, the block ribbons, the panel title and the finish cards (240). The
band agents count, the SUBAGENTS title and the panel agent rows turn the band's braille frame; rows the capture
scorer parses by glyph (TODO, board, plan and band worker rows) keep the circle quarters. A killed worker reads
`closed` in error red on every surface.

## Other surfaces

- The Claude Code HUD above the band keeps the TODO tree. Its Subagents block is dropped there because the band's
  worker rows show the same agents with more detail. omp draws its own native subagent block, which Atlas does not
  control.
- Sidebar: a tab bar with the active tab accented and a gates tab that carries the failing count; the route view is a
  vertical phase list with the current phase's items nested under it.
- Toasts: plain sentences, one per turn.
- Doctor: `Atlas doctor  ·  atlas`, then failures and warnings with wrapped details, one line for passing checks,
  one for checks that do not apply, and a verdict line. Colour only on a TTY and never with `NO_COLOR` set.

## Rev 4 (2026-11-11): what the code at HEAD does

Every statement below is backed by the file named beside it (paths under `plugins/atlas/`).

- One phase rail. `mod/rail.ts` (`railIds`, `railOf`, `railNo`) is the only place a rail is cut from the contract phases
  (`RAIL_SKIP` drops `validate`, `blocked`, `done`). The band (`mod/band.tsx`), the side panel model
  (`mod/pane/sidebar-model.ts`), the panel layout (`mod/panel-layout.ts`) and the omp mission panel
  (`omp/mission-panel.ts`) all ask it, so a phase reads the same number (`4/5` for `implement`) everywhere.
- Gauges need an estimate. The Board and the HUD TODO draw `of mm:ss` and the elapsed gauge only for an item that carries
  `estimate_s` (`mod/board-model.ts` line 78 and `mod/hud.ts` line 73). Any other running item reads
  `elapsed 00:42` with no gauge; there is no default budget.
- One tab list. `STRIP_TABS` (`mod/panel-layout.ts`: route, team, channel, gates, core, board; keys `r t c g k o`) is
  the list the Claude Code side panel strip (`mod/pane/sidebar.tsx`), the omp painter (`omp/panel-view.ts`) and the band
  footer buttons (`BAND_BUTTONS` in `mod/band.tsx`) all draw.
- Board key. `o` runs `openBoard` (`mod/register.ts`). When the Atlas pane is shown, the board is drawn inside that pane
  (view `board`) and a second `o` returns to the route; otherwise it opens the `atlas-board` pane.
- Compact board. At 60 to 99 cells the state column is set from the widest label, not fixed at 26, so a label is not cut
  (`stateCol` in `mod/board-model.ts`, shared with omp).
- HUD Subagents block. It is back on Claude Code (the older note above that it is dropped no longer holds). With nothing
  running, a done agent stays for `LINGER_MS` (15 s, exported from `mod/atlas-ui.ts`, the band's own window) and a failed
  agent stays until it is cleared (`mod/hud.ts` lines 113 to 115).
- Channel tab. The roster falls back to the project's main channel key (`<folder>` or `<folder>@<ref>`) when no candidate
  key matches the lead's session (`mod/data/channels.ts`).
- Route tab. Running agents that own no plan row are listed under the plan, in the HUD Subagents state words
  (`mod/panel-layout.ts`, comment at "Agents that work but hold no plan row").
- Widths are terminal cells. `cells`, `clip` and `clipMiddle` in `mod/atlas-ui.ts` count wide characters as two cells
  through `textWidth` (`mod/theme.ts`).
- The `[-]` beside the first HUD row is the host's own collapse mark in the five cells it reserves (`bodyColumns`). The
  plugin cannot remove it.
- Unmounted omp painters. `paintPanel`, `paintCard` and `paintToast` in `omp/panel-view.ts` are marked UNMOUNTED in the
  file: nothing in omp calls them, so their parity tests are not evidence of a mounted surface.

## Sources

- Primer, CLI foundations: https://primer.style/native/cli/foundations
- Command Line Interface Guidelines: https://clig.dev
- Evil Martians, CLI UX best practices for progress displays: https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays
