# Atlas mod (Claude Code)

Terminal UI sections verified against main ef38fc50 (atlas 17.15.0) on 2026-11-13; sections dated earlier describe 12.x and are marked where the 17.15.0 section supersedes them. Earlier note, 2026-10-13 (atlas 12.0.0, the Command Center redesign): `claude plugin test plugins/atlas` passes 249 mod tests, 0 mod fail. The full plugin walk reports 169 additional failures, all pre-existing `plugins/atlas/colony/**` or `plugins/atlas/omp/**` files importing `bun:test`, which the plugin test host forbids (those suites stay on `bun test`). `bunx tsc --noEmit -p plugins/atlas/mod/tsconfig.json` is 0 errors. Paths are relative to `plugins/atlas/` unless they start with `docs/`.

The mod draws two native surfaces: a one-row band above the prompt and a tabbed sidebar pane (route/team/channel/gates). It also restyles five built-in Claude Code sites (the contract header, spinner, tool-use cards, turn receipt, prompt hint). Design rationale and decision log: `docs/plans/2026-10-13_atlas-command-center-redesign.md`. Earlier design history (the Client-pane Colony/Squad/Board/Channel/Collab tabs, persona sprites, the three-gutter-row band): `plugins/atlas/CHANGELOG.md` entries 11.0.0 through 11.1.7.

The Atlas mod is an in-process UI plugin module for Claude Code mods (Claude Code 2.1.287+). It brings the operating-contract route, the persona roster, the durable TODO board and a message field to the lead channel into the Claude Code terminal, with Atlas branding. It is the Claude-side twin of the omp channel widget (`omp/channel-view.ts`, `ATLAS_CHANNELS=off`); omp is a separate harness and stays as it is. The browser Command Center (`docs/architecture/atlas-workboard.md`) remains the browser front door; the mod is the in-terminal view.

## Requirements and activation

- Claude Code 2.1.287 or newer (mods). On older versions the `modules` key is ignored and the rest of the plugin keeps working.
- The mod is wired by the `modules` entry in `hooks/hooks.json`, in the same file as the existing hook bindings. `register(on, options)` in `mod/register.ts` is the entry point; `claude plugin validate --json plugins/atlas` passes (success true, 0 errors).
- The mod runs in-process. Hook modules get no Node APIs: every file, process and network call goes through the mods `$` API.
- Lifecycle: `session.start` runs `boot` in `register.ts`. It reads the kill switch, builds the first snapshot, and (interactive sessions only) starts every mod clock and registers the four commands (`/atlas-cc`, `/atlas-say`, `/atlas-core`, `/atlas-todo`). Commands and the long timers register once per loaded copy of the mod. A `/clear` raises `session.end` (reason clear) and no `session.start`, so `boot` also runs on `classic.SessionStart` with source `clear`; module state keeps the interactive flag across the clear. Without that second trigger the band, the todo board and the `/atlas-cc` pane stay blank or stale after `/clear`. The pane opens itself only when the terminal is fullscreen and wide enough (`shouldDock`); otherwise it stays closed until `/atlas-cc`.
- Where it runs: the CLI and the Desktop Code tab. Rendering is text-first everywhere. `claude -p` and the Agent SDK run mod hooks but draw nothing, so every `ui.*` call no-ops cleanly there.
- Kill switch: `ATLAS_MOD=off` disables the mod (band, sidebar, restyles, routing). The plugin's hooks and CLIs are unaffected.

## Surfaces

Both surfaces are drawn with native elements (`$.ui.resolve(e)` from the `ui.render` hooks in `mod/register.ts:582-612`), not `Client` surface modules: a `Client` only receives keys after a mouse click, so native Buttons and Inputs are required to join the engine's own focus ring.

### Terminal UI as shipped (atlas 17.15.0, main ef38fc50)

This section wins over the 12.x sections below where they differ. Paths are under `plugins/atlas/`.

