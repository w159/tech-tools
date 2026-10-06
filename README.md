<div align="center">

<img src="img/project-logo-icon.png" alt="Atlas logo" width="120" />

# Atlas

**A self-configuring Claude Code plugin that turns any coding agent into a disciplined multi-agent architect.**

![Atlas README hero banner](img/readme-hero-banner.png)

</div>

Atlas is a plugin for Claude Code (and, via its omp extension package, omp) that
enforces a research-to-verify operating contract with hooks, runs work through a
colony of named role subagents that share one durable board, keeps persistent
memory across sessions, and mines its own telemetry for self-improvement. You
onboard a project once with `/atlas`, then drive everything else by naming a
skill or describing the work in plain language. Current release: **9.5.1**
(`plugins/atlas/.claude-plugin/plugin.json`).

| Surface | Count | Source |
|---|---|---|
| Skills | 47 (2 manual, 45 auto-trigger) | `plugins/atlas/skills/` |
| Agents | 13 role agents (`atlas:*`) | `plugins/atlas/agents/` |
| Hooks | 17 programs, 21 command bindings across 8 lifecycle events | `plugins/atlas/hooks/hooks.json` |
| Scripts | 25 (plus unit tests) | `plugins/atlas/scripts/` |
| MCP connectors | 12, optional, each disabled until credentials exist | `plugins/atlas/.mcp.json` |
| Output style | 1 (`atlas-orchestrator`, force-applied) | `plugins/atlas/output-styles/` |
| omp extension | 1 package, 13 generated omp agents | `plugins/atlas/omp/` |

The marketplace catalog (`.claude-plugin/marketplace.json`, name `tech-tools`,
v4.5.1) lists three plugins. Only `atlas` is required; `armada` (v1.1.1,
org-deployment layer) and `programmer` (v0.2.1, Pragmatic Programmer auditor)
are independent optional installs.

Version history: [docs/CHANGELOG.md](docs/CHANGELOG.md) and
[plugins/atlas/CHANGELOG.md](plugins/atlas/CHANGELOG.md).

## Table of contents

