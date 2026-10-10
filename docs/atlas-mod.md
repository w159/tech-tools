# Atlas mod (Claude Code)

Last verified against the source tree on 2026-10-10 (the unreleased atlas 11.0.0 line; installed releases before it have no mod): `claude plugin test plugins/atlas` loads and passes all 17 mod test files — 215 pass / 0 fail (the full plugin walk reports 384 tests / 186 files, 215 pass / 169 fail; every failure is a `plugins/atlas/colony/**` or `plugins/atlas/omp/**` file importing `bun:test`, which the plugin test host forbids — documented expected residual, those suites stay on `bun test`); `claude plugin validate --json plugins/atlas` returns success with 0 errors and 0 warnings; `bunx tsc --noEmit -p tsconfig.json` (include widened to `[hooks, types, tests, mod]`) exits 0 over 60 mod files. Live render is verified as of 2026-10-10: a tmux capture of a fresh `claude --plugin-dir plugins/atlas` session (Claude Code 2.1.296) shows the three-row AbovePrompt band with zero `ui.render … refused` lines. The earlier refusals came from `undefined` values reaching the Client props through `channels.ts` `parseNote` and `herdr.ts` `mergeSquad`; the fix is a `completeProps` deep undefined-strip sanitizer in `plugins/atlas/mod/props.ts` (`contract.ts` is chmod-locked read-only and so cannot host the helper), routed through every Client mount and every `ui.message` answer in `register.ts`. Paths are relative to `plugins/atlas/` unless they start with `docs/`.

The Atlas mod is an in-process UI plugin module for Claude Code mods (Claude Code 2.1.287+). It brings the Colony, the IRC channel, the durable TODO board, the persona roster and the operating-contract progress into the Claude Code terminal, with Atlas branding (accent teal `#2fbd9f`, the hex-cube mark) and a pixel character per persona. It is the Claude-side twin of the omp channel widget (`omp/channel-view.ts`, `ATLAS_CHANNELS=off`); omp is a separate harness and stays as it is. The browser Command Center (`docs/atlas-workboard.md`) remains the browser front door; the mod is the in-terminal view and links out to the browser for terminals and deep control.

Design rationale and decision log: `docs/plans/2026-10-09-atlas-mod.md`.

## Requirements and activation

- Claude Code 2.1.287 or newer (mods). On older versions the `modules` key is ignored and the rest of the plugin keeps working.
- The mod is wired by the `modules` entry in `hooks/hooks.json` (`hooks/hooks.json:192`, `"../mod/register.ts"` — the validator resolves `modules` paths hooks/-relative), in the same file as the existing 21 hook bindings. `register(on, options)` in `mod/register.ts` is the entry point; `claude plugin validate --json plugins/atlas` passes (success true, 0 errors).
- The mod runs in-process. Hook modules get no Node APIs: every file, process and network call goes through the mods `$` API. Pure logic modules take an injected `FsLike` (see `mod/contract.ts`) so they stay testable without a live session.
- Where it runs: the CLI and the Desktop Code tab. `Raster` and `Image` are terminal-only; Desktop gets the `Svg`/`Text` fallback. `claude -p` and the Agent SDK run mod hooks but draw nothing, so every `ui.*` call no-ops cleanly there — the persona routing below still applies in headless workers.
- Kill switch: `ATLAS_MOD=off` disables the mod (band, pane, restyles, routing), matching `ATLAS_CHANNELS=off` for the omp widget. The plugin's hooks and CLIs are unaffected.

## Surfaces

### The band: contract track (always on)

An `AbovePrompt` `Client` surface, three rows, redrawn at 10 fps while Claude is working or the pane has focus, 2 fps when idle, stopped while hidden:

1. **Contract track.** Phase nodes come from `todoPhases` plus `done` in `contracts/operating-contract.json`. Finished nodes are solid on a lit rail (a short charge pulse when an item completes); the current phase is an inverse-video capsule with its `n/m`; remaining phases are hollow on a dashed rail. `blocked` drains the rail to red and flashes the capsule. Hovering a phase node reveals a card with that phase's items (absolute `Box`, `hover` + `scope` — no hook runs).
2. **Titan walk.** The Atlas titan carries the globe along the rail; its x position is overall progress, so it walks toward `done` as items complete. The parallax starfield density rises with the session's token throughput; the last completion sets the globe down at `done` with a short firework.
3. **Squad conveyor.** A 4x2 mini sprite per live member in its persona colour, animated by its state, then the unread channel mail count, the context gauge, session cost and session tokens. Finished members slide off the left edge; new spawns beam in from the right. Clicking a sprite opens the Command Center on that agent's inspector; clicking the mail glyph opens the Channel tab.

The band's phase comes from the last header in `turn.complete` (matched with the contract's `headerFirstLinePattern`), else the session's first `in_progress` item, else `research`; counts come from the session's todo slice, refiltered only when `todos.json`'s mtime changes. The band stays right when a reply forgets its header. Fewer than 3 available rows collapse to the track; non-terminal surfaces draw the track as an interactive `Svg`, or one text line where `Svg` is missing.

### Command Center (`/atlas-cc`)

The docked pane (the mod opens it at 144 columns unasked, 110 once the user has opened it before). An 8-row `Raster` logo plays once per session on first open. Five full-height tabs:

- **Colony.** A pixel-art orbital station with one district per contract phase (archive, observatory, lab, scanning gate, forge, tribunal, harbour). Every agent is its persona sprite, walking to the district of the todo item it owns and performing that district's idle loop; the lead titan holds the rotating globe. A channel note pops a pixel speech bubble with its first 28 characters (amber border for notes to the lead). Spawns teleport in, completions sparkle toward the harbour, failures glitch and leave a tombstone tile, and 15 minutes of silence shows a sleep bubble and a cobweb. Hovering an agent shows a nameplate (persona, `model·effort`, task, last-note age); clicking opens an inspector card with a token sparkline, the last channel lines, the todo item and evidence, and three actions: **Steer** (a note, or a herdr prompt for an idle pane), **Open pane** (a link to the herdr web UI) and **Stop run** (destructive, confirmed). Dragging one agent onto another pre-addresses a message. Left/right cycles agents, enter inspects, `Esc` returns to the prompt.
- **Channel.** A nick list (sprite avatar, state dot, unread count) beside the message log: persona-coloured nicks, an amber stripe on mentions of `lead` or `human`, exit notes as system lines, joins and parts from registry changes. Notes over three lines fold with a hover-reveal; fenced code and markdown render richly. A typing indicator shows while that agent's `turn.step` is in flight. The composer has Tab nick completion, an `@target` prefix parse and a channel select; Enter runs the `atlas_todo.py note` argv. Away from the tab, a note to the lead raises a toast with the sender's sprite (an optional chime is off by default).
- **Board.** One kanban column per contract phase plus Done; cards show the owner sprite, content, age and an evidence tick. Dragging a card to another phase changes its status, onto an agent claims it, and to Done asks for an evidence note. Each drag posts an intent through `surface.post`; the hooks module validates it, runs the CLI and hands fresh props back, so the card snaps into place without flicker. Column headers carry mini progress bars; the current phase's column is lit to match the band.
- **Squad.** One card per persona (animated 16x16 portrait, role, pinned `model`, `effort`, colour, tools posture, and live count, tokens and cost this session), the task-type matrix from the table below with hover highlight, and a drift panel: header misses this session, effort pins the mod applied to forks, unpinned spawns that inherited opus (with a cost badge), and frontmatter-versus-omp mismatches.
- **Collab.** The collaboration tab, implemented in `mod/pane/collab.tsx` with shared pane sprite components in `mod/pane/sprites.tsx`.

### Restyled built-in sites

