# Atlas cohesion program — design spec

Date: 2026-06-30. Companion to `report.md` (the evidence base) in this directory.
Scope: one program covering all five workstreams, implemented in phased milestones.
Status: design for review. No implementation until this spec is approved.

## Problem

Atlas feels "close but far from cohesive" because of three compounding failures, each
proven in `report.md`:

1. Discipline hooks misfire on ordinary, non-orchestration sessions (nags + a blocking Stop
   gate keyed off session boot and mere `docs/` presence).
2. The orchestration measurement plane is dark (`dispatches`, `recall_*`, `verifier_coverage`
   read zero/null because feeding hooks were never wired).
3. The skills/commands/agents are almost never invoked, and the outputs that exist
   (handoffs, the graphify graph) are never consumed or surfaced.

The user's original ask, a navigable knowledge-graph hub where acting on a node launches the
next session, is WS4 here. It is necessary but not sufficient; it must ship onto trustworthy
hooks (WS1) and live instrumentation (WS2), on top of a graph that actually builds (WS3).

## Goals

- Hooks fire only when contextually correct; a non-orchestration session is never blocked.
- Every dispatch, verification, and recall is recorded, so sextant reflects reality.
- graphify runs successfully on this monorepo by scoping per codebase root.
- Audit outputs become a navigable, branded Atlas knowledge graph whose actionable nodes
  launch a remediation session through one companion command.
- Adoption is measured (not assumed) before any prune-or-promote decision.

## Non-goals (YAGNI)

- No live-server graph cockpit (the user chose the companion-skill launch model, not a
  backend that triggers runs itself).
- No second graph substrate; the graphify graph is the single navigation surface.
- No rewrite of atlas-engine, the squad, or the vendor connectors.
- No pruning of idle skills/agents in this program; WS5 only decides the criteria.

## Cross-workstream design decisions

These are load-bearing and shared. Flagged `[DECISION]` are the ones worth your override.

- **D1 — Orchestration-run marker (approved).** The root cause of both WS1 misfires is that
  `session_boot.py:46-47` starts a run for *every* session, so the hooks cannot tell an
  orchestration from a chat. Introduce an explicit marker that ONLY the `atlas-engine` skill
  (and the Workflow template) sets when real orchestration begins: a per-session flag on the
  run row (`runs.orchestrating = 1`) plus a sentinel file `docs/.run/atlas-engine.active`.
  Session boot keeps starting a run for telemetry, but does NOT set the flag. Both the
  dispatch tripwire and the completion gate require the flag before they may nag or block.
  Alternative considered: infer orchestration from "an Agent/Task was dispatched this
  session" — rejected because the very first inline ops (which the tripwire targets) precede
  any dispatch, so it would still misfire early.

- **D2 — Audit-run-dir contract.** All consumer/launcher logic keys off the existing
  `docs/audits/atlas-<skill>-<date>/` layout. Cartographer and survey already write
  `handoffs/<id>.md`; the hub adds a sibling `hub/` dir (manifest + branded graph) in the
  same run dir. No new top-level locations.

- **D3 — Manifest schema (the node↔finding bridge).** Each run dir gets
  `hub/manifest.json`: an array of `{ id, kind: "finding"|"system", file, line, severity,
  node_id, handoff_path, prompt_summary }`. `node_id` is resolved by matching the finding's
  `file:line` to the graphify node whose span contains it (nearest-enclosing). The manifest
  is the single source the branded graph and the launcher both read.

- **D4 — Naming.** `atlas-handoff` (session-resume checkpoint) keeps its name and meaning.
  The new launcher is `atlas-launch`. The cartographer/survey `handoffs/` artifacts keep
  their name but their prompts target `atlas-launch`, not the non-existent `/atlas-engine`
  command. A short note in each skill's Output section disambiguates the two "handoff" senses.

- **D5 — Propagation.** Per repo `CLAUDE.md`, every change lands across all owning layers:
  skill SKILL.md, `plugin.json` counts/description, the hooks reference docs, READMEs, and
  any `docs/` SSOT. A per-phase propagation checklist is in each workstream below.

## Workstream designs

### WS1 — Hook misfires

Changes:
- `hooks/dispatch_tripwire.py`: require `runs.orchestrating` (D1) before counting inline ops
  or emitting either the `>=threshold` nag (`:69-80`) or the `edit_to_target` first-edit nag
  (`:68-74`). Non-orchestration sessions: tripwire is inert.
- `hooks/completion_gate.py`: replace the `docs/`-presence engagement test (`:40-54,198-200`)
  with the D1 marker for THIS session. No atlas-engine run this session → gate is advisory at
  most, never `decision:block`.