- **Slot order.** The band and its worker rows come first, then one blank row, then the HUD (TODO box, one blank, SUBAGENTS box), so a host clip eats HUD rows, never the band (`atlasSlot`, `mod/register.ts:391`).
- **Hold.** While a run lasts the slot keeps its height: `hudHoldRows` (`mod/hud.ts:352`) reserves a typical five-row plan and up to three agents once a phase header, a plan or an agent exists (`hudRunRows`, `mod/hud.ts:339`); `slotHold` (`mod/register.ts:398`, called at `:1376`) never falls during the run, never passes the budget, and is 0 at rest.
- **Run start and end.** The clock starts at the person's prompt (`armedAt`, `mod/register.ts:1031`, `:1240`) and ends on the host's own turn end with no grace (`stepRun`, `mod/band-motion.ts:70-77`; `END_GRACE_MS` applies only where the host gives no turn signal). The first done frame already shows the final time (`finalSecsOf`, `mod/band-motion.ts:86`). The band reads `idle` after `IDLE_AFTER_SECS = 30` (`mod/mission-layout.ts:221`). A closed run has one total, set at close and never raised after (`closedTotal`, `readRun`, `mod/band-motion.ts`): the done clock is frozen, and the band, run card, side panel and board print that figure. A run that ends with a failed worker or a refused stop reads `blocked`, not `idle`, until a new run starts (`failedOpen`, `runStateOf`, `mod/mission-layout.ts`).
- **Frame clock.** `FRAME_MS = 100` (`mod/band-motion.ts:51`), the loop armed at `mod/register.ts:1097`: at most 10 redraws a second. One frame index per render is shared by every surface (`withSpinFrame`, `mod/atlas-ui.ts:647`).
- **Spinner sets.** Braille `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (`LEAD_FRAMES`, `mod/atlas-ui.ts:609`) on the band lead and agents count, the SUBAGENTS title and the panel agent rows; circle quarters `◐◓◑◒` (`SPIN_FRAMES`, `:607`) on TODO, SUBAGENTS agent rows, board and band worker rows, because the capture scorer reads them (`SCORER_READS_CIRCLES`, `mod/hud-surface.ts:20`).
- **Fit ladder.** `fitRows` (`mod/hud-surface.ts:437`): progress rail, blank row, both closing rules together, finished TODO rows (`n/m · k done`), agent rows (down to one), TODO rows, the TODO box, the SUBAGENTS column names last. Overflow is one wording in the title: `figure · +N more` (`:172`), `3 running · +2 more` (`:285`). Boxes are closed on both blocks or flat on both, never a top rule without a bottom (`titleRow(..., flat)`, `:57`).
- **Truth.** The side panel draws the snapshot as is, with no hold. The phase is never `done` while a dispatch row is open or a worker runs (`currentPhase`, `mod/data/todos.ts:270`). The status tab's phase row is built from the band's own inputs and glyph function (`phaseRow`, `phaseGlyph`, `mod/panel-layout.ts`), so it matches the band on one frame; lane and event times come from the same worker clock and one run start (`originOf`, `runBandModel`, `mod/register.ts`). A row whose owner returned is a neutral `◉` with the word in 245 (`mod/hud-surface.ts:25`). The lead header line is lower case with no `▌` after the host's `●` (`displayLine`, `mod/transcript/leadheader.ts:41`; the chip, `:64`).
- **Durations.** An agent's run is `m:ss` (`h:mm:ss` from an hour) on every surface (`elapsedClock`, `mod/atlas-ui.ts:413`). A plan row's `ran` and `elapsed ... of` detail is `mm:ss` (`mod/hud.ts:99`, `mod/board-model.ts:66`).
- **Palette.** `PALETTE5` (`mod/atlas-ui.ts:405`): accent 141, ok 114, warn 179, error 203, neutrals 236, 240, 245, 252. In 256-colour output every surface is limited to those, the panel fills 234 and 235, and 231 as a fade's first step (`PALETTE_INDICES`, `mod/surface_indices.ts:24`, checked by `mod/critique26.test.ts:39`).
- **Done motion.** A done mark holds its first state `DONE_HOLD_MS = 1000` (`mod/motion.ts:29`), then three `MOTION_STEP_MS = 200` beats (`:23`); the timer runs at `MOTION_FRAME_MS = 100` (`:16`).
- **Host load rules.** The host drops the whole mod if `$` is assigned, stored, returned or spread, or if mod code has a `.json` import or a dynamic `import()` (`mod/host-load-rules.test.ts:228`, `:232`; `hooks/test_atlas_contract.py:1858`).

#### The band, 12.x history (superseded by the list above)

Since 12.2.0 the band is the "Mission Control" panel: a framed multi-row block above the prompt (`mod/band.tsx` `bandTree`), drawn only for the terminal surface in an interactive session with the mod on. `register.ts` hands it the snapshot, the `liveWorkers()` list, the gate groups, the column count, a row budget (`maxRows`) and the spinner tick. Rows, top to bottom:

- **Header rail**: brand pill, a phase rail over research, theory, test, implement, verify, done (`validate` and `blocked` are not drawn as rail stops), the `done/total` meter and the live worker count.
- **Worker lanes**: one lane per live worker with spinner, name, role, current tool and target, and an elapsed bar that fills over two minutes (`REF_MS`). MCP tools show their bare name (`band.tsx` `shortTool`: `mcp__lean-ctx__ctx_shell` reads `ctx_shell`); the target is the basename of `file_path` or `path`, else the first 40 characters of `command`, `pattern` or `query` (`data/orchestration.ts` `targetOf`). Workers that do not fit collapse into a `+N more` row.
- **Channel ticker**: the newest channel notes (2 rows, `TICKER_ROWS`).
- **Footer**: open gates and todos.

Width tiers: >= 120 columns full; 80-119 drops role and target from the lanes; < 80 draws the header row only. When `maxRows` is short, `planRows` drops lanes first, then the ticker, then the footer; hidden workers win over the ticker (the ticker row is traded for `+N more`).

Pane floor: the engine places an unasked pane only from 144 columns (`register.ts` `DOCK_MIN_COLUMNS = 144`); below that the band is the only always-on surface.

Look since 12.3.0: the band is a filled Catppuccin Mocha truecolor panel. The title bar is a gradient (scope, wave, elapsed, live count, context; no dollar cost since 12.4.0); the phase rail is chevron pills with a shimmering current pill that follows the live phase; each lane carries a state chip, a filled tool chip, an eighth-block elapsed bar and a per-worker tool-call sparkline (a ring buffer fed by `onToolStart` and by tool uses read from team pane logs). A lane keeps its last tool, dimmed, between calls. The ticker is an IRC-style feed with hashed nick colors; the footer is a tasks bar plus gate chips. An idle band is two rows.

#### Truecolor in tmux

When Claude Code runs inside tmux, set `CLAUDE_CODE_TMUX_TRUECOLOR=1` and `COLORTERM=truecolor` in its environment. Without them the band, cards and reply header are quantized to the 256-color palette.

Worker segment details (12.1.0). The spinner frame comes from the current phase (`theme.ts` `PHASE_FRAMES`: research, theory, test, implement, verify each have a 4-frame set; other phases use the default). The target is the file basename of the tool call's `file_path`, else the first 40 characters of the first line of its `command` (`data/orchestration.ts` `targetOf`), fitted to 16 cells. The age is `now - startedAt`, the time since the worker was first seen, not since its last tool call (`since` still moves every call). A worker whose state is `parked` is resting: it sorts after `working` and is excluded from the band's live list.

The phase comes from the last header in `turn.complete` (matched with the contract's `headerFirstLinePattern`), else the session's first `in_progress` item, else `research` (`register.ts:97-111` `headerPhaseOf`). The spinner tick (`spinnerTickState`) only advances while `liveWorkers()` has an active entry (`register.ts:529-536`), so an idle session redraws nothing.

### Transcript cards (12.2.0)

`mod/transcript/cards.tsx` holds pure tree builders that `restyle.tsx` wires into the ToolUse, ToolGroup and UserMessage sites; on `null` or a throw the site falls back to `next(e)`.

- **Worker card** (`workerCard`): an `Agent`/`Task` call to an `atlas:*` role renders as a card with the phase mark, worker name, role, the prompt's `GOAL:` line (else the description) and, when finished, the first line of the result.
- **Wave strip** (`waveTree`): a tool group of 2+ calls that are all atlas `Agent`/`Task` dispatches renders as a wave header plus one worker card per call, side by side when the width allows.
- **Channel bubble** (`bubbleTree`): a message another agent sent renders as a bar-edged `#atlas <from> > lead` bubble (up to 8 lines) instead of raw text.