1. [What Atlas is](#what-atlas-is)
2. [Install and update](#install-and-update)
3. [Quickstart](#quickstart)
4. [The operating contract](#the-operating-contract)
5. [Skills](#skills)
6. [Agents](#agents)
7. [Hooks](#hooks)
8. [Scripts](#scripts)
9. [Connectors](#connectors)
10. [Colony and orchestration](#colony-and-orchestration)
11. [Tmux colony mode (mux)](#tmux-colony-mode-mux)
12. [omp parity](#omp-parity)
13. [Docs as the single source of truth](#docs-as-the-single-source-of-truth)
14. [Repository layout](#repository-layout)
15. [Prerequisites and configuration](#prerequisites-and-configuration)
16. [Troubleshooting](#troubleshooting)

## What Atlas is

![Atlas command center](img/command-center-hero.png)

The plugin reshapes behavior along seven axes:

| Axis | Stock agent | With Atlas |
|---|---|---|
| Claiming done | "This should work." | `completion_gate.py` blocks the Stop until real command output, a verified finding, drained todos, and current docs exist. |
| Big tasks | One long inline session | Decomposed into named stages, each dispatched to a role subagent with one failable check (`atlas-orchestrate`, `atlas:planner`). |
| Verification | Written by the context that wrote the fix | A fresh, adversarial `atlas:verifier` re-checks against real evidence before the finding is recorded as `verified`. |
| Your prompt | Sent as typed | Optionally rewritten through a local model so the agent gets a sharper task (`hooks/prompt_optimizer.py`; opt-in, see [Prerequisites](#prerequisites-and-configuration)). |
| Memory | Forgotten at session end | Durable lessons saved to `~/.atlas/memory/` at Stop, reloaded at boot (`hooks/memory_capture.py`). |
| Docs | Drift silently | `docs/` is treated as the source of truth; an inline watch and the completion gate refuse to let docs fall behind code. |
| Repeated mistakes | Re-made every session | Session telemetry is mined into findings you accept or skip, then re-measured against a baseline (`atlas-doctor`). |

## Install and update

![Atlas plugin marketplace tile](img/plugin-marketplace-tile.png)

**Claude Code.**

```bash
claude plugin marketplace update tech-tools      # refresh the marketplace catalog
claude plugin update atlas@tech-tools            # update the plugin (restart required to apply)
```

If the marketplace is not configured yet, add it first:
`claude plugin marketplace add w159/tech-tools`. Restart the session after an
update; hooks and `${CLAUDE_PLUGIN_ROOT}` resolve at session start.

**omp.** Update the marketplace catalog first, upgrade second, then restart omp:

```bash
omp plugin marketplace update tech-tools         # catalog first
omp plugin upgrade atlas                        # then the plugin
```

Restart omp afterwards. For the colonized omp agents (per-role model tiers) or
to run the extension from a source checkout, load it by directory:

```bash
omp --extension /absolute/path/to/tech-tools/plugins/atlas/omp
```

or add that path under `extensions:` in `~/.omp/agent/config.yml` and restart
omp (default profile only; named profiles have their own config).

## Quickstart

In your repo, run:

```text
/atlas                          # boot the workspace: verify companions, scan, wire hooks, seed docs/
atlas-feature add CSV export    # build a feature end to end, with verification
atlas-debug login returns 500   # root-cause a bug, not patch the symptom
atlas-audit                     # code + security audit as a parallel workflow
```

`/atlas` verifies `claude-mem` and `context-mode`, scans the project,
recommends tooling (confirming first), wires hooks, and seeds the `docs/` SSOT.
`/atlas-setup` covers onboarding, install, connectors, and repair (`--fix`).
Both are manual by design (`disable-model-invocation: true`); the other 45
skills auto-trigger from their `description`.

## The operating contract

Every non-trivial task moves through fixed stages. Skipping a stage is the most
common failure mode, so hooks make the contract executable rather than advisory.

```text
research -> theory -> test -> validate -> implement -> verify -> done
   |          |         |          |           |           |      |
 map the    form a   define a   check the    minimal    fresh,   evidence
 ground     plan     failing    plan vs      diff by    in-dep.  shown:
 (explorer)           check     reality      the lead   recheck  cmd + output
```

What the hooks actually enforce, with the message you will see:

**Recall gate** (`hooks/recall_gate.py`, PreToolUse on every tool). Armed only
when claude-mem is enabled; main thread only (subagents are exempt). Until one
real claude-mem call happens in the session, every other first tool call is
denied:

```text
[atlas gate] REQUIRED once per session: your first tool call must be one
claude-mem recall for this project (<route>). Example search args: {"query":
"<prior work on this project>"} Every other tool call is denied until you make
it; then continue. ATLAS_MANDATES=off disables it.
```

**Dispatch tripwire** (`hooks/dispatch_tripwire.py`, PreToolUse + PostToolUse).

- Inline-op threshold (6 unsanctioned main-thread ops since the last dispatch):
  `DENY - 6 inline ops since your last dispatch. Orchestrators delegate: the
  work happens in subagents so this session's context stays clean. Dispatch the
  next step to atlas:explorer (investigation) or atlas:implementer (edits). ...`
- Native-tool routing: an exploration-only `cat`/`grep`/`ls` command toward
  reachable lean-ctx is denied: `DENY - this Bash command only reads files, so
  use lean-ctx `ctx_search` instead.` Grep/Glob get the same treatment.
- Dispatch spec deny: an `atlas:*` dispatch missing any of the five required
  blocks (`GOAL:`, `DELIVERABLE:`, `SUCCESS CRITERIA:`, `OUT OF SCOPE:`,
  `STOP CONDITIONS:`) or carrying more than one `GOAL:` is denied before it
  spawns.
- Production-edit deny (orchestration-flagged sessions): a main-thread
  `Write`/`Edit` of target code (anything outside `docs/` and `.atlas/`) is
  told to route to `atlas:implementer`. URI-scheme writes (`agent://`, `xd://`
  — messages, not files) are never counted as edits.

`ATLAS_TRIPWIRE_HARD=off` lifts the denies (nudges remain).

**Completion gate** (`hooks/completion_gate.py`, Stop). Blocks the "done"
claim until all of its conditions hold, and prints one block message per run
listing exactly which ones are unmet:

- (a) evidence saved under `.atlas/evidence/`
- (b) a finding with status `verified` in `.atlas/.run/findings.json`
- (c) `docs/CHANGELOG.md` current for this run
- (d) `docs/ROADMAP.md` exists and is non-empty
- (e) root `README.md` present
- (f) docs drift: non-docs files changed, but `docs/CHANGELOG.md` is not in
  the diff
- (g) verification coverage: implementer dispatches that shipped code are
  covered by an `atlas:verifier` dispatch or a `verified` finding stamped this
  run
- (h) `docs/ROADMAP.md` holds no items with status `done` (they belong in the
  CHANGELOG)
- (i) todo list drained
- (j) this run's git worktrees closed
- (k) a plan existed on some surface (TodoWrite, board items, or ledger line)
  before code shipped
- (l) dated artifacts touched this run use date-first names
- (m) delegation mandate: at least one `Task`/`Agent` dispatch when main-thread
  code shipped outside `docs/`

Fix the listed condition (paste the test output, write the finding with
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"`, dispatch the
verifier), then stop again. `ATLAS_GATE=off` disables the gate.

**Docs drift watch** (`hooks/docs_drift_watch.py`, PostToolUse on Edit/Write):

```text
[atlas] docs drift: 1 non-docs file(s) changed with no docs/ update in the
diff yet. Dispatch atlas:docs-curator before Stop -- do not wait for the
completion gate to catch this.
```

Debounced: the first drifting edit warns, then every 5th, until a `docs/`
change clears the drift.

**Kill switches.** Every guard is env-gated; set the switch in your shell or
`~/.claude/settings.json` `env`:

| Env var | Off-switch effect |
|---|---|
| `ATLAS_GATE=off` | completion gate (Claude Code) and bridged Stop-time delegation check (omp) |
| `ATLAS_TRIPWIRE_HARD=off` | tripwire denies: native grep/glob routing, inline-op threshold, omp model-override deny |
| `ATLAS_MANDATES=off` | recall gate, "Recall first" boot line, ponytail nudge |
| `ATLAS_FALLOW=off` | fallow commit/push gate |
| `ATLAS_INGEST=off` | session transcript ingest |
| `ATLAS_CHRONICLE=off` | chronicle facet capture |
| `ATLAS_MEMORY_CAPTURE=off` | memory capture |
| `ATLAS_CONNECTOR_WATCH=off` | stale connector credential detection |
| `ATLAS_TODO=off` | TodoWrite-to-board mirror |
| `ATLAS_ENGINE_ARM=off` | prompt-triggered orchestration arming |
| `ATLAS_DECISION=off` | model-based prompt-arm decision (regex answer stays) |
| `ATLAS_MUX` | unset = in-process colony (default); `ATLAS_MUX=tmux` = tmux workers |
| omp only: `ATLAS_HOOK_BRIDGE`, `ATLAS_STOP_BRIDGE`, `ATLAS_LEAN_SHELL`, `ATLAS_ADVISOR_GATE`, `ATLAS_STYLE`, `ATLAS_NATIVE_POLICY` | see [omp parity](#omp-parity) |

## Skills

Type the skill name or describe the work; every skill except the two manual
ones auto-triggers from its `description`. Source: `plugins/atlas/skills/`.

| Skill | When to use | Example invocation |
|---|---|---|
| `atlas` | setting up atlas in a project (manual) | `/atlas` |
| `atlas-setup` | first bringing atlas online, setting up a workspace, or fixing atlas (manual; `--fix`) | `/atlas-setup` |
| `atlas-orchestrate` | a task spans layers or the whole repo (atlas-setup installs atlas itself) | `atlas-orchestrate ship the rate-limiter across API + cache` |
| `atlas-autopilot` | a plan or fix executed end to end autonomously with a stop before any push, PR or merge | `atlas-autopilot fix the flaky cart test` |
| `atlas-brainstorm` | a feature idea or request is vague and needs scoping before planning with atlas-plan | `atlas-brainstorm add offline mode` |
| `atlas-plan` | requirements are settled and a plan is needed before execution | `atlas-plan split invoice storage out of the monolith` |
| `atlas-feature` | asked to implement or add a feature or build new functionality | `atlas-feature add CSV export` |
| `atlas-debug` | the actual cause of a failure must be found and fixed | `atlas-debug login returns 500` |
| `atlas-refactor` | code works but is messy, hard to navigate or carries dead weight | `atlas-refactor extract the pricing rules into a module` |
| `atlas-component` | creating a progress modal, upload widget, job panel or other async component | `atlas-component add a cancellable file uploader` |
| `atlas-frontend` | creating or reworking frontend UI | `atlas-frontend build the dashboard page` |
| `atlas-gitignore` | starting a repo or hardening an existing .gitignore | `atlas-gitignore harden for node + terraform` |
| `atlas-handoff` | at a checkpoint before context fills, before a break, or handing work to another session | `/atlas-handoff` |
| `atlas-harden` | remediating or enforcing an endpoint setting at scale | `atlas-harden remediate unencrypted drives for RMM` |
| `atlas-launch` | after an atlas-audit run, to act on a finding | `atlas-launch` |
| `atlas-loop` | something must run repeatedly, poll for status, iterate until done, or sweep a backlog | `atlas-loop scan dependencies weekly until green` |
| `atlas-prompt` | a request is underspecified and needs sharpening before execution | `atlas-prompt make the search faster` |
| `atlas-readme` | a repo has no README or its README is stale | `atlas-readme` |
| `atlas-validate` | a plugin is believed complete and needs a structural and content check | `atlas-validate plugins/atlas` |
| `atlas-wiki` | architecture docs changed, wiki diagrams stale or missing, or before the completion gate | `atlas-wiki` |
| `atlas-simplify` | after implementing a change and before review or commit; not broad restructuring | `atlas-simplify` |
| `atlas-review` | reviewing a changeset before merge; not for whole-codebase audits | `atlas-review PR #142` |
| `atlas-audit` | asked to audit a repo, map its architecture before a refactor, or check atlas health | `atlas-audit` |
| `atlas-doctor` | telemetry has accumulated, atlas should self-improve, or before skill/hook/agent changes | `atlas-doctor` |
| `atlas-db-audit` | reviewing a database before any schema or permission change | `atlas-db-audit` |
| `atlas-compound` | a problem was solved and verified and a future engineer would repeat the mistake | `atlas-compound` |
| `atlas-strategy` | starting a product, adding a strategy doc, or changing direction | `/atlas-strategy` |
| `atlas-pulse` | asked for a product pulse, health snapshot, or usage and error summary | `atlas-pulse 7d` |
| `atlas-sweep` | new issues or feedback need sweeping and triage | `atlas-sweep` |
| `atlas-bakeoff` | choosing an architecture, library or data-model shape; not routine reversible picks | `atlas-bakeoff sqlite vs postgres for the queue` |
| `atlas-pov` | asked for an opinion or second opinion on a technical choice | `atlas-pov should we switch ORMs` |
| `atlas-explain` | asked how something works, why something happens, or what a file or message means | `atlas-explain why the retry loop exists` |
| `atlas-prototype` | a question is cheaper to demonstrate than argue about | `atlas-prototype sketch the new nav` |
| `atlas-optimize` | a working system's metric should improve and the winning change is unknown | `atlas-optimize cut the prompt tokens 30%` |
| `atlas-feedback-analysis` | analyzing user feedback, transcripts or tickets for pain points and requests | `atlas-feedback-analysis docs/feedback/2026-09.md` |
| `atlas-commit` | changed files are ready to commit locally | `atlas-commit` |
| `atlas-ship` | verified, gate-passing work is ready to commit and optionally push or open a PR | `atlas-ship` |
| `atlas-babysit-pr` | an open PR needs CI watched and genuine failures repaired | `atlas-babysit-pr #142` |
| `atlas-resolve-pr-feedback` | a PR has open review comments to address | `atlas-resolve-pr-feedback #142` |
| `atlas-worktree` | isolating parallel implementer waves, spikes or bakeoffs, or closing worktrees at wave end | `atlas-worktree branch for the payment spike` |
| `atlas-polish` | a surface needs spacing, transition or micro-interaction polish, not new functionality | `/atlas-polish` |
| `atlas-dogfood` | changed flows must work end to end and small breakages should be fixed autonomously | `atlas-dogfood current` |
| `atlas-test-xcode` | building or testing an iOS or Xcode project; macOS only | `atlas-test-xcode current` |
| `atlas-test-browser` | a quick check that changed routes still render is needed | `atlas-test-browser` |
| `atlas-ux-test` | a full UI/UX test pass: persona testing, pre-release frontend sweep, re-test after fixes | `atlas-ux-test the checkout flow` |
| `atlas-proof` | sharing a plan, spec or draft for review or acting on its comments; not proofreading | `atlas-proof docs/plans/x.md` |
| `atlas-promote` | after a merged PR, completed plan, or recorded lesson; announce what changed | `atlas-promote the audit feature` |

## Agents

Role subagents the orchestrator dispatches (`atlas:*`). Read-only agents cannot
edit code; fresh agents start without the leader's assumptions. Source:
`plugins/atlas/agents/`.

| Agent | Mode | Use when |
|---|---|---|
| `atlas:explorer` | read-only, fresh | a task needs to know where something lives or how code connects before it is changed |
| `atlas:planner` | fork | a task spans several stages or layers and needs an ordered, verifiable plan |
| `atlas:implementer` | writes | a single, clearly specified code change is ready to be made and verified |
| `atlas:verifier` | read-only, fresh | a finding or fix must be checked before it is recorded as verified |
| `atlas:completeness-critic` | fork, read-only | work is about to be declared done and its completeness needs an independent check |
| `atlas:docs-curator` | writes `docs/` only | a shipped change needs docs updated or the structure repaired |
| `atlas:docs-auditor` | read-only | checking whether docs and project structure still match the code |
| `atlas:runner` | writes, haiku/low (mechanical tier) | a task is fully specified as at most 7 exact numbered STEPS on at most 5 named files; returns a fixed `STEPS:` report |
| `atlas:db-prober` | read-only | a task needs facts about database structure, privileges, or query plans |
| `atlas:schema-inventory` | read-only | running the schema half of a database audit |
| `atlas:rls-privilege-audit` | read-only | running the security half of a database audit in regulated environments |
| `atlas:naming-glossary-audit` | read-only | running the nomenclature half of a database audit |
| `atlas:ui-runtime-tester` | read-only | a UI change needs confirming in a running app rather than by reading code |

## Hooks

Wired in `plugins/atlas/hooks/hooks.json`: 17 programs across 21 command
bindings, fired by 8 lifecycle events (SessionStart, UserPromptSubmit,
PreToolUse, PostToolUse, Stop, SubagentStop, SessionEnd, PreCompact). All are
stdlib Python. Most fail open on internal errors; `dispatch_tripwire.py`,
`completion_gate.py`, and `fallow_gate.py` deny on purpose by design.

| Program | Event(s) | Effect | Off switch |
|---|---|---|---|
| `session_boot.py` | SessionStart | Loads contract, memory, board carry-over, tool routing; claude-mem "Recall first" line. Repairs a missing `docs/` subfolder only if `docs/` exists. | — |
| `scripts/atlas_doctor.py --hook` | SessionStart | Rollback guard: warns on downgrade, forked marketplace, or missing hooks/assets. | — |
| `prompt_optimizer.py` | UserPromptSubmit | Optional model-rewritten prompt; arms orchestration on engineering prompts. | `ATLAS_ENGINE_ARM=off`, decision part `ATLAS_DECISION=off` |
| `recall_gate.py` | PreToolUse (all) | claude-mem recall gate (see message above). | `ATLAS_MANDATES=off` |
| `bash_advisor.py` | PreToolUse (Bash) | Warns on catastrophic commands; one ponytail-before-commit nudge per session. Advisory only, never denies. | — |
| `fallow_gate.py` | PreToolUse (Bash) | On `git commit`/`git push`, runs `fallow audit`; denies on `verdict: fail`. Fail-open when the CLI is absent. | `ATLAS_FALLOW=off` |
| `dispatch_tripwire.py` | PreToolUse + PostToolUse | Denies covered in [the operating contract](#the-operating-contract); mirrors dispatch state. | `ATLAS_TRIPWIRE_HARD=off` |
| `todo_capture.py` | PostToolUse (TodoWrite) | Mirrors every plan into `<project>/.atlas/.run/todos.json`. | `ATLAS_TODO=off` |
| `format_after_edit.py` | PostToolUse (Edit/Write) | Auto-formats the edited file (ruff format→black for Python; prettier for JS/TS/JSON/CSS; gofmt; rustfmt). | — |
| `docs_drift_watch.py` | PostToolUse (Edit/Write) | Inline docs-drift warning (see message above). | `ATLAS_GATE=off` (watch also goes silent) |
| `connector_credential_watch.py` | PostToolUse (connector tools) | On the first 401/403 (or a 400 whose body names the credential) from a known connector, says to restart the server instead of sweeping endpoints. | `ATLAS_CONNECTOR_WATCH=off` |
| `completion_gate.py` | Stop | Definition-of-done gate, conditions (a)-(m). | `ATLAS_GATE=off` |
| `ingest_session.py` | Stop, SubagentStop, SessionEnd, PreCompact | Mirrors the transcript into the observability DB. | `ATLAS_INGEST=off` |
| `worker_report_gate.py` | SubagentStop | Blocks an `atlas:*` subagent whose final message is not the fixed report container (`contracts/worker-protocol.json`); once per agent, fail-open. | — |
| `chronicle_facet.py` | Stop | One facets row per session + friction event mirror. | `ATLAS_CHRONICLE=off` |
| `memory_capture.py` | Stop | Writes durable lessons to `~/.atlas/memory/`. | `ATLAS_MEMORY_CAPTURE=off` |
| `nudge.py` | Stop | Throttled self-improvement nudge; silent when memory capture already wrote. | — |

Also in `hooks/` but unbound: `docs_drift.py` (library for the gate's drift
condition), `prompt_decision.py` (the model-answer band for the prompt
rewriter), `validate-readonly-query.sh` (helper).

## Scripts

Source: `plugins/atlas/scripts/` (25 non-test scripts; unit tests sit beside
them).

| Script | Purpose |
|---|---|
| `atlas_db.py` | Observability store: the SQLite SSOT for run health; shares contract helpers (e.g. `is_uri_path`). |
| `session_ingest.py` | Mirrors session transcripts into the DB (omp workers ingest as lead sidechains). |
| `omp_transcript.py` | Converts an omp session file to the Claude transcript shape for the bridge. |
| `omp_runstate.py` | Writes the omp run/dispatch/edit state Claude hooks would have written. |
| `atlas_doctor.py` | Rollback repair (`--fix`, `--hook`), self-improvement miners (`--mine`, `--list-findings`, `--set-status`, `--baseline`, `--remeasure`), `--purge` to cap telemetry tables. |
| `atlas_memory.py` | File-backed memory store: `snapshot`/`list`/`add`/`remove`/`usage`. |
| `atlas_todo.py` | The board and per-worker notes: `list`, `set`, `add`, `claim`, `complete`, `status`, `remove`, `carry`, `counts`, `note`, `notes`. |
| `atlas_finding.py` | Appends verdict rows to `.atlas/.run/findings.json` (the verifier's write path). |
| `atlas_dashboard.py` | Local dashboard: `status`, `serve`, `ensure`, `stop`, `url`; UI at `http://127.0.0.1:7421/`. |
| `atlas_control.py` | Dashboard control plane: behavior knobs, ecosystem inventory, connector writes (allowlisted keys only). |
| `atlas_mux.py` | Opt-in tmux colony (see [below](#tmux-colony-mode-mux)). |
| `atlas_curator.py` | Skill-asset lifecycle: `run`/`status`/`pin`/`unpin`/`restore`. |
| `atlas_context_optimizer.py` | Disables unused skills/agents to cut token cost. |
| `atlas_packs.py` | Resolves Compound Packs declared in `.claude/atlas.local.md`. |
| `atlas_hook_guard.py` | Shared Stop-hook loop guard. |
| `sweep_state.py` | Single-writer engine for `atlas-sweep` state. |
| `tool_routing.py` | Stack signals and the tool-routing boot lines. |
| `turn_scoring.py` | Optional model-scored turn quality. |
| `typesafe_client.py` | Stdlib client for the TypeSafe System One API. |
| `asset_audit.py` | The context-cost lens of `atlas-audit`. |
| `build_hub.py` | Builds the knowledge-graph hub for an audit run. |
| `discover_capabilities.py` | Read-only inventory of installed skills, agents, and tools. |
| `install_hooks.py` | Installs the hooks into a `settings.json` (outside a plugin install). |
| `lint_skill_names.py` | Asserts the `atlas-` skill prefix and slug validity. |
| `lint_docs_names.py` | Docs naming conformance: date-first names and `.atlas` records. |

## Connectors

Twelve optional MCP servers in `plugins/atlas/.mcp.json` (eleven Node bundles
under `plugins/atlas/mcp/<name>/server.mjs`, plus CrowdStrike Falcon launched
with `uv`). Each stays disabled until its `userConfig` credentials exist (51
config keys across the twelve); nothing is networked otherwise. Status tool:
`<vendor>_status` (ConnectWise: `cw_status`) — run it first when a
call 401s; the `connector_credential_watch` hook will usually tell you to
restart the session instead.

| Connector | Covers | Enable with (userConfig keys) | Status tool |
|---|---|---|---|
| Auvik | Network monitoring | `auvik_username`, `auvik_api_key` (+ `auvik_region`) | `auvik_status` |
| ConnectWise Manage | PSA / ticketing | `cw_manage_company_id`, `cw_manage_public_key`, `cw_manage_private_key` (+ client id, base URL) | `cw_status` |
| NinjaOne | RMM, patching, scripts | `ninjaone_client_id`, `ninjaone_client_secret` | `ninjaone_status` |
| Kaseya Spanning | Backup (M365/GWS/Salesforce) | `spanning_admin_email`, `spanning_api_token` | `spanning_status` |
| CIPP | Microsoft 365 multi-tenant | `cipp_base_url` + API key, or client-id/secret | `cipp_status` |
| Blumira | SIEM / XDR | `blumira_jwt_token` or `blumira_client_id`+`blumira_client_secret` | `blumira_status` |
| KnowBe4 | Security-awareness data | `knowbe4_api_key` | `knowbe4_status` |
| ThreatLocker | Zero-trust app control | `threatlocker_api_key` | `threatlocker_status` |
| Vanta | GRC / compliance | `vanta_client_id`, `vanta_client_secret` | `vanta_status` |
| Paylocity | HR / payroll | `paylocity_client_id`, `paylocity_client_secret` (+ `paylocity_company_id`) | `paylocity_status` |
| PAN-OS | Palo Alto firewall / Panorama | `panos_host`, `panos_api_key` (+ username/password for keygen, `panos_target`) | `panos_status` |
| CrowdStrike Falcon | Endpoint, identity, SIEM, SOAR, SaaS posture | `falcon_client_id`, `falcon_client_secret` (+ `falcon_base_url`, `falcon_member_cid`) | `falcon_status` |

Connector source lives in `mcp_servers/` (11 vendor `*-mcp` projects, a
`_shared/` helper, and `mcp-gateway`, an Entra-ID remote gateway not declared
in `.mcp.json`); `falcon` is vendored at `plugins/atlas/mcp/falcon`.

## Colony and orchestration

![Atlas architecture](img/architecture-section-header.png)

One lead orchestrator, named sibling workers, one shared board. Every
dispatch is named: in Claude Code the dispatch tripwire denies an unnamed
`atlas:*` dispatch (convention `<role>-<slice>`, e.g. `auth-explorer`); in omp
each `task` item takes a unique CamelCase `name` (<=32 chars). The name is the
sibling address: a worker reaches a sibling with `write agent://<Name>` in omp
(`SendMessage` by roster name in Claude Code). Workers report to the lead,
never to the user, and never dispatch other subagents.

Dispatch discipline is enforced. Every `atlas:*` dispatch prompt must contain
`GOAL:`, `DELIVERABLE:`, `SUCCESS CRITERIA:`, `OUT OF SCOPE:`, and
`STOP CONDITIONS:` (exactly one GOAL) — the full spec shape lives in
`plugins/atlas/skills/atlas-orchestrate/references/subagent-kit.md`. Parallel
writers get `isolation: "worktree"`.

The board (`<project>/.atlas/.run/todos.json`; per-worker notes at
`.atlas/.run/board/<owner>.jsonl`) is claim-before-work state shared by lead
and workers:

```bash
TODO="${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py"
python3 "$TODO" list                                   # read the board
python3 "$TODO" claim --id 3 --owner AlphaDocs         # claim an item before working
python3 "$TODO" complete --id 3 --evidence "pytest -k csv: 12 passed"
python3 "$TODO" note --owner AlphaDocs --to lead "API slice staged in worktree"
python3 "$TODO" notes --to lead                        # read what siblings left
```

Claude Code mirrors every `TodoWrite` into the board; omp mirrors its `todo`
tool through the extension; under omp, messages between siblings
(`write agent://<Name>`) are additionally appended to the board notes
(`.atlas/.run/board/<sender>.jsonl`) — omp-only, fails open. Never edit
`todos.json` or `board/*.jsonl` directly; go through `atlas_todo.py`.

Dispatched agents run on the model and effort pinned in their agent
definitions; override per dispatch only with a stated reason.
Fork-mode dispatches (`atlas:planner`, `atlas:completeness-critic`,
`atlas:docs-curator`) inherit session history; fresh dispatches
(`atlas:verifier`, `atlas:explorer`) start empty so verification stays
independent.

## Tmux colony mode (mux)

Opt-in: set `ATLAS_MUX=tmux` in the lead's environment before dispatching.
Each worker then runs as its own detached headless process (`claude -p` or
`omp -p`) in a window of one tmux session named `atlas-<run>`; the in-process
colony stays the default otherwise. The lead forwards its 18 `ATLAS_*`/profile
env switches (`FORWARDED_ENV` in `scripts/atlas_mux.py`) so a worker honors the
lead's kill switches; watch panes with tmux itself:

```bash
export ATLAS_MUX=tmux
cd /path/to/project
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" spawn \
  --run fix-500 --harness omp \
  --name AlphaFix --agent implementer \
  --prompt-file .atlas/.run/alpha-fix.md \
  --root "$PWD"
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" status --run fix-500
tmux attach -t atlas-fix-500            # observe the detached workers
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" kill --run fix-500    # idempotent
```

`--harness {claude,omp}`; `--agent` is the atlas role (e.g. `implementer`);
`--prompt-file` is the worker's brief; `--root` defaults to
`ATLAS_PROJECT_ROOT` or cwd. Tier enforcement: `spawn` refuses (ok:false, exit
2, before any tmux call) when the role's definition yields no usable model —
the only override is `--model M` paired with `--effort E` (claude) or
`--thinking T` (omp). Optional env: `ATLAS_MUX_OMP_CONFIG` (config.yml path for
`@role` alias resolution), `ATLAS_MUX_OMP_EXTENSION` (pin the worker's
extension). Each worker is identified by `ATLAS_WORKER_NAME`; its output and
the exact harness argv are posted to the board notes (`atlas_todo.py notes
--to lead`).

## omp parity

Atlas runs on both harnesses through `plugins/atlas/omp/` (load instructions in
[Install](#install-and-update); contracts shared with the Python hooks live in
`plugins/atlas/contracts/`). Status detail:
[docs/atlas-harness-parity.md](docs/atlas-harness-parity.md). Runtime notes:
`plugins/atlas/omp/README.md`.

**Works in omp** (rules shared with the Claude Code hooks through `plugins/atlas/contracts/`):

| Capability | Switch |
|---|---|
| Native grep/glob denied toward reachable lean-ctx; exploration-only `bash` denied toward it; every `bash` routed through `lean-ctx -c` | `ATLAS_TRIPWIRE_HARD=off`, `ATLAS_LEAN_SHELL=off` |
| Recall gate, "Recall first" boot line, ponytail-before-commit nudge | `ATLAS_MANDATES=off` |
| Output style plus an omp-only lead addendum, rendered once per session | `ATLAS_STYLE=off` |
| Hook bridge runs the Claude hooks from `hooks.json`; at `session_stop` the definition-of-done gate, ingest, chronicle, memory capture, and nudge run (at most 3 consecutive gate blocks) | `ATLAS_HOOK_BRIDGE=off`, `ATLAS_STOP_BRIDGE=off`, `ATLAS_GATE=off` |
| Dispatch tripwire through the bridge, plus a model-override deny on `before_subagent_spawn` | `ATLAS_TRIPWIRE_HARD=off` |
| Advisor board gate: advisor `concern`/`blocker` notes become board items and block stop up to 3 times | `ATLAS_ADVISOR_GATE=off` |
| Worker output-token cap (default 32000, never raised) | `ATLAS_WORKER_MAX_TOKENS` |
| `todo`-to-board mirror, so omp workers have claimable items | — |
| Every `write agent://<Name>` also appended to `.atlas/.run/board/<sender>.jsonl` (omp-only, fails open) | — |

**Differs or not yet verified live:**

| Item | Detail |
|---|---|
| Marketplace install is Claude-dialect | Generated `omp/agents/` (model tiers) are used only when the `omp/` directory is loaded as an extension; otherwise `agents/*.md` run model-less. |
| Tmux mux workers | omp reports each as a main session; `ATLAS_WORKER_NAME` is the leaf marker. |
| Memory capture | Runs in omp; its durable-write path has not been observed live. |
| Inline-op, production-edit, and dispatch-spec denies | Tested against the real hook through the bridge; not yet observed in a live omp session. |
| Mixed `task` batches | The run-state fallback logs one row per batch (first agent only), so it undercounts. |
| Tool-state directories (e.g. `.serena/`) | omp exempts them from the shell-edit count; Claude Code's condition (m) still counts them. |
| `session_shutdown` budget | omp allows handlers 2 s; a slow transcript conversion skips that shutdown's ingest (the Stop-time ingest still ran). |

13 generated omp agents: `plugins/atlas/omp/agents/` (regenerate with
`bun plugins/atlas/omp/gen-agents.ts`; never edit generated copies). Per-role
model tiers resolve through `modelRoles.atlas-worker` / `modelRoles.atlas-verifier`
in `~/.omp/agent/config.yml`.

## Docs as the single source of truth

![Atlas docs and wiki](img/docs-wiki-header.png)

`docs/` is canonical: `atlas-setup` scaffolds it, `atlas:docs-curator` keeps it
current after every ship, `atlas:docs-auditor` flags drift, `atlas-wiki`
regenerates `docs/wiki/` from `docs/architecture/`, and the completion gate
(condition f) refuses to close when source changed and `docs/CHANGELOG.md`
did not. `.atlas/` holds atlas's internal state (`.atlas/evidence/`,
`.atlas/audits/`, `.atlas/findings/`, `.atlas/decisions/`, `.atlas/departments/`, `.atlas/graphify/`, ephemeral `.atlas/.run/`). Atlas's own
development docs sit in this repo's `docs/` (CHANGELOG, ROADMAP, architecture,
standards, lessons, plans).

## Repository layout

```text
tech-tools/
|- .claude-plugin/           # marketplace.json catalog (tech-tools, v4.5.1)
|- README.md, AGENTS.md, CONTRIBUTING.md
|- img/                      # repo imagery
|- docs/                     # canonical documentation (SSOT)
|- plugins/
|  |- atlas/                 # the plugin (v9.5.1)
|  |  |- .claude-plugin/     # plugin.json + userConfig (51 keys)
|  |  |- .mcp.json           # 12 connector server definitions
|  |  |- package.json        # omp.extensions entry
|  |  |- skills/             # 47 skills
|  |  |- agents/             # 13 role agents
|  |  |- hooks/              # 16 bound programs (the 17th, atlas_doctor.py, is in scripts/) + helpers + hooks.json + tests
|  |  |- scripts/            # 25 scripts + tests
|  |  |- contracts/          # shared JSON contracts (Python hooks + omp modules)
|  |  |- omp/                # omp extension package incl. generated agents/
|  |  |- mcp/                # bundled connector servers (11 Node + falcon)
|  |  |- output-styles/      # atlas-orchestrator
|  |  |- references/         # supporting reference docs
|  |  \- CHANGELOG.md
|  |- armada/                # optional org-deployment plugin (v1.1.1)
|  |- programmer/            # optional Pragmatic Programmer auditor (v0.2.1)
|  |- _standards/            # shared authoring standards
|  \- _templates/            # agent/command templates
|- skills/                   # 12 standalone skills not tied to one plugin
|- mcp_servers/              # connector source (11 vendor projects + _shared + mcp-gateway)
|- mcp_node/                 # Node client libraries the servers depend on
|- fallow-baselines/         # fallow audit baselines (dead-code/health/dupes)
|- test-mcp-tools.mjs        # connector boot gate
\- pyrightconfig.json
```

## Prerequisites and configuration

- **Python 3** for the 17 hook programs and the `scripts/` tooling; stdlib
  only, no third-party imports. **Bun** only to run the omp tests or regenerate
  omp agents. **uv** only for the Falcon connector. **tmux** only for
  [mux mode](#tmux-colony-mode-mux).
- **claude-mem** and **context-mode** companion plugins: `atlas-setup` detects
  them and offers to install. The recall gate is armed only when claude-mem is
  enabled; without it the gate stays silent instead of denying.
- **Prompt model decision is optional and local.** The ambiguous band of
  engineering-prompt arming can call a local System One model at
  `http://127.0.0.1:11434`, tag `nimble`, 4 s timeout (`hooks/prompt_decision.py`).
  Timeout, low confidence, or `ATLAS_DECISION=off` keep the regex answer.
- **TypeSafe scoring is optional**: off unless `TYPESAFE_API_KEY` is set, or an
  explicit loopback `ATLAS_TYPESAFE_URL` (+ `ATLAS_TYPESAFE_MODEL`).
- **Connector credentials are optional per server** (table above). Set them
  as the plugin's `userConfig` values (51 keys); each server receives them as
  `CFG_*` env vars (mapped in `plugins/atlas/.mcp.json`) and also reads a
  plugin-root `.env` via `ATLAS_ENV_FILE`. Nothing is committed.
- **Dashboard** (`atlas_dashboard.py serve|ensure|stop|url|status`) binds
  loopback only (`127.0.0.1:7421`, port via `ATLAS_DASHBOARD_PORT`) unless
  `--allow-remote` is passed.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every first tool call is denied with `[atlas gate] REQUIRED once per session: ...` | Recall gate is armed (claude-mem enabled), no claude-mem call this session yet. | Make one claude-mem recall (e.g. a search of prior work). To disable: `ATLAS_MANDATES=off`. |
| `DENY - 6 inline ops since your last dispatch...` | Tripwire: orchestrator is doing too much inline work. | Dispatch `atlas:implementer` (edits) or `atlas:explorer` (investigation); `docs/`/`.atlas/` writes don't count. `ATLAS_TRIPWIRE_HARD=off` to lift. |
| Stop blocked listing `(a)`, `(f)`, ... | Completion gate found unmet conditions. | Fix the listed ones: capture evidence to `.atlas/evidence/`, write a verified finding via `scripts/atlas_finding.py`, update `docs/CHANGELOG.md`, drain todos. `ATLAS_GATE=off` disables. |
| Connector tool 401s / credential watch fires | Stale or missing credentials for that server. | Re-set the server's `userConfig` keys, then restart the session (hooks and servers re-resolve at start). |
| Atlas workers still run old paths (`atlas_todo.py` unresolved) after `omp plugin upgrade` | Long-lived omp process kept the pre-upgrade `CLAUDE_PLUGIN_ROOT`. | Restart omp; the extension re-resolves the plugin root at load. |
| Doctor warns on downgrade or forked marketplace | Installed plugin version is lower than marketplace, or the marketplace points at a fork. | `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --fix`, then re-run `claude plugin marketplace update tech-tools`. |
| `atlas_mux.py spawn` exits 2 with `ok:false`, "tier enforcement: no model for role '<role>' …" | Role definition yields no model tier. | Pass `--model M` together with `--effort E` (claude) or `--thinking T` (omp); check the agent file exists in the right dir. |
| Hooks never fire | `hooks.json` not loaded (bare-skill install rather than a plugin install) | Install as a plugin, or run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py"`. |
| `fallow audit` blocks `git commit`/`git push` | Fallow gate returned `verdict: fail` for findings newer than the saved baselines in `fallow-baselines/`. | Fix the finding, or skip once with `ATLAS_FALLOW=off`. |

## License

Apache-2.0. Author: [w159](https://github.com/w159). Repository:
[github.com/w159/tech-tools](https://github.com/w159/tech-tools).