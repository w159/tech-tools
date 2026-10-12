# Atlas mod (Claude Code)

Last verified against the source tree on 2026-10-12 (the unreleased atlas line; `plugins/atlas/CHANGELOG.md` Unreleased > Mod: native sidebar): `claude plugin test plugins/atlas` passes 309 tests across the mod test files. The full plugin walk also reports 169 failures, all pre-existing `plugins/atlas/colony/**` or `plugins/atlas/omp/**` files importing `bun:test`, which the plugin test host forbids (those suites stay on `bun test`). Live render is verified on 2026-10-12 in a Claude Code 2.1.296 session: ctrl+x tab focuses the sidebar, Tab and arrows walk its rows, Enter sends a note (`.atlas/evidence/mod-native-sidebar-2026-10-12/`). Fullscreen docked placement is not yet live-verified. Paths are relative to `plugins/atlas/` unless they start with `docs/`.

The mod was redesigned in 11.0.2 to 11.0.4 around `Client` panes and then replaced, in the unreleased line, by native elements: one docked sidebar and a one-line band. The Client panes (colony, squad, board, channel, collab, orchestra, sprites), the `/atlas-sprites` command and the Client props budget (`mod/props.ts`) were removed. Restyles, context discipline, agent identity labels, the orchestration data plane and the isolated-worker workflow below are unchanged by that replacement. Every section below is read from the current `mod/` source tree.

The Atlas mod is an in-process UI plugin module for Claude Code mods (Claude Code 2.1.287+). It brings the operating-contract route, the persona roster, the durable TODO board and a message field to the lead channel into the Claude Code terminal, with Atlas branding. It is the Claude-side twin of the omp channel widget (`omp/channel-view.ts`, `ATLAS_CHANNELS=off`); omp is a separate harness and stays as it is. The browser Command Center (`docs/atlas-workboard.md`) remains the browser front door; the mod is the in-terminal view.

Design rationale and decision log: `docs/plans/2026-10-09-atlas-mod.md`.

## Requirements and activation

- Claude Code 2.1.287 or newer (mods). On older versions the `modules` key is ignored and the rest of the plugin keeps working.
- The mod is wired by the `modules` entry in `hooks/hooks.json` (`hooks/hooks.json:192`, `"../mod/register.ts"` — the validator resolves `modules` paths hooks/-relative), in the same file as the existing 21 hook bindings. `register(on, options)` in `mod/register.ts` is the entry point; `claude plugin validate --json plugins/atlas` passes (success true, 0 errors).
- The mod runs in-process. Hook modules get no Node APIs: every file, process and network call goes through the mods `$` API. Pure logic modules take an injected `FsLike` (see `mod/contract.ts`) so they stay testable without a live session.
- Lifecycle: the mod loads at session start and opens the docked sidebar without taking the keyboard (`register.ts:535-537`); `/atlas-cc` focuses it, reopening it if it was closed. The band is always on. The early-wave `logo.ts` (pixel logo) was deleted.
- Where it runs: the CLI and the Desktop Code tab. Rendering is text-first everywhere; `Raster`/`Image` are not used by the mod. `claude -p` and the Agent SDK run mod hooks but draw nothing, so every `ui.*` call no-ops cleanly there — the persona routing below still applies in headless workers.
- Kill switch: `ATLAS_MOD=off` disables the mod (band, sidebar, restyles, routing), matching `ATLAS_CHANNELS=off` for the omp widget. The plugin's hooks and CLIs are unaffected.

## Surfaces

## Surfaces

Both surfaces are drawn with native elements (`$.ui.resolve(e)` from the `ui.render` hooks in `mod/register.ts:584-607`), not `Client` surface modules. A `Client` only receives keys after a mouse click, so in a live Claude Code 2.1.296 session ctrl+x tab could not focus the earlier Command Center pane and its tab hotkeys typed into the prompt. Native Buttons and Inputs join the engine focus ring. Live check: `.atlas/evidence/mod-native-sidebar-2026-10-12/` (`live-gates-and-input.txt`, `live-after-polish.txt`, `board-note.jsonl`).