Since 12.3.0 worker cards are filled stripe cards with a state chip and goal, now and finished rows (the finished row is the first result line; since 17.4.2 the label is `finished`, or `fail`, `failed` or `killed`, never `done`, and the label column width is defined once in `cards.tsx`); background-agent notification rows use the same style, and a background batch also gets a wave strip. The reply header is drawn as brand and phase pills with no pipe. Limit: the engine folds 2+ background dispatches into one "N background agents launched" row that a plugin cannot restyle; each result still shows on its own notification row.

### The sidebar (`mod/pane/sidebar.tsx`)

One `Pane` with id `atlas`. Placement: the pane docks itself, unasked, only on the first render that knows the viewport, only when the terminal is fullscreen and at least 110 columns wide (`register.ts:34,37` `DOCK_MIN_COLUMNS`, `shouldDock`, checked once via `paneChecked`); it opens undocked at `PANE_DOCK` (56 columns, auto rows). Everywhere else the pane stays closed until `/atlas-cc`, which opens a focused, closable 12-row inline pane (`register.ts:32` `PANE_ON_DEMAND`) and closes with Esc or the close mark (clearing `paneOpenedState` so `/atlas-cc` reopens it next time, `register.ts:636-639`).

**Tab strip** (`STRIP_TABS`, `mod/panel-layout.ts:28`). Six names only, `route  team  channel  gates  core  board`, at every width: the lit name bold accent with a one-row accent rule under it, the rest dim. The keys `r t c g k o` stay bound on the zero-width layer; a dim `keys  r t c g k o` line sits on the last spare row of a tall pane (`mod/panel-layout.ts:1060`). Exactly one view renders below the strip at a time (`sidebar.tsx` `VIEWS` map), switched by `on.setView`.

