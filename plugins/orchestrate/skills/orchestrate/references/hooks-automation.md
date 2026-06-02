# Hooks — make the discipline automatic

Hooks turn the orchestrator's rules into things that *happen on their own* instead of things
you have to remember. This skill ships four (three on by default, one opt-in), plus a gated
installer. They are stdlib-only Python, self-contained under `hooks/`, and every one fails safe
(any error → silent passthrough; none can break a prompt, a tool call, or wedge a session).

| id | event | script | what it does |
|---|---|---|---|
| `optimizer` | `UserPromptSubmit` | `hooks/prompt_optimizer.py` | optimize the prompt through a local model before Claude sees it |
| `format` | `PostToolUse` (Edit\|Write\|MultiEdit) | `hooks/format_after_edit.py` | auto-format the edited file (ruff/prettier/gofmt/rustfmt), async |
| `guard` | `PreToolUse` (Bash) | `hooks/bash_guard.py` | deny catastrophic / ask before high-blast-radius shell commands |
| `completion-gate` | `Stop` | `hooks/completion_gate.py` | **opt-in.** block stopping an orchestrate run until evidence is captured |

## Install (gated, idempotent)

```
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --list            # current coverage
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py                   # plan (dry-run)
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --apply           # install the DEFAULT set (optimizer, format, guard — NOT the gate)
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --select completion-gate --apply   # opt into the Stop gate
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --select optimizer --apply
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --uninstall --apply
```

It MERGES into the target settings file (default `~/.claude/settings.json`), never clobbering
existing hooks, and backs the file up before writing. Per law 6, present the plan and get the
user's go-ahead before `--apply` — installing hooks mutates their `~/.claude`. Hooks load on
the next session, not the current one.

## 1. `optimizer` — automatic prompt optimization

Automates "run my prompt through `ollama run prompt-optimizer:latest`, then paste the result."
Reaches the optimizer via the ollama **HTTP API** (`/api/generate`, clean text) and falls back
to the `ollama run` CLI if the server is down. Injects the rewrite as `additionalContext`
(it augments the prompt, never replaces it). See `references/prompt-optimization.md` for how to
read its output.

Because the optimizer is slow and `UserPromptSubmit` is synchronous, it is **trigger-gated by
default** — instant passthrough unless the prompt opts in — with a generous hook `timeout` so
Claude Code doesn't kill it mid-run.

Config (env vars, all optional):

| var | default | meaning |
|---|---|---|
| `ORCHESTRATE_OPTIMIZE` | `trigger` | `off` · `trigger` (opt-in prefix) · `always` |
| `ORCHESTRATE_OPTIMIZE_TRIGGER` | `opt:,optimize:,++` | comma-separated opt-in prefixes |
| `ORCHESTRATE_OPTIMIZER_MODEL` | `prompt-optimizer:latest` | ollama model tag |
| `ORCHESTRATE_OLLAMA_URL` | `$OLLAMA_HOST` → `http://127.0.0.1:11434` | optimizer endpoint |
| `ORCHESTRATE_OPTIMIZE_CMD` | — | override: run this instead of ollama (`{prompt}` substituted) |
| `ORCHESTRATE_OPTIMIZE_TIMEOUT` | `110` | seconds before giving up (passthrough) |
| `ORCHESTRATE_OPTIMIZE_MINLEN` | `12` | skip triggered prompts shorter than this |
| `ORCHESTRATE_OPTIMIZE_LOG` | — | append an audit trail (original → optimized) to this file |

Put env vars in `~/.claude/settings.json` under `env` (not just the shell profile —
non-interactive hook runs don't source it).

## 2. `format` — format-on-edit

Picks a formatter by extension and runs it in place using the **project's own config**, async
so it never blocks the loop, no-op when the formatter isn't installed. Keeps diffs minimal so
verifier subagents and reviewers see only real changes, not whitespace. Coverage: `.py`
(ruff→black), prettier-family (`.ts/.tsx/.js/.json/.css/.md/.yaml/...`, prefers the repo's local
`node_modules/.bin/prettier`), `.go` (gofmt), `.rs` (rustfmt).

## 3. `guard` — destructive-command backstop

Encodes law 6 ("gate writes") as an automatic check on every Bash call: `deny` for the
near-irreversible (`rm -rf /`, fork bomb, `mkfs`, raw disk writes), `ask` for high-blast-radius
(force push, hard reset, recursive delete, `curl|sh`, `sudo`, recursive chmod/chown, dependency
installs). Everything else passes through to the normal permission flow untouched. It's a
backstop for a runaway subagent or a careless paste — not a replacement for `permissions`.

## 4. `completion-gate` — the Definition-of-done backstop (opt-in)

Encodes the skill's hardest rule — *a change is not done until observed behavior is captured and
an independent agent verified it* — as a `Stop` hook. Prose alone doesn't enforce it (the
orchestrator rationalizes "I'll mark it unverified and move on"); this is the machine backstop.

- **Scoped.** Engages only when the working dir holds an `.orchestrator/` state dir — i.e. an
  orchestrate run is actually in progress. In any other session it is a silent no-op, so it is
  safe to leave installed.
- **What satisfies it.** At least one file under `.orchestrator/evidence/`, **or** a
  `findings.json` recording a `verified` entry. It checks that *something was observed and
  verified*, not that the work is perfect — keep the harder correctness/coverage bar in the prose
  laws (3 and 5), not the hook.
- **Single nudge, never a wedge.** It blocks the stop at most **once** (the `stop_hook_active`
  loop-guard), then lets the continuation through. Fail-open on any error. Disable entirely with
  `ORCHESTRATE_GATE=off`.
- **Off by default.** A plain `--apply` installs only optimizer/format/guard; opt in with
  `--select completion-gate --apply`. (Note: it coexists with codebase-brain's `validate_gate.py`
  Stop hook — that one is message-text based, this one is artifact based; complementary.)

## Extending

Audit which lifecycle events have handlers and where the leverage is (formatter, guard, session
orientation, idle notify, compaction state) in `references/claude-code-tuning.md`. To add a hook,
drop a stdlib script in `hooks/`, add a `HOOK_SPECS` entry in `scripts/install_hooks.py`, and a
guard test in `tests/`. Keep the fail-safe contract: a hook must never block or break the action
it observes.