### The band (always on)

One native line above the prompt, `Atlas  <phase> n of m   N working   N gates open` (`mod/band.tsx:14-21` `bandTree`), drawn only for the terminal surface in an interactive session with the mod on (`register.ts:584-588`). `n of m` is `routeCounts(s.todoGroups, s.contract)`, the same tasks the sidebar route shows; `N working` counts squad agents in state `running` or `spawning`; `N gates open` is `openGateCount` over the gate groups (`mod/gates.ts:43-44`). Runs are cut to `props.bodyColumns` with `fitText` (`band.tsx:22-29`).

The phase comes from the last header in `turn.complete` (matched with the contract's `headerFirstLinePattern`), else the session's first `in_progress` item, else `research`. Usage figures (tokens, cost, context fill) are held per-figure nullable in `$.state` (`usage`, `null` means not measured yet) and feed the snapshot; the band line itself no longer prints them.

### The sidebar (`mod/pane/sidebar.tsx`)

One docked `Pane` with id `atlas` (`PANE_OPEN = { id: 'atlas', title: 'Atlas', columns: 44, rows: 32 }`, `register.ts:33`), drawn with Claude Code theme keys (`chartRoom` in `mod/theme.ts` maps roles to `subtle`, `claude`, `suggestion`, `success`, `error`, `warning`, `promptBorder`; body text takes the terminal default), so it reads on light and dark themes. No hex colors are used. Sections are frameless and separated by one blank line; there are no badge chips, portraits or speech bubbles. It opens at session start without taking the keyboard (`register.ts:535-537`), and the host seats it docked only when the terminal is fullscreen and wide enough. `columns`/`rows` are a size request, not a grant: `sidebarTree` lays out to `props.bodyColumns` and `props.scroll.bodyRows` (`register.ts:595-604`). Sections, top to bottom (`sidebar.tsx:259-281` `sidebarTree`):

- **Route.** Header `Atlas  <phase>, D of T done`, then a compact route line `◆━━━━◆━━━━◉────○` (◆ passed, ◉ current, ○ upcoming; fixed 4-column segments, not stretched) and one plain label row of the contract phase names with the current one bold (`routeLines`, `sidebar-route.tsx`).
- **Tasks.** One row per task: status glyph (✓ ◉ ○ ✗), phase name on the first task of a phase only (every row keeps its own glyph), title, owner (muted). Phases without tasks are not listed; with no tasks at all a faint `nothing planned`. Each row is a Button; Enter toggles its evidence (`taskRows`, `sidebar-route.tsx`).
- **Team.** The lead plus this session's members, capped by pane height (6 rows at `rows >= 30`, 4 at `>= 20`, else 2; the rest fold into `+N more`, `teamCap`, `sidebar.tsx:153`). Header `Team` with a right-aligned muted `lead is conducting N` or `lead is idle`. Rows are `▸` on the selected member (two spaces otherwise), name, current tool or `idle`, elapsed right-aligned. Each member is a Button that selects the message recipient (press again to deselect; the lead is the default). An empty team shows one line on how to dispatch. Under the list is an `Input` ("type a message, Enter sends"); Enter posts a note to the selected member or the lead (`sidebar.tsx:183-189`).
- **Gates.** Header `Gates` with a right-aligned `N open` (error color) or `all clear` (success color), then one row per gate item (✗ or ✓ plus short text) across completion conditions, inline-op tripwire, tool routing and last-reply header. Enter on a row shows its detail and fix command; Enter on an open row that has a fix copies the command (`gateRows`, `sidebar.tsx:196-234`).
- **Advisor notes.** Frameless, below Gates: header with a right-aligned count, the two most recent notes, with a `+N more` row (`ADVISOR_SHOWN = 2`, `sidebar.tsx:236-252`).

Keys: ctrl+x tab focuses the sidebar, Tab and the arrow keys walk its rows, Enter acts on the focused row. `/atlas-cc` opens the sidebar with `focus: true` and it stays until the person closes it (Esc or the close mark); closing clears `paneOpened` so `/atlas-cc` reopens it (`register.ts:610-621`). There are no tabs, no digit hotkeys and no tab argument.

**Messaging.** `sendNote` (`register.ts:424-447`) builds the same `{t:'note'}` intent `/atlas-say` uses, resolves it with `intentToArgv` (`mod/intents.ts`) and runs `atlas_todo.py note` through `$.process.run`. On success it clears `sidebarDraft` and toasts `Sent to <who>`; on a missing board or a nonzero exit it toasts the reason and keeps the draft.

**Gate sources.** `scripts/atlas_gates.py --session <id> --root <repo> --json` prints three independent groups, completion, tripwire and routing (`atlas_gates.py:108` `tripwire_group`, `:156` `routing_group`, `:190-191`); an exception in one group sets that group's `error` and the others still print. The completion group calls `completion_gate.evaluate()` (`atlas_gates.py:93`), the same function the Stop hook uses. `runGates` (`register.ts:402`) runs it at session start, on a 30 s clock (`GATES_MS`) and after rebuilds, and `parseGates` (`mod/gates.ts:10`) validates the shape; a missing script, nonzero exit or bad JSON becomes one error group (`gatesError`). The `header` group is not from the script: `mod/discipline.ts:146-153` tests the first line of each answer turn against `headerFirstLinePattern` and stores `{matched, phase}` in `lastHeader`; `headerGroup` (`gates.ts:27`) renders it as "Last reply header matched".

**`$.state` keys** (atoms declared at `register.ts:53-57`; handlers and ticks write, render hooks only read): `sidebarRecipient` (selected member or `null` for the lead), `sidebarExpanded` (the one expanded task, group or gate key, or `null`), `sidebarDraft` (message text), `gates` (script groups) and `lastHeader` (header check, also declared in `discipline.ts:42`).

**Not live-verified.** Fullscreen docked placement has not been observed: the live captures above are the inline pane in the classic renderer. Whether the host seats the pane docked beside a fullscreen transcript is documented behavior (`register.ts:30-32,535`), not an observation.

### Restyled built-in sites

- **`Spinner`** (`mod/restyle.tsx` `spinnerTree`) becomes an 8-frame braille globe (`⠋⠙⠹⠸⠼⠴⠦⠧`, 120ms/frame) next to the phase capsule and a progress bar; when any squad member is `running`/`spawning` it appends a live agent count (`N agent(s)`) and the first such agent's current task.
- **`ToolUse` for `Agent`/`Task` on atlas personas** (`toolUseTree`) becomes a deployment card — `▸ <name> <persona> <model>·<effort> · <status>` — that tracks `$.agent.list()` status live: spawning, running, waiting (input), completed, failed, killed. A finished `Bash`/`Read`/`Grep` call whose output is 8000 bytes or more (`NOISY`, `NOISY_BYTES`) collapses instead to a one-line `<tool> <target> ▸ <size>` summary (`noisyTree`) rather than drawing the raw output.
- **`AssistantMessage`** renders its header line as a coloured phase pill with `n/m`. A reply with no header gets a dim "inferred" pill.
- **`TurnDuration`** becomes a one-line receipt (`durationTree`): duration, phase move, completions this turn, live agent count, the turn's own tokens from `turn.complete` usage (`12k in / 1k out (+5k cached)`), context fill as `ctx N%`, and this turn's cost as `turn $X`: the engine's session cost (`$.session.usage().cost.usd`) at the end minus its value at `turn.start`. No dollar figure is drawn when the host keeps no cost ledger; atlas has no price table and never estimates cost.
- **`PromptHint`** shows contextual chords (`/atlas-cc Command Center · /atlas-say @name …`); `$.prompt.suggest` offers the next contract step after a turn, which the user takes with Tab.
- Toasts for a subagent completed or failed, a note to the lead, a todo completed. They fire on answer-turn boundaries: `mod/notify.ts` registers `on('turn.complete', { reason: 'answer' }, …)`, wired in `mod/register.ts` as `registerNotify(on, { getSnapshot, soundEnabled })`. An opt-in sound pack (`atlas_mod_sound` in `.claude-plugin/plugin.json`, off by default, read as `options.atlas_mod_sound === true`) ships its assets in `mod/fx/`.

### Context discipline (`mod/discipline.ts`, new in 11.0.2)

Gated by `ATLAS_MOD!=off` plus an interactive session; every hook fails open (a throw never blocks a tool, prompt or answer) and only ever adds model-only context or a rate-limited toast — it never rewrites what the user typed. Wired by `registerDiscipline(on, { reinforce })` in `register.ts:275`:

- **Heavy inline calls.** A `Read`/`Grep`/`Glob`/`Bash` call whose tool-result text is 4000 characters (`HEAVY_CHARS`) or more, with no `Task`/`Agent` dispatch yet this turn, counts as one heavy inline call. On the 4th (`HEAVY_LIMIT`) in the same turn, Atlas toasts `atlas: 4 heavy inline <Tool> calls — delegate to <role>` (Read/Grep/Glob -> `atlas:explorer`, Bash -> `atlas:runner`); at `turn.complete` it also calls `$.prompt.suggest({ text: "Dispatch <role> to do that reading and return only findings" })` if the turn still never delegated. A turn that grew the context by 30,000 tokens or more (`BIG_TURN_TOKENS`) inline, with at least one heavy call and no delegation, gets a second toast naming the tokens added. A `Task`/`Agent` call resets the heavy counter for the rest of the turn.
- **Contract drift.** If the session's `headerFirstLinePattern` does not match the first line of an answer turn, Atlas toasts `atlas: reply is missing the ATLAS | <phase> | <state> header`.
- **Toast rate limit.** Every toast above shares one 30-second minimum gap (`TOAST_GAP_MS`): whichever rule fires first in that window wins, the rest are silently skipped until the gap passes.
- **Vague-prompt sharpening.** A composer prompt at or under 60 characters (`VAGUE_MAX_CHARS`) and 8 words (`VAGUE_MAX_WORDS`), with no path-like token, file extension, digit, quote or acceptance word (`test`/`should`/`must`/`until`/`expect`/`passes`), gets an `atlas facts: repo <root>; branch <b>; phase <p>; open todos: …` line appended to the model's context for that turn only (`prompt.submit`'s `context` array) — the text shown to the user, and sent to the model as the visible prompt, is unchanged.
- **Test coverage.** `discipline.test.ts` covers `isVague`, `factsLine` and the hook wiring. The delegation-suggestion toast (heavy-call limit -> `$.prompt.suggest`) is exercised only by that unit test; it has not yet been observed in a live session.