- **Route** (`mod/panel-layout.ts` `routeBody`; `pane/sidebar-route.tsx` `routeRows` is a one-line wrapper over `viewRows`). The rev 4 route tab: a `phase` row with the position on the numbered rail (`research 2/4`; a phase the rail does not know prints no position, `done` prints N/N), the `gates` summary, the `todo` gauge, the `agents` row of state counts, then one row per plan item with its state mark, word and (from 100 columns) owner and reason. A blocked item keeps its owner's mark and reason. Done items are listed at every width. Enter toggles a row's evidence line.
- **Team** (`mod/panel-layout.ts` `teamBody`; `pane/sidebar-team.tsx` `teamRows` wraps `viewRows`). The lead's own row first (`◉ lead  waiting  idle`; state from its mood, `pane/sidebar-roster.ts` `leadMood`), then every subagent by name with its state word, model, plan row and last action, then roster members the squad does not list (`queued`, their last words), then the lead's tally last (`lead  1 queued · 1 running · 2 done · 1 failed`, running always shown, zero counts dropped). Other sessions' leads and workers resting for over two hours are left out (`sidebar-roster.ts` `mates`). The state word is the one from `mod/data/live.ts` `liveState`, the same on the HUD, the band and this tab: a worker that has made no call yet reads `queued` for 90 seconds, then `running`. A message `Input` (`▸ to <recipient>`, Enter sends) sits below the table (`inputEl` in `pane/sidebar-paint.tsx`).
- **Channel** (`mod/panel-layout.ts` `channelBody`; `pane/sidebar-channel.tsx` `channelRows` wraps `viewRows`). An IRC-style log: header `#<channel>  N people[ · M unread]` (`1 person` singular, `#channel` when the board names none; unread counts the notes after the lead last spoke, every note when it never did), then one row per recent board note (`HH:MM` from 50 columns, `--:--` for a bad timestamp; the nick column is as wide as the widest nick, 4 to 10 cells below 100 columns and up to 18 from 100, cut with an ellipsis; a `▲ blocked` / `● handoff` / `● done` mark or `▸ <recipient>` when not to all; the text on one line), then the same message `Input`. The people count includes live workers from `liveWorkers()`.
- **Gates** (`pane/sidebar-gates.tsx` `gateRows`). One summary row per gate group (`✗`/`✓` mark, title, `N open`/`ok`, a tail of the first failing fix or detail). Enter expands a group into its lines; Enter on an open line with a fix copies the command (`on.copy`).

