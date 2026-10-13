# Atlas mod (Claude Code)

Last verified against the source tree on 2026-10-13 (atlas 12.0.0, the Command Center redesign): `claude plugin test plugins/atlas` passes 249 mod tests, 0 mod fail. The full plugin walk reports 169 additional failures, all pre-existing `plugins/atlas/colony/**` or `plugins/atlas/omp/**` files importing `bun:test`, which the plugin test host forbids (those suites stay on `bun test`). `bunx tsc --noEmit -p plugins/atlas/mod/tsconfig.json` is 0 errors. Paths are relative to `plugins/atlas/` unless they start with `docs/`.

The mod draws two native surfaces: a one-row band above the prompt and a tabbed sidebar pane (route/team/channel/gates). It also restyles five built-in Claude Code sites (the contract header, spinner, tool-use cards, turn receipt, prompt hint). Design rationale and decision log: `docs/plans/2026-10-13-atlas-command-center-redesign.md`. Earlier design history (the Client-pane Colony/Squad/Board/Channel/Collab tabs, persona sprites, the three-gutter-row band): `plugins/atlas/CHANGELOG.md` entries 11.0.0 through 11.1.7.

The Atlas mod is an in-process UI plugin module for Claude Code mods (Claude Code 2.1.287+). It brings the operating-contract route, the persona roster, the durable TODO board and a message field to the lead channel into the Claude Code terminal, with Atlas branding. It is the Claude-side twin of the omp channel widget (`omp/channel-view.ts`, `ATLAS_CHANNELS=off`); omp is a separate harness and stays as it is. The browser Command Center (`docs/atlas-workboard.md`) remains the browser front door; the mod is the in-terminal view.

## Requirements and activation

- Claude Code 2.1.287 or newer (mods). On older versions the `modules` key is ignored and the rest of the plugin keeps working.
- The mod is wired by the `modules` entry in `hooks/hooks.json`, in the same file as the existing hook bindings. `register(on, options)` in `mod/register.ts` is the entry point; `claude plugin validate --json plugins/atlas` passes (success true, 0 errors).
- The mod runs in-process. Hook modules get no Node APIs: every file, process and network call goes through the mods `$` API.
- Lifecycle: `session.start` reads the kill switch, builds the first snapshot, and (interactive sessions only) starts every mod clock and registers the three commands (`register.ts:495-543`). The pane opens itself only when the terminal is fullscreen and wide enough (`shouldDock`); otherwise it stays closed until `/atlas-cc`.
- Where it runs: the CLI and the Desktop Code tab. Rendering is text-first everywhere. `claude -p` and the Agent SDK run mod hooks but draw nothing, so every `ui.*` call no-ops cleanly there.
- Kill switch: `ATLAS_MOD=off` disables the mod (band, sidebar, restyles, routing). The plugin's hooks and CLIs are unaffected.

## Surfaces

Both surfaces are drawn with native elements (`$.ui.resolve(e)` from the `ui.render` hooks in `mod/register.ts:582-612`), not `Client` surface modules: a `Client` only receives keys after a mouse click, so native Buttons and Inputs are required to join the engine's own focus ring.

### The band (always on)

One borderless row above the prompt (`mod/band.tsx` `bandTree`), drawn only for the terminal surface in an interactive session with the mod on (`register.ts:582-583`). Cut to `props.bodyColumns` with `rowOf`/`fitRuns` (`mod/runs.ts`). Three width tiers, all built from `routeCounts`, `openGateCount` and the one `liveWorkers()` list:

- **Idle** (no live worker): `[ATLAS] ⚑ idle · <phase> n/m · N open`; with open gates it reads `⚑ blocked`, and a lingering `done` phase is not printed (`band.tsx` `idleParts`).
- **Narrow** (< 60 columns): `<phase> n/m · N working[ · ✗N]`, no brand pill.
- **Mid and up** (>= 60 columns): the inverse bold ` ATLAS ` brand pill (`BRAND_PILL`), phase pill, a 5-cell meter (`done/total`, filled part colored by `meterColor`, remainder muted, `theme.ts` `barParts`), up to 3 named live workers (`⏸ <name> awaits input` / `✗ <name>` / `<frame> <name> <tool> [<target>] <age>`), a `+N` overflow count, a gate count, and, at >= 100 columns, the tool and its target plus a trailing `▸ /atlas-cc` hint.

