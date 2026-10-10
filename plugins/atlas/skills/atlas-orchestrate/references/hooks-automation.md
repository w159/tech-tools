# Hooks - make the discipline automatic

## Contents

- [Install (gated, idempotent)](#install-gated-idempotent)
- [1. `optimizer` - automatic prompt optimization](#1-optimizer---automatic-prompt-optimization)
- [2. `format` - format-on-edit](#2-format---format-on-edit)
- [3. `advisor` - catastrophic-command warning](#3-advisor---catastrophic-command-warning)
- [4. `completion-gate` - the Definition-of-done backstop (opt-out)](#4-completion-gate---the-definition-of-done-backstop-opt-out)
- [Extending](#extending)

Hooks turn the orchestrator's rules into things that *happen on their own* instead of things
you have to remember. The plugin ships auto-loaded hooks via `hooks/hooks.json` on install
(no manual step). They are stdlib-only Python, self-contained under `hooks/` (except
`atlas_doctor.py` in `scripts/`), and fail safe on internal errors (fallow_gate is the one
hook that may *deny* a tool call, and only when fallow audit returns `verdict: fail`).

| id | event | script | what it does |
|---|---|---|---|
| `session-boot` | `SessionStart` | `hooks/session_boot.py` | activate the runtime: inject the contract/methodology, report claude-mem/context-mode/fallow state, surface past lessons |
| `optimizer` | `UserPromptSubmit` | `hooks/prompt_optimizer.py` | optimize the prompt through a local model before Claude sees it; trigger-gated |
| `advisor` | `PreToolUse` (Bash) | `hooks/bash_advisor.py` | advisory-only; emits a warning on catastrophic, near-irreversible commands only |
| `fallow-gate` | `PreToolUse` (Bash) | `hooks/fallow_gate.py` | agent gate: on `git commit`/`git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`; deny on fail; skip if fallow absent (`ATLAS_FALLOW=off`) |
| `recall-gate` | `PreToolUse` (all tools) | `hooks/recall_gate.py` | claude-mem recall is required once per session: the first main-thread call that is neither a claude-mem call nor `TodoWrite` is denied on every attempt until then (reason from `contracts/mandates.json` `recallGate`, 279 -> 197 B); a claude-mem call satisfies it. ToolSearch name variants are normalized. Armed when the claude-mem plugin is enabled; skips subagent transcripts; fail-open (`ATLAS_MANDATES=off`). omp twin: `omp/mandates.ts` (omp: armed only when a claude-mem route is callable now) |
| `format` | `PostToolUse` (Edit\|Write\|MultiEdit) | `hooks/format_after_edit.py` | auto-format the edited file (ruff/prettier/gofmt/rustfmt); synchronous under the plugin hooks.json (async only when installed via `install_hooks.py`). A formatter failure is a quiet skip, not a hook crash |
| `dispatch-tripwire` | `PostToolUse` + `PreToolUse` | `hooks/dispatch_tripwire.py` | Existing armed-orchestrator drift/spec guards plus two colony dispatch guards (armed sessions, `atlas:*` only): a dispatch with no `name` is denied (named dispatches put the sibling on the roster for SendMessage and board notes; the guard stands down while `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, because teams mode turns a named main-conversation dispatch into a teammate — inherits the lead's effort, runs in the lead's cwd — and atlas workers must stay scoped subagents; the name requirement is also lifted when `TMUX` is set but `TMUX_PANE` is empty), and a per-call `model` that overrides the agent definition's frontmatter tier is denied (`model: inherit` or no model accepts any; an unreadable definition fails open; the omp gate accepts omp's expansion of a frontmatter alias, e.g. sonnet -> anthropic/claude-sonnet-5). Independently, docs/ projects deny native Grep/Glob only when lean-ctx is reachable (binary on PATH AND a lean-ctx MCP server configured in `.mcp.json` / project or `~` Claude settings; the deny names the `ToolSearch("select:mcp__<server>__ctx_search")` load step; the exploration deny text is 126 B, was 343 B), otherwise a one-time allow-nudge, including subagents; an allowed native call still counts toward and is subject to the armed inline-op threshold deny, and allow-nudge Read/Bash once per tool/session (`ctx_read`; `ctx_shell` / context-mode `ctx_execute`). `ATLAS_TRIPWIRE_HARD=off` disables denies, not nudges. It also denies `atlas:*` dispatches lacking GOAL/DELIVERABLE/SUCCESS CRITERIA/OUT OF SCOPE/STOP CONDITIONS/REPORT (the deny names exactly the missing labels and gives a paste-ready skeleton; REPORT fields STATUS, STEPS, FILES_CHANGED, EVIDENCE, DELIVERABLE, NEXT), with >1 GOAL, or lacking the batched ToolSearch+nav-tool TOOLS block, a `atlas:runner` dispatch without a numbered `STEPS:` block (cap 7), and any nested Agent/Task from a subagent (not disabled by `ATLAS_TRIPWIRE=off`). Footprint arming: an unflagged run is armed once the main thread has edited 3 distinct code files (`ATLAS_FOOTPRINT_FILES`, 0 disables). Worker exemption (10.4.1): a session with a non-blank `ATLAS_WORKER_NAME` (pinned by `atlas_mux`/`atlas_launch`) is never armed and gets no deny tier or STOP advisories; leads unchanged. |
| `completion-gate` | `Stop` | `hooks/completion_gate.py` | **opt-out.** conditions (a)-(l) and (n)-(p) remain orchestration-marker scoped; (m) blocks main-thread non-docs code with zero Task/Agent dispatches even without that marker. docs/ scope; disable with `ATLAS_GATE=off`. |
| `worker-report-gate` | `SubagentStop` | `hooks/worker_report_gate.py` | blocks (once per agent id) an `atlas:*` subagent whose final message is not the fixed `REPORT:` container (`STATUS`, `STEPS`, `FILES_CHANGED`, `EVIDENCE`, `DELIVERABLE`, `NEXT`; contract `contracts/worker-protocol.json`); fail-open; disable with `ATLAS_GATE_REPORT=off` or `ATLAS_GATE=off` |
| `nudge` | `Stop` | `hooks/nudge.py` | self-improvement: surface a past lesson and prompt to capture new ones; marker-gated, throttled |
| `ingest-session` | `Stop`, `SubagentStop`, `SessionEnd`, `PreCompact` | `hooks/ingest_session.py` | index the session transcript into the observability store for atlas-audit |

The dispatch tripwire, completion gate, and nudge additionally gate on the per-session
orchestration marker. The tripwire sets that marker automatically when an orchestration
skill (atlas-orchestrate, atlas-audit, atlas-ux-test, atlas-loop) is invoked or an `atlas:*` subagent is dispatched; `mark-orchestrating`
remains as a manual fallback. The gates stay inert in ordinary non-orchestration sessions.
The tripwire's `PreToolUse` deny tier is independently switchable from its `PostToolUse`
advisory tier: `ATLAS_TRIPWIRE=off` silences drift coaching only (the nested-dispatch deny and the native-tool
policy are unaffected; the latter is switched by `ATLAS_TRIPWIRE_HARD=off`, which disables only
the deny tier and leaves the advisory nag in place). `hooks/validate-readonly-query.sh` is
not wired in hooks.json; it is a read-only SQL guard available for the DB-audit
subagents to invoke during read-only audits. In total 17 hook programs / 21 bindings are wired.

## Install (gated, idempotent)

```
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py --list            # current coverage
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py                   # plan (dry-run)
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py --apply           # install the DEFAULT set (optimizer, format, guard); add --select completion-gate for the Stop gate
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py --select completion-gate --apply   # opt into the Stop gate
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py --select optimizer --apply
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py --uninstall --apply
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
to invoke atlas-orchestrate. Deliberately conservative (defaults to "trivial") since a false positive
costs more than a false negative - a wrongly-armed session gets denied by the dispatch tripwire.
Disable with `ATLAS_ENGINE_ARM=off`. The arm path also consults a local decision model unless
`ATLAS_DECISION=off`, which keeps regex only.

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

Picks a formatter by extension and runs it in place using the **project's own config**. It runs
synchronously under the plugin `hooks.json` (no async flag); `async: true` applies only when installed
via `install_hooks.py`. No-op when the formatter isn't installed. Keeps diffs minimal so
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

Ponytail mandate: a `git commit` (parsed per segment; `git commit-tree` and `echo git commit`
do not count; shared cases in `contracts/mandates.json`) gets a once-per-session nudge to run
ponytail-review on `git diff --cached`, only when the ponytail plugin is enabled in Claude
settings. The omp twin is `omp/mandates.ts`. `ATLAS_MANDATES=off` disables it.

## 4. `completion-gate` - the Definition-of-done backstop (opt-out)

Encodes the skill's hardest rule -- *a change is not done until observed behavior is captured and
an independent agent verified it* -- as a `Stop` hook. Prose alone doesn't enforce it (the
orchestrator rationalizes "I'll mark it unverified and move on"); this is the machine backstop.

- **Scoped.** Engages only when a `docs/` directory is found at or above the working dir (walked
  up to 6 levels). Conditions (a)-(l) and (n)-(p) additionally require an orchestration flag in
  the atlas DB (set by an orchestration skill or `atlas:*` dispatch); condition (m)
  deliberately checks unarmed runs too. Without docs/ every condition is silent.
- **What satisfies it.** All sixteen conditions (a)-(p) must hold:
  - (a) At least one file under `.atlas/evidence/` (observed-behavior proof captured). Only checked when this run wrote non-docs code; files older than the run start do not count.
  - (b) `.atlas/.run/findings.json` exists and records at least one entry with status `verified`
    (an independent check happened - a deterministic test recorded via
    `scripts/atlas_finding.py`, or an atlas:verifier result). Only checked when this run wrote non-docs
    code; stamps older than the run start (`verified_at`) do not count.
  - (c) `docs/CHANGELOG.md` exists and is non-empty.
  - (d) `docs/ROADMAP.md` exists and is non-empty.
  - (e) `README.md` at the project root exists and is non-empty.
  - (f) No docs drift: if non-docs files changed this run, `docs/CHANGELOG.md` must be
    among them -- the deterministic trigger forcing an `atlas:docs-curator` dispatch
    before "done". Any single `docs/` path used to clear this, so a one-line edit to a
    `docs/architecture/` scratch file kept the gate quiet while the CHANGELOG, the
    ROADMAP and the README all rotted; the check needs to know "was the record of this
    change written", and `docs-ssot.md` names the CHANGELOG for exactly that. The
    primary signal is `run_changed_paths` (tool calls carrying a `file_path`), which is
    blind to a file written by a Bash-invoked script, so the gate cross-checks `git`
    before blocking. That suppression is one-directional: it can only prevent a false
    block.
  - (g) Law 5 - verification coverage: if non-docs code changed this run, block when
    implementer dispatches outnumber the independent checks that covered them. Two things
    count as a check, and they are interchangeable: an `atlas:verifier` dispatch, or a
    `verified` entry written into `findings.json` DURING this run (a test run recorded via
    `scripts/atlas_finding.py`). The formula is
    `max(0, unpaired_implementer_dispatches - verified_findings_stamped_this_run)`. Entries
    inherited from an earlier run, and undated entries, earn no credit - they prove nothing
    about the code this run shipped. A stamp earns credit only if the run actually executed a
    test-runner command; a stamp with no executed test earns nothing.
  - (h) ROADMAP reconciliation: a `docs/ROADMAP.md` item marked `done` is a defect -- it
    belongs in `docs/CHANGELOG.md` with a date and an evidence citation.
  - (i) Todo drain: if this run shipped code and the most recent plan still holds
    non-`completed` items, block. TodoWrite rewrites the whole list every call, so the last
    one is current state. (i) enforces DRAINING a list; (k) is what enforces having one.
  - (j) Worktree close-out: if this run dispatched an agent with `isolation: "worktree"`
    (recorded by the dispatch tripwire in `runs.used_worktrees`) and `git worktree list`
    still shows trees beyond the main one, block. Scoped to this run's own dispatches, so a
    user's long-lived worktrees never trip it.
  - (k) Plan mandate: if this run shipped code and NO plan surface ever carried a single
    item -- no `TodoWrite` call, no non-manual board item for this session, no `LEDGER`
    line -- block. (i) alone let a run that never planned anything pass trivially, since an
    absent list has zero open items; that gap is how orchestration ran with no todo state at
    all. Manual board items are a human's notes, not the orchestrator's plan, so they do not
    satisfy it. Scoped to code-shipping runs, and fail-open: an unreadable surface never
    manufactures a block.
  - (l) Docs naming: every dated record this run touched (plan, spec, lesson, decision,
    audit, finding, evidence dir) must be named `<YYYY-MM-DD>-<slug>` so a plain
    listing sorts chronologically. A trailing date (`atlas-security-2026-06-15/`) or a
    leading sequence number (`00-master-plan.md`) sorts by subject instead. Enforced by
    `scripts/lint_docs_names.py`, run-scoped via git and fail-open, so historical names
    nobody is touching never wedge a run. Living docs (`architecture/`, `features/`,
    `wiki/`) are bare slugs and are never checked: they are revised in place.
  - (m) Delegation mandate: main-thread non-docs code writes require a Task/Agent
    dispatch this run. Enforced even if orchestration was never armed; sidechains
    and docs-only changes are exempt. Dispatch `atlas:implementer` (or another
    `atlas:*` agent) for the code change, then verify. DB/transcript failures fail open;
    in-flight dispatches suppress Stop as usual.
  - (n) Status header: for an orchestrating, non-sidechain session the final reply must start, on
    its first non-empty line, with the header matching `headerFirstLinePattern` in
    `contracts/operating-contract.json` (`ATLAS | <glyph> <phase> | <state>`). Kill switch
    `ATLAS_GATE_HEADER=off`.
  - (o) Phased todo: when this run shipped non-docs code, the session's board items must cover each
    phase in `requiredTodoPhasesWhenCodeShipped` (`implement`, `verify`). Kill switch
    `ATLAS_GATE_PHASES=off`.
  - (p) Colony channel: when this run dispatched two or more atlas workers, the channel must show use
    (a board note on this run's lead channel, at or after the run start, whose owner is a registered
    or departed member that is not a lead; or IRC/SendMessage traffic). A lead's own note, another
    lead's channel and a non-member's note do not count. `agent://` traffic logged under sibling run
    ids of the same session counts. Kill switch `ATLAS_GATE_COLONY=off`.
  (n)-(p) ask for a presentation repair, so each blocks at most once per session. All three fail open.
  The block message names exactly which condition(s) are missing and, for (p), the one fix command.
- **Re-blocks, never a wedge.** Blocks every Stop until (a)-(p) hold, except: a Stop that is already a
  forced continuation (`stop_hook_active`) is allowed, and after >5 Stop events in 120 s the circuit
  breaker silences the gate for the session. On omp the bridge additionally allows at most 3
  consecutive blocks (`MAX_STOP_BLOCKS` in `omp/stop-bridge.ts`). Fail-open on any error. Disable
  entirely with `ATLAS_GATE=off`. Block-loop limit: `BLOCK_LOOP_LIMIT=3` (tunable with
  `ATLAS_GATE_BLOCK_LOOP`, clamped to 1-7); after N identical consecutive blocks the next Stop
  is allowed and `gate_block_loop` friction is recorded.
- **On by default when docs/ exists** (via the plugin's hooks.json; a plain `install_hooks.py --apply`
  does not install it, add `--select completion-gate`). Disable with `ATLAS_GATE=off`. (Note: it coexists with codebase-brain's
  `validate_gate.py` Stop hook -- that one is message-text based, this one is artifact based;
  complementary.)

## Extending

Audit which lifecycle events have handlers and where the leverage is (formatter, guard, session
orientation, idle notify, compaction state) in `references/claude-code-tuning.md`. To add a hook,
drop a stdlib script in `hooks/`, add a `HOOK_SPECS` entry in `scripts/install_hooks.py`, and a
guard test alongside the others in `hooks/` (`test_*.py`). Keep the fail-safe contract: a hook
must never block or break the action it observes.