**Gate sources.** `scripts/atlas_gates.py --session <id> --root <repo> --json` prints three independent groups — completion, tripwire, routing; an exception in one group sets that group's `error` and the others still print. The completion group calls `completion_gate.evaluate()`, the same function the Stop hook uses. `runGates` (`register.ts:391-405`) runs it at session start, on a 30 s clock (`GATES_MS`) and after answer turns, and `parseGates` (`mod/gates.ts:28`) validates the shape; a missing script, nonzero exit or bad JSON becomes one error group (`gatesError`). The `header` group is not from the script: it is built in `mod/gates.ts:38-50` `headerGroup` from the last answer's header match, recorded by `mod/discipline.ts`.

**`$.state` keys** (atoms declared at `register.ts:51-66`; handlers and ticks write, render hooks only read): `sidebarRecipient`, `sidebarExpanded`, `sidebarDraft`, `atlasView` (the active `SidebarView`), `gates` (script groups) and `lastHeader`.

### Restyled built-in sites (`mod/restyle.tsx`)

- **`AssistantMessage`** (`restyle.tsx:153-182` `assistantTree`) draws the contract header verbatim on one styled row — ` ATLAS ` (inverse brand chip) `| <phase label>[ n/m]` (phase-colored) ` | <sentence>` (fit to the remaining width) — when the reply's first line matches `headerFirstLinePattern`; the pipes are kept. A reply whose first line does not match is left to the engine's own default render (no header row is drawn).
- **`Spinner`** becomes a braille-globe frame next to the phase capsule; when any squad member is `running`/`spawning` it appends a live agent count and that agent's current task.
- **`ToolUse` for `Agent`/`Task` on atlas personas** becomes a deployment card tracking `$.agent.list()` status live. A finished `Bash`/`Read`/`Grep` call whose output is 8000 bytes or more collapses to a one-line `<tool> <target> ▸ <size>` summary instead of drawing the raw output.
- **`TurnDuration`** becomes a one-line receipt: duration, phase move, completions this turn, live agent count and context fill. Since 12.4.0 the receipt shows no dollar cost and no token count (the engine exposes no per-turn token count).
- **`PromptHint`** shows contextual chords (`/atlas-cc Command Center · /atlas-say @name …`).
- Toasts for a subagent completed or failed, a note to the lead, a todo completed, fired on answer-turn boundaries (`mod/notify.ts` `registerNotify`). An opt-in sound pack (`atlas_mod_sound`, off by default) ships its assets in `mod/fx/`.

### Context discipline (`mod/discipline.ts`)

Gated by `ATLAS_MOD!=off` plus an interactive session; every hook fails open and only ever adds model-only context or a rate-limited toast. Wired by `registerDiscipline(on, { reinforce })` in `register.ts`. The `reinforce` line is `atlas contract: open replies with <headerTemplate> (phase: <phase>)` from `reinforceLine`; it carries the template from the operating contract, not the regex:

- **Heavy inline calls.** A `Read`/`Grep`/`Glob`/`Bash` call whose tool-result text is 4000+ characters, with no `Task`/`Agent` dispatch yet this turn, counts as one heavy inline call; the 4th in a turn toasts a delegate-to-role suggestion.
- **Contract drift.** A first line that does not match `headerFirstLinePattern` toasts a missing-header warning. The phase is read with the shared parser `headerPhaseOf` (`mod/restyle.tsx`).
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

**`mod/data/live.ts` `liveWorkers(snapshot, now)`** is the one worker list every surface reads: squad minus the lead, each resolved to `working`/`blocked`/`failed`/`done` from its activity mood and agent state, sorted blocked-and-failed first. `band.tsx` reads it for the band's worker chips and `activeCount()`; `sidebar-route.tsx` reads it for `blockedReason`; `sidebar-model.ts` reads it for the Team tab; `sidebar-channel.tsx` reads it for the live nick count. No surface keeps its own copy.

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

