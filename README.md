<div align="center">

<img src="img/project-logo-icon.png" alt="Atlas logo" width="120" />

# Atlas

**A self-configuring Claude Code plugin that turns any coding agent into a disciplined multi-agent architect.**

![Atlas README hero banner](img/readme-hero-banner.png)

</div>

Atlas is a plugin for Claude Code (and, through its omp extension package, omp).
It enforces a research-to-verify contract with hooks, runs work through a colony
of named role subagents that share one durable board, keeps persistent memory
across sessions, and mines its own telemetry for self-improvement. Onboard a
project once with `/atlas`, then drive everything by typing a skill name or
describing the work in plain language. Current release: **10.3.1**.

| Surface | What you get | Source |
|---|---|---|
| Skills | 47 (2 manual: `atlas`, `atlas-setup`; 45 auto-trigger from their description) | `plugins/atlas/skills/` |
| Agents | 13 role agents (`atlas:*`) | `plugins/atlas/agents/` |
| Hooks | 17 programs, 21 command bindings, 8 lifecycle events | `plugins/atlas/hooks/hooks.json` |
| Scripts | 37 non-test Python scripts (plus unit tests beside them) | `plugins/atlas/scripts/` |
| Workboard v2 | Loopback web dashboard (the shell of the colony UI): 8 pages, live SSE updates, token-guarded API; Colony is one page that frames the herdr web UI edge to edge; reached remotely at `/atlas/**` through the herdr web UI front door | `plugins/atlas/scripts/dashboard_ui/`, [docs](docs/atlas-workboard.md) |
| Browser automation | 3 skills (`atlas-test-browser`, `atlas-dogfood`, `atlas-ux-test`) driving a real browser through `atlas:ui-runtime-tester` | [section](#browser-automation-and-testing) |
| MCP connectors | 12, optional, each disabled until credentials exist | `plugins/atlas/.mcp.json` |
| Output style | 1 (`atlas-orchestrator`, force-applied) | `plugins/atlas/output-styles/` |
| omp extension | 1 package, 13 generated omp agents | `plugins/atlas/omp/` |

The marketplace catalog (`.claude-plugin/marketplace.json`, name `tech-tools`)
lists three plugins. Only `atlas` is required; `armada` (org-deployment layer)
and `programmer` (Pragmatic Programmer auditor) are independent optional
installs. Version history: [docs/CHANGELOG.md](docs/CHANGELOG.md) and
[plugins/atlas/CHANGELOG.md](plugins/atlas/CHANGELOG.md).

## Table of contents

1. [What Atlas does](#what-atlas-does)
2. [Install and update](#install-and-update)
3. [Use it in chat](#use-it-in-chat)
4. [Scripting and CI (headless)](#scripting-and-ci-headless)
5. [The operating contract](#the-operating-contract)
6. [Skills](#skills)
7. [Agents](#agents)
8. [Hooks](#hooks)
9. [Scripts](#scripts)
10. [Connectors](#connectors)
11. [Colony and orchestration](#colony-and-orchestration)
12. [Herdr colony mode (mux)](#herdr-colony-mode-mux)
13. [Colony, herdr and Tailscale](#colony-herdr-and-tailscale)
14. [Browser dashboard (Atlas Workboard)](#browser-dashboard-atlas-workboard)
15. [Browser automation and testing](#browser-automation-and-testing)
16. [omp parity](#omp-parity)
17. [Docs as the single source of truth](#docs-as-the-single-source-of-truth)
18. [Repository layout](#repository-layout)
19. [Prerequisites and configuration](#prerequisites-and-configuration)
20. [Troubleshooting](#troubleshooting)
21. [License](#license)

## What Atlas does

![Atlas command center](img/command-center-hero.png)

| Axis | Stock agent | With Atlas |
|---|---|---|
| Claiming done | "This should work." | `completion_gate.py` blocks the Stop until real command output, a verified finding, drained todos, and current docs exist. |
| Big tasks | One long inline session | Decomposed into named stages, each dispatched to a role subagent with one failable check (`atlas-orchestrate`, `atlas:planner`). |
| Verification | Written by the context that wrote the fix | A fresh, adversarial `atlas:verifier` re-checks against real evidence before the finding is recorded as `verified`. |
| Your prompt | Sent as typed | Optionally rewritten through a local model for a sharper task (`hooks/prompt_optimizer.py`; opt-in, see [Prerequisites](#prerequisites-and-configuration)). |
| Memory | Forgotten at session end | Durable lessons saved to `~/.atlas/memory/` at Stop, reloaded at boot (`hooks/memory_capture.py`). |
| Docs | Drift silently | `docs/` is the source of truth; an inline watch and the completion gate refuse to let docs fall behind code. |
| Repeated mistakes | Re-made every session | Session telemetry is mined into findings you accept or skip, then re-measured against a baseline (`atlas-doctor`). |

## Install and update

![Atlas plugin marketplace tile](img/plugin-marketplace-tile.png)

**Claude Code.**

```bash
claude plugin marketplace add w159/tech-tools    # first time only
claude plugin marketplace update tech-tools      # refresh the catalog
claude plugin update atlas@tech-tools            # update the plugin
```

Restart the session after an update; hooks and `${CLAUDE_PLUGIN_ROOT}` resolve
at session start.

**omp.** Update the catalog first, upgrade second, then restart omp:

```bash
omp plugin marketplace update tech-tools         # catalog first
omp plugin upgrade atlas                         # then the plugin
omp plugin list                                  # confirm the installed version
```

Inside an omp session the equivalents are `/marketplace update tech-tools`,
`/marketplace upgrade atlas@tech-tools`, then `/reload-plugins`
(`omp://marketplace.md`). Claude Code and omp keep separate installs; update
both.

For the per-role model tiers of the generated omp agents, or to run the
extension from a source checkout, load it by directory:

```bash
omp --extension /absolute/path/to/tech-tools/plugins/atlas/omp
```

or add that path under `extensions:` in `~/.omp/agent/config.yml` (default
profile only; named profiles have their own config) and restart omp.

## Use it in chat

Atlas is driven from the chat prompt of Claude Code or omp. Type a skill name
followed by what you want, or just describe the work: 45 of the 47 skills
auto-trigger from their description. The two manual skills, `/atlas` and
`/atlas-setup`, you invoke yourself. The output blocks below are illustrative
sketches, not captured runs; real answers are longer, but open with the
`ATLAS | <glyph> <phase> | <state>` status line the output style requires.

**Boot a project once.**

```text
/atlas
```

```text
ATLAS | 🔍 research | claude-mem and context-mode found; scan done
Dependencies: ok     Hooks: active     docs/ SSOT: seeded
Next: atlas-orchestrate for multi-step work, or /atlas menu
```

`/atlas` verifies the two companion plugins, scans the project, recommends
tooling (asking before any install or write outside `docs/` and `.claude/`),
wires hooks, and seeds `docs/`. Optional arguments: `menu [need] | deps |
discover | hooks | config | all`. `/atlas-setup` handles onboarding, install,
connectors and repair: `[onboard | install | connectors | repair [--fix] |
task description | 'menu']`.

**Not sure which skill to use?**

```text
/atlas menu fix a flaky test
```

```text
ATLAS - what do you want to do?
  Fix & improve existing code
    atlas-debug     reproduce a failure, root-cause it, fix in place with proof
  ...
Best fit: atlas-debug - the actual cause must be found, not just the symptom.
```

**Build, fix, audit, ship** (same text in Claude Code and omp):

```text
atlas-feature add CSV export to the reports page
atlas-debug login returns 500
atlas-audit
```

```text
ATLAS | 🔧 implement | CSV export: explorer mapped 4 files, implementer dispatched
ATLAS | ✅ verify | atlas:verifier re-ran the suite from a fresh context
ATLAS | 🏁 done | pytest output captured; finding recorded as verified
```

Skills hand off to each other in plain language: an audit finding is acted on
with `atlas-launch`, finished work is committed with `atlas-commit` (local
only) or `atlas-ship` (commit and optionally push or open a PR).

**Run a big task as a colony.**

```text
atlas-orchestrate ship the rate limiter across API and cache
```

The lead splits the work into named workers that share one board. Watch it in
the [Workboard](#browser-dashboard-atlas-workboard); add `ATLAS_MUX=tmux` to
run workers as herdr panes ([mux mode](#herdr-colony-mode-mux), remote viewing
in [Colony, herdr and Tailscale](#colony-herdr-and-tailscale)).

**Check the changes in a real browser.**

```text
smoke test the routes my branch touches
```

```text
| Route         | Status | Notes                                       |
| /broken.html  | Fail   | GET /api/metrics 404; renderChart undefined |
Remediation: run atlas-dogfood or atlas-debug with the failed routes as scope.
```

More browser prompts are in [Browser automation and testing](#browser-automation-and-testing).

**In omp**, the same prompts work after the extension is installed. To name a
skill explicitly, use the `/skill:` form, for example
`/skill:atlas-test-browser current`.

Hit a wall? A blocked Stop, a denied first tool call, a missing connector:
see [Troubleshooting](#troubleshooting). Every guard has an off switch listed
under [Kill switches](#the-operating-contract).

## Scripting and CI (headless)

Atlas also runs non-interactively. This is for pipelines, not day-to-day use.

```bash
claude -p "atlas-audit" --output-format stream-json --verbose
omp -p "atlas-audit" --mode json
```

| Purpose | Claude Code | omp |
|---|---|---|
| Non-interactive run | `-p, --print` | `-p, --print` |
| Machine-readable output | `--output-format stream-json` (needs `--verbose`) | `--mode json` |
| Restrict tools | `--permission-mode <mode>`, `--allowedTools` | `--tools read,grep,glob` |
| Cap spend or time | `--max-budget-usd N` | `--max-time 10m` |
| Load a source checkout | `--plugin-dir <path>` | `-e, --extension <dir>` |
| No saved session | n/a | `--no-session` |

All flags are from `claude --help` and `omp --help`. Why `stream-json`: the Stop
gate adds a closing turn and `-p` prints only the last assistant message, so the
real answer appears only in the stream. First-tool-call denials by the recall
gate in headless runs are expected unless the claude-mem search tool is
allowed; `ATLAS_MANDATES=off` disables it for throwaway runs. omp prints MCP
connector warnings on stderr, so `omp -p ... > answer.md` captures only the
answer. For unattended browser smoke checks use `atlas-test-browser
mode:pipeline`.

## The operating contract

Every non-trivial task moves through fixed stages. Hooks make the contract
executable rather than advisory.

```text
research -> theory -> test -> validate -> implement -> verify -> done
   |          |         |          |           |           |      |
 map the    form a   define a   check the    minimal    fresh,   evidence
 ground     plan     failing    plan vs      diff by    in-dep.  shown:
 (explorer)           check     reality      the lead   recheck  cmd + output
```

The visible surface of the contract (phases, status-line pattern, required todo
phases) lives in `plugins/atlas/contracts/operating-contract.json`. What the
hooks enforce, with the message you will see:

**Recall gate** (`hooks/recall_gate.py`, PreToolUse on every tool). Armed only
when claude-mem is enabled; main thread only (subagents are exempt). Until one
real claude-mem call happens in the session, every other first tool call is
denied. `TodoWrite` (omp `todo`) is exempt: it is neither denied nor does it
satisfy the gate.

```text
[atlas gate] REQUIRED once per session: your first tool call must be one
claude-mem recall for this project (<route>). Example search args: {"query":
"<prior work on this project>"} Every other tool call is denied until you make
it; then continue. ATLAS_MANDATES=off disables it.
```

**Dispatch tripwire** (`hooks/dispatch_tripwire.py`, PreToolUse + PostToolUse).
Denies, all lifted by `ATLAS_TRIPWIRE_HARD=off`:

- Inline-op threshold: after 6 unsanctioned main-thread ops with no dispatch in
  between, the 7th is denied (`DENY - 6 inline ops since your last dispatch ...`).
  Writes to `docs/` and `.atlas/` do not count.
- Native-tool routing: exploration-only `cat`/`grep`/`ls`, and native Grep/Glob,
  are denied toward lean-ctx when it is reachable.
- Dispatch spec: an `atlas:*` dispatch missing any of `GOAL:`, `DELIVERABLE:`,
  `SUCCESS CRITERIA:`, `OUT OF SCOPE:`, `STOP CONDITIONS:`, or carrying more
  than one `GOAL:`.
- Also denied: a dispatch with no `name`, a dispatch that overrides `model`, a
  subagent dispatching another subagent, a dispatch missing the code-nav
  `TOOLS` block, and an `atlas:runner` dispatch without at most 7 numbered
  `STEPS`.
- Production-edit deny: a main-thread `Write`/`Edit` of target code (anything
  outside `docs/` and `.atlas/`) in an orchestration-flagged session is routed
  to `atlas:implementer`. URI-scheme writes (`agent://`, `xd://`) are never
  counted as edits.

`ATLAS_TRIPWIRE=off` disables the drift tiers (nudges); `ATLAS_TRIPWIRE_THRESHOLD`
(default 4) sets the nudge tier.

**Completion gate** (`hooks/completion_gate.py`, Stop). Sixteen conditions,
(a) to (p). It engages only in a project with a `docs/` directory, stays silent
while a dispatch is in flight, and prints one block message listing exactly
which conditions are unmet:

- (a) evidence saved under `.atlas/evidence/` during this run
- (b) a finding with status `verified` in `.atlas/.run/findings.json`, stamped this run
- (c) `docs/CHANGELOG.md` exists and is non-empty
- (d) `docs/ROADMAP.md` exists and is non-empty
- (e) root `README.md` exists and is non-empty
- (f) no docs drift: non-docs files written this run, but no `docs/` file changed
- (g) verification coverage: shipped implementer dispatches are covered by an
  `atlas:verifier` dispatch or a `verified` finding backed by an executed test run
- (h) `docs/ROADMAP.md` holds no items with status `done` (they belong in the CHANGELOG)
- (i) todo list drained
- (j) this run's git worktrees closed
- (k) a plan existed on some surface (TodoWrite, board items, or ledger line) before code shipped
- (l) dated artifacts touched this run use date-first names
- (m) delegation mandate: at least one `Task`/`Agent` dispatch when main-thread code shipped outside `docs/`
- (n) status header: an orchestrating session's final reply starts with `ATLAS | <glyph> <phase> | <state>`
- (o) phased todo: when code shipped, the session's board items cover the `implement` and `verify` phases
- (p) colony channel: with two or more atlas workers dispatched, the board notes or IRC show use by someone other than `lead`

(a), (b), (f) and (g) apply only when the run shipped non-docs code. (n), (o)
and (p) ask for presentation repairs, so each blocks at most once per session;
(a) to (m) re-block on every Stop until they hold. Fix the listed condition
(paste the test output, write the finding with
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"`, dispatch the
verifier), then stop again.

**Docs drift watch** (`hooks/docs_drift_watch.py`, PostToolUse on Edit/Write)
warns when non-docs files change with no `docs/` update yet: the first drifting
edit warns, then every 5th, until a `docs/` change clears it.

**Kill switches.** Every guard is env-gated; set the switch in your shell or in
`~/.claude/settings.json` `env`:

| Env var | Off-switch effect |
|---|---|
| `ATLAS_GATE=off` | completion gate (Claude Code) and the bridged Stop-time delegation check (omp) |
| `ATLAS_GATE_HEADER=off` | completion-gate condition (n), status header |
| `ATLAS_GATE_PHASES=off` | completion-gate condition (o), phased todo |
| `ATLAS_GATE_COLONY=off` | completion-gate condition (p), colony channel |
| `ATLAS_TRIPWIRE_HARD=off` | tripwire denies: native grep/glob routing, inline-op threshold, spec/name/model denies, omp model-override deny |
| `ATLAS_TRIPWIRE=off` | tripwire drift tiers (nudges) |
| `ATLAS_MANDATES=off` | recall gate, "Recall first" boot line, ponytail nudge |
| `ATLAS_DASHBOARD=off` | SessionStart dashboard auto-start (`0`, `off`, `false`, `no`) |
| `ATLAS_FALLOW=off` | fallow commit/push gate |
| `ATLAS_INGEST=off` | session transcript ingest |
| `ATLAS_CHRONICLE=off` | chronicle facet capture |
| `ATLAS_MEMORY_CAPTURE=off` | memory capture |
| `ATLAS_CONNECTOR_WATCH=off` | stale connector credential detection |
| `ATLAS_TODO=off` | TodoWrite-to-board mirror |
| `ATLAS_ENGINE_ARM=off` | prompt-triggered orchestration arming |
| `ATLAS_DECISION=off` | model-based prompt-arm decision (regex answer stays) |
| `ATLAS_MUX` | unset = in-process colony (default); `ATLAS_MUX=tmux` unlocks `atlas_mux.py spawn` (workers in herdr panes) |
| `ATLAS_COLONY_TRANSPORT` | `tmux` forces tmux windows for workers; unset = herdr, with tmux only when the herdr socket does not answer |
| `ATLAS_COLONY=off` | SessionStart start of the herdr web UI (`0`, `off`, `false`, `no`) |
| `ATLAS_REMOTE_PORT` | HTTPS port `atlas_remote.py` maps with `tailscale serve` (default 8443, never 443) |
| `ATLAS_DASHBOARD_URL` | where the herdr web UI's `/atlas/**` gateway proxies the dashboard (loopback only; default `http://127.0.0.1:7421`) |
| `ATLAS_LANDING=off` | the herdr web UI's redirect of a browser visit of `/` to the dashboard (`/atlas/#/herd`); the herdr app is then served at `/` |
| omp only: `ATLAS_HOOK_BRIDGE`, `ATLAS_STOP_BRIDGE`, `ATLAS_LEAN_SHELL`, `ATLAS_ADVISOR_GATE`, `ATLAS_STYLE`, `ATLAS_NATIVE_POLICY` | see [omp parity](#omp-parity) |

## Skills

Type the skill name or describe the work; every skill except the two manual
ones auto-triggers from its `description`. In chat either `atlas-debug login
returns 500` or `/atlas-debug login returns 500` works in Claude Code.
Source: `plugins/atlas/skills/`.

| Skill | When to use | Example invocation |
|---|---|---|
| `atlas` | setting up atlas in a project (manual) | `/atlas` |
| `atlas-setup` | first bringing atlas online, setting up a workspace, or fixing atlas (manual; `--fix`) | `/atlas-setup` |
| `atlas-orchestrate` | a task spans layers or the whole repo | `atlas-orchestrate ship the rate-limiter across API + cache` |
| `atlas-autopilot` | a plan or fix executed end to end autonomously, stopping before any push, PR or merge | `atlas-autopilot fix the flaky cart test` |
| `atlas-brainstorm` | a feature idea is vague and needs scoping before planning | `atlas-brainstorm add offline mode` |
| `atlas-plan` | requirements are settled and a plan is needed before execution | `atlas-plan split invoice storage out of the monolith` |
| `atlas-feature` | implement or add a feature or build new functionality | `atlas-feature add CSV export` |
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
| `atlas-wiki` | architecture docs changed or wiki diagrams are stale or missing | `atlas-wiki` |
| `atlas-simplify` | after implementing a change and before review or commit | `atlas-simplify` |
| `atlas-review` | reviewing a changeset before merge; not whole-codebase audits | `atlas-review PR #142` |
| `atlas-audit` | audit a repo, map its architecture before a refactor, or check atlas health | `atlas-audit` |
| `atlas-doctor` | telemetry has accumulated, atlas should self-improve, or before skill/hook/agent changes | `atlas-doctor` |
| `atlas-db-audit` | reviewing a database before any schema or permission change | `atlas-db-audit` |
| `atlas-compound` | a problem was solved and verified and a future engineer would repeat the mistake | `atlas-compound` |
| `atlas-strategy` | starting a product, adding a strategy doc, or changing direction | `/atlas-strategy` |
| `atlas-pulse` | a product pulse, health snapshot, or usage and error summary | `atlas-pulse 7d` |
| `atlas-sweep` | new issues or feedback need sweeping and triage | `atlas-sweep` |
| `atlas-bakeoff` | choosing an architecture, library or data-model shape | `atlas-bakeoff sqlite vs postgres for the queue` |
| `atlas-pov` | an opinion or second opinion on a technical choice | `atlas-pov should we switch ORMs` |
| `atlas-explain` | how something works, why something happens, or what a file or message means | `atlas-explain why the retry loop exists` |
| `atlas-prototype` | a question is cheaper to demonstrate than argue about | `atlas-prototype sketch the new nav` |
| `atlas-optimize` | a working system's metric should improve and the winning change is unknown | `atlas-optimize cut the prompt tokens 30%` |
| `atlas-feedback-analysis` | analyzing feedback, transcripts or tickets for pain points and requests | `atlas-feedback-analysis docs/feedback/2026-09.md` |
| `atlas-commit` | changed files are ready to commit locally | `atlas-commit` |
| `atlas-ship` | verified, gate-passing work is ready to commit and optionally push or open a PR | `atlas-ship` |
| `atlas-babysit-pr` | an open PR needs CI watched and genuine failures repaired | `atlas-babysit-pr #142` |
| `atlas-resolve-pr-feedback` | a PR has open review comments to address | `atlas-resolve-pr-feedback #142` |
| `atlas-worktree` | isolating parallel implementer waves, spikes or bakeoffs | `atlas-worktree branch for the payment spike` |
| `atlas-polish` | a surface needs spacing, transition or micro-interaction polish | `/atlas-polish` |
| `atlas-dogfood` | changed flows must work end to end and small breakages should be fixed autonomously | `atlas-dogfood current` |
| `atlas-test-xcode` | building or testing an iOS or Xcode project; macOS only | `atlas-test-xcode current` |
| `atlas-test-browser` | a quick check that changed routes still render | `atlas-test-browser current` |
| `atlas-ux-test` | a full UI/UX test pass: persona testing, pre-release sweep, re-test after fixes | `atlas-ux-test the checkout flow` |
| `atlas-proof` | sharing a plan, spec or draft for review or acting on its comments | `atlas-proof docs/plans/x.md` |
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
`completion_gate.py`, and `fallow_gate.py` deny on purpose.

| Program | Event(s) | Effect | Off switch |
|---|---|---|---|
| `session_boot.py` | SessionStart | Loads contract, memory, board carry-over, tool routing; claude-mem "Recall first" line; starts the dashboard and prints its URL. | `ATLAS_DASHBOARD=off` (dashboard part) |
| `scripts/atlas_doctor.py --hook` | SessionStart | Rollback guard: warns on downgrade, forked marketplace, or missing hooks/assets. | n/a |
| `prompt_optimizer.py` | UserPromptSubmit | Optional model-rewritten prompt; arms orchestration on engineering prompts. | `ATLAS_ENGINE_ARM=off`, decision part `ATLAS_DECISION=off` |
| `recall_gate.py` | PreToolUse (all) | claude-mem recall gate (see message above). | `ATLAS_MANDATES=off` |
| `bash_advisor.py` | PreToolUse (Bash) | Warns on catastrophic commands; one ponytail-before-commit nudge per session. Advisory only. | n/a |
| `fallow_gate.py` | PreToolUse (Bash) | On `git commit`/`git push`, runs `fallow audit`; denies on `verdict: fail`. Fail-open when the CLI is absent. | `ATLAS_FALLOW=off` |
| `dispatch_tripwire.py` | PreToolUse + PostToolUse | Denies covered in [the operating contract](#the-operating-contract); mirrors dispatch state. | `ATLAS_TRIPWIRE_HARD=off`, `ATLAS_TRIPWIRE=off` |
| `todo_capture.py` | PostToolUse (TodoWrite) | Mirrors every plan into `<project>/.atlas/.run/todos.json`. | `ATLAS_TODO=off` |
| `format_after_edit.py` | PostToolUse (Edit/Write) | Auto-formats the edited file (ruff format then black for Python; prettier for JS/TS/JSON/CSS; gofmt; rustfmt). | n/a |
| `docs_drift_watch.py` | PostToolUse (Edit/Write) | Inline docs-drift warning. | `ATLAS_GATE=off` |
| `connector_credential_watch.py` | PostToolUse (connector tools) | On the first 401/403 from a known connector, says to restart the server instead of sweeping endpoints. | `ATLAS_CONNECTOR_WATCH=off` |
| `completion_gate.py` | Stop | Definition-of-done gate, conditions (a)-(p). | `ATLAS_GATE=off` (plus the three `ATLAS_GATE_*` switches) |
| `ingest_session.py` | Stop, SubagentStop, SessionEnd, PreCompact | Mirrors the transcript into the observability DB. | `ATLAS_INGEST=off` |
| `worker_report_gate.py` | SubagentStop | Blocks an `atlas:*` subagent whose final message is not the fixed report container (`contracts/worker-protocol.json`); once per agent, fail-open. | n/a |
| `chronicle_facet.py` | Stop | One facets row per session plus friction event mirror. | `ATLAS_CHRONICLE=off` |
| `memory_capture.py` | Stop | Writes durable lessons to `~/.atlas/memory/`. | `ATLAS_MEMORY_CAPTURE=off` |
| `nudge.py` | Stop | Throttled self-improvement nudge; silent when memory capture already wrote. | n/a |

Also in `hooks/` but not bound: `docs_drift.py` (library for the gate's drift
condition), `prompt_decision.py` (model-answer band for the prompt rewriter),
`worker_inbox.py` (library the tripwire uses to deliver dashboard-queued
messages to a worker), and `validate-readonly-query.sh` (helper).

## Scripts

Source: `plugins/atlas/scripts/`: 37 non-test Python scripts (counted as `*.py`
excluding `test_*.py`); unit tests sit beside them.

| Script | Purpose |
|---|---|
| `atlas_db.py` | Observability store: the SQLite SSOT for run health. |
| `session_ingest.py` | Mirrors session transcripts into the DB (omp workers ingest as lead sidechains). |
| `omp_transcript.py` | Converts an omp session file to the Claude transcript shape for the bridge. |
| `omp_runstate.py` | Writes the omp run/dispatch/edit state Claude hooks would have written. |
| `atlas_doctor.py` | Rollback repair (`--fix`, `--hook`), self-improvement miners (`--mine`, `--list-findings`, `--set-status`, `--baseline`, `--remeasure`), `--json`, `--status`. |
| `atlas_memory.py` | File-backed memory store. |
| `atlas_todo.py` | The board and per-worker notes: `list`, `set`, `add`, `scaffold`, `claim`, `complete`, `status`, `remove`, `carry`, `counts`, `note`, `notes`. |
| `atlas_finding.py` | Appends verdict rows to `.atlas/.run/findings.json` (the verifier's write path). |
| `atlas_dashboard.py` | Local dashboard daemon: `status`, `serve`, `ensure`, `stop`, `url`; UI at `http://127.0.0.1:7421/`. |
| `atlas_dash_work.py` | Dashboard v2 routes: the todo board (`/api/v2/todos`). |
| `atlas_dash_irc.py` | Dashboard v2 routes: IRC board notes, delivery through herdr (`/api/v2/irc`). |
| `atlas_dash_herd.py` | Dashboard v2 routes: herdr agents, prompts, panes, ensure (`/api/v2/herd/*`). |
| `atlas_dash_insights.py` | Dashboard v2 routes: overview, health, activity, improve, prefs. |
| `atlas_control.py` | Dashboard control plane: behavior knobs, ecosystem inventory, connector writes (allowlisted keys only). |
| `atlas_mux.py` | Opt-in colony workers (`ATLAS_MUX=tmux` unlocks `spawn`); herdr transport by default, tmux fallback (see [below](#herdr-colony-mode-mux)). |
| `atlas_launch.py` | Starts one agent session as a detached herdr pane (tmux window only as the fallback); used by the dashboard and `atlas_mux`. |
| `atlas_herdr.py` | Colony control: `status`, `ensure`, `reap`, `install-check`, `create-pane`; manages the one vendored herdr-web-ui. |
| `atlas_remote.py` | Tailnet-only colony access through `tailscale serve`: `status`, `plan`, `apply --yes`, `disable --yes`, `url`. |
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

In chat, ask for the doctor with `atlas-doctor` or repair with `/atlas-setup
repair`; run the scripts directly from a shell or CI. Inside a session
`${CLAUDE_PLUGIN_ROOT}/scripts/...` resolves to the same files; the omp
extension sets `CLAUDE_PLUGIN_ROOT` itself.

**Side effects to expect.** Running either harness in a directory creates
`.atlas/` there (atlas run state; see [Docs as the single source of
truth](#docs-as-the-single-source-of-truth)) and `/atlas` may write
`.claude/atlas.local.md`. `.serena/` comes from the serena MCP tooling, not
from atlas. Add these to `.gitignore` in real projects.

## Connectors

Twelve optional MCP servers in `plugins/atlas/.mcp.json` (eleven Node bundles
under `plugins/atlas/mcp/<name>/server.mjs`, plus CrowdStrike Falcon launched
with `uv`). Each stays disabled until its `userConfig` credentials exist (51
config keys across the twelve); nothing is networked otherwise. Status tool:
`<vendor>_status` (ConnectWise: `cw_status`); run it first when a call 401s.
In chat, `/atlas-setup connectors` walks you through setup.

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

Connector source lives in `mcp_servers/` (11 vendor projects, a `_shared/`
helper, and `mcp-gateway`, an Entra-ID remote gateway not declared in
`.mcp.json`); `falcon` is vendored at `plugins/atlas/mcp/falcon`.

## Colony and orchestration

![Atlas architecture](img/architecture-section-header.png)

One lead orchestrator, named sibling workers, one shared board. Every dispatch
is named: in Claude Code the dispatch tripwire denies an unnamed `atlas:*`
dispatch (convention `<role>-<slice>`, e.g. `auth-explorer`); in omp each `task`
item takes a unique CamelCase `name` (<=32 chars). The name is the sibling
address: a worker reaches a sibling with `write agent://<Name>` in omp
(`SendMessage` by roster name in Claude Code). Workers report to the lead,
never to the user, and never dispatch other subagents.

Every `atlas:*` dispatch prompt must contain `GOAL:`, `DELIVERABLE:`, `SUCCESS
CRITERIA:`, `OUT OF SCOPE:`, and `STOP CONDITIONS:` (exactly one GOAL); the full
spec shape lives in
`plugins/atlas/skills/atlas-orchestrate/references/subagent-kit.md`. Parallel
writers get `isolation: "worktree"`.

You normally never touch the board by hand; say `atlas-orchestrate ship X
across API and cache` and the workers use these commands automatically. The
board (`<project>/.atlas/.run/todos.json`; per-worker notes at
`.atlas/.run/board/<owner>.jsonl`) is claim-before-work state:

```bash
TODO="${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py"
python3 "$TODO" list                                   # read the board
python3 "$TODO" claim --id <id> --owner AlphaDocs      # claim an item before working
python3 "$TODO" complete --id <id> --evidence "pytest -k csv: 12 passed"
python3 "$TODO" note --owner AlphaDocs --to lead "API slice staged in worktree"
python3 "$TODO" notes --to lead                        # read what siblings left
```

Item ids come from `list` or `add` output. `atlas_todo.py` has no `--help`
(`--help` answers `unknown_command`, and `add --help` would create an item whose
text is `--help`); pass `--root` or set `ATLAS_PROJECT_ROOT` to pick the board.
CLI statuses are `pending`, `in_progress` and `completed`. Claude Code mirrors
every `TodoWrite` into the board; omp mirrors its `todo` tool through the
extension; under omp, messages between siblings are also appended to the board
notes (omp-only, fails open). Never edit `todos.json` or `board/*.jsonl`
directly.

Dispatched agents run on the model and effort pinned in their agent
definitions; override per dispatch only with a stated reason. Fork-mode
dispatches (`atlas:planner`, `atlas:completeness-critic`, `atlas:docs-curator`)
inherit session history; fresh dispatches (`atlas:verifier`, `atlas:explorer`)
start empty so verification stays independent.

## Herdr colony mode (mux)

Opt-in: `export ATLAS_MUX=tmux` in the lead's environment (the name is
historical; it only unlocks `atlas_mux.py spawn`), then ask the lead in chat to
run the colony. Each worker runs as its own detached headless process
(`claude -p` or `omp -p`) in a pane of the herdr workspace `atlas-<run>`, one
tab per worker. herdr is the default transport; tmux (session `atlas-<run>`,
one window per worker) is used only when `ATLAS_COLONY_TRANSPORT=tmux` is set
or the herdr socket does not answer. The in-process colony stays the default
otherwise. Every worker pane carries `ATLAS_PROJECT_ROOT`, `ATLAS_WORKER_NAME`
and the lead's 18 `ATLAS_*`/profile env switches (`FORWARDED_ENV` in
`scripts/atlas_mux.py`) as `env K=V` pins in the pane command, so a worker
honors the lead's kill switches. Spawn manually only to debug:

```bash
export ATLAS_MUX=tmux
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" spawn \
  --run fix-500 --harness omp --name AlphaFix --agent implementer \
  --prompt-file .atlas/.run/alpha-fix.md --root "$PWD"
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" status --run fix-500
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" kill --run fix-500    # idempotent
```

Watch the panes on the dashboard's Fleet lens (the inspector's Terminal tab) or its Colony page (the
herdr web UI as `/?chrome=full`; `http://127.0.0.1:7317/?chrome=full` is that app on its own); with `ATLAS_COLONY_TRANSPORT=tmux`, `tmux attach -t
atlas-fix-500`. `--harness {claude,omp}`; `--agent` is the atlas role;
`--prompt-file` is the worker's brief; `--root` defaults to
`ATLAS_PROJECT_ROOT` or cwd. Tier enforcement: `spawn` refuses (ok:false, exit
2, before any pane call) when the role's definition yields no usable model; the
only override is `--model M` paired with `--effort E` (claude) or `--thinking
T` (omp). Optional env: `ATLAS_MUX_OMP_CONFIG` (config.yml path for `@role`
alias resolution) and `ATLAS_MUX_OMP_EXTENSION` (pin the worker's extension).
Each worker is identified by `ATLAS_WORKER_NAME`; its output and the exact
harness argv are posted to the board notes (`atlas_todo.py notes --to lead`).

## Colony, herdr and Tailscale

The colony is **herdr** (an installed terminal-multiplexer binary, checked
against `plugins/atlas/colony/herdr/PIN.json`) plus the **herdr-web-ui** app
vendored at `plugins/atlas/colony/herdr-web-ui` (MIT; patched, every change is
listed under `ATLAS-PATCHES` in its `UPSTREAM.md`), exactly one instance reused
by every caller. `atlas_herdr.py ensure` mirrors it to `$ATLAS_HOME/colony/`,
builds it and binds `127.0.0.1:7317` when that port is free; when a user-run
upstream herdr-web-ui holds 7317 it starts on a fallback port instead (recorded
in `$ATLAS_HOME/colony/port`) and reports the `takeover` hint. **The Atlas
dashboard is the shell**: its nav (Observe, Operate, Improve, Configure) is the
only Atlas navigation. Operate holds the Fleet, Board and Channel lenses
of the Agents page and **Colony**, a page of its own that is only the
herdr-web-ui app framed edge to edge as `/?chrome=full` (no header, lens bar or
second view; one `Colony` entry on mobile); the old `#/herd`, `#/herdr`,
`#/console` and `#/agents?lens=colony` routes redirect to `#/colony`. The Fleet
inspector's Terminal tab frames one pane as `?chrome=pane`. The legacy
`?embed=1` is retired (rewritten to those modes). The browser reaches the herdr-web-ui Bun server
(directly, or through `tailscale serve`); after its own auth, a plain browser
visit of `/` redirects to `/atlas/#/herd` (which the router sends to `#/colony`) and `/atlas/**` is
proxied to the loopback dashboard on `127.0.0.1:7421`. Env: `ATLAS_LANDING=off`
disables the redirect; `ATLAS_DASHBOARD_URL` points the proxy at the dashboard;
`HERDR_WEB_TOKEN` is the web UI's shared token; `HERDR_WEB_URL` overrides the
colony URL (loopback only); `ATLAS_COLONY=off` skips the SessionStart start;
`ATLAS_COLONY_TRANSPORT=tmux` forces tmux workers; `ATLAS_REMOTE_PORT` sets the
tailnet port (default 8443). Install herdr from https://herdr.dev and run
`herdr` once; Atlas never starts herdr itself. `atlas_herdr.py ensure` reuses a
healthy web UI, waits for an existing `managed.ts`, and otherwise builds the
vendored tree under a lock; `status` reports `duplicates` for a second
instance. To take 7317 from an upstream instance, stop it first, then disable
it: `herdr plugin action invoke stop --plugin devswha.herdr-web-ui`, then
`herdr plugin disable devswha.herdr-web-ui`, `rm -f $ATLAS_HOME/colony/port`,
`atlas_herdr.py ensure` (disable first makes `stop` fail). SessionStart
(`ensure_colony`) reports a healthy web UI or starts `ensure` detached (log:
`$ATLAS_HOME/herdr-ensure.log`).

> **Updating the plugin.** The running omp and Claude Code sessions load the
> **installed plugin cache**, not this repository. The omp worker `--thinking`
> fix, the automatic channel registration for dispatches and workers, and the
> single Colony page reach a live session only after the plugin is committed,
> released and reinstalled or updated from this marketplace repo. Only the
> dashboard daemon on `127.0.0.1:7421` serves this repo's `dashboard_ui/` files
> directly, so the UI part is live there after a browser reload. Until then a
> session on an older cache keeps the old behavior (for example an empty channel
> list).

Remote access is tailnet-only, through `tailscale serve` (never funnel):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_remote.py" status
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_remote.py" plan              # prints the commands, runs nothing
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_remote.py" apply --yes       # https://<node>.<tailnet>.ts.net:8443 -> 127.0.0.1:7317
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_remote.py" disable --yes
```

`ATLAS_REMOTE_PORT` (default 8443, never 443) picks the HTTPS port; the
tailnet URL it prints opens the Atlas dashboard (via the `/` redirect). `apply`
refuses while an anonymous tailnet request would be let in, so set
`HERDR_WEB_TOKEN` or pair a device first: the colony exposes live terminals, so
reaching it is code execution as your user. Details and the auth order:
[docs/atlas-colony.md](docs/atlas-colony.md) and
[remote-access.md](plugins/atlas/skills/atlas-orchestrate/references/remote-access.md).

## Browser dashboard (Atlas Workboard)

![Overview page](img/readme-workboard-overview.png)

One shared, loopback-only web dashboard serves every concurrent coding-agent
terminal: a stdlib Python daemon with a static single-page UI (no build step,
no CDN) and a JSON API. It reads the shared `~/.atlas/atlas.db`, each project's
`.atlas/.run/` (todo board, board notes, findings) and, for Fleet and Colony, the
herdr socket. It never spawns agents; starting a colony is a command it prints
for you to run. For remote or multi-terminal viewing of the terminals, open it
through the herdr web UI front door (`http://127.0.0.1:7317`, redirects to
`/atlas/#/herd`; see
[Colony, herdr and Tailscale](#colony-herdr-and-tailscale)). Workboard v2 (the
single-page UI, `/api/v2`, SSE, the token guard) ships in atlas 10.0.1; older
installs answer 404 on `/api/v2/*`.

**Start.** The SessionStart hook runs `atlas_dashboard.py ensure` and adds one
line to the boot context, then you open the URL once:

```text
dashboard: http://127.0.0.1:7421/ (ready) - open once; all concurrent terminals share it
```

Manual control (from a shell; `${CLAUDE_PLUGIN_ROOT}` resolves inside a session):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_dashboard.py" ensure   # start if needed, print JSON
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_dashboard.py" url      # print the URL (exit 1 if the port is closed)
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_dashboard.py" status   # JSON snapshot
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_dashboard.py" stop
```

`serve [--port N] [--host H] [--foreground] [--allow-remote]` runs the server
directly; a non-loopback `--host` is refused without `--allow-remote`.
Environment: `ATLAS_DASHBOARD_PORT` (default `7421`), `ATLAS_DASHBOARD=off`
(skip auto-start), `ATLAS_DASHBOARD_DB` (default `~/.atlas/atlas.db`),
`ATLAS_HOME` (state directory; point it elsewhere for an isolated instance).

**Eight pages**, hash-routed (`#/<page>`), with a project switcher that scopes
every page (Agents is one page with three lenses):

| Group | Page | What you do there |
|---|---|---|
| Observe | Overview | KPIs, the "Needs attention" inbox, activity trend, recent runs |
| Observe | Activity | Group, filter and search events; live tail; saved views |
| Observe | Health | Subsystem cards (hooks, gates, dispatch, colony, daemon, telemetry DB, connectors, memory, doctor), silent-failure table |
| Operate | Agents | Three lenses. **Fleet**: the live herdr agents with state, a prompt box that only reaches idle agents, an inspector with a Terminal tab. **Board**: the durable todo board (add, claim, edit, change status, reorder, remove). **Channel** (the IRC): what agents and you said to each other, per `<folder>@<branch>` channel and per-lead subchannel; send to the channel or one member |
| Operate | Colony | The herdr web UI framed full height, edge to edge (its own pane list, Chat/Terminal and prompting), nothing around it. When herdr runs but its web UI does not, a **Start terminal service** button (and **Recheck**) replaces the frame |
| Improve | Self-improvement | Observe, mine, propose, apply, remeasure; doctor findings with Mark fixed, Dismiss, Won't fix, Remeasure |
| Configure | Projects | Pin, mute or hide projects |
| Configure | Settings | Theme, density, default project, polling interval, noise filters, behavior knobs, ecosystem toggles, connector credentials |

![Health page](img/readme-workboard-health.png)

![Self-improvement page](img/readme-workboard-improve.png)

Keyboard: `Ctrl/Cmd+K` command palette, `/` focus search, `g` then `o a l h c n w i
p s ,` jumps to a page (`c` Colony, `n` Channel, `w` Board), `?` lists shortcuts. Theme (dark, light, system) and
density persist in `~/.atlas/dashboard-prefs.json`.

![Command palette](img/readme-workboard-palette.png)

**Live updates.** The topbar shows `Live` while `GET /api/v2/stream` (Server-Sent
Events) is connected. Every 5 seconds the server re-reads five topics, `herd`,
`todos`, `irc`, `health` and `improve`, and emits a topic only when its content
hash changed, plus a `tick` and a 15 second heartbeat. If the stream drops the
client polls every 8 seconds and the topbar says `Polling every 8s`.

**Security model.** Every route passes a request guard in this order:

| # | Check | Failure |
|---|---|---|
| 1 | `Host` must be `127.0.0.1:<port>` or `localhost:<port>` | `403 bad_host` |
| 2 | POST and PUT need `Content-Type: application/json` | `415 unsupported_media_type` |
| 3 | A present `Origin` must be the same loopback origin | `403 bad_origin` |
| 4 | Mutations, `/api/v2/stream` and sensitive GETs (IRC, transcripts) need `X-Atlas-Token` | `401 bad_token` |

The token is `secrets.token_urlsafe(32)`, regenerated at every daemon start and
delivered only inside `GET /` as `<meta name="atlas-token">`; `?token=` is
accepted on the stream only. No CORS headers are sent, bodies are capped at 4
MiB, and other read-only GETs are unauthenticated, so keep the loopback
default. External scripts must fetch `GET /` first, read the token, then send
`X-Atlas-Token` and the JSON content type on every mutation.

Sending to an agent from IRC (or from the embedded herdr web UI) goes through
herdr: an idle interactive `claude`/`omp` pane is typed into (IRC stamps the
note `delivered`); a pane that is busy is refused (`409`, IRC keeps the note
`queued`); a shell or other process is refused with `409 pane_not_steerable`;
a headless worker or an agent with no live pane gets a queued board note it
reads on its next tool call.

Full references: [docs/atlas-workboard.md](docs/atlas-workboard.md) (product
overview, agent states, typing guard, onboarding) and
[dashboard-api.md](plugins/atlas/skills/atlas-orchestrate/references/dashboard-api.md)
(routes, guard, SSE, pages, keyboard shortcuts).

## Browser automation and testing

Atlas can put a real browser in front of your running app and report what it
actually did: did the route render, was the console clean, did the network
calls succeed. Three skills cover this, from a quick smoke check up to a full
persona sweep. All browser work is done by the read-only `atlas:ui-runtime-tester`
agent through the browser surface your harness exposes, never inline and never
through an ad hoc Playwright install.

Prompts to type in Claude Code or omp:

```text
smoke test the routes my branch touches
atlas-test-browser PR 482 --port 5173
dogfood this change and fix what breaks, --fix-budget 3
atlas-ux-test users=6 coverage=smoke
run a full UI pass before release, users=12 coverage=full seed=42
```

In omp the explicit form is `/skill:atlas-test-browser current`.

**Options at a glance**

| Skill | Scope | Fixes code? | Arguments | Evidence |
|---|---|---|---|---|
| `atlas-test-browser` | Routes touched by the current diff or PR | No: marks Fail and hands off | PR number, branch, `current`, or `--port PORT`; `mode:pipeline` for unattended runs (claims a free port, starts and stops the server, never prompts) | Pass/Fail/Skip table per route, console and network lines, screenshots under `.atlas/evidence/<date>-<slug>/`, one `findings.json` entry per failed route |
| `atlas-dogfood` | User flows touched by the current diff or PR | Yes, bounded: only via `atlas:implementer`, each fix confirmed by a fresh `atlas:verifier`; never auto-commits | PR number, branch or `current`, `--port PORT`, `--fix-budget N` (default 2 attempts per scenario); stops on an empty diff | Scenario matrix (Pass, Fixed, Skipped, Blocked), regression tests, report at `docs/audits/atlas-dogfood-<branch-slug>-<date>/report.md` |
| `atlas-ux-test` | The whole app, multi-persona | No: detects and reports | `users` (6/12/24 or an integer, default 12), `coverage=smoke\|standard\|full` (default standard), `profile=valid\|mixed` (default mixed), `speed=fast\|thorough` (default fast), `seed`; browser walk only in `standard` and `full` | Screenshots per mutating step, severity ratings, three gates, verdict under `docs/claude_testers/run-<date>/` |

Which one: smoke-check a change with `atlas-test-browser`; smoke-check then fix
with `atlas-test-browser`, then `atlas-dogfood` using the failed routes as
scope; a full pre-release UX pass with `atlas-ux-test` (do not combine it with
the others in one run); one known bug with `atlas-debug`. In manual mode you
run the dev server yourself; if none is running the skill stops and prints how
to start it. Every run ends with each route marked Pass, Fail or Skip, or a
preflight blocker saying what would clear it.

**The tester agent.** `atlas:ui-runtime-tester` (Claude: `model: sonnet`,
`effort: low`, write/edit/dispatch tools removed) is also dispatched by
`atlas-frontend` and `atlas-feature` waves. The omp copy
(`plugins/atlas/omp/agents/ui-runtime-tester.md`, generated by
`omp/gen-agents.ts`) uses `thinkingLevel: low` and spawns nothing.

**Browser surface.** Atlas ships no browser server of its own; the browser
comes from your harness or MCP configuration: the Claude_Preview MCP or
`webapp-testing` skill named in the tester's method, the `browser-use` MCP
(`browser_use` is listed in `contracts/mcp-servers.json` so transcript tooling
splits its device name correctly), or omp's own `browser` tool. `atlas-ux-test`
personas drive real Chrome through the `browser-harness` CLI. If the harness
exposes no browser at all, the skill reports a preflight blocker instead of
faking the check.

**Troubleshooting the browser.**

- `browser-use` calls time out: run `browser-use --doctor`; Chrome's
  remote-debugging approval may not be granted.
- omp `browser` says the relay's extension never connected: run `omp
  browser-relay install` and check the extension badge shows `on`.
- No browser tool at all: configure one (for example a Playwright MCP server in
  your harness) or accept the preflight blocker.
- A passing smoke check can still say a visual state is `[unverified]` when
  the tester did not inspect the rendered page; that is the tester reporting
  what it did not check.

## omp parity

Atlas runs on both harnesses through `plugins/atlas/omp/` (load instructions in
[Install](#install-and-update); contracts shared with the Python hooks live in
`plugins/atlas/contracts/`). Status detail and verification dates:
[docs/atlas-harness-parity.md](docs/atlas-harness-parity.md). Runtime notes:
`plugins/atlas/omp/README.md`.

**Works in omp** (rules shared with the Claude Code hooks):

| Capability | Switch |
|---|---|
| Native grep/glob denied toward reachable lean-ctx; exploration-only `bash` denied toward it; every `bash` routed through `lean-ctx -c` | `ATLAS_TRIPWIRE_HARD=off`, `ATLAS_LEAN_SHELL=off` |
| Recall gate, "Recall first" boot line, ponytail-before-commit nudge | `ATLAS_MANDATES=off` |
| Output style plus an omp-only lead addendum, rendered once per session | `ATLAS_STYLE=off` |
| Hook bridge runs the Claude hooks from `hooks.json`; at `session_stop` the definition-of-done gate, ingest, chronicle, memory capture and nudge run (at most 3 consecutive gate blocks) | `ATLAS_HOOK_BRIDGE=off`, `ATLAS_STOP_BRIDGE=off`, `ATLAS_GATE=off` |
| Dispatch tripwire through the bridge, plus a model-override deny on `before_subagent_spawn` | `ATLAS_TRIPWIRE_HARD=off` |
| Advisor board gate: advisor `concern`/`blocker` notes become board items and block stop up to 3 times | `ATLAS_ADVISOR_GATE=off` |
| Worker output-token cap (default 32000, never raised) | `ATLAS_WORKER_MAX_TOKENS` |
| `todo`-to-board mirror, so omp workers have claimable items | n/a |
| Every `write agent://<Name>` also appended to `.atlas/.run/board/<sender>.jsonl` (omp-only, fails open) | n/a |

**Differs or not yet verified live:**

| Item | Detail |
|---|---|
| Marketplace install is Claude-dialect | Generated `omp/agents/` (model tiers) are used only when the `omp/` directory is loaded as an extension; otherwise `agents/*.md` run model-less. |
| Mux workers (herdr or tmux panes) | omp reports each as a main session; `ATLAS_WORKER_NAME` is the leaf marker. |
| Memory capture | Runs in omp; its durable-write path has not been observed live. |
| Inline-op, production-edit, and dispatch-spec denies | Tested against the real hook through the bridge; not yet observed in a live omp session. |
| Mixed `task` batches | The run-state fallback logs one row per batch (first agent only), so it undercounts. |
| Tool-state directories (e.g. `.serena/`) | omp exempts them from the shell-edit count; Claude Code's condition (m) still counts them. |
| `session_shutdown` budget | omp allows handlers 2 s; a slow transcript conversion skips that shutdown's ingest (the Stop-time ingest still ran). |

13 generated omp agents live in `plugins/atlas/omp/agents/` (regenerate with
`bun plugins/atlas/omp/gen-agents.ts`; never edit generated copies). Per-role
model tiers resolve through `modelRoles.atlas-worker` / `modelRoles.atlas-verifier`
in `~/.omp/agent/config.yml`.

## Docs as the single source of truth

![Atlas docs and wiki](img/docs-wiki-header.png)

`docs/` is canonical: `atlas-setup` scaffolds it, `atlas:docs-curator` keeps it
current after every ship, `atlas:docs-auditor` flags drift, `atlas-wiki`
regenerates `docs/wiki/` from `docs/architecture/`, and the completion gate
(condition f) refuses to close when source changed and `docs/` did not. `.atlas/`
holds atlas's internal state (`.atlas/evidence/`, `.atlas/audits/`,
`.atlas/findings/`, `.atlas/decisions/`, `.atlas/departments/`,
`.atlas/graphify/`, ephemeral `.atlas/.run/`). Atlas's own development docs sit
in this repo's `docs/` (CHANGELOG, ROADMAP, architecture, standards, lessons,
plans, plus [atlas-workboard.md](docs/atlas-workboard.md) for the dashboard and
[atlas-harness-parity.md](docs/atlas-harness-parity.md) for the omp matrix).

## Repository layout

```text
tech-tools/
|- .claude-plugin/           # marketplace.json catalog (tech-tools)
|- README.md, AGENTS.md, CONTRIBUTING.md
|- img/                      # repo imagery
|- docs/                     # canonical documentation (SSOT); see docs/architecture/README.md
|- plugins/
|  |- atlas/                 # the plugin
|  |  |- .claude-plugin/     # plugin.json + userConfig (51 keys)
|  |  |- .mcp.json           # 12 connector server definitions
|  |  |- package.json        # omp.extensions entry
|  |  |- skills/             # 47 skills
|  |  |- agents/             # 13 role agents
|  |  |- hooks/              # 16 bound hook programs (atlas_doctor.py, the 17th, is in scripts/), helpers, hooks.json, tests
|  |  |- scripts/            # 27 scripts + tests; dashboard_ui/ holds the Workboard v2 static assets
|  |  |- contracts/          # shared JSON contracts (Python hooks + omp modules)
|  |  |- omp/                # omp extension package incl. generated agents/
|  |  |- mcp/                # bundled connector servers (11 Node + falcon) and the shared _env loader
|  |  |- output-styles/      # atlas-orchestrator
|  |  |- references/         # supporting reference docs
|  |  \- CHANGELOG.md
|  |- armada/                # optional org-deployment plugin
|  |- programmer/            # optional Pragmatic Programmer auditor
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

- **Python 3** for the hook programs and the `scripts/` tooling; stdlib only,
  no third-party imports. **Bun** only to run the omp tests or regenerate omp
  agents. **uv** only for the Falcon connector. **tmux** only for [mux
  mode](#herdr-colony-mode-mux)) when you pick `ATLAS_COLONY_TRANSPORT=tmux`
  or herdr is not running. **herdr** and the vendored **herdr-web-ui**
  with **Bun** (to build and start it) for the [colony](#herdr-colony-mode-mux).
- **claude-mem** and **context-mode** companion plugins: `atlas-setup` detects
  them and offers to install. The recall gate is armed only when claude-mem is
  enabled; without it the gate stays silent instead of denying.
- **Prompt model decision is optional and local.** The ambiguous band of
  engineering-prompt arming can call a local System One model at
  `http://127.0.0.1:11434`, tag `nimble`, 4 s timeout
  (`hooks/prompt_decision.py`). Timeout, low confidence, or `ATLAS_DECISION=off`
  keep the regex answer.
- **TypeSafe scoring is optional**: off unless `TYPESAFE_API_KEY` is set, or an
  explicit loopback `ATLAS_TYPESAFE_URL` (+ `ATLAS_TYPESAFE_MODEL`).
- **Connector credentials are optional per server** (see
  [Connectors](#connectors)). Set them as the plugin's `userConfig` values (51
  keys); each server receives them as `CFG_*` env vars (mapped in
  `plugins/atlas/.mcp.json`) and also reads a plugin-root `.env` via
  `ATLAS_ENV_FILE`. Nothing is committed.
- **Dashboard** binds loopback only (`127.0.0.1:7421`, port via
  `ATLAS_DASHBOARD_PORT`) unless `--allow-remote` is passed; see [Workboard](#browser-dashboard-atlas-workboard).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every first tool call is denied with `[atlas gate] REQUIRED once per session: ...` | Recall gate is armed (claude-mem enabled), no claude-mem call this session yet. | Make one claude-mem recall (e.g. a search of prior work). To disable: `ATLAS_MANDATES=off`. |
| `DENY - 6 inline ops since your last dispatch...` | Tripwire: the orchestrator is doing too much inline work. | Dispatch `atlas:implementer` (edits) or `atlas:explorer` (investigation); `docs/` and `.atlas/` writes don't count. `ATLAS_TRIPWIRE_HARD=off` to lift. |
| Stop blocked listing `(a)`, `(f)`, ... | Completion gate found unmet conditions. | Fix the listed ones: capture evidence to `.atlas/evidence/`, write a verified finding via `scripts/atlas_finding.py`, update `docs/CHANGELOG.md`, drain todos. For (n)/(o)/(p) fix the presentation once. `ATLAS_GATE=off` disables. |
| Dashboard call returns `403 bad_host`, `403 bad_origin`, `415 unsupported_media_type` or `401 bad_token` | The 10.0.1 request guard rejected a script or proxied call. | Use `http://127.0.0.1:<port>/` or `localhost`; fetch `GET /` for the token; send `X-Atlas-Token` and `Content-Type: application/json` on every mutation. |
| `/api/v2/*` answers 404 | Older atlas install serving the legacy dashboard. | Update both harnesses ([Install and update](#install-and-update)) and restart. |
| Connector tool 401s / credential watch fires | Stale or missing credentials for that server. | Re-set the server's `userConfig` keys, then restart the session. |
| Atlas workers still run old paths (`atlas_todo.py` unresolved) after `omp plugin upgrade` | Long-lived omp process kept the pre-upgrade `CLAUDE_PLUGIN_ROOT`. | Restart omp; the extension re-resolves the plugin root at load. |
| Doctor warns on downgrade or forked marketplace | Installed plugin version is lower than the marketplace, or the marketplace points at a fork. | `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --fix`, then `claude plugin marketplace update tech-tools`. |
| `atlas_mux.py spawn` exits 2 with `ok:false`, "tier enforcement: no model for role '<role>' ..." | Role definition yields no model tier. | Pass `--model M` together with `--effort E` (claude) or `--thinking T` (omp); check the agent file exists in the right dir. |
| Dashboard **Colony** page or `atlas_herdr.py status` reports `server_down` | Atlas cannot start herdr itself. | Install herdr from https://herdr.dev, run `herdr` in a terminal, then `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_herdr.py" ensure`. `ATLAS_COLONY=off` skips the SessionStart start. |
| Hooks never fire | `hooks.json` not loaded (bare-skill install rather than a plugin install). | Install as a plugin, or run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py"`. |
| `fallow audit` blocks `git commit`/`git push` | Fallow gate returned `verdict: fail` for findings newer than the saved baselines in `fallow-baselines/`. | Fix the finding, or skip once with `ATLAS_FALLOW=off`. |
| `atlas-test-browser` reports a preflight blocker | The dev server is down, or the harness exposes no browser surface. | Start the dev server (manual mode prints the command), or configure a browser tool; see the browser troubleshooting list above. |

## License

Apache-2.0. Author: [w159](https://github.com/w159). Repository:
[github.com/w159/tech-tools](https://github.com/w159/tech-tools).