## Data plane

All data is read from `<root>/.atlas/.run/`; the mod itself writes nothing to disk. `root` is `ATLAS_PROJECT_ROOT` if set, otherwise the nearest ancestor containing `.atlas` (the same `boardRoot` rule as `omp/channel-view.ts:74`).

| Surface | Source | Read rule |
|---|---|---|
| TODO board | `todos.json` `{version, items[{id, content, status, owner, session_id, phase?, archived, evidence}]}` | Filter `session_id == $.session.id()` and `!archived`, plus in-progress items owned by channel members. Phase comes from `phase` or the `[<phase>] ` content prefix. The file is replaced atomically, so the reader polls `stat` mtime, never per frame |
| IRC channel | `board/<owner>.jsonl` lines `{ts, seq, owner, to, item, text, channel, kind?, delivery?}` | Filter `channel == <lead channel>`, sort by `seq,ts`, keep a per-file byte cursor from `stat.size`. The viewer never calls `atlas_todo.py inbox`, which drains the lead's mail |
| Channel roster | `channels.json` `channels[name].members[{name, role, pane_id, pid, ended_at, exit_code}]` | The lead channel is the entry whose `lead` equals `lead-<first 6 of the session id>`, else `<folder>@<branch>` |
| Colony panes | herdr unix socket (unreachable from `$`) | `$.process.run(['python3', <plugin>/scripts/atlas_herdr.py, 'status'])` every 5 s, only after the sidebar has been opened (`paneOpened`) |
| In-session subagents | `$.agent.list()` plus `agent.spawn`/`turn.complete` events | Native; the primary source for Task subagents. `register.ts` re-syncs the squad from `$.agent.list()` (d.ts `EngineInterface.agent.list`, lines 3180–3187; `AgentInfo.status`, line 545) on every rebuild, so host-spawned agents appear even when their `agent.spawn` event was missed; status maps to band states (`pending`→`spawning`, `waiting`→`input`, `completed`→`finished`, `killed`→`dead`) and unknown statuses read `running` |
| Personas | `agents/*.md` frontmatter (`model`, `effort`, `color`) | Read once at session start; the single source, no copied table |
| Contract | `contracts/operating-contract.json` (`phases[].id/glyph`, `todoPhases`, `headerFirstLinePattern`) | Track order and the header regex |
| Orchestration (new 11.0.3) | `agent.spawn`, `tool.call` start/end, `turn.step`, `turn.complete` host events, folded by `mod/data/orchestration.ts` `deriveOrchestration` with `channels.json` members/notes, `.atlas/.run/findings.json` and `python3 scripts/atlas_wt.py status` JSON | Per-agent activity (tool, elapsed, mood, last line), the comms log, the squad count behind the band's `N working`, each worker's lifecycle stage, and the measured bytes of tool output kept out of the lead's context (`savings.keptBytes`; no token or dollar conversion) |
| Worker sessions (`sessions`, new 11.0.4) | In-session subagent transcript tails (`<home>/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl`, last `TAIL_BYTES=131072` bytes read with `tail -c`, parsed by `mod/data/sessions.ts` `parseTranscript`) merged with `python3 scripts/atlas_mux.py status` worker rows (`parseMuxStatus`), de-duplicated by name (first source wins, `mergeSessions`) | Session data only; the Colony multiplexer view that rendered it was removed with the Client panes; each `Session` carries `transport: 'subagent'\|'claude-bg'\|'tmux'\|'herdr'`, `state`, `since` and up to 4 tail lines (each clipped to 120 chars, ANSI stripped) — covered by `data/sessions.test.ts` fixture strings, not a live running background session |
| Todo groups and contract progress (`todoGroups`, `contractProgress`, `backlog`, new 11.0.4) | `todos.json` re-sliced by `mod/data/todos.ts` `groupTodos` (groups by contract phase, unphased items to `phase: 'unsorted'`/`dept: 'UNSORTED'`, live items first within a group) and `contractProgress` (done/total per phase, **this session's** todos only) | the sidebar's Tasks section (`todoGroups`) and the band's `n of m` (`routeCounts`); `backlog` is the separate global done/total count for the Board's collapsed-items line and is never read by the pill |
Merged member state reuses the dashboard states (`scripts/atlas_dash_colony.py`): `running`, `idle`, `stuck` (15 minutes silent with an open todo), `parked`, `finished`, `dead`, plus **input** from herdr's blocked state. Missing files fail open: a surface renders empty rather than erroring. Liveness itself comes only from the host agent list, never from the lead's own turn state — a background worker keeps running after the lead's turn ends, and `syncAgentsFromList` only marks a spawn-recorded entry the host no longer lists as `finished` once its `agent.spawn` time is older than `SPAWN_GRACE_MS` (15 s, `register.ts:85`) — an unlisted entry inside that window is presumed still starting up, not gone.

**Agent identity labels.** `syncAgentsFromList` (`register.ts:159-195`) names each squad row by the first of: the name recorded at `agent.spawn` (`e.name`, threaded through `routing.ts:85`'s `onSpawn` call into `Orch.meta[id].name`), else the teammate id's local part before `@`, else the recorded or type-inferred persona — skipped when the persona is `unknown` or the generic `general-purpose` host type, so a dispatch that never got a real persona falls through instead of showing that label — else the first 3 words of the Agent call's task description (`slugOf`), else the persona again, else the lowercased agent type (`typeLabel`), else the agent id's first 6 characters as a last resort; a 4-char id suffix is appended when two rows would otherwise share the same label.

**Rebuild fingerprint.** `rebuildTick` redraws only when `dataFingerprint` (`register.ts:172-195`) changes, on a 1.5s poll. As of 11.0.2 the fingerprint covers, besides the `todos.json`/`channels.json`/board-note `stat` signatures: the host agent list (`$.agent.list()` `id:status` pairs, so a subagent finishing — which writes no file — still triggers a redraw), the live usage state, the header-derived phase, and the header-miss counter.

## Isolated-worker workflow (`scripts/atlas_wt.py`, new in 11.0.3)

One git worktree and branch per parallel `atlas:implementer` dispatch, so concurrent writers never collide in the main working tree. Naming contract: branch `worker/<agent>`, worktree `.atlas/wt/<agent>` (repo-root relative). The script never pushes, never force-deletes a branch, never resets, and never touches the main tree outside the merge itself; every refusal exits 1 with the exact reason on stderr (`scripts/atlas_wt.py:1-20`).

- `add <agent> [--base main]` — creates (or reuses, idempotently) the worktree and branch.
- `status` — prints a JSON array, one row per `worker/*` branch: `{agent, branch, worktree, head, ahead, behind, dirty, verified_finding, merged}`. This is the same JSON `mod/data/orchestration.ts` `parseWt` reads for the Colony/Channel lifecycle and merge-queue display.
- `merge <agent>` — refuses unless `.atlas/.run/findings.json` holds a `verified` entry whose title or evidence names the branch or agent, refuses on a dirty worktree or zero commits ahead; otherwise does a `--no-ff` merge, removes the worktree, deletes the branch, and aborts cleanly (restoring the tree) on a merge conflict.
- `prune` — runs `git worktree prune`, then deletes branches that are fully merged with no worktree left.

**Protocol** (`agents/implementer.md` Worktree dispatch; `skills/atlas-orchestrate/references/implementation-units.md` Worktree protocol section): the lead runs `atlas_wt.py add <name>` per parallel implementer before dispatch; the dispatch brief names the worktree path as the only place that implementer edits, tests and commits (it `cd`s there first, confirms `git rev-parse --abbrev-ref HEAD` is the named branch, commits only unit-scoped files, never touches the main tree, never merges, never pushes); the lead dispatches one `atlas:verifier` per branch against that worktree; only after a `verified` finding does the lead run `atlas_wt.py merge <name>`, one branch at a time, then rerun tests once on the merged tree.

**Enforcement.** `hooks/completion_gate.py` condition (q) (`_unmerged_worker_branches`, `completion_gate.py:777-831`) blocks "done" while `atlas_wt.py status` reports a `worker/*` branch with unmerged commits or a dirty worktree, naming "unmerged worker branches; verify each, then atlas_wt.py merge <agent>". `ATLAS_WT_GATE=off` disables it; the condition fails open on any internal error.

## Personas, models and effort

Source of truth is `agents/*.md` frontmatter (13 agents; all set `model`, `effort` and `color`). The mod copies the frontmatter value; it never keeps a second table.

| Task type | Persona | Model | Effort (Claude) |
|---|---|---|---|
| Mechanical edit, at most 7 exact STEPS on at most 5 files | `atlas:runner` | haiku | low |
| One bounded implementation | `atlas:implementer` | sonnet | low |
| Explore / map code | `atlas:explorer` | sonnet | low |
| Stage plan | `atlas:planner` | sonnet | low |
| Adversarial verify | `atlas:verifier` | sonnet | medium |
| Pre-done completeness audit | `atlas:completeness-critic` | sonnet | medium |
| DB RLS / grants audit | `atlas:rls-privilege-audit` | sonnet | medium |
| DB probe | `atlas:db-prober` | sonnet | low |
| DB catalog dump | `atlas:schema-inventory` | haiku | low |
| Naming audit | `atlas:naming-glossary-audit` | haiku | low |
| UI runtime test | `atlas:ui-runtime-tester` | sonnet | low |
| Post-ship docs | `atlas:docs-curator` | sonnet | low |
| Docs drift audit | `atlas:docs-auditor` | haiku | low |
| Department work | `armada-<dept>` | inherit (unpinned) | inherit |
| Architecture, synthesis, final judgment | main thread | opus | high |

On omp the same agents carry a `thinkingLevel` (the policy page is `skills/atlas-orchestrate/references/squad-and-tiers.md`); `atlas:implementer` is `low` in frontmatter but `medium` in `omp/atlas-agents.ts`. Nothing in the sidebar flags that mismatch now.

How the mod applies the matrix:

- `agent.spawn`: for `subagentType` `atlas:<role>`, records the agentId→persona mapping; the model passes through untouched (the agent definition's own frontmatter pin decides it). Forks are skipped, and an explicit non-inherit model on a known role is never rewritten. Per-call model overrides on `atlas:*` stay denied by `hooks/dispatch_tripwire.py`; the mod adds no second gate.
- `turn.step`: when the agent maps to a persona, `next({...e, effort: <frontmatter effort>})`. Normal atlas spawns already get their frontmatter effort, so the gain is forks of `planner`/`completeness-critic`/`docs-curator`, which otherwise inherit the opus parent's effort. The model is left alone to keep the prompt cache.
- Unpinned spawns (armada departments, the generic `task`) that inherit opus are not rewritten (the Squad drift panel was removed with the Client panes).

## Managed policy and fail-open behaviour

Regulated deployments (FTC Safeguards, SEC Reg S-P, GLBA) should read this section before enabling the mod. `sec-default@builtin` loads on any machine with managed settings, and for a Team or Enterprise sign-in it loads ahead of every user-installed mod.

| Managed setting | Atlas mod | Atlas plugin hooks (`hooks/hooks.json`) | Notes |
|---|---|---|---|
| `allowManagedModsOnly` (managed settings only) | refused unless an org mod | keep running | Status lines and `/goal` keep working |
| `allowManagedHooksOnly` | refused unless an org mod | blocked, unless managed `enabledPlugins` force-enables atlas | Also blocks agent-frontmatter hooks, non-managed `statusLine`, and `/goal` |
| `disableAllHooks` (managed) | stopped, org mods included | stopped | Built-in mods and Agent SDK hooks keep running |
| `disableSideloadFlags` | `--plugin-dir` is rejected | n/a | A sideloaded spike cannot run on such a machine |
| A site policy mod refusing `process.run` | refused unless an org mod | n/a | Atlas calls `$.process.run` |

Fail open, stated precisely:

- When only the mod is stopped (`allowManagedModsOnly`, `--safe-mode`, or three hook-worker crashes, which unload every mod), the band and the pane are absent. The output-style header, LEDGER, the atlas plugin hooks and the dashboard keep working, and nothing in atlas depends on the mod.
- Under `allowManagedHooksOnly` without force-enable, or under managed `disableAllHooks`, the atlas plugin hooks stop too: the completion gate, dispatch tripwire and board capture are all off. Atlas degrades to its output style and CLIs. An admin who wants atlas under those settings must install it as an org mod or force-enable it.
- The guard fails closed when it cannot read managed settings.

**Admin path: install atlas as the organisation's mod.** A plugin Claude Code copies into its cache from any source counts as the user's, even when managed `enabledPlugins` turns it on. To count as the organisation's, all three must hold: managed `enabledPlugins` sets `"atlas@tech-tools": true`; managed `extraKnownMarketplaces` names the marketplace as a `directory` source at an administrator-owned absolute path; and the marketplace lists atlas by a relative path so it loads in place (this repo does: `.claude-plugin/marketplace.json` has `"source": "./plugins/atlas"`). A `prependPlugins` list must then name `sec-default@builtin` to keep the guard, and `allowModsToOverrideDenyRules` stays off. Side effect: the same admin-only update channel then governs atlas's hooks and scripts, which is the change control an examiner wants.

**Permission boundary.** Deny rules and managed `PreToolUse` hooks do not govern a mod's own `$.fs`/`$.process` calls, nor the python children it starts; those children run with the user's full access. The control is review plus audit: a site policy mod can hook `process.run` by name to log or refuse each atlas invocation, and `claude plugin validate --json plugins/atlas` prints the exact `hooks:` and `calls:` surface for review.

## State-changing actions

Everything the mod can change, all user-initiated:

- Todo add, claim, status and complete (complete requires an evidence note) through `atlas_todo.py`, via `/atlas-todo`.
- Channel notes: the sidebar Team message field and `/atlas-say` (`register.ts:424-447`).
- Automatic process calls: the 5-second `atlas_herdr.py status` poll (read-only per its docstring) and the 30-second `atlas_gates.py` run (`GATES_MS`, no side effects, DB opened read-only). The earlier Steer and Stop run controls were removed with the Colony pane.
- The mod makes no `$.http` calls, and its links point only at localhost (the herdr web UI). Python children do their own I/O outside the mods API (see the permission boundary above).

## File map

```
plugins/atlas/mod/
|-- contract.ts      # shared types and BRAND tokens
|-- register.ts      # entry point: register(on, options); wired from hooks.json "modules"; $.state atoms, gates run, sendNote, ui.render hooks
|-- register.test.ts, register-sidebar.test.ts, register-open.test.ts, register-agents.test.ts # register wiring
|-- theme.ts         # chartRoom palette, width-safe glyph allowlist, fitText/textWidth
|-- band.tsx         # AbovePrompt band: one native line (bandTree)
|-- gates.ts         # parseGates, gatesError, headerGroup, openGateCount (pure)
|-- pane/
|   |-- sidebar.tsx  #   sidebarTree: route, tasks, team + message field, gates, advisor notes
|   |-- sidebar.test.ts
|   `-- chrome.tsx   #   shared helpers (ageStr, scrub)
|-- orchestra-types.ts # LiveSnapshot, Mood, ActivityEntry, CommsEntry, LifecycleEntry, TodoGroup
|-- routing.ts       # agent.spawn persona recording, turn.step effort pin, roster events
|-- restyle.tsx      # Spinner, ToolUse, AssistantMessage, TurnDuration, PromptHint sites
|-- discipline.ts    # context discipline: heavy-inline-call toasts, contract drift, vague-prompt facts, lastHeader
|-- notify.ts        # toasts and next-step suggestion on answer-turn boundaries
|-- intents.ts       # note/todo intents resolved to atlas_todo.py argv
|-- snapshot.ts      # session snapshot
|-- live_fixture.ts  # busySnap()/idleSnap() orchestration fixtures
|-- svg.ts           # Svg/Text fallback rendering
|-- data/            # readers for the .atlas/.run plane; all fail open on missing files
|   |-- root.ts, todos.ts, channels.ts, personas.ts, collab.ts, orchestration.ts, sessions.ts, herdr.ts
|-- sprites/         # persona art modules, used by restyle.tsx and svg.ts only
`-- fx/              # optional sound pack assets ($.audio.play)

Colocated `*.test.ts` files use the `claude-code/testing` kit.

## Honesty and known defects

- **Claude-Code-only.** Both surfaces are drawn by the `ui.render` mod dispatch on the `AbovePrompt` and `Pane` components. omp has no such vocabulary and keeps its own `atlas-channel` widget (`omp/channel-view.ts`).
- **Observed live (2026-10-12, Claude Code 2.1.296, inline pane):** ctrl+x tab focus on the sidebar, Tab and arrow row walking, a message sent from the Team field landing as a board note, and gate groups expanding (`.atlas/evidence/mod-native-sidebar-2026-10-12/`).
- **Not live-verified:** fullscreen docked placement; any tmux-specific behavior; the context-discipline delegation-suggestion toast (unit test only).
- **Sprites.** `mod/sprites/` remains and is imported by `restyle.tsx` and `svg.ts`; no pane draws it and `/atlas-sprites` no longer exists.

## See also

- `docs/atlas-colony.md` — the herdr colony
- `docs/atlas-channels.md` — channel names, registry and delivery rules
- `docs/atlas-workboard.md` — the browser Command Center (dashboard) the mod complements
- `docs/atlas-harness-parity.md` — the harness parity matrix, including the Claude mod vs omp widget row
- `docs/plans/2026-10-09-atlas-mod.md` — design plan, decisions and stage history
