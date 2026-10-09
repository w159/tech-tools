# The repair round: diagnose → fix → verify → commit → consent

One genuine CI failure costs at most one round. The round budget (default 3, configurable via `rounds=N`) is consumed by genuine-failure rounds only — flaky reruns, comment surfacing, and dead-SHA skips are free.

## Round anatomy

### 1. Diagnose — `atlas:explorer` (read-only)

Dispatch per the atlas-orchestrate subagent-kit schema. Template:

```
ROLE: atlas:explorer — diagnose a CI failure from its logs
GOAL: Identify the root cause of the failing check(s) on PR <N> head <sha>, with file:line.
CONTEXT: PR <N> (<url>), head <sha>, failing checks <list>, run_watch failure artifact at <artifact://path>.
TOOLS (required): ToolSearch first, ONE batched call, then ctx_compose / ctx_search / ctx_read / ctx_glob / serena symbol tools. Read-only.
DISCOVER FIRST: confirm the repo's test/build entry points from AGENTS.md and docs/ before interpreting logs.
TOOLS ALLOWED: read/search/shell (non-mutating). TOOLS FORBIDDEN: Edit, Write, git push, package installs.
DELIVERABLE: one root-cause finding per distinct failure: {check, root cause, file:line, proposed minimal fix sketch, confidence}.
SUCCESS CRITERIA: every failing check mapped to either a root cause with file:line evidence from the artifact, or an explicit "infra/insufficient logs" verdict.
OUT OF SCOPE: applying fixes, editing files, resolving review comments.
STOP CONDITIONS: logs do not contain the failing assertion/compile error, or the fix sketch would require reverting PR-level design decisions — report back, do not push through.
REPORT BACK (final message only): the findings list, evidence paths, uncertainty, proposed next step.
```

If the explorer returns multiple unrelated root causes, spend one round per distinct cause (each round still runs the full anatomy below) — but only after it confirms the causes are distinct.

### 2. Fix — `atlas:implementer`

```
ROLE: atlas:implementer — apply a minimal CI fix
GOAL: Make failing check(s) <list> pass with the minimal change in the PR worktree at <path>, committed locally.
CONTEXT: explorer finding: <paste the root-cause finding verbatim>. PR <N>, head <sha>, round <k>/<budget>.
TOOLS (required): ToolSearch first, ONE batched call, then serena edits (replace_symbol_body / insert_after_symbol) + ctx_* reads + Bash for the local gate.
TOOLS ALLOWED: Edit, Write, Bash, read/search. TOOLS FORBIDDEN: git push, force-push, rebase, merge, package installs beyond what the failing check itself needs.
DELIVERABLE: local commit(s) in the PR worktree + proof the failing check passes locally (exact command + output captured to .atlas/evidence/<YYYY-MM-DD>-pr<N>-round<k>/).
SUCCESS CRITERIA: the exact failed CI step now passes when run locally; the diff touches only files implicated by the root cause; a conventional commit message exists ("fix: <what> (PR <N> round <k>)"); nothing is pushed.
OUT OF SCOPE: pushing, resolving review threads, refactoring beyond the fix, editing CI workflow files to skip the check.
STOP CONDITIONS: the fix requires weakening test assertions, reverting a reviewer-approved change, or touching files outside the root cause — STOP, write a DECISION NEEDED line, return.
REPORT BACK (final message only): diff summary, local gate output, commit sha, evidence path, uncertainty.
```

**Minimal fix.** Smallest change that makes the failing check pass without weakening it. If the minimal fix and the right fix diverge (e.g. a real bug in pre-existing code surfaced by this PR), fix the right thing at the smallest scope that is correct and note the divergence in the report — do not expand scope silently.

### 3. Verify — `atlas:verifier` (fresh context, never the implementer grading itself)

```
ROLE: atlas:verifier — independently confirm the round's fix
GOAL: Independently verify that local commit <sha> in <worktree path> fixes failing check <check>, and nothing else.
CONTEXT: root cause finding, commit range <base>..<sha>, the original failure artifact path.
TOOLS (required): ToolSearch first, ONE batched call, then serena/ctx_* reads + Bash to re-run the check.
TOOLS ALLOWED: read/search/shell. TOOLS FORBIDDEN: Edit, Write, dispatch, push.
DELIVERABLE: verdict (verified / rejected / needs-evidence) + a findings.json row written via:
  python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" --id "PR<N>-R<k>" --status <verdict> \
    --title "<one line>" --evidence "<artifact path or file:line>" \
    --reproduction "<the exact command you ran>"
SUCCESS CRITERIA: you personally re-ran the failed CI step and saw it pass against the committed fix; you checked the diff touches only the implicated files; the findings.json row exists.
OUT OF SCOPE: fixing anything; proposing patches (report, do not apply).
STOP CONDITIONS: cannot reproduce the original failure locally (environment mismatch) — return needs-evidence with what is missing.
REPORT BACK (final message only): verdict + one-line reason + evidence gathered + side effects noticed.
```

A round is DONE only when the verifier's findings.json row exists with status `verified`. `rejected` → send the failure back to a fresh implementer with the verifier's evidence attached; that consumes another round. `needs-evidence` → report as a residual, do not count it as progress.

## Round bookkeeping

Track per run: `rounds_used`, `rounds_budget`, per-round `{check, root cause, fix commit, verifier finding id, pushed?}`. All of it feeds the Step 5 report. Re-read `.atlas/.run/findings.json` after every verifier return; a missing or truncated row means re-dispatch the verifier, never assume it.

## Commit and consent

- The verified fix sits as a local commit in the PR worktree. Local commits are authorized by the babysit invocation.
- **STOP AND ASK before pushing.** Present: round number, one-line root cause, diffstat, commit sha, and the exact push action (device `github` op `pr_push`, or `git push` from the worktree). Wait for explicit user consent. Same gate as `atlas-ship` — this skill never auto-pushes, regardless of what CE's original did.
- On consent: push once, record it, re-arm `run_watch`. On refusal: the local commit becomes a residual in the report; the watch stops (CI cannot go green without the push).
- If review feedback arrived for the same code the round is fixing, surface it to the user in the same consent prompt — fixing code a reviewer is actively commenting on, without showing them both, is a judgment call the user owns.

## Escalation and early stop

- **Budget exhausted with CI still red:** stop, report ⛔ with the full round ledger and the still-red checks. Never keep looping "one more round".
- **Oscillation:** the same check failing under two different fixes → stop early, report the two attempts and the conflicting evidence. A third round on an oscillating check is burning budget on a wrong approach.
- **Verifier rejected twice:** treat as `needs-human`, not as round 3 fuel.
- **Wrong-approach signal:** the fix would contradict posted review feedback, revert a reviewer-requested change, or require weakening a test → stop immediately with a `DECISION NEEDED` line in the report; this does not consume a round.