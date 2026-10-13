# Atlas Command Center redesign (mod 12.0)

Status: proposed 2026-10-13. Inputs: `docs/audits/2026-10-13-{mod-audit,orchestration-audit,output-style-audit,mod-examples}.md`.
Target: `plugins/atlas/mod/**` (mod source), `plugins/atlas/hooks/session_boot.py:271` (header backup). No install-cache edits.

## 1. Why

- The `ATLAS | glyph phase | state` header never reaches the screen: `restyle.tsx:182-209` replaces it with a ` ▸ phase n/m ` pill and invents `· inferred` when absent (output-style audit §4).
- Phase is drawn in 8 places, open gates in 4, "N working" in 4 with two different counts (mod audit §3.2).
- The pane asks 44x32 and opens unconditionally, so it covers ~26 transcript rows inline; sprites/portrait need 40 rows and never show (§3.3-3.4).
- Animation runs only while the lead's Spinner is mounted; background workers freeze (§3.4).
- No channel/IRC view, no dispatch edge, failed workers fold into `+N more` (§3.4).
- Dead weight: `svg.ts`, `band.tsx-E`, nine unread snapshot fields, 128 KB transcript tails per worker every 5 s (§3.6-3.9).

## 2. Principles

1. One fact, one place. The header line is the phase authority; the band is the live strip; the pane is detail. Nothing repeats what the row above already says.
2. Never cover the transcript. Pane docks only when `e.viewport.isFullscreen && columns >= 110`; otherwise the band is the whole UI and `/atlas-cc` opens an inline pane of at most 12 rows (user-initiated, so it places at any width).
3. Live means live. One `$.clock.every(250)` started in `session.start`, running while any worker is active; stops when squad is idle.
4. Failures first. Sort order: blocked, failed, working, done. Nothing failed ever folds.
5. Width-safe only. No emoji; contract glyphs map to `theme.ts` single-cell glyphs (`🔍→◎ 💡→◇ 🧪→⚗ 📋→☰ 🔧→⚒ ✅→✓ 🏁→⚑ ⛔→■`). `textWidth` fits every row.

## 3. Surfaces (what the user sees)

### 3.1 AssistantMessage: the header, styled, kept

```
 ATLAS ▏⚒ implement 3/5 ▏dedup cpWidth, 2 workers running
```
`ATLAS` inverse accent badge; glyph+phase bold in `stageColor`; `n/m` dim; state sentence plain; thin `▏` separators replace the pipes visually but the raw text stays in the transcript (engine `rest` keeps lines 2+). No header → `next(e)` untouched (no fake pill). File: `restyle.tsx assistantTree`.

### 3.2 Band (AbovePrompt): one row, no border, always current

```
⚒ implement 3/5 ▰▰▰▱▱  ⠹ impl-auth Edit 12s · explorer-1 Grep 3s  ✗1 gate  ▸ /atlas-cc
```
Segments left to right: phase+meter · live workers (name, tool, age; blocked shown `⏸ name awaits input`; failed `✗ name`) · gates only when open · hint. Idle: `⚑ idle · last: verify 5/5 · 0 open` (no spinner). Width tiers: ≥100 all; ≥60 drop hint and ages; <60 phase+counts. `next(e)` row stacked below so other mods keep theirs. Files: `band.tsx`.

### 3.3 Pane `atlas` (docked ≥110 cols, else `/atlas-cc` inline ≤12 rows)

Header strip + hotkey tabs (Buttons, hotkeys `r t c g`), one view at a time, stored in `$.state.atlasView`:

```
 ◎ route  ● team  ✉ channel  ✗ gates          Tab/↑↓ move · Enter act · c copy
```

