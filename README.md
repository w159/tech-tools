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
4. [Usage examples (Claude Code and omp)](#usage-examples-claude-code-and-omp)
5. [The operating contract](#the-operating-contract)
6. [Skills](#skills)
7. [Agents](#agents)
8. [Hooks](#hooks)
9. [Scripts](#scripts)
10. [Connectors](#connectors)
11. [Colony and orchestration](#colony-and-orchestration)
12. [Tmux colony mode (mux)](#tmux-colony-mode-mux)
13. [Browser dashboard (Atlas Workboard)](#browser-dashboard-atlas-workboard)
14. [Browser automation and testing](#browser-automation-and-testing)
15. [omp parity](#omp-parity)
16. [Docs as the single source of truth](#docs-as-the-single-source-of-truth)
17. [Repository layout](#repository-layout)
18. [Prerequisites and configuration](#prerequisites-and-configuration)
19. [Troubleshooting](#troubleshooting)

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

## Usage examples (Claude Code and omp)

Install and update are covered in [Install and update](#install-and-update). This
section is day-to-day use. Every output below was captured on 2026-10-06 from
atlas 9.7.0 against a throwaway repo (`/tmp/atlas-demo/repo`: `stats.py` with an
off-by-one in `moving_average`, and a one-line `README.md` giving the expected
result). Trims are marked `...`. Each headless run used a 170 second cap and was
read-only by prompt and by tool allowlist.

### Check the install first

```bash
claude plugin list | grep -A3 atlas@tech-tools
omp plugin list
```

```text
$ claude plugin list | grep -A3 atlas@tech-tools
  ❯ atlas@tech-tools
    Version: 9.7.0
    Scope: user
    Status: ✔ enabled

$ omp plugin list
...
Marketplace Plugins:
  ...
  atlas@tech-tools (9.5.1) (user)
```

The two harnesses keep separate installs, and each must be updated on its own:
run both update pairs from [Install and update](#install-and-update), then restart.

### Flags used

| Purpose | Claude Code | omp |
|---|---|---|
| Non-interactive run | `-p, --print` | `-p, --print` |
| Load the atlas source checkout | `--plugin-dir <path>` (session only) | `-e, --extension <dir>` (directory load, so `omp/agents/` is found) |
| Keep a run read-only | `--permission-mode dontAsk --allowedTools "Read Grep Glob"` | `--tools read,grep,glob` |
| Cap spend or time | `--max-budget-usd 1` | `--max-time 3m` |
| Machine-readable output | `--output-format json` or `stream-json --verbose` | `--mode json` |

All flags are from `claude --help` and `omp --help` (omp v18.6.1). The `--max-time`
and `--mode json` omp flags and the Claude `--plugin-dir` flag appear in help but
were not exercised in the runs below.

### Side by side

| Task | Claude Code | omp |
|---|---|---|
| Root-cause a bug, read-only | `claude -p "atlas-debug: ..." --permission-mode dontAsk --allowedTools "Read Grep Glob"` | `omp -p --extension <repo>/plugins/atlas/omp --tools read,grep,glob "atlas-debug: ..."` |
| Explain code with file:line evidence | `claude -p "atlas-explain how X works. Read-only."` | `omp -p --extension <repo>/plugins/atlas/omp "atlas-explain how X works. Read-only."` |
| Ask which skills apply | `claude -p "List which atlas skills would apply to ..."` | `omp -p --extension <repo>/plugins/atlas/omp "List which atlas skills would apply to ..."` |
| See every turn, not just the last | `--output-format stream-json --verbose` | not needed in this capture (full answer on stdout) |
| Health check | `python3 plugins/atlas/scripts/atlas_doctor.py` | same script |
| Shared todo board | `python3 plugins/atlas/scripts/atlas_todo.py list --root .` | same script |
| Dashboard state (JSON) | `python3 plugins/atlas/scripts/atlas_dashboard.py status` | same script |
| Kill switches | `ATLAS_MANDATES=off`, `ATLAS_GATE=off` in the shell that starts `claude` | `ATLAS_STYLE=off`, `ATLAS_MANDATES=off`, `ATLAS_HOOK_BRIDGE=off`, `ATLAS_GATE=off` (full list in [omp parity](#omp-parity)) |

The three scripts are plain Python and harness-neutral. Inside a session
`${CLAUDE_PLUGIN_ROOT}/scripts/...` resolves to the same files; the omp
extension sets `CLAUDE_PLUGIN_ROOT` itself (`plugins/atlas/omp/README.md`).

### Claude Code examples

#### 1. atlas-debug, read-only, and why `-p` needs `stream-json`

```bash
cd /tmp/atlas-demo/repo
claude -p "atlas-debug: stats.moving_average([1,2,3,4], 2) returns [1.5, 2.5] but the README says [1.5, 2.5, 3.5]. Find the root cause. Read-only: do not edit any file." \
  --permission-mode dontAsk --allowedTools "Read Grep Glob" --max-budget-usd 1
```

Plain text output (exit 0, 147 s in the first capture, with `--permission-mode plan`) was
only this:

```text
ATLAS | 🏁 done | nothing to capture, no files changed

I'm not recording a note or touching `docs/`. This turn was a read-only diagnosis, so no behavior or structure changed. ...

The fix is still not applied and the diagnosis is not run. Nothing has changed since my last reply.
```

The diagnosis is missing. In `-p` mode atlas's Stop gate adds a closing turn, and
`-p` prints only the last assistant message. The same prompt with
`--output-format stream-json --verbose` (exit 0, 20 s, 4 turns, `total_cost_usd`
0.47) shows every turn. Extracted with a small script, the tool and message
sequence was:

```text
=== tool_use: ToolSearch {"query": "select:mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_shell", "max_results": 2}
=== tool_result: PreToolUse:ToolSearch hook error: [atlas gate] REQUIRED once per session: your first tool call must be one claude-mem recall for this project (mcp__plugin_claude-mem_mcp-search__search). ... Every other tool call is denied until you make it; then continue. ATLAS_MANDATES=off disables it.
=== tool_use: mcp__plugin_claude-mem_mcp-search__search {"query": "moving_average off-by-one stats.py"}
=== tool_result: Permission to use mcp__plugin_claude-mem_mcp-search__search has been denied because Claude Code is running in don't ask mode. ...
=== tool_use: Read {"file_path": "/private/tmp/atlas-demo/repo/stats.py"}
=== assistant text block 1 ===
ATLAS | 🔍 research | Root cause found at `stats.py:7`, no files edited. Not yet run.

**Root cause:** the loop bound is off by one.

    for i in range(len(values) - window):   # stats.py:7

A list of `n` values has `n - window + 1` windows of size `window`. The range stops one short, so the last window is never visited.
...
**Fix, not applied:** change line 7 to `range(len(values) - window + 1)`.
...
**Process note:** the session's recall hook required a claude-mem search first. The permission mode denied that call, so I read the file directly instead.
=== assistant text block 2 ===
ATLAS | 🏁 done | Nothing to capture, no files changed.
...
=== result {"subtype": "success", "is_error": false, "num_turns": 4, "duration_ms": 13896, "total_cost_usd": 0.4709552}
```

What it shows: the `ATLAS | <glyph> <phase> | <state>` header the output style
mandates, the recall-first gate firing on the first tool call (it blocked
`ToolSearch`), and an honest process note when a permission mode blocked the
recall. The run above is the `dontAsk` default; a separate `dontAsk` run with the
exact MCP tool name in `--allowedTools` (`mcp__plugin_claude-mem_mcp-search__search`)
printed a final turn that cited an existing observation (`#36873`), so the recall
went through there. That run was captured with `--output-format json`, whose
`result` field held only the final turn, the same as plain text. The full answer
only arrives in the stream, so use `stream-json --verbose` whenever it matters.

#### 2. atlas-explain with plan mode (full answer on stdout)

```bash
claude -p "atlas-explain how moving_average in stats.py works, step by step. Read-only: do not edit any file." \
  --permission-mode plan --max-budget-usd 1
```

```text
ATLAS | 🔍 research | `moving_average` explained from `stats.py:4-10`. It has an off-by-one bug.

**Step by step** (`stats.py`)
1. `:4` The function takes `values` (a list of numbers) and `window` (the size of each group).
2. `:6` `out = []` holds the results.
3. `:7` `for i in range(len(values) - window)` makes `i` the start index of each window.
...
**Bug at `:7`:** a list of `n` values has `n - window + 1` full windows. `range(len(values) - window)` yields one fewer, so the last window is never computed.
...
**Process notes**
- The atlas gate required a claude-mem search as the first tool call. Plan mode blocked that call, so no memory recall happened.
- With the gate unresolved, only the native `Read` went through. It was used instead of `ctx_read`.
- I changed no files.
```

What it shows: file:line evidence, the "I did not run it, so that result is
unverified" discipline (the answer labelled its own trace as unverified), and the
recall gate again, this time reported by the model itself. Exit 0 in 151 s.

#### 3. Ask which skills apply

```bash
claude -p "List which atlas skills would apply to adding a test for moving_average, and why. Read-only: do not edit any file." \
  --permission-mode plan --max-budget-usd 1
```

```text
ATLAS | 🔍 research | No atlas skill is dedicated to writing a test. Answered from the skill listing, no files read.

**Apply:**
- `atlas:atlas-orchestrate`: the standing loop (research, test, implement, verify, docs) covers this. ...
- `atlas:atlas-commit`: only if you want the finished test committed locally. It stages an explicit file list and never pushes.

**Conditional:**
- `atlas:atlas-debug`: only if the new test fails and exposes a real bug in `moving_average`. ...
- `atlas:atlas-explain`: only if the window or edge-case behavior is unclear. It is read-only and answers with file:line evidence.
...
I have not opened `stats.py`, so I can't say whether the function has edge cases ... that would change this list.
```

What it shows: skills are routed from their descriptions, and the model states
what it did not read. Exit 0 in 24 s.

[INFERENCE] The fast path in example 3 (24 s against about 150 s for 1 and 2)
fits no file being read, so the recall gate and Stop gate had less to do; the
transcript was not inspected to confirm.

#### 4. Headless pitfalls seen in these runs

| Symptom | Observed text | Cause and fix |
|---|---|---|
| Only the closing turn prints | `ATLAS \| 🏁 done \| nothing to capture, no files changed` | `-p` prints the last assistant message. Use `--output-format stream-json --verbose`. |
| First tool call denied | `[atlas gate] REQUIRED once per session: your first tool call must be one claude-mem recall ...` | Recall gate. Allow the claude-mem search tool, or set `ATLAS_MANDATES=off` for throwaway runs. |
| `--bare` fails | `Not logged in · Please run /login` (exit 1, 1 s) | `--bare` never reads OAuth or keychain (see `claude --help`); it needs `ANTHROPIC_API_KEY`. It also skips atlas's hooks. |

### omp examples

All three runs loaded the source checkout by directory, read-only
(`--tools read,grep,glob`), and exited 0.

```bash
cd /tmp/atlas-demo/repo
omp -p --extension /absolute/path/to/tech-tools/plugins/atlas/omp \
  --tools read,grep,glob \
  "atlas-debug: stats.moving_average([1,2,3,4], 2) returns [1.5, 2.5] but the README says [1.5, 2.5, 3.5]. Find the root cause. Read-only: do not edit any file."
```

![omp atlas-debug answer header](img/readme-usage-omp-debug.png)

The PNG drops the flag glyph in the header (Menlo has no glyph for it); the real
first line is `ATLAS | 🏁 done | Root cause: off-by-one in the loop bound at `stats.py:7``.

#### 1. atlas-debug (63 s)

```text
ATLAS | 🏁 done | Root cause: off-by-one in the loop bound at `stats.py:7`

**Root cause.** `range(len(values) - window)` should be `range(len(values) - window + 1)`. ...

**Reproduction and prediction check**
$ python3 -c 'import stats; print(stats.moving_average([1,2,3,4],2)); print(stats.moving_average([1,2,3],3)); print(stats.moving_average([1,2,3,4,5],1))'
[1.5, 2.5]                # README expects [1.5, 2.5, 3.5]; the window [3,4] is missing
[]                        # window == len: should be [2.0], so it returns nothing
[1.0, 2.0, 3.0, 4.0]      # window=1: the last element (5.0) is dropped

**Hypotheses, ranked**
1. **Confirmed: loop bound off by one** (`stats.py:7`). ...
2. **Rejected: the README is wrong.** ...
3. **Rejected: slicing or averaging error.** ...

**Fix (not applied, since you asked for read-only):**
-    for i in range(len(values) - window):
+    for i in range(len(values) - window + 1):
...
I didn't run the skill's verify and defense-in-depth steps because no edit was allowed. Those passes were evaluated and skipped.
```

What it shows: the full answer lands on stdout (no separate Stop-turn problem
seen), a reproduction with a prediction check, ranked hypotheses, and a stated
skip of the verify step because the prompt forbade edits. The reproduction ran
Python, so `--tools read,grep,glob` was evidently not the only route the run
had to a shell; [INFERENCE] the atlas extension or an MCP shell device supplied
it, which was not confirmed.

#### 2. atlas-explain (57 s)

```bash
omp -p --extension /absolute/path/to/tech-tools/plugins/atlas/omp \
  --tools read,grep,glob \
  "atlas-explain how moving_average in stats.py works, step by step. Read-only: do not edit any file."
```

```text
ATLAS | 🏁 done | moving_average explained from source; it has an off-by-one bug, and no files were edited

**Short answer:** `moving_average` slides a window of size `window` across `values` and averages each slice. The loop stops one window too early, so the last average is always missing. ...

**Step by step (`stats.py`):**
1. `stats.py:4`: takes `values`, a sequence of numbers that can be sliced, and `window`, an int.
...
**Edge cases that follow from the code:**

| Input | Result | Why |
|---|---|---|
| `window == len(values)` | `[]` | `range(0)` runs no loops; it should return one average |
| `window > len(values)` | `[]` | a negative range runs no loops |
| `window == 0` | `ZeroDivisionError` | the first chunk is `[]`, so `len(chunk)` is 0 |
...
**What I didn't check:**
- I didn't run the function. The outputs above come from tracing the code by hand.
- I did this as a one-function inline read instead of handing it to atlas:explorer. ...
```

#### 3. Which skills apply (66 s)

```bash
omp -p --extension /absolute/path/to/tech-tools/plugins/atlas/omp \
  --tools read,grep,glob \
  "List which atlas skills would apply to adding a test for moving_average, and why. Read-only: do not edit any file."
```

```text
ATLAS | 🏁 done | 5 atlas skills apply to this test, 1 more is optional, and the rest don't. No files were edited.

**What the code shows.** `stats.py:7` loops with `range(len(values) - window)`, which drops the last window. ...

| Skill | Applies? | Why |
|---|---|---|
| **atlas-debug** | Yes, primary | The new test shows a bug you can reproduce: an off-by-one at `stats.py:7` ... |
| **atlas-review** | Yes | Reviews the diff (new test file plus the one-line fix) before merge. |
| **atlas-simplify** | Yes, briefly | A pass after the change to keep the test small and free of setup boilerplate. |
| **atlas-commit** | Yes | Makes a local conventional commit (`test:` / `fix:`). It never pushes. |
...
**Outside atlas.** `test-driven-development` and `verification-before-completion` also fit. The session also flagged that the repo has no `docs/` tree, so a `CHANGELOG` update would need `/atlas-setup` first.
```

#### 4. stderr stays separate

omp prints MCP connector warnings (servers configured in your own omp, not atlas)
on stderr, so `omp -p ... > answer.md` captures only the answer. Kill switches
such as `ATLAS_STYLE=off` and `ATLAS_MANDATES=off` are listed in
[omp parity](#omp-parity).

### Scripts (harness-neutral, run from any shell)

#### Health check: `atlas_doctor.py`

```bash
python3 plugins/atlas/scripts/atlas_doctor.py
```

![atlas_doctor health check](img/readme-usage-doctor.png)

```text
PASS  registered           atlas@tech-tools at 9.7.0
PASS  marketplace-source   w159/tech-tools (expected w159/tech-tools)
PASS  version-sync         installed 9.7.0, marketplace 9.7.0
PASS  hooks-wired          all hook files present
PASS  assets               {"commands": 0, "agents": 13, "skills": 47}
PASS  output-style         outputStyle='Atlas Orchestrator'
WARN  context-tooling      /private/tmp/atlas-demo/scripts-root/AGENTS.md does not exist; run atlas-setup to scaffold it
WARN  omp-model-roles      omp modelRoles missing atlas-mechanic, atlas-worker: ... Set modelRoles.atlas-mechanic (and atlas-worker) to a haiku/flash-class model in ~/.omp/agent/config.yml
PASS  typesafe-scoring     TYPESAFE_API_KEY set; ATLAS_TYPESAFE_SCORING=on; ...
HEALTHY - atlas
```

Exit 0. The two `WARN` lines are actionable and real for this machine: the scratch
directory has no `AGENTS.md`, and omp has no cheap model configured for the
`atlas-worker` and `atlas-mechanic` roles. Other options from `--help`:
`--fix`, `--mine`, `--list-findings [--status open]`, `--set-status ID STATUS`,
`--baseline ID`, `--remeasure`, `--json`. `--list-findings --json` printed
telemetry findings (for example `high error rate on mcp:lean_ctx.ctx_patch`,
status `accepted`) from the shared `~/.atlas/atlas.db`.

#### Shared todo board: `atlas_todo.py`

The board is JSON on stdout. It has no `--help`:

```text
$ python3 plugins/atlas/scripts/atlas_todo.py --help
{"ok": false, "error": "unknown_command", "command": "--help"}
```

The subcommands (from the script's own dispatcher) are `list`, `counts`, `set`,
`add`, `scaffold`, `claim`, `complete`, `status`, `remove`, `carry`, `note`,
`notes`. A short session against a scratch root (`--root` keeps it away from your
project's `.atlas/`):

```bash
R=/tmp/atlas-demo/scripts-root
python3 plugins/atlas/scripts/atlas_todo.py add "write regression test for moving_average" --root $R --phase test
python3 plugins/atlas/scripts/atlas_todo.py add "fix off-by-one in moving_average" --root $R --phase implement
python3 plugins/atlas/scripts/atlas_todo.py counts --root $R
python3 plugins/atlas/scripts/atlas_todo.py claim --root $R --id t5a9d98e6 --owner demo-worker
python3 plugins/atlas/scripts/atlas_todo.py complete --root $R --id t5a9d98e6 --owner demo-worker --evidence "pytest tests/test_stats.py: 3 passed"
python3 plugins/atlas/scripts/atlas_todo.py counts --root $R
```

```text
{"ok": true, "item": {"id": "t5a9d98e6", "content": "write regression test for moving_average", "status": "pending", "owner": null, ... "phase": "test"}, "counts": {"needed": 1, "remaining": 1, "complete": 0, "claimed": 0}}
{"ok": true, "item": {"id": "tb7ef4714", "content": "fix off-by-one in moving_average", "status": "pending", ... "phase": "implement"}, "counts": {"needed": 2, "remaining": 2, "complete": 0, "claimed": 0}}
{"ok": true, "needed": 2, "remaining": 2, "complete": 0, "claimed": 0, "session_id": null}
{"ok": true, "item": {"id": "t5a9d98e6", ... "status": "in_progress", "owner": "demo-worker", ...}
{"ok": true, "item": {"id": "t5a9d98e6", ... "status": "completed", "owner": "demo-worker", ...}
{"ok": true, "needed": 2, "remaining": 1, "complete": 1, "claimed": 0, "session_id": null}
```

The `evidence` string in the `complete` call above is example text, not a test run.
Exit code is 0 on `ok: true` and 1 otherwise, which is what a worker script should
branch on.

#### Dashboard state: `atlas_dashboard.py status`

```bash
python3 plugins/atlas/scripts/atlas_dashboard.py status
```

```json
{"ok": true, "url": "http://127.0.0.1:7421/", "plugin": {"name": "atlas", "version": "9.7.0", "root": "/absolute/path/to/tech-tools/plugins/atlas"}, "keys": ["ok", "generated_at", "url", "db_path", "plugin", "projects", "sessions", "live_sessions"]}
```

That line is the real `ok`, `url`, and `plugin` fields plus the first eight
top-level keys, reformatted onto one line; the full document also has `health`,
`savings`, `connectors`, `user_config`, `findings`, and `ui_hints`, and its
`projects` list showed the two scratch runs as projects with `run_count` 3 each,
so headless runs are registered like any other session. `status` only reads; the
subcommands `serve`, `ensure`, `stop`, and `url` manage the shared daemon (the
browser UI is covered in [Browser dashboard](#browser-dashboard-atlas-workboard)).

### Side effects to expect

Running either harness in a directory creates atlas state there. In the scratch
repo, `git status --short` after the first runs showed:

```text
?? .atlas/
?? .serena/
```

`.atlas/` is atlas's run state (see [Docs as the single source of truth](#docs-as-the-single-source-of-truth));
`.serena/` comes from the serena MCP tooling, not from atlas: the atlas boot hook
only repairs an existing `.serena/project.yml` and states that absent configs are
not created (`plugins/atlas/hooks/session_boot.py`, `heal_serena_project`). Add both
to `.gitignore` in real projects.

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

## Browser dashboard (Atlas Workboard)

Atlas ships one shared, loopback-only web dashboard for every concurrent coding-agent terminal. A single daemon serves a static single-page UI (no build step, no CDN) plus a JSON API, reading the shared `~/.atlas/atlas.db`, each project's `.atlas/.run/` (todo board, board notes, findings) and live tmux panes. It never spawns agents: starting a colony is a command it prints for you to run.

Workboard v2 (the nine-page UI, `/api/v2`, SSE, and the token guard below) ships in atlas 10.0.1. Older installs serve the legacy single-page dashboard and answer 404 on `/api/v2/*`; update with the commands in [Install and update](#install-and-update).

![Overview page](img/readme-workboard-overview.png)

Every screenshot below was captured from a real daemon running this repo's source (`plugins/atlas/scripts/atlas_dashboard.py`) on port 7431, against a throwaway project (`demo-app`, an invented calculator library) and an empty, isolated `ATLAS_HOME`. All names, tasks, messages and findings are synthetic and were created with the real CLIs listed in "Reproduce these screenshots" below. The Settings screenshots show only the top "Dashboard preferences" section: the lower Behavior, Ecosystem and connector sections read your own `~/.claude/settings.json` and installed plugins, so they are intentionally not shown.

### Start, stop, and find the URL

| Command | What it does |
|---|---|
| `python3 plugins/atlas/scripts/atlas_dashboard.py ensure [--port N]` | Start the daemon if it is not running and print result JSON. Restarts it if the running daemon serves a different DB. |
| `python3 plugins/atlas/scripts/atlas_dashboard.py serve [--port N] [--host H] [--foreground] [--allow-remote]` | Run the server. `--foreground` keeps it attached to the terminal. |
| `python3 plugins/atlas/scripts/atlas_dashboard.py url` | Print the URL if the default port is open (exit 1 otherwise). |
| `python3 plugins/atlas/scripts/atlas_dashboard.py status` | Print a JSON snapshot (keys: `ok, generated_at, url, db_path, plugin, projects, sessions, live_sessions, health, savings, connectors, user_config, settings_path, findings, ui_hints`). |
| `python3 plugins/atlas/scripts/atlas_dashboard.py stop` | Stop the daemon recorded in `~/.atlas/dashboard.pid`. |

| Environment variable | Default | Effect |
|---|---|---|
| `ATLAS_DASHBOARD_PORT` | `7421` | Port for `serve`, `ensure`, `url`. |
| `ATLAS_DASHBOARD` | `on` | `0`, `off`, `false` or `no` disables the SessionStart auto-start. |
| `ATLAS_DASHBOARD_DB` | `~/.atlas/atlas.db` | Database the dashboard serves. |
| `ATLAS_HOME` | `~/.atlas` | State directory: `dashboard.pid`, `dashboard.log`, `dashboard-prefs.json`, `atlas.db`. Point it elsewhere to run an isolated instance. |

Real output of `serve --help` and the loopback guard:

```text
$ python3 plugins/atlas/scripts/atlas_dashboard.py serve --help
usage: atlas_dashboard.py serve [-h] [--port PORT] [--host HOST]
                                [--foreground] [--allow-remote]
...
  --allow-remote  Allow binding a non-loopback --host (e.g. 0.0.0.0 or a LAN
                  IP). The dashboard serves session/findings data with no
                  auth; binding it to all interfaces exposes that data to the
                  network. Off by default.

$ python3 plugins/atlas/scripts/atlas_dashboard.py serve --host 0.0.0.0 --port 7432
[atlas-dashboard] refusing to bind non-loopback host '0.0.0.0'; pass --allow-remote to expose the dashboard beyond localhost
```

That help text predates the request guard described under
[Security model](#security-model): mutations, the event stream and the
sensitive reads now require `X-Atlas-Token`, but the other read-only `GET`
routes stay unauthenticated, so keep the loopback default.

Boot injection: the SessionStart hook (`hooks/session_boot.py`, `ensure_dashboard`) runs `atlas_dashboard.py ensure` with an 8 second timeout and adds one line to the boot context. The format string in the source produces (`started` instead of `ready` when it had to launch the daemon):

```text
dashboard: http://127.0.0.1:7421/ (ready) — open once; all concurrent terminals share it
```

It does not open a browser and fails open: if the script is missing or `ensure` errors, the line is simply omitted. This line is copied from the source string, not from a captured session, because the daemon here was started by hand.

To run a throwaway instance without touching your real daemon or pid file:

```bash
ATLAS_HOME=/tmp/wb-demo ATLAS_DASHBOARD_DB=/tmp/wb-demo/atlas.db \
  python3 plugins/atlas/scripts/atlas_dashboard.py serve --port 7431 --foreground
```

### Pages

Hash-routed (`#/<page>`), default `#/overview`. A project switcher in the sidebar scopes every page to `all` or one project root.

| Group | Page | What you can do there | Screenshot |
|---|---|---|---|
| Observe | Overview | KPIs (runs, dispatches, silent failures, open findings), the "Needs attention" inbox with an "Open in Health" action per item, activity trend, recent runs | `readme-workboard-overview.png` |
| Observe | Activity | Group events by project, kind or agent; filter by kind; search; live tail; save a view | `readme-workboard-activity.png` |
| Observe | Health | Subsystem cards (hooks, gates, dispatch, colony/mux, dashboard daemon, telemetry DB, connectors, memory capture, nudge, doctor, chronicle ingest), 24h/7d/30d window, silent-failure table | `readme-workboard-health.png` |
| Operate | Colony | See every tmux rig and agent with state (`working`, `idle`, `needs_input`, `failed`, `exited`, `unknown`), open an agent drawer, send a message, copy the attach command, stop a rig | `readme-workboard-colony.png` |
| Operate | Work | The durable todo board: add, claim, edit, change status, reorder, remove | `readme-workboard-work.png` |
| Operate | IRC | Read what agents and you said to each other; filter by channel, agent, text; pause the live tail; send to one agent | `readme-workboard-irc.png` |
| Improve | Self-improvement | Observe, mine, propose, apply, remeasure pipeline; doctor findings with "Mark fixed", "Dismiss", "Won't fix", "Remeasure" | `readme-workboard-improve.png` |
| Configure | Projects | Pin, mute or hide projects; drill into one | `readme-workboard-projects.png` |
| Configure | Settings | Theme, density, default project, polling interval, noise filters, navigation order, Behavior knobs, Ecosystem toggles, connector credentials (password inputs, saved values never echoed), per-project Agents editor | `readme-workboard-settings.png` |

![Colony page](img/readme-workboard-colony.png)

The Colony page above shows `1 rig, 12 agents` for the demo project. Agent names are the demo's own board notes (`Implementer`, `Researcher`, `Verifier`) plus `atlas:<agent>#<n>` rows from recorded subagent dispatches. The rig is a synthetic `board-<project>` rig built from board notes and dispatch rows (each card says `no tmux pane`), which is how non-tmux work still appears. Real rigs are tmux sessions named `atlas-<run>`; the colony is opt-in via `ATLAS_MUX=tmux`. The `Stop rig` button is real but was not clicked.

![Health page](img/readme-workboard-health.png)

![Self-improvement page](img/readme-workboard-improve.png)

![Work page](img/readme-workboard-work.png)

![IRC page](img/readme-workboard-irc.png)

![Activity page](img/readme-workboard-activity.png)

![Projects page](img/readme-workboard-projects.png)

![Settings page](img/readme-workboard-settings.png)

The same page with the Theme dropdown set to Light (the dropdown, density, default project, polling interval and noise filters all save immediately through `PUT /api/v2/prefs`):

![Settings page, light theme](img/readme-workboard-settings-light.png)

### Keyboard, command palette, theme and density

| Keys | Action |
|---|---|
| `Ctrl/Cmd + K` | Open or close the command palette |
| `/` | Focus the page search field, or open the palette if the page has none |
| `g` then `o` `a` `h` `c` `w` `i` `s` `p` `,` | Go to Overview, Activity, Health, Colony, Work, IRC, Self-improvement, Projects, Settings (1.5 s chord window) |
| `?` | Show the shortcut list |
| `Esc` | Close palette, then modal, then drawer |

Shortcuts other than `Ctrl/Cmd+K` and `Esc` are ignored while focus is in an input, textarea, select or contenteditable element.

![Command palette](img/readme-workboard-palette.png)

The palette lists "Go to ..." for every page, "Toggle light and dark theme", "Toggle compact density", "Keyboard shortcuts", "Show all projects" and one "Switch to project ..." per project. It filters by substring: typing `colony` left only `Go to Colony` (`g c`). Observed: pressing `g` then `c` on `#/overview` moved the browser to `#/colony`.

![Keyboard shortcuts](img/readme-workboard-shortcuts.png)

| Preference | Values | Where |
|---|---|---|
| `theme` | `dark` (default), `light`, `system` | topbar sun/moon button, palette, Settings |
| `density` | `comfortable` (default), `compact` | palette, Settings |
| `default_project` | `all` or an absolute project root | project switcher, Settings |
| `refresh_seconds` | 2 to 3600 (Settings field limits to 2 to 300) | Settings, polling fallback only |
| `noise.collapse_duplicates`, `noise.min_severity` | `true`/`false`; `info`, `warn`, `fail` | Settings |

Preferences are saved to `~/.atlas/dashboard-prefs.json` (`$ATLAS_HOME/dashboard-prefs.json`); `theme`, `density` and `default_project` are also mirrored to browser `localStorage["atlas.dashboard.prefs"]` for first paint. Clicking the theme button on the Overview page flipped `data-theme` from `dark` to `light` and the prefs file then read `"theme": "light"`.

![Light theme](img/readme-workboard-light.png)

![Compact density](img/readme-workboard-compact.png)

### Live updates: SSE with polling fallback

The topbar shows `Live` while the Server-Sent Events stream is connected. `GET /api/v2/stream` re-reads `colony`, `todos`, `irc` and `health` every 5 seconds and emits a topic only when its content hash changed, plus a `tick` every cycle and a 15 second comment heartbeat. If `EventSource` is missing or fails twice, the client polls `/api/v2/*` every 8 seconds (`refresh_seconds`) and the topbar says `Polling every 8s`.

Captured from the running daemon (token passed as `?token=`, because `EventSource` cannot set headers):

```text
$ curl -s -N -m 7 -D - "http://127.0.0.1:7431/api/v2/stream?token=$TOKEN"
HTTP/1.0 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store
Connection: close
X-Accel-Buffering: no

retry: 3000

event: colony
data: {"mux_enabled":true,"tmux_available":true,"rigs":[{"id":"board-atlas-demo-app","run":"board","project":"/private/var/tmp/atlas-demo-app",...

event: todos
data: {"project":"all","projects":["/private/var/tmp/atlas-demo-app"],"phases":[{"name":"research","items":[{"id":"te9b43d04","content":"Research: survey existing calculator libraries","status":"done"...

event: irc
data: {"messages":[{"id":"m96f9c3d9a45f","ts":"2026-10-06T15:57:26Z","from":"Implementer","to":"all","body":"Starting on subtract and multiply in src/calc.py",...

event: health
data: {"subsystems":[{"id":"hooks","label":"Hooks","status":"unknown","detail":"no hookstate recorded",...

event: tick
data: {"ts":1791302451.173032}
```

With `?project=/private/var/tmp/atlas-demo-app` added, a 7 second capture counted `colony` x2, `health` x1, `irc` x1, `todos` x1 and `tick` x2 events, so topics are re-sent only when their hash changes while `tick` fires every cycle.

### Security model

Every route and method passes a request guard first, in this order:

| # | Check | Failure |
|---|---|---|
| 1 | `Host` must be `127.0.0.1:<port>` or `localhost:<port>` | `403 bad_host` |
| 2 | POST and PUT need `Content-Type: application/json` | `415 unsupported_media_type` |
| 3 | A present `Origin` must be the same loopback origin | `403 bad_origin` |
| 4 | Mutations, `/api/v2/stream` and sensitive GETs (IRC, colony capture, colony agent, transcripts) need `X-Atlas-Token` | `401 bad_token` |

The token is `secrets.token_urlsafe(32)`, regenerated at every daemon start, and delivered only inside `GET /` as `<meta name="atlas-token" content="...">`. `OPTIONS` answers 204 with `Allow: GET, HEAD, POST, PUT` and no CORS headers. `/api/health` is Host-checked only so hooks and `ensure` can probe it. Bodies are capped at 4 MiB.

Real run against the daemon on port 7431 (`TOKEN` is read from the page's meta tag):

```bash
TOKEN=$(curl -s http://127.0.0.1:7431/ | grep -o 'name="atlas-token" content="[^"]*"' | sed 's/.*content="//;s/"$//')
```

```text
# 1) JSON body, no token -> 401
$ curl -s -i -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:7431/api/v2/colony/spawn-help
HTTP/1.0 401 Unauthorized
{
  "ok": false,
  "error": "bad_token",
  "why": "missing or invalid X-Atlas-Token",
  "do": "reload the dashboard page to obtain a fresh token"
}

# 2) same request with the token -> 200
$ curl -s -i -X POST -H 'Content-Type: application/json' -H "X-Atlas-Token: $TOKEN" -d '{}' http://127.0.0.1:7431/api/v2/colony/spawn-help
HTTP/1.0 200 OK
{
  "ok": true,
  "mux_enabled": true,
  "tmux_available": true,
  "steps": [
    { "label": "Install tmux (if missing)", "command": "brew install tmux" },
    { "label": "Enable colony mode for this shell", "command": "export ATLAS_MUX=tmux" },
    ...
  ],
  "next": "run the commands in your terminal; the dashboard never spawns processes itself"
}

# 3) token but no JSON content type -> 415
HTTP/1.0 415 Unsupported Media Type
{ "ok": false, "error": "unsupported_media_type", "why": "mutations must send Content-Type: application/json", ... }

# 4) forged Host header -> 403
$ curl -s -i -H 'Host: evil.example:7431' http://127.0.0.1:7431/api/v2/overview
HTTP/1.0 403 Forbidden
{ "ok": false, "error": "bad_host", "why": "Host 'evil.example:7431' is not this dashboard",
  "do": "use http://127.0.0.1:7431/ or http://localhost:7431/" }

# 5) foreign Origin -> 403
$ curl -s -i -H 'Origin: http://evil.example' -H "X-Atlas-Token: $TOKEN" 'http://127.0.0.1:7431/api/v2/irc?project=all'
HTTP/1.0 403 Forbidden
{ "ok": false, "error": "bad_origin", "why": "Origin 'http://evil.example' is not this dashboard",
  "do": "call the API from the dashboard page itself" }
```

The stream follows the same rule: `GET /api/v2/stream` without a token returned `401 bad_token`, and with `?token=` returned `200 text/event-stream`. External scripts that used to POST to the dashboard must now fetch `GET /` first and send both the token and the JSON content type.

### Sending to an agent (Colony and IRC)

`POST /api/v2/colony/send` (and the IRC box) first probes the pane's foreground process, then decides:

| Outcome | When | Result |
|---|---|---|
| Delivered | Pane runs an interactive `claude` or `omp` session and shows no prompt | Text typed with `tmux send-keys -l` plus Enter inside a `From:/To:` envelope; message status `delivered` |
| `409 typing_guard` | Interactive pane that is `needs_input` or shows a prompt, and `force` is not true | Nothing typed. Resend with `force:true` or attach and answer yourself |
| `409 pane_not_steerable` | Pane runs a shell, python, node or anything else, or the probe fails | Nothing typed (typed text would run as a command); `force:true` does not override; message recorded with status `refused` |
| `queued` | Headless `-p` mux worker, or an agent with no live pane | Recorded as a board note (`delivered:"queued"`); the worker reads it on its next tool call, then status becomes `read` |

Every send is also recorded as an IRC message. `POST /api/v2/irc` reports the same refusals as HTTP 200 with `ok:false`, not 409. Keyboard shortcuts are separately disabled while you type in the message box.

Validation runs before any pane or board write. Real responses, with a real token, for requests that wrote nothing:

```text
$ curl -s -X POST <headers as above> -d '{"run":"x","name":"nobody","text":"  "}' http://127.0.0.1:7431/api/v2/colony/send
HTTP/1.0 400 Bad Request
{ "ok": false, "error": "text_required", "why": "nothing to send", "do": "pass a non-empty text" }

$ ... -d '{"run":"nope","name":"nobody","text":"hi"}'
HTTP/1.0 404 Not Found
{ "ok": false, "error": "agent_not_found", "why": "no agent 'nobody' in run 'nope'", "do": "refresh the colony" }

$ curl -s -X POST <headers as above> -d '{"run":"demo","name":"worker1"}' http://127.0.0.1:7431/api/v2/colony/attach-command
{ "ok": true, "command": "tmux attach -t atlas-demo:worker1" }
```

The `typing_guard`, `pane_not_steerable`, `queued` and `delivered` outcomes in the table come from `send_to_agent` in `plugins/atlas/scripts/atlas_dash_colony.py` and the API reference. They were not triggered live: doing so needs a real `atlas-*` tmux rig, and sending would type into a real pane or write to a project board. [INFERENCE] about runtime behavior beyond the code paths read.

### Reproduce these screenshots

The screenshots use a throwaway project and an isolated state directory, so your real `~/.atlas` is never read or written. These are the commands that produced them (run from the repository root, since `$S` is the relative path to the atlas `scripts/` directory):

```bash
R=/private/var/tmp/atlas-demo-app      # not /tmp: the Projects list hides /tmp roots as noise
H=/tmp/wb-demo-clean
S=plugins/atlas/scripts
export ATLAS_HOME=$H ATLAS_DB=$H/atlas.db ATLAS_DASHBOARD_DB=$H/atlas.db ATLAS_PROJECT_ROOT=$R

mkdir -p $R/src $R/tests $H && git -C $R init -q          # a .git marker is enough; no commit needed

# Todos in three phases, then claim and complete some (board: $R/.atlas/.run/todos.json)
python3 $S/atlas_todo.py add "Research: survey existing calculator libraries" --phase research --root $R
python3 $S/atlas_todo.py claim    --id <id> --owner Researcher --root $R
python3 $S/atlas_todo.py complete --id <id> --owner Researcher --evidence "surveyed 3 libraries" --root $R
python3 $S/atlas_todo.py status   --id <id> --status in_progress --owner Implementer --root $R

# Board notes become IRC lines and Colony agents
python3 $S/atlas_todo.py note "API sketch is ready." --owner Researcher --to Implementer --root $R

# Project ledger entries (Self-improvement page)
python3 $S/atlas_finding.py --root $R --id S1 --status verified --title "add returns the sum" --evidence tests/test_calc.py::test_add --by demo:verifier
```

Runs, dispatches, friction events, doctor findings and a few failing tool calls were written through the `atlas_db` helpers (`register_project`, `start_run`, `log_dispatch`, `finalize_run`, `record_friction`, `upsert_finding`, `insert_tool_call`) into `$H/atlas.db`. Then start the daemon against that state:

```bash
ATLAS_HOME=$H ATLAS_DASHBOARD_DB=$H/atlas.db python3 $S/atlas_dashboard.py serve --port 7431 --foreground
```

Two things this seeding showed that are worth knowing:

- `atlas_todo.py` has no help flag. `atlas_todo.py --help` answers `{"ok": false, "error": "unknown_command"}`, but `atlas_todo.py add --help` treats `--help` as the todo text and creates an item. The board root is `--root`, then `ATLAS_PROJECT_ROOT`, then the nearest ancestor of the current directory holding `.git`, `.atlas` or `docs/`, so always pass `--root`.
- The CLI's status values are `pending`, `in_progress` and `completed` (`STATUSES` in `atlas_todo.py`), and any other value is stored as `pending`, so `atlas_todo.py status --status blocked` left the item open. A blocked item is made through the dashboard API: `POST /api/v2/todos` with `{"op": "status", "status": "blocked"}` returned `ok: true` and counts `{"open": 2, "in_progress": 2, "done": 2, "blocked": 1}`, and the board file then held `"status": "pending"` plus a separate `"blocked": true` flag on the item. The Work and Overview screenshots were re-captured after this call, so they include one blocked item.

### More

- Full route-level reference: `plugins/atlas/skills/atlas-orchestrate/references/dashboard-api.md`.
- Product overview, agent states and the OpenRig mapping: `docs/atlas-workboard.md`.

## Browser automation and testing

atlas can put a real browser in front of your running app and report what it actually did: did the route render, was the console clean, did the network calls succeed. Four atlas skills and one agent cover this, from a one-load smoke check up to a full persona sweep. They share one rule: browser work is done by the `ui-runtime-tester` agent through whatever browser surface your harness exposes, never inline and never through an ad hoc Playwright install.

### Options at a glance

| Piece | Kind | Trigger phrases | Fixes code? | Scope | Inputs and modes | Evidence it produces |
|---|---|---|---|---|---|---|
| `atlas-test-browser` | skill | "smoke test", "check changed routes", "does it load", "console errors", "quick browser check" | No. Marks Fail and hands off | Routes touched by the current diff or PR | Argument: PR number, branch name, `current`, or `--port PORT`. Modes: manual (default, you run the dev server) and `mode:pipeline` (unattended, claims a free port, starts and tears down the server, never prompts) | Per-route Pass/Fail/Skip table, exact console lines, failing network entries, screenshots under `.atlas/evidence/<date>-<slug>/`, a `findings.json` entry per failed route |
| `atlas-dogfood` | skill | "dogfood this change", "drive the changed flows", "find and fix UI breakage" | Yes, bounded. Repairs only via dispatched `atlas:implementer`, each fix confirmed by a fresh `atlas:verifier` | User flows touched by the current diff or PR | Argument: PR number, branch, or `current`, plus `--port PORT` and `--fix-budget N`. Stops if the diff is empty. Never auto-commits | Scenario matrix (Pass, Fixed, Skipped, Blocked), regression tests for each fix, report at `docs/audits/atlas-dogfood-<branch-slug>-<date>/report.md` |
| `atlas-ux-test` | skill | "UX test swarm", "persona testing", "pre-release sweep", "fuzz the forms" | No. Detects and reports only | The whole app, multi-persona | `users=` (6/12/24 or integer, default 12), `coverage=smoke\|standard\|full`, `profile=valid\|mixed`, `speed=fast\|thorough`, `seed=`. Browser walk runs only in `standard` and `full` | Before and after screenshot per mutating step, Nielsen 0-4 severity, three gates (G1 client-surface, G2 evidence-complete, G3 accuracy), completion-rate verdict under `docs/claude_testers/run-<date>/reports/` |
| `ui-runtime-tester` | agent (pink, sonnet, low effort) | Dispatched by the three skills above and by `atlas-frontend` / `atlas-feature` waves; also named directly in the routing table for "run and validate behavior" | No. Write, Edit and dispatch tools are removed | One navigation session per tester | Static gate first (typecheck, lint, tests, build), then live drive: render, console, network, loading/empty/error/success states, mobile width | Pass/fail per behavior with screenshot path, console line, or network entry; fixed report container (`STATUS`, `STEPS`, `EVIDENCE`, `DELIVERABLE`, `NEXT`) |
| `browser-use` MCP | MCP server (`browser_use`) | Any task that needs real Chrome, the user's logged-in session, or a bot-protected page | n/a (a tool, not a workflow) | One Chrome via CDP | `browser_exec` (Python helpers: `new_tab`, `page_info`, `js`, `click_at_xy`, `wait_for_load`, `list_tabs`) and `browser_screenshot` (`full`, `max_dim`) | Screenshots and whatever the script prints. `atlas-ux-test` personas use it (as `browser-harness`) for real-Chrome walks |
| omp `browser` tool | omp built-in (eval global) | omp sessions that need JavaScript execution, authenticated sessions, or interaction | n/a | Managed Chromium, an attached CDP endpoint, or your Chrome via the omp relay | `browser.open({name, url, headed, persist, app})`, then `observe`, `click`, `fill`, `screenshot`, `console`, `errors`, `requests` | Structured values and screenshots returned to the eval cell |
| `cmux browser` | cmux CLI | Sessions running inside cmux (`CMUX_SOCKET_PATH` set) | n/a | A browser pane (WKWebView) inside your cmux workspace | `cmux browser open <url>`, then `surface:<N> goto, get, click, wait, screenshot --out, console list, errors list, viewport, tab close` | Screenshots to a path you choose, console and error lists, DOM text |

How the atlas pieces relate, in one line each:

- Smoke check a change: `atlas-test-browser`.
- Smoke check, then fix what broke: `atlas-test-browser`, then `atlas-dogfood` with the failed routes as scope.
- Full pre-release UX pass: `atlas-ux-test` (do not combine with the others in one run).
- One known bug, root-cause fix: `atlas-debug`.

### Claude Code versus omp

The skills, the tester's method, and the report formats are the same on both surfaces. What changes is who supplies the browser.

| | Claude Code | omp |
|---|---|---|
| Tester agent | `agents/ui-runtime-tester.md`: `model: sonnet`, `effort: low`, `disallowedTools` removes Agent, Task, Write, Edit, MultiEdit | `omp/agents/ui-runtime-tester.md`, generated from the Claude file by `omp/gen-agents.ts`: `thinkingLevel: low`, model `["@atlas-worker","@smol"]`, `spawns: "none"` |
| Browser surface the method names | Claude_Preview MCP (`preview_start`, `preview_click`, `preview_fill`, `preview_console_logs`, `preview_network`, `preview_screenshot`) or the `webapp-testing` skill (Playwright) | The same method text ships to omp, so there the tester uses what omp actually exposes: the `browser` eval global, the `browser-use` MCP device, or `cmux browser` |
| Calling an MCP browser tool | `mcp__<server>__browser_exec` style tool names, loaded with `ToolSearch` [INFERENCE: exact prefix varies per install, per capability-routing.md Step 2b] | A device path: write JSON to `xd://mcp__browser_use_browser_use_browser_exec`. `browser_use` is listed under `underscoredServers` in `contracts/mcp-servers.json` so atlas's transcript reader splits that device name at the right boundary |
| Dispatch | `Agent` tool with `subagent_type: atlas:ui-runtime-tester` | `task` tool; the lead alone dispatches, testers cannot spawn |

atlas does not wire a browser server of its own. `browser_use` appears in `contracts/mcp-servers.json` only as a name the transcript tooling must recognise; the server itself comes from your own MCP configuration. [INFERENCE] The omp tester's body still names Claude_Preview, so on omp it relies on the model choosing the omp-side surface from the same instructions.

### Prompts to type

Claude Code:

```text
smoke test the routes my branch touches
smoke test PR 482 --port 5173
run atlas-test-browser mode:pipeline on current
dogfood this change and fix what breaks, --fix-budget 3
run a UX test swarm users=6 coverage=smoke
run a full UI pass before release, users=12 coverage=full seed=42
use the ui-runtime-tester to confirm the settings page renders with a clean console
```

omp:

```text
/skill:atlas-test-browser current
smoke test the routes this diff touches and show me the console errors
dogfood PR 482 and repair any breakage
UX test swarm, coverage=standard
open http://localhost:3000/settings in the browser tool and tell me what the console says
```

The `/skill:` prefix form for omp was run as typed in the worked example below and triggered the skill; the plain-language prompts are what the skills' `when_to_use` lines match.

### Manual drive with cmux browser (not an atlas surface)

This part is a person, not atlas, driving a browser by hand with `cmux browser` commands, the way a tester would. A two-route static site was served from `/tmp`, and the checks were the ones `ui-runtime-tester` makes: load, read, interact, capture console and network. It shows what evidence looks like and what the skills collect for you; the next section shows the atlas skill doing it. The `browser-use` MCP and the omp `browser` tool were both tried first and failed in this environment (see "Browser surfaces that did not work" at the end), so this walkthrough used `cmux browser`.

Serve the demo (one working route, one broken route):

```bash
python3 -m http.server 51596 --bind 127.0.0.1 --directory /tmp/atlas-browser-demo
for u in / /health.json /broken.html /api/metrics; do
  printf '%s -> ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:51596$u"
done
```

```text
/ -> 200
/health.json -> 200
/broken.html -> 200
/api/metrics -> 404
```

`broken.html` fires, 1.2 seconds after load, a `fetch('/api/metrics')` that returns 404 and a call to an undefined `renderChart()`.

Open a pane without stealing focus, then check the working route:

```bash
cmux browser open http://127.0.0.1:51596/ --focus false
S=surface:36
cmux browser $S wait --load-state complete --timeout 15
cmux browser $S get title
cmux browser $S get text "#health"
cmux browser $S get text "#count"
cmux browser $S click "#inc"        # three times
cmux browser $S get text "#count"
cmux browser $S console list
cmux browser $S errors list
```

```text
OK surface=surface:36 pane=pane:23 placement=split
Atlas Demo - Dashboard
ok
0
3
No console entries
No browser errors
```

The title rendered, the API health card resolved to `ok`, the button moved the counter from 0 to 3, and the console and error lists were empty.

![Working route after three clicks](img/readme-browser-index.png)

Now the broken route. Clear both lists first so only this page's output is captured, wait past the 1.2 second timer, then read everything back:

```bash
cmux browser $S console clear; cmux browser $S errors clear
cmux browser $S goto http://127.0.0.1:51596/broken.html
cmux browser $S wait --load-state complete --timeout 15; sleep 3
cmux browser $S is visible "#banner"
cmux browser $S get text "#banner"
cmux browser $S console list
cmux browser $S errors list
cmux browser $S eval 'fetch("/api/metrics").then(r=>r.status+" "+r.url)'
```

```text
1
Could not load metrics (HTTP 404)
[error] Atlas demo: metrics request failed with HTTP 404
[error] ReferenceError: Can't find variable: renderChart
404 http://127.0.0.1:51596/api/metrics
```

![Broken route showing the error banner](img/readme-browser-broken.png)

`cmux browser network requests` is not available on cmux's WKWebView (`Error: not_supported: browser.network.requests is not supported on WKWebView`), so network evidence came from an in-page `fetch` probe plus the server's own access log:

```text
127.0.0.1 - - [06/Oct/2026 11:49:02] "GET /broken.html HTTP/1.1" 200 -
127.0.0.1 - - [06/Oct/2026 11:49:03] code 404, message File not found
127.0.0.1 - - [06/Oct/2026 11:49:03] "GET /api/metrics HTTP/1.1" 404 -
```

### The skill running itself (headless, real output)

The walkthrough above is a person driving a browser. This section is the atlas skill doing the work. Setup: a scratch git repo whose `main` branch holds `index.html` and `health.json`, and whose `feature/broken-reports` branch adds `broken.html`, so the diff against `main` touches exactly one route. The demo site is served on a free port by `python3 -m http.server`.

```text
$ git log --oneline --all
e2a88db Add broken reports route
ee337dc Add dashboard route
$ git diff --name-only main...HEAD
broken.html
```

#### Claude Code

```bash
cd /tmp/atlas-browser-skill
ATLAS_MANDATES=off claude -p "atlas-test-browser --port 56751 current" \
  --output-format stream-json --verbose --max-budget-usd 2 --permission-mode dontAsk \
  --mcp-config mcp.json \
  --allowedTools "Read" "Glob" "Grep" "Bash" "Edit" "Write" "Agent" "Task" "ToolSearch" "Skill" \
    "TodoWrite" "mcp__playwright__*" "mcp__mcp-search__*"
```

`mcp.json` is the browser surface for this run, because the machine's Claude Code config had no browser MCP server:

```json
{"mcpServers": {"playwright": {"command": "npx", "args": ["-y", "@playwright/mcp@latest", "--headless"]}}}
```

Result: exit code 0, 56 seconds, 7 turns, about $0.84, zero permission denials. `ATLAS_MANDATES=off` was set to skip the session recall gate; the run was not tested with it on. The tool calls the skill actually made, from the stream (paths shortened, 14 calls in all):

```text
01 Skill      {"skill": "atlas:atlas-test-browser", "args": "--port 56751 current"}
02 Read       skills/atlas-test-browser/references/route-and-report.md
03 Bash       git diff --name-only main...HEAD; curl -s -o /dev/null -w "%{http_code}" http://localhost:56751
04 Bash       wc -l broken.html && cat broken.html; curl ... /broken.html
05 Agent      {"subagent_type": "atlas:ui-runtime-tester", "name": "ui-runtime-tester-broken-reports", ...}
06 ToolSearch select:mcp__playwright__browser_navigate,...console_messages,...network_requests,...
07 Bash       mkdir -p .atlas/evidence/2026-10-06-broken-reports/
08 mcp__playwright__browser_navigate         {"url": "http://localhost:56751/broken.html"}
09 mcp__playwright__browser_wait_for         {"time": 3}
10 mcp__playwright__browser_console_messages {"filename": ".atlas/evidence/.../console.txt"}
11 mcp__playwright__browser_network_requests {"filename": ".atlas/evidence/.../network.txt"}
12 mcp__playwright__browser_take_screenshot  {"filename": ".atlas/evidence/.../broken.png"}
13 Bash       ls; cat console.txt network.txt
14 Bash       atlas_finding.py --id smoke-broken-html --status verified ... (two ledger entries)
```

The orchestrator mapped the diff to one route, checked the server, and dispatched the tester using the skill's template. The dispatch prompt, trimmed:

```text
ROLE: Live browser smoke tester for routes affected by the current diff
GOAL: Load each listed route and report Pass/Fail/Skip per route with evidence.
CONTEXT: Dev server at http://localhost:56751 (already running; root returns 200). Diff scope: branch
  feature/broken-reports vs main ... Affected routes: /broken.html (changed file: broken.html ...)
Evidence dir: .atlas/evidence/2026-10-06-broken-reports/ (create it).
...
```

Evidence files the tester wrote:

```text
broken.png   console.txt   network.txt

console.txt:
Total messages: 4 (Errors: 4, Warnings: 0)
[ERROR] Failed to load resource: the server responded with a status of 404 (File not found) @ http://localhost:56751/favicon.ico:0
[ERROR] Failed to load resource: the server responded with a status of 404 (File not found) @ http://localhost:56751/api/metrics:0
[ERROR] Atlas demo: metrics request failed with HTTP 404 @ http://localhost:56751/broken.html:27
ReferenceError: renderChart is not defined
    at http://localhost:56751/broken.html:36:5

network.txt:
1. [GET] http://localhost:56751/broken.html => [200] OK
2. [GET] http://localhost:56751/api/metrics => [404] File not found
```

The skill's final message, verbatim apart from trims:

```markdown
ATLAS | done | Smoke check result: FAIL, 1 route tested, 0 Pass, 1 Fail, 0 Skip.

## Browser Smoke Check Results

**Test Scope:** `feature/broken-reports` vs `main` (changed file: `broken.html`)
**Server:** http://localhost:56751 (root and route both returned 200 on preflight)

| Route | Status | Notes |
|-------|--------|-------|
| `/broken.html` | Fail | `GET /api/metrics` returned 404, and `ReferenceError: renderChart is not defined` at `broken.html:36:51`. Evidence: `.atlas/evidence/2026-10-06-broken-reports/` |

**Console errors: 4**
- `Failed to load resource: 404 (File not found) @ /api/metrics`
- `Atlas demo: metrics request failed with HTTP 404 @ broken.html:27`
- `ReferenceError: renderChart is not defined at broken.html:36:51`
- `favicon.ico` 404, likely unrelated

**Human verifications:** 0

The tester did not inspect the rendered page content, so the visible state (for example the error banner) is `[unverified]`. ...

Ledger: two entries (`smoke-broken-html`, `smoke-run-2026-10-06`) written to `.atlas/.run/findings.json`.

Remediation: run atlas-dogfood (same diff scope + autonomous repair loop) or
atlas-debug (single-issue root-cause fix) with `/broken.html` as scope.
```

Two things worth noting in that report. It says plainly what it did not verify (the banner), which is the `[unverified]` rule in the tester's agent definition doing its job. And it never touched a source file: the scratch repo's `git status` afterwards showed only untracked tool directories (`.atlas/`, `.playwright-mcp/`, `.serena/`), no modified tracked file.

#### omp

```bash
cd /tmp/atlas-browser-skill
ATLAS_MANDATES=off omp -p --no-session \
  --extension <repo>/plugins/atlas/omp \
  "/skill:atlas-test-browser --port 56751 current"
```

Result: exit code 0, 134 seconds. The `/skill:` form worked as typed. The extension was loaded by directory, as `plugins/atlas/omp/README.md` prescribes. Three unrelated user MCP servers failed to connect and omp warned about each (`fiddler`, `magic`, `context7`); the run was unaffected. This run tested two routes, because the omp lead also checked the root as a baseline, and its tester read the rendered banner that the Claude Code run left `[unverified]`. The final message, trimmed:

```markdown
ATLAS | done | FAIL: `/broken.html` breaks, root passes

## Browser Smoke Check Results

**Test Scope:** branch `feature/broken-reports` (commit `e2a88db`). The diff against main changes only `broken.html` (+40 lines).
**Server:** http://localhost:56751 (it was already running and the root page returned 200).

### Routes Tested: 2

| Route | Status | Notes |
|---|---|---|
| `/` (baseline) | Pass | Title "Atlas Demo - Dashboard" and the Dashboard heading show, along with "API health ok". The console is clean. Clicking Increment raises the count to 1. Evidence: `root.png` |
| `/broken.html` | Fail | The page shows (title "Atlas Demo - Reports", Reports heading), but a red banner says "Could not load metrics (HTTP 404)". Evidence: `broken.png`, `broken-console.txt`, `broken-resources.txt` |

### Console Errors: 2 (both on `/broken.html`)
- `[error] Atlas demo: metrics request failed with HTTP 404`
- `[error] ReferenceError: Can't find variable: renderChart`

### Network Failures: 1
- `GET http://localhost:56751/api/metrics` returns 404. I re-ran the fetch from inside the page and got 404 again. The browser here can't record network requests directly, so this comes from the page's own list of loaded resources plus that manual fetch.

### Human Verifications: 0
### Failures: 1
- `/broken.html`: about 1.2s after load, `fetch('/api/metrics')` returns 404. The page then calls `renderChart()`, which is never defined anywhere.

### Result: FAIL

Remediation: run atlas-dogfood (same diff scope + autonomous repair loop) or
atlas-debug (single-issue root-cause fix) with the failed routes above as scope.
```

The wording `Can't find variable: renderChart` and the note that network requests cannot be recorded match what `cmux browser` returned earlier in this section (a WKWebView backend), and the evidence files (`*-snapshot.txt`, `*-console.txt`, `*-errors.txt`) have the same shape as its output. [INFERENCE] The omp tester therefore drove a cmux browser pane inherited from the environment; the tool calls themselves were not captured in `-p` text output, so this was not confirmed directly. What is confirmed: the omp relay was not installed (its install needs your consent, and this run did not do it), and the run reported the same two console errors and the same 404 as the Claude Code run.

Comparing the two real runs:

| | Claude Code | omp |
|---|---|---|
| Skill trigger | `Skill` tool, `atlas:atlas-test-browser` | `/skill:atlas-test-browser` |
| Tester | `atlas:ui-runtime-tester` via `Agent` | `ui-runtime-tester` via `task` |
| Browser surface | Playwright MCP, supplied with `--mcp-config` | [INFERENCE] a cmux browser pane from the environment; the omp relay was not installed |
| Routes tested | 1 (the diff route) | 2 (diff route plus root baseline) |
| Rendered banner read | No, flagged `[unverified]` | Yes |
| Console errors | 4 (includes `favicon.ico` 404) | 2 |
| Evidence | `console.txt`, `network.txt`, `broken.png` | `*-console.txt`, `*-errors.txt`, `*-resources.txt`, `root.png`, `broken.png` |
| Ledger | 2 entries in `.atlas/.run/findings.json` | 2 entries in `.atlas/.run/findings.json` |
| Duration | 56 s | 134 s |

The two runs are one sample each. [INFERENCE] Differences such as the extra baseline route and the banner check are more likely model variance between runs than a platform difference; they were not repeated to find out.

#### Browser surfaces that did not work in this environment

| Surface tried | Result |
|---|---|
| `browser-use` MCP (`browser_exec`) | Even `print('alive')` timed out: `Request timeout after 30000ms`. `browser-harness --doctor` reported `[ok] chrome running`, `[FAIL] daemon alive`, `[FAIL] active browser connections - 0`. Chrome's remote-debugging approval was not granted, so no attach was possible |
| omp `browser` global | `ToolError: omp browser relay is serving at http://127.0.0.1:9224 but its extension never connected. Install it with 'omp browser-relay install' and check the toolbar badge shows "on".` |
| `cmux browser` | Worked for the manual drive above. Only `network requests` was unsupported (WKWebView) |

If your harness exposes none of these, `atlas-test-browser` is specified to report a preflight blocker rather than fake the check.

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