Worker segment details (12.1.0). The spinner frame comes from the current phase (`theme.ts` `PHASE_FRAMES`: research, theory, test, implement, verify each have a 4-frame set; other phases use the default). The target is the file basename of the tool call's `file_path`, else the first 40 characters of the first line of its `command` (`data/orchestration.ts` `targetOf`), fitted to 16 cells. The age is `now - startedAt`, the time since the worker was first seen, not since its last tool call (`since` still moves every call). A worker whose state is `parked` is resting: it sorts after `working` and is excluded from the band's live list.

The phase comes from the last header in `turn.complete` (matched with the contract's `headerFirstLinePattern`), else the session's first `in_progress` item, else `research` (`register.ts:97-111` `headerPhaseOf`). The spinner tick (`spinnerTickState`) only advances while `liveWorkers()` has an active entry (`register.ts:529-536`), so an idle session redraws nothing.

### The sidebar (`mod/pane/sidebar.tsx`)

One `Pane` with id `atlas`. Placement: the pane docks itself, unasked, only on the first render that knows the viewport, only when the terminal is fullscreen and at least 110 columns wide (`register.ts:34,37` `DOCK_MIN_COLUMNS`, `shouldDock`, checked once via `paneChecked`); it opens undocked at `PANE_DOCK` (56 columns, auto rows). Everywhere else the pane stays closed until `/atlas-cc`, which opens a focused, closable 12-row inline pane (`register.ts:32` `PANE_ON_DEMAND`) and closes with Esc or the close mark (clearing `paneOpenedState` so `/atlas-cc` reopens it next time, `register.ts:636-639`).

**Tab strip** (`sidebar.tsx:20-44` `tabStrip`). Four plain hotkey Buttons, the current one bold and inverse, separated by a dim ` │ ` pipe, plus a right-pushed hint (`r t c g tabs · ↑↓ Enter`) when the pane is at least 60 columns inside:

```
r: ◎ route │ t: ● team │ c: ✉ channel │ g: ✗ 2
```

The gates tab label is `✗ N` (error color) when gates are open, else `✓ gates`. Exactly one view renders below the strip at a time (`sidebar.tsx:46` `VIEWS` map), switched by `on.setView` (hotkeys `r`/`t`/`c`/`g` live while the pane holds focus) or the arrow-key focus ring.

- **Route** (`pane/sidebar-route.tsx` `routeRows`). One phase rail, never truncated: `◎ research ✓ ─ … ─ ⚒ implement ◉` (glyph + name + state mark per phase, collapsing to glyph + mark only when the full form would overflow, `railRuns`), then the current phase's header (`⚒ implement 1/3`) and its items. Each item is one row: status mark (`✓`/`⏸`/`◉`/`○`), title, a 12-char-fit owner tag, and — for a blocked owner — the reason read live from `liveWorkers()` (`blockedReason`, `itemSegments`). Enter toggles a row's evidence line. Completed items are hidden below 80 columns.
- **Team** (`pane/sidebar-team.tsx` `teamRows`). An aligned worker table, failures and blocked workers always sorted first (never folded), each row: a state mark (`✗`/`⏸`/`✓`/blank for working), name, persona/role, a `now` column (`awaits lead reply` / `failed` / `done` / the live tool or `working`), and right-aligned age. A lead summary row and a message `Input` (`▸ to <recipient>`, Enter sends) sit above/below the table (`leadRow`, `messageInput`).
- **Channel** (`pane/sidebar-channel.tsx` `channelRows`). An IRC-style log: header `#<channel>  N nicks[  M unread]`, then one row per recent board note (`HH:MM` at >= 50 columns, a persona-colored nick, a direction/kind mark — `─▶` lead-sent, `▶`/`↔` to/between others, `⚠` blocked, `✓` handoff/done — the recipient when not `all`, and the text), then the same message `Input`. Nick count includes live (not-yet-registered) workers from `liveWorkers()`.
- **Gates** (`pane/sidebar-gates.tsx` `gateRows`). One summary row per gate group (`✗`/`✓` mark, title, `N open`/`ok`, a tail of the first failing fix or detail). Enter expands a group into its lines; Enter on an open line with a fix copies the command (`on.copy`).

**Gate sources.** `scripts/atlas_gates.py --session <id> --root <repo> --json` prints three independent groups — completion, tripwire, routing; an exception in one group sets that group's `error` and the others still print. The completion group calls `completion_gate.evaluate()`, the same function the Stop hook uses. `runGates` (`register.ts:391-405`) runs it at session start, on a 30 s clock (`GATES_MS`) and after answer turns, and `parseGates` (`mod/gates.ts:28`) validates the shape; a missing script, nonzero exit or bad JSON becomes one error group (`gatesError`). The `header` group is not from the script: it is built in `mod/gates.ts:38-50` `headerGroup` from the last answer's header match, recorded by `mod/discipline.ts`.

**`$.state` keys** (atoms declared at `register.ts:51-66`; handlers and ticks write, render hooks only read): `sidebarRecipient`, `sidebarExpanded`, `sidebarDraft`, `atlasView` (the active `SidebarView`), `gates` (script groups) and `lastHeader`.

### Restyled built-in sites (`mod/restyle.tsx`)

- **`AssistantMessage`** (`restyle.tsx:153-182` `assistantTree`) draws the contract header verbatim on one styled row — ` ATLAS ` (inverse brand chip) `| <phase label>[ n/m]` (phase-colored) ` | <sentence>` (fit to the remaining width) — when the reply's first line matches `headerFirstLinePattern`; the pipes are kept. A reply whose first line does not match is left to the engine's own default render (no header row is drawn).
- **`Spinner`** becomes a braille-globe frame next to the phase capsule; when any squad member is `running`/`spawning` it appends a live agent count and that agent's current task.
- **`ToolUse` for `Agent`/`Task` on atlas personas** becomes a deployment card tracking `$.agent.list()` status live. A finished `Bash`/`Read`/`Grep` call whose output is 8000 bytes or more collapses to a one-line `<tool> <target> ▸ <size>` summary instead of drawing the raw output.
- **`TurnDuration`** becomes a one-line receipt: duration, phase move, completions this turn, live agent count, this turn's own tokens, context fill, and this turn's cost (session cost at turn end minus at turn start; no figure when the host keeps no cost ledger).
- **`PromptHint`** shows contextual chords (`/atlas-cc Command Center · /atlas-say @name …`).
- Toasts for a subagent completed or failed, a note to the lead, a todo completed, fired on answer-turn boundaries (`mod/notify.ts` `registerNotify`). An opt-in sound pack (`atlas_mod_sound`, off by default) ships its assets in `mod/fx/`.

### Context discipline (`mod/discipline.ts`)

Gated by `ATLAS_MOD!=off` plus an interactive session; every hook fails open and only ever adds model-only context or a rate-limited toast. Wired by `registerDiscipline(on, { reinforce })` in `register.ts:483-488`:

- **Heavy inline calls.** A `Read`/`Grep`/`Glob`/`Bash` call whose tool-result text is 4000+ characters, with no `Task`/`Agent` dispatch yet this turn, counts as one heavy inline call; the 4th in a turn toasts a delegate-to-role suggestion.
- **Contract drift.** A first line that does not match `headerFirstLinePattern` toasts a missing-header warning.
- **Vague-prompt sharpening.** A short, path-free, test-word-free composer prompt gets an `atlas facts: …` line appended to the model's context for that turn only.

## Data plane

All data is read from `<root>/.atlas/.run/`; the mod itself writes nothing to disk. `root` is `ATLAS_PROJECT_ROOT` if set, otherwise the nearest ancestor containing `.atlas`.

| Surface | Source | Read rule |
|---|---|---|
| TODO board | `todos.json` | Filtered to this session plus in-progress items owned by channel members; the reader polls `stat` mtime |
| IRC channel | `board/<owner>.jsonl` | Filtered to the lead channel, sorted by `seq,ts` |
| Channel roster | `channels.json` `channels[name].members[...]` | The lead channel is the entry whose `lead` equals `lead-<first 6 of the session id>` |
| In-session subagents | `$.agent.list()` plus `agent.spawn`/`turn.complete` events | Primary source; host-spawned agents appear even when `agent.spawn` was missed |
| Personas | `agents/*.md` frontmatter | Read once at session start, the single source |
| Contract | `contracts/operating-contract.json` | Track order and the header regex |
| Orchestration | host events folded by `mod/data/orchestration.ts` | Per-agent activity (tool, elapsed, mood, last line) and the comms log |

**`mod/data/live.ts` `liveWorkers(snapshot, now)`** is the one worker list every surface reads: squad minus the lead, each resolved to `working`/`blocked`/`failed`/`done` from its activity mood and agent state, sorted blocked-and-failed first. `band.tsx` reads it for the band's worker chips and `activeCount()`; `sidebar-route.tsx` reads it for `blockedReason`; `sidebar-team.tsx` reads it for the table; `sidebar-channel.tsx` reads it for the live nick count. No surface keeps its own copy.

Merged member state reuses the dashboard states (`scripts/atlas_dash_colony.py`): `running`, `idle`, `stuck` (15 minutes silent with an open todo), `parked`, `finished`, `dead`, plus **input** from herdr's blocked state. Missing files fail open: a surface renders empty rather than erroring.

## Isolated-worker workflow (`scripts/atlas_wt.py`)

One git worktree and branch per parallel `atlas:implementer` dispatch, so concurrent writers never collide in the main working tree. Naming contract: branch `worker/<agent>`, worktree `.atlas/wt/<agent>` (repo-root relative). The script never pushes, never force-deletes a branch, never resets, and never touches the main tree outside the merge itself.

- `add <agent> [--base main]` — creates (or reuses, idempotently) the worktree and branch.
- `status` — prints a JSON array, one row per `worker/*` branch: `{agent, branch, worktree, head, ahead, behind, dirty, verified_finding, merged}`.
- `merge <agent>` — refuses unless `.atlas/.run/findings.json` holds a `verified` entry naming the branch or agent, refuses on a dirty worktree or zero commits ahead; otherwise does a `--no-ff` merge, removes the worktree, deletes the branch.
- `prune` — runs `git worktree prune`, then deletes branches that are fully merged with no worktree left.

**Enforcement.** `hooks/completion_gate.py` condition (q) blocks "done" while `atlas_wt.py status` reports a `worker/*` branch with unmerged commits or a dirty worktree. `ATLAS_WT_GATE=off` disables it.

## Sprite review (`mod/sprites/`)

The sidebar draws no sprites; `mod/sprites/api.ts` (`spriteRows`, `art.ts`, `palette.ts`) exists only to color persona nicks (`personaStyle`, used by `sidebar-channel.tsx`). To review the sprite art itself, `scripts/sprite_review.ts` renders every persona x mood sprite (size `m`, frame 0) by folding `spriteRows()` through `mod/sprites/review.ts` `runsToSvg()` — the same `Run[]` cell data the terminal paints, drawn as SVG cells (bg rect, fg half/full rects for `▀ ▄ █`, chip text as `<text>`) at real terminal cell aspect — to `/tmp/atlas-sprites.svg`, converted to `/tmp/atlas-sprites.png` via `rsvg-convert` when that binary is present.

## Personas, models and effort

Source of truth is `agents/*.md` frontmatter (13 agents; all set `model`, `effort` and `color`). The mod copies the frontmatter value; it never keeps a second table.

How the mod applies the matrix: `agent.spawn` records the agentId→persona mapping for `atlas:<role>` spawns (model untouched, the frontmatter pin decides it); `turn.step` sets `effort` from the frontmatter when the agent maps to a persona, so forks of `planner`/`completeness-critic`/`docs-curator` get their frontmatter effort instead of inheriting the opus parent's. Unpinned spawns (armada departments, the generic `task`) are not rewritten.

## Managed policy and fail-open behaviour

Regulated deployments (FTC Safeguards, SEC Reg S-P, GLBA) should read this section before enabling the mod. `sec-default@builtin` loads on any machine with managed settings, and for a Team or Enterprise sign-in it loads ahead of every user-installed mod.

| Managed setting | Atlas mod | Atlas plugin hooks | Notes |
|---|---|---|---|
| `allowManagedModsOnly` (managed settings only) | refused unless an org mod | keep running | Status lines and `/goal` keep working |
| `allowManagedHooksOnly` | refused unless an org mod | blocked, unless managed `enabledPlugins` force-enables atlas | Also blocks agent-frontmatter hooks, non-managed `statusLine`, and `/goal` |
| `disableAllHooks` (managed) | stopped, org mods included | stopped | Built-in mods and Agent SDK hooks keep running |
| `disableSideloadFlags` | `--plugin-dir` is rejected | n/a | A sideloaded spike cannot run on such a machine |
| A site policy mod refusing `process.run` | refused unless an org mod | n/a | Atlas calls `$.process.run` |

Fail open, stated precisely: when only the mod is stopped, the band and the pane are absent and nothing else in atlas depends on the mod. Under `allowManagedHooksOnly` without force-enable, or managed `disableAllHooks`, the atlas plugin hooks stop too. The guard fails closed when it cannot read managed settings.

## State-changing actions

Everything the mod can change, all user-initiated:

- Todo add, claim, status and complete (complete requires an evidence note) through `atlas_todo.py`, via `/atlas-todo`.
- Channel notes: the sidebar message field and `/atlas-say`.
- Automatic process calls: the 5-second `atlas_herdr.py status` poll (read-only) and the 30-second `atlas_gates.py` run (no side effects, DB opened read-only).
- The mod makes no `$.http` calls, and its links point only at localhost (the herdr web UI).

## File map

```
plugins/atlas/mod/
|-- contract.ts        # shared types and BRAND tokens
|-- register.ts        # entry point: register(on, options); $.state atoms, session.start clocks, gates run, sendNote, ui.render hooks
|-- register*.test.ts  # register wiring (sidebar, open, agents)
|-- theme.ts            # chartRoom palette, width-safe glyph allowlist, fitText/textWidth, bar/spin
|-- runs.ts              # Segment/rowOf/fitRuns: the one text-run layout helper band and sidebar views share
|-- band.tsx              # AbovePrompt band: one-row bandTree
|-- gates.ts               # parseGates, gatesError, headerGroup, openGateCount/groupOpenCount (pure)
|-- pane/
|   |-- sidebar.tsx     #   tabStrip + VIEWS dispatch (route/team/channel/gates)
|   |-- sidebar-route.tsx   #   phase rail + task rows
|   |-- sidebar-team.tsx    #   worker table + lead row + message field
|   |-- sidebar-channel.tsx #   IRC-style note log + message field
|   |-- sidebar-gates.tsx   #   gate group/line rows
|   |-- sidebar-types.ts    #   SidebarModel/SidebarHandlers/SidebarView, pad()
|   `-- chrome.tsx          #   ageStr, scrub
|-- orchestra-types.ts  # LiveSnapshot, Mood, ActivityEntry, CommsEntry, TodoGroup
|-- routing.ts          # agent.spawn persona recording, turn.step effort pin, turn.complete -> registerCompletion
|-- restyle.tsx         # Spinner, ToolUse, AssistantMessage (header), TurnDuration, PromptHint sites
|-- discipline.ts       # context discipline: heavy-inline-call toasts, contract drift, vague-prompt facts
|-- notify.ts           # toasts and next-step suggestion on answer-turn boundaries
|-- intents.ts          # note/todo intents resolved to atlas_todo.py argv
|-- snapshot.ts          # session snapshot (SnapshotBuilder)
|-- live_fixture.ts      # busySnap()/idleSnap() orchestration fixtures for tests
|-- data/                # readers for the .atlas/.run plane; all fail open on missing files
|   |-- root.ts, todos.ts, channels.ts, personas.ts, orchestration.ts, herdr.ts
|   `-- live.ts          #   liveWorkers()/activeCount(): the one worker list every surface reads
|-- sprites/             # api.ts (spriteRows/personaStyle), art.ts, palette.ts, review.ts (runsToSvg for the review script)
`-- fx/                  # optional sound pack assets ($.audio.play)
```

Colocated `*.test.ts` files use the `claude-code/testing` kit. `scripts/sprite_review.ts` (one level up, `plugins/atlas/scripts/`) is the sprite review CLI; it is not a mod module.

## Route default tab and turn timer (12.1.0)

- The `atlasView` atom defaults to `route`, matching the tab strip order; closing the pane resets it to `route` so `/atlas-cc` reopens on the first tab (`register.ts` `viewState`).
- The turn receipt duration is `min(host durationMs, now - turnStart)`. The mod stamps `turnStart` from `$.clock.now()` at turn start (`restyle.tsx` `ReceiptTracker.turnStart`, `durationTree`); the host figure was seen reading 9m02s for a 77s turn. Without a clock the host figure is used.

## Honesty and known defects

- **Claude-Code-only.** Both surfaces are drawn by the `ui.render` mod dispatch on the `AbovePrompt` and `Pane` components. omp has no such vocabulary and keeps its own `atlas-channel` widget (`omp/channel-view.ts`).
- **Fullscreen docked placement** (>= 110 columns, fullscreen terminal) is exercised by `shouldDock`'s unit tests; a live capture of the docked pane itself (as opposed to the inline `/atlas-cc` pane) is not in `.atlas/evidence/`.
- Live evidence of the redesigned surfaces: `.atlas/evidence/mod-cc-2026-10-13/live-160x45.md` (band, team awaiting-reply row, idle band, header pill, pane tab strip at 100x30).

## See also

- `docs/atlas-colony.md` — the herdr colony
- `docs/atlas-channels.md` — channel names, registry and delivery rules
- `docs/atlas-workboard.md` — the browser Command Center (dashboard) the mod complements
- `docs/atlas-harness-parity.md` — the harness parity matrix, including the Claude mod vs omp widget row
- `docs/plans/2026-10-13-atlas-command-center-redesign.md` — design plan, decisions and stage history