- **`Spinner`** becomes the 8-frame rotating pixel globe, the phase capsule and what is actually happening, from `tool.call` events tagged with the agent id.
- **`ToolUse` for `Agent`/`Task` on atlas personas** becomes a deployment card (persona sprite, nameplate, `model`/`effort` badges, dispatch name) that tracks `$.agent.list()` status live: running, waiting, completed, failed. Hovering reveals the dispatch GOAL and DELIVERABLE lines.
- **`AssistantMessage`** renders its header line as a coloured phase pill with `n/m`. Hovering the pill shows the contract track as it stood at that reply, so scrolling back shows the run's progress history. A reply with no header gets a dim "inferred" pill.
- **`TurnDuration`** becomes a turn receipt: duration, phase moves, completions, agents, tokens, cost.
- **`PromptHint`** shows contextual chords; `$.prompt.suggest` offers the next contract step after a turn, which the user takes with Tab.
- Toasts for a subagent completed or failed, a note to the lead, a todo completed. They fire on answer-turn boundaries: `mod/notify.ts` registers `on('turn.complete', { reason: 'answer' }, …)`, wired in `mod/register.ts:216` as `registerNotify(on, { getSnapshot, soundEnabled })`. An opt-in sound pack (`atlas_mod_sound` in `.claude-plugin/plugin.json`, off by default, read as `options.atlas_mod_sound === true`) ships its assets in `mod/fx/`.

## Data plane

All data is read from `<root>/.atlas/.run/`; the mod itself writes nothing to disk. `root` is `ATLAS_PROJECT_ROOT` if set, otherwise the nearest ancestor containing `.atlas` (the same `boardRoot` rule as `omp/channel-view.ts:74`).

| Surface | Source | Read rule |
|---|---|---|
| TODO board | `todos.json` `{version, items[{id, content, status, owner, session_id, phase?, archived, evidence}]}` | Filter `session_id == $.session.id()` and `!archived`, plus in-progress items owned by channel members. Phase comes from `phase` or the `[<phase>] ` content prefix. The file is replaced atomically, so the reader polls `stat` mtime, never per frame |
| IRC channel | `board/<owner>.jsonl` lines `{ts, seq, owner, to, item, text, channel, kind?, delivery?}` | Filter `channel == <lead channel>`, sort by `seq,ts`, keep a per-file byte cursor from `stat.size`. The viewer never calls `atlas_todo.py inbox`, which drains the lead's mail |
| Channel roster | `channels.json` `channels[name].members[{name, role, pane_id, pid, ended_at, exit_code}]` | The lead channel is the entry whose `lead` equals `lead-<first 6 of the session id>`, else `<folder>@<branch>` |
| Colony panes | herdr unix socket (unreachable from `$`) | `$.process.run(['python3', <plugin>/scripts/atlas_herdr.py, 'status'])` every 5 s, only while the Colony tab is visible |
| In-session subagents | `$.agent.list()` plus `agent.spawn`/`turn.complete` events | Native; the primary source for Task subagents |
| Personas | `agents/*.md` frontmatter (`model`, `effort`, `color`) | Read once at session start; the single source, no copied table |
| Contract | `contracts/operating-contract.json` (`phases[].id/glyph`, `todoPhases`, `headerFirstLinePattern`) | Track order and the header regex |

Merged member state reuses the dashboard states (`scripts/atlas_dash_colony.py`): `running`, `idle`, `stuck` (15 minutes silent with an open todo), `parked`, `finished`, `dead`, plus **input** from herdr's blocked state. Missing files fail open: a surface renders empty rather than erroring.

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

On omp the same agents carry a `thinkingLevel` (the policy page is `skills/atlas-orchestrate/references/squad-and-tiers.md`); `atlas:implementer` is `low` in frontmatter but `medium` in `omp/atlas-agents.ts`, and the Squad tab flags that mismatch.

How the mod applies the matrix:

- `agent.spawn`: for `subagentType` `atlas:<role>`, records the agentId→persona mapping; the model passes through untouched (the agent definition's own frontmatter pin decides it). Forks are skipped, and an explicit non-inherit model on a known role is logged as Squad drift, never rewritten. Per-call model overrides on `atlas:*` stay denied by `hooks/dispatch_tripwire.py`; the mod adds no second gate.
- `turn.step`: when the agent maps to a persona, `next({...e, effort: <frontmatter effort>})`. Normal atlas spawns already get their frontmatter effort, so the gain is forks of `planner`/`completeness-critic`/`docs-curator`, which otherwise inherit the opus parent's effort. The model is left alone to keep the prompt cache.
- Unpinned spawns (armada departments, the generic `task`) that inherit opus get a cost badge in the Squad drift panel.

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

- Todo add, claim, status and complete (complete requires an evidence note) — `atlas_todo.py`.
- Channel notes: the Channel composer, the Steer input, and dragging a board card onto an agent (claim).
- **Steer**: a herdr prompt into an idle pane — `atlas_herdr.py prompt --pane --text`.
- **Stop run (destructive)**: `atlas_mux.py kill --run R` closes the whole run workspace and every pane in it. A `$.ui.ask` confirmation lists every worker that will die before anything happens.
- The one automatic process call is the Colony tab's 5-second `atlas_herdr.py status` poll, which is read-only per its docstring (`ps`, socket pings, health probes on loopback ports).
- The mod makes no `$.http` calls, and its links point only at localhost (the herdr web UI). Python children do their own I/O outside the mods API (see the permission boundary above).

## File map

```
plugins/atlas/mod/
|-- contract.ts      # shared types and BRAND tokens, imported by every module
|-- register.ts      # entry point: export function register(on, options); wired from hooks.json "modules"
|-- register.test.ts # colocated tests for the register wiring
|-- theme.ts         # colour tokens and theme keys
|-- band.tsx         # AbovePrompt band: contract track, titan walk, squad conveyor
|-- routing.ts       # agent.spawn persona recording, turn.step effort pin, roster events
|-- restyle.tsx      # Spinner, ToolUse, AssistantMessage, TurnDuration, PromptHint sites
|-- props.ts         # completeProps: deep undefined and array-hole strip for Client props surfaces
|-- props.test.ts    # regression tests for the completeProps live-failure class
|-- notify.ts        # toasts and next-step suggestion on answer-turn boundaries
|-- intents.ts       # board drag intents posted through surface.post
|-- snapshot.ts      # session snapshot for the notify path
|-- svg.ts           # Svg/Text fallback rendering
|-- data/            # readers for the .atlas/.run plane; all fail open on missing files
|   |-- root.ts      #   root resolution (boardRoot rule)
|   |-- todos.ts     #   todos.json: session filter, archived filter, phase prefix, mtime poll
|   |-- channels.ts  #   channels.json registry and board/<owner>.jsonl notes (byte cursor)
|   |-- personas.ts  #   agents/*.md frontmatter
|   |-- collab.ts   #   collab board claims and handoffs reader
|   `-- herdr.ts     #   atlas_herdr.py status poll (5 s, Colony tab visible only)
|-- pane/            # the /atlas-cc Command Center tabs (Client surfaces)
|   |-- colony.tsx   #   diorama
|   |-- channel.tsx  #   IRC client
|   |-- board.tsx    #   kanban
|   |-- squad.tsx    #   persona roster and drift panel
|   |-- collab.tsx   #   collab tab
|   `-- sprites.tsx  #   shared pane sprite components
|-- sprites/         # one source grid per persona in three sizes (portrait 16x16, field 8x12, mini 4x4) with state frames
`-- fx/              # optional sound pack assets ($.audio.play)
```

Colocated `*.test.ts` files use the `claude-code/testing` kit.

## See also

- `docs/atlas-colony.md` — the herdr colony the Colony tab mirrors
- `docs/atlas-channels.md` — channel names, registry and delivery rules
- `docs/atlas-workboard.md` — the browser Command Center (dashboard) the mod complements
- `docs/atlas-harness-parity.md` — the harness parity matrix, including the Claude mod vs omp widget row
- `docs/plans/2026-10-09-atlas-mod.md` — design plan, decisions and stage history