**team** (default while anyone works). Aligned table, failures first, every row one line:
```
 st  agent         role          now                  age   tools  last line
 ✗   runner-1      runner        exit 1 pytest        2m    7      FAILED test_gate.py::x
 ⏸   impl-auth     implementer   awaits lead reply    40s   12     claimed plugins/atlas/mod/band.tsx
 ⠹   explorer-1    explorer      Grep ctx_search      3s    4      ctx_search pattern=AGENT_TEAMS
 ✓   dedup-cpwidth implementer   done 421 pass        5m    19     releases: channel.tsx, theme.ts
 ●   lead                        dispatching 3        now
```
Dispatch edge: `lead ─▶ impl-auth` drawn as a `▸` prefix on rows spawned this turn and a `lead is running N · M done · K blocked` line. Enter on a row toggles a 3-line detail (transcript tail) under it. Portrait sprites only when `scroll.bodyRows >= 40` on desktop or terminal with kitty graphics; otherwise none.

**channel** (IRC). Newest at bottom, nick colours from persona, direction marks, input field to send (`/atlas-say` stays):
```
 #tech-tools@main/lead-01a130   4 nicks   2 unread
 08:51 lead      ─▶ DedupCpWidth   dedup cpWidth channel.tsx→theme.ts
 08:52 DedupCpWidth  claims plugins/atlas/mod/pane/channel.tsx, theme.ts
 08:53 DedupCpWidth ▶ lead  done: 421 pass/169 fail unchanged
 08:55 StyleAudit  ⚠ blocked  explorer may not write repo paths
 ▸ to lead ▏ type a message, Enter sends
```

**route**. Waypoint rail with full phase names (never truncated: labels drop to glyphs when `bodyColumns < 7*phases`), then only the current phase's open items, owner next to the title (not right-aligned):
```
 ◎ research ✓ ─ ◇ theory ✓ ─ ⚗ test ✓ ─ ☰ validate ─ ⚒ implement ◉ ─ ✓ verify ○
 ⚒ implement 3/5
   ◉ edit auth middleware · impl-auth
   ○ add ttl config
   ⏸ wire gate · runner-1 (blocked: pytest)
```

**gates**. One row per gate with verdict, age and the one-line "how to clear"; no strip duplicating the rows:
```
 ✗ completion   2 open   docs: CHANGELOG line missing; (g) stamp finding for impl-auth
 ✓ header       ok       last reply carried ATLAS header
 ✓ tripwire     ok
 ✓ routing      ok
```
Advisor notes move out of the pane: they are todos with `origin: advisor` and appear under route only when they belong to this session.

### 3.4 Spinner / TurnDuration / PromptHint

- Spinner: `next({...e, props:{...e.props, suffix: '· impl-auth Edit · explorer-1 Grep'}})` (detail, not replace). No phase capsule: the header and band already say it.
- TurnDuration: `▸ 4m12s · +2 done · 2 workers · ctx 31% · $0.12`. Workers = active-this-turn count, the same `liveWorkers` the band uses.
- PromptHint: engine hint untouched; `prompt.suggest` is called from exactly one place (`notify.ts`) with one rule: first blocked worker's ask, else first in_progress todo. `HINT_TAIL` removed.
- Toasts: `✓ impl-auth 58s · 421 pass`, `✗ runner-1 exit 1`, `⏸ StyleAudit blocked: write denied`. Fired from `agent` events, not only at answer-turn end.

## 4. Data plane

- Keep `SnapshotBuilder`; delete unread fields (`lifecycle`, `savings`, `sessions`, `unread`, `contractProgress`, `backlog`, `headerMisses`, `tokens`, `costUsd`) and their builders (`data/sessions.ts` tails, `data/collab.ts`, lifecycle half of `data/orchestration.ts`). `activity` gains `lastLine` (from `tool.call` input summary) and `exit` (from `turn.complete`/`agent` result) so the team table needs no transcript reads.
- `liveWorkers(snapshot)` is the single function behind band, team, spinner suffix, receipt.
- `contractGlyph(phase)` in `theme.ts` maps emoji → single-cell glyph once; `personas.ts:118` passes through it.
- Clock: `register.ts session.start` → `$.clock.every(250, tick)`; tick writes `spinnerTick` only when `liveWorkers.length > 0`.
- Pane placement: `$.ui.open` only when docked conditions hold; `/atlas-cc` opens inline with `rows: 12`, `closeOnEscape: true`. `isPlaced:false` → toast reason once.

