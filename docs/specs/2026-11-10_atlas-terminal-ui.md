# Atlas terminal UI (2026-11-10, Atlas 17.4.0)

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

Catppuccin Mocha. Tones: text `#cdd6f4`, muted `#9399b2`, dim `#585b70`, accent `#cba6f7`, ok `#a6e3a1`, warn
`#f9e2af`, bad `#f38ba8`. Panel `#11111b`, raised header `#1e1e2e`. Defined once in `TONE_HEX`.

## Other surfaces

- The Claude Code HUD above the band keeps the TODO tree. Its Subagents block is dropped there because the band's
  worker rows show the same agents with more detail. omp draws its own native subagent block, which Atlas does not
  control.
- Sidebar: a tab bar with the active tab accented and a gates tab that carries the failing count; the route view is a
  vertical phase list with the current phase's items nested under it.
- Toasts: plain sentences, one per turn.
- Doctor: `Atlas doctor  ·  atlas`, then failures and warnings with wrapped details, one line for passing checks,
  one for checks that do not apply, and a verdict line. Colour only on a TTY and never with `NO_COLOR` set.

## Sources

- Primer, CLI foundations: https://primer.style/native/cli/foundations
- Command Line Interface Guidelines: https://clig.dev
- Evil Martians, CLI UX best practices for progress displays: https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays
