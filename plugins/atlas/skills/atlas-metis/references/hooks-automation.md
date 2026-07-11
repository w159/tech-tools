# Hooks - make the discipline automatic

Hooks turn the orchestrator's rules into things that *happen on their own* instead of things
you have to remember. The plugin ships **eight** hooks, and all eight auto-load via
`hooks/hooks.json` on install (no manual step). They are stdlib-only Python, self-contained
under `hooks/`, and every one fails safe (any error -> silent passthrough; none can break a
prompt, a tool call, or wedge a session).

| id | event | script | what it does |
|---|---|---|---|
| `session-boot` | `SessionStart` | `hooks/session_boot.py` | activate the runtime: inject the contract/methodology, report claude-mem/context-mode state, surface past lessons |
| `optimizer` | `UserPromptSubmit` | `hooks/prompt_optimizer.py` | optimize the prompt through a local model before Claude sees it; trigger-gated |
| `advisor` | `PreToolUse` (Bash) | `hooks/bash_advisor.py` | advisory-only; emits a warning on catastrophic, near-irreversible commands only |
| `format` | `PostToolUse` (Edit\|Write\|MultiEdit) | `hooks/format_after_edit.py` | auto-format the edited file (ruff/prettier/gofmt/rustfmt), async |
| `dispatch-tripwire` | `PostToolUse` + `PreToolUse` | `hooks/dispatch_tripwire.py` | advisory STOP at the threshold (default 4); a second `PreToolUse` tier DENIES at 8 inline ops or on Edit/Write/MultiEdit to non-docs paths; marker-gated, orchestration sessions only |
| `completion-gate` | `Stop` | `hooks/completion_gate.py` | **opt-out.** block stopping an orchestration run until evidence is captured; marker-gated, on by default when .atlas/docs/ exists (disable with ATLAS_GATE=off) |
| `nudge` | `Stop`, `SubagentStop` | `hooks/nudge.py` | self-improvement: surface a past lesson and prompt to capture new ones; marker-gated, throttled |
| `ingest-session` | `Stop`, `SubagentStop`, `SessionEnd`, `PreCompact` | `hooks/ingest_session.py` | index the session transcript into the observability store for atlas-argus |

The dispatch tripwire, completion gate, and nudge additionally gate on the per-session
orchestration marker. The tripwire sets that marker automatically when an orchestration
skill (atlas-metis, atlas-athena, atlas-ariadne, atlas-odysseus, atlas-chronos,
atlas-nestor) is invoked or an `atlas:*` subagent is dispatched; `mark-orchestrating`
remains as a manual fallback. The gates stay inert in ordinary non-orchestration sessions.
The tripwire's `PreToolUse` deny tier is independently switchable from its `PostToolUse`
advisory tier: `ATLAS_TRIPWIRE=off` disables both, `ATLAS_TRIPWIRE_HARD=off` disables only
the deny tier and leaves the advisory nag in place. A ninth script, `hooks/validate-readonly-query.sh`, is
**not** auto-loaded by hooks.json; it is a read-only SQL guard available for the DB-audit
subagents to invoke during read-only audits.

## Install (gated, idempotent)

```
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --list            # current coverage
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py                   # plan (dry-run)
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --apply           # install the DEFAULT set (optimizer, format, advisor, completion-gate)
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --select completion-gate --apply   # opt into the Stop gate
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --select optimizer --apply
python3 ${CLAUDE_SKILL_DIR}/scripts/install_hooks.py --uninstall --apply
```

It MERGES into the target settings file (default `~/.claude/settings.json`), never clobbering
existing hooks, and backs the file up before writing. Per law 6, present the plan and get the
user's go-ahead before `--apply` - installing hooks mutates their `~/.claude`. Hooks load on
the next session, not the current one.

## 1. `optimizer` - automatic prompt optimization

Automates "run my prompt through `ollama run prompt-optimizer:latest`, then paste the result."
Reaches the optimizer via the ollama **HTTP API** (`/api/generate`, clean text) and falls back
to the `ollama run` CLI if the server is down. Injects the rewrite as `additionalContext`
(it augments the prompt, never replaces it). See `references/prompt-optimization.md` for how to
read its output.

Because the optimizer is slow and `UserPromptSubmit` is synchronous, it is **trigger-gated by
default** - instant passthrough unless the prompt opts in - with a generous hook `timeout` so
Claude Code doesn't kill it mid-run.

The same hook also runs an **arm-early classifier** (`looks_substantive`), independent of the
optimizer path: it flags a prompt as substantive engineering work - an error/stack-trace signal,
a strong engineering verb (`refactor`/`audit`/`debug`/...) on its own, or a common verb
(`fix`/`add`/`build`/...) anchored to a concrete code reference - and marks the session
orchestrating via `atlas_db.mark_orchestrating` *before* any dispatch happens, injecting a nudge
to invoke atlas-metis. Deliberately conservative (defaults to "trivial") since a false positive
costs more than a false negative - a wrongly-armed session gets denied by the dispatch tripwire.
Disable with `ATLAS_ENGINE_ARM=off`.

Config (env vars, all optional):

| var | default | meaning |
|---|---|---|
| `ATLAS_OPTIMIZE` | `trigger` | `off` - `trigger` (opt-in prefix) - `always` |
| `ATLAS_OPTIMIZE_TRIGGER` | `opt:,optimize:,++` | comma-separated opt-in prefixes |
| `ATLAS_OPTIMIZER_MODEL` | `prompt-optimizer:latest` | ollama model tag |
| `ATLAS_OLLAMA_URL` | `$OLLAMA_HOST` -> `http://127.0.0.1:11434` | optimizer endpoint |
| `ATLAS_OPTIMIZE_CMD` | - | override: run this instead of ollama (`{prompt}` substituted) |
| `ATLAS_OPTIMIZE_TIMEOUT` | `110` | seconds before giving up (passthrough) |
| `ATLAS_OPTIMIZE_MINLEN` | `12` | skip triggered prompts shorter than this |
| `ATLAS_OPTIMIZE_LOG` | - | append an audit trail (original -> optimized) to this file |

Put env vars in `~/.claude/settings.json` under `env` (not just the shell profile -
non-interactive hook runs don't source it).

## 2. `format` - format-on-edit

Picks a formatter by extension and runs it in place using the **project's own config**, async
so it never blocks the loop, no-op when the formatter isn't installed. Keeps diffs minimal so
verifier subagents and reviewers see only real changes, not whitespace. Coverage: `.py`
(ruff->black), prettier-family (`.ts/.tsx/.js/.json/.css/.md/.yaml/...`, prefers the repo's local
`node_modules/.bin/prettier`), `.go` (gofmt), `.rs` (rustfmt).

## 3. `advisor` - catastrophic-command warning

Advisory-only: never alters approval or emits a `permissionDecision` field. On every Bash call
it checks for a small set of catastrophic, near-irreversible patterns (`rm -rf /` or `~/`,
fork bomb, `mkfs`, `dd` to a raw disk device). On a match it injects an `additionalContext`
factual warning ("This command matches a catastrophic, near-irreversible pattern. Confirm intent
before running.") and exits 0 so the normal permission flow continues unaffected. Every other
command exits 0 with no output. It is a signal, not a gate.

## 4. `completion-gate` - the Definition-of-done backstop (opt-out)

Encodes the skill's hardest rule -- *a change is not done until observed behavior is captured and
an independent agent verified it* -- as a `Stop` hook. Prose alone doesn't enforce it (the
orchestrator rationalizes "I'll mark it unverified and move on"); this is the machine backstop.

- **Scoped.** Engages only when a `.atlas/docs/` directory is found at or above the working dir (walked
  up to 6 levels) AND the session's run is flagged orchestrating in the atlas DB (the
  dispatch-tripwire hook sets that flag automatically when an orchestration skill is invoked or
  an `atlas:*` subagent is dispatched). In any other session it is a silent no-op.
- **What satisfies it.** All seven conditions must hold:
  - (a) At least one file under `.atlas/docs/evidence/` (observed-behavior proof captured).
  - (b) `.atlas/docs/.run/findings.json` exists and records at least one entry with status `verified`
    (independent atlas:verifier result present).
  - (c) `.atlas/docs/CHANGELOG.md` exists and is non-empty.
  - (d) `.atlas/docs/ROADMAP.md` exists and is non-empty.
  - (e) `README.md` at the project root exists and is non-empty.
  - (f) No docs drift: if non-docs files changed this run (git diff HEAD + staged), at least
    one `.atlas/docs/` file changed too -- the deterministic trigger forcing an `atlas:docs-curator`
    dispatch before "done".
  - (g) Law 5 - verifier coverage: if non-docs code changed this run, block when implementer
    dispatches outnumber verifier dispatches (`atlas_db.unpaired_implementer_dispatches > 0`) -
    shipping work that never got an independent `atlas:verifier` pass.
  The block message names exactly which condition(s) are missing.
- **Single nudge, never a wedge.** It blocks the stop at most **once** (the `stop_hook_active`
  loop-guard), then lets the continuation through. Fail-open on any error. Disable entirely with
  `ATLAS_GATE=off`.
- **On by default when .atlas/docs/ exists.** A plain `--apply` installs the full set including the
  completion-gate. Disable with `ATLAS_GATE=off`. (Note: it coexists with codebase-brain's
  `validate_gate.py` Stop hook -- that one is message-text based, this one is artifact based;
  complementary.)

## Extending

Audit which lifecycle events have handlers and where the leverage is (formatter, guard, session
orientation, idle notify, compaction state) in `references/claude-code-tuning.md`. To add a hook,
drop a stdlib script in `hooks/`, add a `HOOK_SPECS` entry in `scripts/install_hooks.py`, and a
guard test alongside the others in `hooks/` (`test_*.py`). Keep the fail-safe contract: a hook
must never block or break the action it observes.