## 5. Delete

`mod/svg.ts` + test, `mod/band.tsx-E`, `data/sessions.ts`, `data/collab.ts`, `pane/sidebar-portrait.tsx` (sprites stay in `sprites/api.ts` for team badges and the ≥40-row portrait), `sprites/<persona>.ts` modules (16 files feeding only `svg.ts`; `art.ts` stays), `restyle.tsx HINT_TAIL`, `nextStepText`.

## 6. Review image for sprites (advisor note t2b156948)

`scripts/sprite_sheet.py` is out; instead `mod/sprites/review.ts` exports `runsToSvg(rows: Run[][], cellW=8, cellH=16)` that consumes `spriteRows()` output: one rect per cell at 1:2, bg/tile fill, `▀`/`▄`/`█` as half or full rects in `fg`, chip text drawn with `<text>`. Used by `sprites.golden.test.ts` to write nothing (pure function) and by a `--svg` flag on `claude plugin test`-independent `bun scripts/sprite_review.ts > /tmp/sprites.svg` for human review. Closes the note.

## 7. Header backup in hooks

`session_boot.py:271-272`: always emit the one-line header rule even when `outputStyle == "Atlas Orchestrator"` (the mod can hide it; the hook cannot know).

## 8. Waves (each item = one implementer, own tests, no shared files inside a wave)

| wave | slice | files | check |
|---|---|---|---|
| 1 | header kept + no inferred pill | `restyle.tsx`, `restyle.test.tsx` | mount AssistantMessage with/without header: header text present / engine ref returned |
| 1 | theme glyph map + `liveWorkers` + clock in session.start | `theme.ts`, `data/orchestration.ts`, `register.ts` | unit: glyph widths all 1; tick advances only with live workers |
| 1 | delete list §5 + snapshot fields | `snapshot.ts`, `data/*`, `svg.ts`, `band.tsx-E`, sprites/*.ts | `claude plugin test` green; fallow dead-code 0 |
| 2 | band | `band.tsx`, `band.test.ts` | three width tiers render ≤ bodyColumns; idle has no spinner |
| 2 | pane shell + tabs + state atom + placement rule | `pane/chrome.tsx`, `pane/sidebar.tsx`, `register.ts`, `types/index.d.ts` | press `t`/`c` switches view; open only when docked rule holds |
| 2 | team view | `pane/team.tsx` | failures first, never folded, row width ≤ bodyColumns at 44/80/120 |
| 2 | channel view | `pane/channel.tsx`, `data/channels.ts` | notes render newest last; Enter sends via `atlas_todo.py note` |
| 2 | route + gates views | `pane/route.tsx`, `pane/gates.tsx` | labels never `…`; one row per gate |
| 3 | spinner/receipt/hint/toasts | `restyle.tsx`, `notify.ts` | one `prompt.suggest` caller; toast on agent events |
| 3 | sprite review svg | `sprites/review.ts` + test | svg has cell rects at 1:2 and `<text>` chip |
| 3 | session_boot header backup | `hooks/session_boot.py` + test | rule emitted when style matches |
| 4 | docs | `docs/atlas-mod.md`, `CHANGELOG.md`, `README.md` | cites match code |

Verification surface: `claude plugin test plugins/atlas` (mod green) and a live tmux Claude Code session at 100x30 and 160x45 with two subagents, screenshots saved under `.atlas/evidence/mod-cc-2026-10-13/`.

## 9. Out of scope here (separate decision)

Hook friction found by the orchestration audit (3-6 Python processes per tool call, ≥10 tripwire deny classes, recall gate denying every tool until claude-mem): a separate plan, since it changes enforcement policy, not UI.