Source of truth is `agents/*.md` frontmatter (14 agents; all set `model`, `effort` and `color`). The mod copies the frontmatter value; it never keeps a second table.

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
|   |-- sidebar-team.tsx    #   team wrapper over viewRows (rows come from mod/panel-layout.ts teamBody)
|   |-- sidebar-roster.ts   #   mates(): lead first, squad, roster strangers; stale and other-lead cuts; leadMood, teamSummary
|   |-- sidebar-model.ts    #   panelModelOf: snapshot -> PanelModel (lead row, roster, gate text scrubbed)
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

## Failure reporting and the core report (17.4.1)

- **Failures are visible.** `reportFailure` (`mod/register.ts`) writes the debug log and shows one toast per distinct message, cut at 200 characters. Toast texts: `atlas: boot failed: ...`, `atlas: rebuild failed: ...`, `atlas: <component> <module> <phase>: <reason>` (a `ui.fault`, a tree the host refused), `atlas: core tick failed: ...`. A new boot clears the set, so a new session toasts again.
- **Header pill.** `headerPhaseOf` in `mod/restyle.tsx` is the only header parser (`register.ts` re-exports it). It returns no phase, and so no pill, when `headerFirstLinePattern` is empty, the first line does not match, or the phase is not one of the eight. The pill never falls back to the snapshot phase.
- **Todo board read errors.** A `todos.json` that exists but is corrupt or unreadable keeps the last good rows and toasts `atlas: todos.json is corrupt, showing the last good board` (or `unreadable`). A missing file is an empty board (`mod/data/todos.ts`).
- **`/atlas-core`.** One finding counts once, by its latest entry (`latestPerId` in `mod/data/core.ts`). The line reads `VERDICTS  <n> findings: <v> verified, <r> refuted, <o> open  |  <c> claims this run, <u> unchecked`. Entries without `id` or `title` use `batch` and `claim`. Row caps in `mod/core-row.ts`: 12 verdict rows (refuted and open first), 3 unchecked rows, 8 worker rows, then `... N more`.

## Honesty and known defects

- **Claude-Code-only.** Both surfaces are drawn by the `ui.render` mod dispatch on the `AbovePrompt` and `Pane` components. omp has no such vocabulary and keeps its own `atlas-channel` widget (`omp/channel-view.ts`).
- **Fullscreen docked placement** (>= 110 columns, fullscreen terminal) is exercised by `shouldDock`'s unit tests; a live capture of the docked pane itself (as opposed to the inline `/atlas-cc` pane) is not in `.atlas/evidence/`.
- **`/clear` fix not observed live.** The reboot on `classic.SessionStart` is verified with the mod test kit (`mod/register-clear.test.ts`); the render after `/clear` in an installed terminal has not been observed.
- **Native subagent rows** at the bottom of the terminal are drawn by the host and cannot be restyled; only the atlas cards in the transcript are ours.
- Live evidence of the redesigned surfaces: `.atlas/evidence/mod-cc-2026-10-13/live-160x45.md` (band, team awaiting-reply row, idle band, header pill, pane tab strip at 100x30).

## See also

- `docs/architecture/atlas-colony.md` — the herdr colony
- `docs/architecture/atlas-channels.md` — channel names, registry and delivery rules
- `docs/architecture/atlas-workboard.md` — the browser Command Center (dashboard) the mod complements
- `docs/architecture/atlas-harness-parity.md` — the harness parity matrix, including the Claude mod vs omp widget row
- `docs/plans/2026-10-13_atlas-command-center-redesign.md` — design plan, decisions and stage history

## Changes in 12.4.0

- **Band controls.** The band footer is a row of clickable Buttons `r: route  t: team  c: channel  g: gates  o: board`. route, team, channel and gates open the pane on that view; board toggles the todo panel. The hint reads "click or ctrl+x Tab, then r t c g o" (the engine needs ctrl+x then Tab). The pane hint lists only existing keys. Verified under tmux with `CLAUDE_CODE_NO_FLICKER=1`; not yet verified in the default inline mode. Superseded in rev 4 (2026-11-11): the footer is six buttons from `STRIP_TABS` (`r t c g k o`, see "Rev 4" below) and `o` opens the board.
- **Role characters.** Each role has a 3-cell face (role eyes, state mouth). running cycles 5 frames, thinking 3, done, failed and blocked one frame. Faces draw in Claude band lanes, omp lanes and the tmux pane header (4 Hz redraw). A Python mirror test guards drift.
- **Board panel.** Collapsed: one animated violet-to-teal progress bar row with done/total and the active item. Expanded: one row per item (state glyph, owner, evidence, "+N more"). Toggle with `o` or the board button; on Claude Code the HUD always shows the TODO tree and the board has its own pane. Each atlas dispatch creates a board item; a valid `STATUS: DONE` report completes it with its evidence; `BLOCKED` or `FAILED` marks it `blocked` (new status). Superseded in rev 4 (2026-11-11): the board is the rev 4 Board (`mod/board-model.ts`), and `o` draws it inside the shown Atlas pane or opens the `atlas-board` pane.
- **Look (theme, colour, ASCII).** Every surface (HUD, band, side panel, board, toasts, cards, notifications) gets its `Ui` from the one `$.env` read in `mod/look.ts` (`lookOf($)`: `ATLAS_THEME`, `COLORFGBG`, `ATLAS_ASCII`, locale, `NO_COLOR`, `COLORTERM`, `TERM`, `ATLAS_BAND_RICH`), computed once and cached until `clearLook()` at boot. The process-env `hostEnv()` is only the fallback for a bun/omp host that has no `$`. `mod/register-look.test.ts` proves `NO_COLOR` and `ATLAS_ASCII` reach the side panel and the board under the kit, where no process global exists.
- **Cost.** No dollar cost appears in the band title, idle summary, turn receipt or omp panel.

## Rev 4 terminal UI (2026-11-11)

Matches the code at its date (superseded in part by "Terminal UI as shipped" above); the design record is `docs/specs/2026-11-10_atlas-terminal-ui.md`. Where an older section above
disagrees (the one-row band, `mission-layout.ts` runs, a fixed 26-cell board state column, the `starting` worker state),
this section wins. Paths are under `plugins/atlas/`.

- One phase rail: `mod/rail.ts` (`railIds`, `railOf`, `railNo`; `RAIL_SKIP` drops `validate`, `blocked`, `done`) is used by the band (`mod/band.tsx`), the side panel model (`mod/pane/sidebar-model.ts`), `mod/panel-layout.ts` and the omp mission panel (`omp/mission-panel.ts`).
- Gauges: `of mm:ss` and the elapsed gauge are drawn only for an item with `estimate_s` (`mod/board-model.ts`, `mod/hud.ts`); otherwise `elapsed 00:42`, no gauge.
- Tab strip: `STRIP_TABS` in `mod/panel-layout.ts` (route, team, channel, gates, core, board; keys `r t c g k o`) feeds the Claude Code strip (`mod/pane/sidebar.tsx`), the omp painter (`omp/panel-view.ts`) and the band buttons (`BAND_BUTTONS`, `mod/band.tsx`).
- Board key `o`: `openBoard` (`mod/register.ts`) draws the board inside the Atlas pane when it is shown (view `board`, a second press returns to the route); otherwise it opens the `atlas-board` pane.
- Compact board (60 to 99 cells): the state column fits the widest label (`stateCol`, `mod/board-model.ts`).
- HUD Subagents block (`mod/hud.ts`): with nothing running, a done agent stays `LINGER_MS` (15 s, exported from `mod/atlas-ui.ts`, shared with the band); a failed agent stays until cleared.
- Channel roster (`mod/data/channels.ts`): when no candidate key matches the lead, it falls back to the project's main channel key (`<folder>` or `<folder>@<ref>`). The Route tab lists running agents that own no plan row (`mod/panel-layout.ts`).
- Widths are terminal cells: `cells`, `clip` and `clipMiddle` (`mod/atlas-ui.ts`) use `textWidth` (`mod/theme.ts`), so wide characters count as two.
- The `[-]` beside the TODO block is the host's collapse mark (`bodyColumns` reserves its cells). The plugin cannot remove it.
- omp `paintPanel`, `paintCard` and `paintToast` (`omp/panel-view.ts`) are UNMOUNTED: nothing in omp calls them.
