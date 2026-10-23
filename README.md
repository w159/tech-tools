<div align="center">

<img src="img/project-logo-icon.png" alt="Atlas logo" width="120" />

# Atlas

**Atlas makes Claude Code verify its own work: it delegates to named subagents and blocks "done" until there is evidence.**

![Atlas README hero banner](img/readme-hero-banner.png)

</div>

Version 15.0.0 (`plugins/atlas/.claude-plugin/plugin.json`). Release history is in the [CHANGELOG](plugins/atlas/CHANGELOG.md).

Current version: **16.0.1** (`plugins/atlas/.claude-plugin/plugin.json`), a test hermeticity fix on top of 16.0.0. Breaking in 16.0.0: the 13 vendor MCP connectors now ship in the armada plugin (2.0.0); install `armada@tech-tools` to keep them, see [plugins/armada/README.md](plugins/armada/README.md#upgrading-connectors-moved-from-atlas-to-armada). Also in 16.0.0: scoped worker tool profiles, a Stop gate that sees shell-changed files, shared gate rules, one hook process per tool event, and hermetic tests.

- **A fixed work loop.** Hooks enforce research, test, implement, verify. A lead session hands work to named role subagents (explorer, implementer, verifier and others) that share one todo board.
- **A gate on "done".** A Stop hook refuses to let a session finish until there is evidence, a verified finding, current docs and no open todos. Each of its 17 conditions has an off switch.
- **Memory and self-tuning.** Each session starts with a claude-mem recall, a local dashboard shows runs and gates, and a doctor mines session telemetry into rule changes that you approve.

| What | Count | Source |
|---|---|---|
| Skills | 39 (3 manual) | `plugins/atlas/skills/` |
| Role agents (`atlas:*`) | 14 | `plugins/atlas/agents/` |
| Hooks | 17 programs, 22 bindings, 9 lifecycle events | `plugins/atlas/hooks/hooks.json` |
| Scripts | 70 non-test Python files | `plugins/atlas/scripts/` |
| MCP connectors | 13, each off until credentials exist | `plugins/armada/.mcp.json` (shipped by the optional armada plugin) |
| omp agents | 14, generated | `plugins/atlas/omp/agents/` |

The marketplace also carries `armada` (an optional organization layer: department agents and the vendor connectors) and `programmer` (code review based on The Pragmatic Programmer). Their licenses and contents are listed in [plugins/README.md](plugins/README.md).

## Quick start

**Prerequisites**

- Claude Code.
- Python 3 (standard library only) for the hooks and scripts.
- Node.js, only if you use armada's vendor connectors.
- uv, only for the CrowdStrike Falcon connector.
- Recommended: the claude-mem and context-mode plugins. `/atlas-setup` checks for them and offers to install them. Atlas runs without them, but the recall gate and the output-size protection depend on them.
- Optional: tmux (to show worker panes), Bun (to run the omp tests).

**Install** (Claude Code):

```bash
claude plugin marketplace add w159/tech-tools    # first time only: register the catalog
claude plugin install atlas@tech-tools           # first time only: install the plugin
claude plugin install armada@tech-tools          # optional: department agents and vendor connectors
```

To update later, refresh the catalog and update the plugin:

```bash
claude plugin marketplace update tech-tools
claude plugin update atlas@tech-tools
```

Restart the session afterwards: hooks resolve at session start.

**omp** (the oh-my-pi coding agent CLI, which atlas also supports):

```bash
omp plugin install atlas@tech-tools    # first time (tech-tools is already a configured marketplace if you added it)
omp plugin upgrade atlas               # update
```

**Onboard a project once:**

```text
/atlas-setup
```

`/atlas-setup` checks the companion plugins, scaffolds `docs/` and `.atlas/` in the project, wires hooks, and walks through connectors. It asks before it installs or changes anything.

**Then describe the work.** Skills trigger from plain language, or name one:

```text
atlas-orchestrate add CSV export to the reports page
atlas-debug login returns 500
atlas-audit
```

Terms used below: a "colony" is the set of named worker subagents a lead session runs together. By default they run inside the lead session; the opt-in `ATLAS_MUX=tmux` mode runs each as a visible terminal pane.

## What it looks like

Every image below is a real capture of the installed plugin, taken from a tmux
session or the browser.

**Mission Control band.** The panel above the prompt shows the wave, phase
pills, one lane per worker with its current tool and target, a channel ticker,
and gate chips.

![Band with two running workers](img/showcase/cc-band-running.png)

When the wave ends the band settles into a summary of what ran and which gate
is still open.

![Idle band after a wave](img/showcase/cc-band-idle.png)

**Parallel teams.** Two or more workers run side by side in one tmux window,
each pane headed by its role, with tool and peer chips.

![Three workers tiled in tmux](img/showcase/cc-team.png)

**Gates in the transcript.** A dispatch that breaks a rule is refused with the
command that fixes it. A worker's card updates in place when it reports.

![Scope deny card](img/showcase/cc-scope-deny.png)
![Worker card done](img/showcase/cc-card-done.png)

## What it changes on your machine

- **Hooks.** The plugin registers 22 hook bindings (17 programs) from `plugins/atlas/hooks/hooks.json` for nine lifecycle events, including SessionStart, PreToolUse, PostToolUse and Stop. They can deny tool calls (for example a dispatch missing its required blocks) and block a stop. Each has an off switch; see Configuration below. Atlas edits your `~/.claude/settings.json` only when you ask: the statusline `install` command, `scripts/install_hooks.py`, or an `/atlas-setup` step you approve.
- **Project files.** `/atlas-setup` creates `docs/` and `.atlas/` in the project it onboards (evidence, the todo board at `.atlas/.run/`, findings). Worktrees for isolated parallel implementers go under `.atlas/wt/`.
- **State in `~/.atlas/`.** `atlas.db` (SQLite telemetry), `memory/` (lessons saved at Stop and reloaded at boot), `dashboard-prefs.json`, and self-fix worktrees.
- **Transcript storage.** At Stop, `ingest_session.py` copies the session transcript into `~/.atlas/atlas.db`. Text passes through one shared redactor first: credential-shaped strings and a few personal-identifier patterns (SSN, routing and account numbers, card numbers, dates of birth) are replaced with `[REDACTED]` placeholders. The redactor is pattern matching and best effort; it misses unlabeled values, names and addresses. `ATLAS_INGEST=off` turns ingest off.
- **Local dashboard.** A daemon starts at session start on `http://127.0.0.1:7421/` (loopback only, shared by every open terminal, a per-start token guards writes). `ATLAS_DASHBOARD=off` stops it from starting.
- **Self-fix scheduler (on by default).** While the dashboard runs, a scheduler checks every 30 minutes for actionable doctor findings and runs up to 2 worker sessions, each in its own git worktree under `~/.atlas/worktrees/` on a branch named `atlas/selffix-<id>`. It never pushes; a passing fix waits as a local branch for you to merge. Set `ATLAS_SELFFIX=0` in your shell to turn it off, or set `selffix.enabled` to `false` in `~/.atlas/dashboard-prefs.json`.
- **Outbound traffic.** Atlas sends no transcript data off the machine by default. Optional exceptions: turn scoring sends redacted transcript excerpts to api.typesafe.ai only when `TYPESAFE_API_KEY` is set (`ATLAS_TYPESAFE_SCORING=off` disables it), and the prompt classifier can call a local Ollama server. Connectors talk to their vendors once you give them credentials.

## How it works

### 1. One loop for every task

```text
research -> theory -> test -> validate -> implement -> verify -> done
```

Every reply opens with a status line that names the phase. This is a real one
from a session that fixed the omp advisor gate:

```text
ATLAS | <glyph> done 1/1 | omp advisor gate fixed and its tests pass, not yet run in a live omp session
```

`done` is terminal. It is allowed only when every deliverable exists, nothing
is still running, no question is pending, and no advisor item is open.

### 2. The lead delegates, workers do the work

The lead classifies the task and resolves its team from one scope matrix:

```text
$ python3 plugins/atlas/scripts/atlas_resolve.py implement medium --paths plugins/atlas/omp/advisor.ts
{"effort": "medium", "task_class": "implement", "isolation": "worktree", "max_parallel": 3,
 "team": [{"count": 2, "role": "implementer"}, {"count": 1, "role": "verifier"}]}
```

Then it dispatches named workers. Each dispatch carries a `SCOPE:`, a `TOOLS:`
block, a `GOAL:`, a `DELIVERABLE:`, success criteria, what is out of scope, and
when to stop. A dispatch missing any of them is denied before it runs:

```text
DENY - this Agent dispatch to atlas:implementer is unbounded: missing GOAL:, DELIVERABLE:.
Each block is a line-start `LABEL: text`. Add exactly:
GOAL: <one measurable sentence>
DELIVERABLE: <the exact artifact>
Then re-dispatch.
```

```text
DENY - SCOPE audit/med does not resolve: unknown effort 'med'; known: ['high', 'low', 'medium'].
```

Workers report in a fixed shape, so the lead can check them:

```text
STATUS: DONE
STEPS: 4/4
FILES_CHANGED: plugins/atlas/omp/advisor.ts; plugins/atlas/omp/advisor.test.ts; ...
EVIDENCE:
1. bun test plugins/atlas/omp/advisor.test.ts -> "18 pass / 0 fail / 47 expect() calls"
2. bun test plugins/atlas/omp (whole omp suite) -> "443 pass / 0 fail"
```

The lead does not take a worker's word for it. It re-runs the check on its own
side before it reports. Read-only roles (explorer, verifier, ui-runtime-tester)
cannot edit code, and a verifier always starts from a fresh context.

### 3. The board and the colony channel

Workers share one board (`.atlas/.run/todos.json`) and a channel per lead.
They claim items before working, post a note on start and on finish, and close
items only with evidence:

```bash
python3 plugins/atlas/scripts/atlas_todo.py claim --id t1a7fd052 --owner implementer-advisor-gate
python3 plugins/atlas/scripts/atlas_todo.py complete --id t1a7fd052 --evidence "advisor tests 18 pass 0 fail"
```

The lead sees each note on its next tool call:

```text
[atlas] 2 messages for you from the board:
- from implementer-advisor-gate: starting advisor gate edits
- from implementer-advisor-gate: advisor gate done, omp tests 443 pass
```

### 4. The Stop gate

When the agent tries to finish, `completion_gate.py` checks the definition of
done (17 conditions, (a)-(q): evidence under `.atlas/evidence/`, a verified finding,
current docs, drained todos, a dispatch for any shipped code, and more). If
something is missing it blocks the stop and says what to do:

```text
[atlas] Definition-of-done gate: the following condition(s) are not met:
  (a) No files found under .atlas/evidence/. Capture observed-behavior proof
      (test output, DB read-back, endpoint response, or UI screenshot) there first.
  (o) Phased todo: this run shipped code, but this session's todo items do not
      cover the required phase(s): implement, verify.
```

The full condition list and every kill switch are in the
[reference](docs/reference/atlas-reference.md#the-operating-contract).

### 5. Memory

The first tool call of a session must be one claude-mem recall for the project,
so prior work is found before it is re-derived:

```text
[atlas gate] REQUIRED once per session: your first tool call must be one
claude-mem recall for this project.
```

### 6. Self-improvement with `/atlas-doctor`

The doctor reads the telemetry in `~/.atlas/atlas.db`, mines recurring friction
into findings, asks you to apply, skip or modify each one, applies what you
accept, and records a baseline so the next run can tell whether the change
helped:

```text
$ python3 plugins/atlas/scripts/atlas_doctor.py --mine --json
{"recurring_friction": 9, "colony_adherence": 2, "turn_quality": 8, "verifier_coverage_low": 1, ...}

finding 8834 -> accepted
improvement 101: finding 8834 baseline=4.42 target=4.0 (remeasure after 5 runs)
finding 8834 -> applied
```

The latest runtime audit, built from these logs, is
[docs/audits/2026-10-14_atlas-runtime-audit.md](docs/audits/2026-10-14_atlas-runtime-audit.md).

## omp support

The same rules run in omp through `plugins/atlas/omp/`: the lean-ctx routing,
the recall gate, the output style, the bridged Stop gate, and the dispatch
tripwire. omp has two extras:

- **Advisor gate.** Every advisor note, of any severity, becomes a board item.
  At the start of each prompt the open items are listed in the context, and a
  stop is refused (up to 3 times per prompt) until each is closed with
  evidence.
- **Mission Control widget.** The same band as Claude Code, inside omp's
  widget area.

![omp widget during a team run](img/showcase/omp-widget.png)

The parity matrix is in [docs/architecture/atlas-harness-parity.md](docs/architecture/atlas-harness-parity.md).

## Command Center web UI

A loopback-only dashboard (`http://127.0.0.1:7421/`) starts at session start
and is shared by every open terminal. It reads the same telemetry DB, boards and
channels the hooks write.

![Overview](img/showcase/dashboard-overview.png)

| Page | What it shows |
|---|---|
| Overview | KPIs, the needs-attention inbox, recent runs |
| Activity | Events by group, filter and live tail |
| Health | Hooks, gates, dispatch, colony, daemon, DB, connectors, memory, doctor |
| Agents | Three lenses: Roster (colony members with send, stop, pause, resume), Supervise, and Board. `#/colony`, `#/board` and `#/supervise` are aliases for them |
| Colony | The roster of the lead and its workers (the Roster lens) |
| Terminal | A seat grid of real terminals, one per colony worker |
| Channels | What agents and you said to each other |
| Improve | Doctor findings: mark fixed, dismiss, remeasure |
| Projects | Pin, mute or hide projects |
| Settings | Five tabs: Dashboard, Behavior, Models, Integrations, Agents. A saved knob applies on the next hook run |

![Health](img/showcase/dashboard-health.png)
![Improve](img/showcase/dashboard-improve.png)

Every route checks the `Host` header, content type, origin and, for mutations,
a per-start token. Details: [docs/architecture/atlas-workboard.md](docs/architecture/atlas-workboard.md).

## Configuration

Every guard has an off switch. Set it in your shell or in
`~/.claude/settings.json` under `env`. The most used:

| Variable | Effect |
|---|---|
| `ATLAS_GATE=off` | Stop gate off |
| `ATLAS_TRIPWIRE_HARD=off` | dispatch and routing denies off |
| `ATLAS_MANDATES=off` | recall gate off |
| `ATLAS_DASHBOARD=off` | no dashboard at session start |
| `ATLAS_ADVISOR_GATE=off` | omp advisor gate off |
| `ATLAS_MODE=solo` | small direct changes on the main thread are acknowledged instead of forced into a dispatch |

The full table, connector setup, colony transport, remote access and
troubleshooting are in the [reference](docs/reference/atlas-reference.md).

Worker pane transport: tmux when installed, else background `claude --bg` processes (`claude-bg`); herdr (a terminal multiplexer atlas can also drive) is selectable with `ATLAS_COLONY_TRANSPORT`.

## Documentation

| Topic | Where |
|---|---|
| Full reference (skills, agents, hooks, scripts, connectors, colony, troubleshooting) | [docs/reference/atlas-reference.md](docs/reference/atlas-reference.md) |
| Colony and seat backends | [docs/architecture/atlas-colony.md](docs/architecture/atlas-colony.md) |
| Dashboard | [docs/architecture/atlas-workboard.md](docs/architecture/atlas-workboard.md) |
| omp parity | [docs/architecture/atlas-harness-parity.md](docs/architecture/atlas-harness-parity.md) |
| Changes | [docs/CHANGELOG.md](docs/CHANGELOG.md), [plugins/atlas/CHANGELOG.md](plugins/atlas/CHANGELOG.md) |
| Plans | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Audits | [docs/audits/](docs/audits/) |

## Releases

Release notes are in the [CHANGELOG](plugins/atlas/CHANGELOG.md) and on
[GitHub Releases](https://github.com/w159/tech-tools/releases). A release
workflow (`.github/workflows/release.yml`) tags each release
`atlas-v<version>` and takes the release body from the matching CHANGELOG
section.

## Developing atlas

This repo is the marketplace source. Edit under `plugins/atlas/` (and
`mcp_servers/`, `mcp_node/` for connectors), never the installed copy under
`~/.claude/plugins/cache/`. A change reaches a session only after it is released
and the plugin is reinstalled.

```bash
python3 -m unittest discover -s plugins/atlas/hooks        # hook tests
python3 -m unittest discover -s plugins/atlas/scripts      # script tests
bun test plugins/atlas/omp                                 # omp extension tests
```

The marketplace also carries two optional plugins: `armada` (org deployment)
and `programmer` (code review based on The Pragmatic Programmer). Contributor rules are in
[AGENTS.md](AGENTS.md).

## License

Per plugin:

| Plugin | License |
|---|---|
| atlas | Apache-2.0 (`plugins/atlas/LICENSE`) |
| armada | Apache-2.0 (`plugins/armada/LICENSE`) |
| programmer | MIT for plugin code, with a notice on the book-summary files (`plugins/programmer/LICENSE`) |

The repo-root `LICENSE` is the Apache-2.0 text. Author: [w159](https://github.com/w159). Repository:
[github.com/w159/tech-tools](https://github.com/w159/tech-tools).