- `hooks/nudge.py`: skip pure read-only turns; move the marker out of the source tree (write
  under the OS temp/`~/.atlas/`, not `plugins/atlas/.claude/`). Remove the stray
  `scripts/.claude/` marker and gitignore `__pycache__/`, `.ruff_cache/`.
- Inventory reconcile to the real 8 hooks: fix `commands/atlas.md:38-39` (drop the
  non-existent "SQL guard", add dispatch tripwire + ingest), `atlas-architect/SKILL.md:35-38,
  73-75` (add ingest_session), rewrite `hooks-automation.md` (currently documents 4 of 8).

Acceptance: in a session with no atlas-engine run, 6 Reads + 1 non-docs edit produce zero
tripwire injections, and Stop is never blocked. In an atlas-engine run, both still fire as
today. Verified by extending `hooks/test_dispatch_tripwire.py` and
`hooks/test_completion_gate.py` with an `orchestrating=0` case (expect no block/nag) and an
`orchestrating=1` case (expect today's behavior).

Propagation: `plugin.json:4` count stays 8; fix the three drifted hook descriptions.

### WS2 — Instrumentation wiring

Changes:
- Wire `log_dispatch`: add a PostToolUse hook on `Agent|Task` that calls
  `atlas_db.log_dispatch(conn, run_id, agent_type, model, wave_id)`. This is the missing
  link behind `dispatches=0` across all runs.
- Ensure `derive_run_metrics` runs after each mirror refresh (the SKILL claims it does; the
  data shows gaps) and that `finalize_run` passes `wall_clock_s`.
- Write `recall_hits`/`recall_misses` and `verifier_coverage`: emit a signal from the engine
  Orient step (memory lookup used/usable) and from each verifier dispatch, mapped at ingest.
- Fix the ingest tool-kind classifier: builtin tool names (`read`, `bash`, `write`, ...) must
  be `kind='builtin'` with `is_error` from the real result, not `kind='skill'`/`is_error=1`.
- Add a `SessionEnd` finalize path for the run (today only `Stop` finalizes).

Acceptance: a scripted session that dispatches 2 agents and 1 verifier yields
`dispatches=3`, `verifier_coverage>0`, non-null `recall_*`, and `tool_usage(kind='builtin')`
showing the builtins with correct error flags. Verified by a new
`hooks/test_dispatch_logging.py` and a `scripts/session_ingest.py` classifier unit test.

Propagation: update the sextant SKILL where it claims auto-derivation; add the new hook to the
inventory (count becomes 9) and to all four hook-description surfaces.

### WS3 — graphify scoping

Changes:
- `atlas-survey/SKILL.md` Phase 1: **dynamically discover codebase roots by exploring the
  workspace** (a discovery pass — an `atlas:explorer` over the tree plus graphify's own
  lightweight `detect()` for minimal-context understanding), not a static or config-supplied
  list. Then run graphify **scoped per discovered root**, writing `graphify-out/` under each,
  instead of zero-arg on the monorepo root. The discovery is self-adapting: a single-package
  repo yields one root, this monorepo yields one per MCP server / node lib / plugin.
- `skills/graphify/SKILL.md`: expose the engine's existing scoping. Add `--exclude` to the
  Usage block and forward it as `extra_excludes` in the Step 2 `detect(...)` call
  (`:85-91`); document `.graphifyignore`/`.gitignore` respect and `_SKIP_DIRS`.
- Size gate (`graphify/SKILL.md:108-110`): when non-interactive (no TTY or an
  `ATLAS_NONINTERACTIVE`/orchestrated flag), auto-scope to the largest sub-root or hard-fail
  with an instruction, instead of asking and waiting.
- Add a repo-root `.graphifyignore` as belt-and-suspenders for direct invocations.

Acceptance: `atlas-survey` Phase 1 completes on this repo without stalling, producing a
`graphify-out/` per detected root, each under the 200-file gate. Verified by running survey
Phase 1 (or the graphify driver directly) on `mcp_servers/<one>-mcp/src` and confirming a
populated `graphify-out/` and exit without an interactive prompt.

Propagation: graphify SKILL Usage + atlas-survey Output tree (now lists `graphify-out/`).

### WS4 — Knowledge-graph hub + launcher

Changes:
- Surface the graph as a deliverable: copy/brand each `graphify-out/` into the run dir's
  `hub/` (Approach A — overlay, not a new substrate).
- Build `hub/manifest.json` (D3): map every `handoffs/<id>.md` and every `report.md` finding
  to its graphify `node_id` by file:line.
- Branded overlay `hub/index.html`: the graphify graph with actionable nodes marked; clicking
  a marked node shows the finding, the handoff, and the exact `atlas-launch <id>` command.
  Branding (approved): the **Atlas theme throughout** — the cartography/discovery narrative
  (maps, charts, compass, sextant, expedition) and an Atlas token set (its own palette,
  type, and iconography), NOT the Henssler client tokens. The theme/vocabulary is consistent
  with the existing skill names (cartographer, survey, sextant, expedition, harbor, orbit).
- New `commands/atlas-launch.md`: `atlas-launch <node-id>` reads the manifest, loads the
  handoff prompt, and invokes the existing `atlas-engine` skill with it; no-arg mode lists
  actionable nodes from the most recent run dir. This sets the D1 orchestration marker
  (closing the loop with WS1/WS2). No new `/atlas-engine` command is created — `atlas-launch`
  is the single launcher and `atlas-engine` remains the orchestration skill it invokes.
- Make the handoff target real: cartographer/survey `handoffs/` prompts reference
  `atlas-launch` (not the non-existent `/atlas-engine` command).
- **Harden `atlas-engine` (approved scope add).** As the orchestration substrate that
  `atlas-launch` invokes, atlas-engine owns: setting the D1 marker on start, emitting the
  dispatch/recall/verifier signals WS2 records, and reliably consuming a handoff prompt as
  its opening task. Concrete engine reliability gaps surfaced while wiring WS1/WS2 (e.g.
  `finalize_run`/`derive_run_metrics` wiring, marker lifecycle) are fixed here so the loop
  lands on an engine that actually works, not one that "should."

Acceptance: after a survey run, `hub/index.html` opens and shows marked nodes; the listed
`/atlas-launch <id>` for one node starts an atlas-engine session pre-loaded with that handoff
(orchestration marker set, tripwire/gate now correctly active). Verified by opening the HTML,
running one `atlas-launch` end-to-end, and confirming the new session's first message carries
the handoff content and `runs.orchestrating=1`.

Propagation: `plugin.json:4` command count (15→16 launchers, or 17 with `/atlas-engine`);
README hub section; survey/cartographer Output trees gain `hub/`.

### WS5 — Adoption (investigate, then decide)

Changes: with WS2 making invocation measurable, run a sextant adoption review after a defined
window (proposed 2 weeks of normal use): which of the 7 idle skills / 16 idle commands / 14
idle agents stay idle, and why (discoverability vs felt-need vs breakage). Output is a
decision memo (prune / promote / add discoverability such as an `/atlas` menu). Also assess
claude-mem (44% error, near-unused) and ponytail (absent): fix, replace, or drop.

Decision discipline (approved): every prune/promote/fix verdict is **proposed to the user via
interactive questions and options, and never adopted automatically** — same CONFIRM discipline
as the existing `asset_audit.py` apply path. No asset is moved, disabled, or removed without an
explicit choice.

Acceptance: a written adoption memo under `docs/audits/` citing post-WS2 invocation counts,
each idle asset carrying a proposed verdict awaiting user confirmation. No automatic changes;
no build gate.

## Phasing and dependencies

- **Phase 0** — D1 marker primitive + D2/D3 contracts (shared foundation).
- **Phase 1 — WS1** (depends P0): hooks stop misfiring.
- **Phase 2 — WS2** (depends P0): instrumentation live; sextant reflects reality.
- **Phase 3 — WS3** (independent of P1/P2; can run parallel): graphify scopes per root.
- **Phase 4 — WS4** (depends P3 for the graph, P1/P2 for a trustworthy launch): the hub.
- **Phase 5 — WS5** (depends P2 for real counts): adoption decision.

Each phase ends with its acceptance check run and evidence captured before the next begins
(verification-protocol: no "done" without command output).

## Testing strategy

- Hook changes: extend the existing `hooks/test_*.py` (pytest) with orchestrating on/off
  cases. WS2 adds dispatch-logging and ingest-classifier tests.
- graphify: a scoped-run smoke test on one MCP server source dir.
- Hub: manual open of `hub/index.html` + one real `atlas-launch` round-trip.
- Server/bundle suites (`node test-mcp-tools.mjs`) are unaffected (no connector changes) but
  run once at the end to confirm no regression.

## Resolved decisions (user-approved 2026-06-30)

1. D1 mechanism: run-row flag + sentinel file, as proposed.
2. WS4 branding: Atlas theme throughout — cartography/discovery narrative + Atlas tokens, not
   Henssler.
3. WS4 entry point: `atlas-launch` is the single launcher and invokes the existing
   `atlas-engine` skill; no new `/atlas-engine` command. `atlas-engine` is hardened as part of
   WS4.
4. WS3 root detection: dynamic self-discovery by exploring the workspace + graphify's own
   `detect()`; no static or config list.
5. WS5: adoption verdicts are proposed via interactive questions/options and never adopted
   automatically; observation window proposed at 2 weeks.
