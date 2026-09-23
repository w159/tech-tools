# CI classification and the run_watch mechanics

Read this before interpreting any `run_watch` result.

## Arming and reading run_watch

The `xd://github` device's `run_watch` op is the only CI source this skill trusts. Write JSON arguments to `xd://github`:

```json
{"op": "run_watch"}
```

Omitting `run` watches every Actions run for the current HEAD (branch defaults to the checkout's current branch). While it watches, it consumes no agent tokens; its return wakes the next tick. Two optional fields matter:

- `"run": "<id>"` — target a specific run by ID or URL.
- `"tail": 50` — log lines captured per failed job. Always set this (50 is a good default) so the failure artifact carries diagnosis-ready log tails.

**On failure, the device saves the full logs to a session artifact** (`artifact://<id>` in its result). That artifact is the round's evidence: pass its path to the diagnosing `atlas:explorer`, and cite it in the findings entry. Never paste full logs into a dispatch prompt — pass the path.

If `run_watch` returns with no run in progress (a quiet head: CI just started, or the PR has no checks), do not busy-loop: wait one bounded interval (default 120s) via the harness wait mechanism, then re-check with a fresh arm. An empty watch result tells you nothing about the PR's state — only a fresh arm or a fresh `pr://` read does.

**Device unavailable:** if the `github` device tool is not mounted in this session, poll CI with the locally available `gh` CLI instead (`gh pr checks <N> --watch --fail-fast`, `gh run list --branch <head>`); if neither the device nor `gh` exists, report 🚫 blocked with the missing capability — never fake CI state from memory or inference.

## Stale-SHA cancellation

Capture `git rev-parse HEAD` in the PR worktree at the top of every tick, before reading CI state. If the head SHA has moved since that capture, every CI failure still attached to the old SHA is dead: skip it, re-arm against the new head, and let the fresh run appear next tick. Acting on a dead SHA's failure is the classic babysit defect — it produces a "fix" for a run that no longer exists.

## Classification: flaky/infra vs genuine

Classify from evidence, not vibes. For each failing check look at the run's metadata and the failure artifact's log tails:

**Flaky/infra signals** (rerun path, one bounded attempt):

- Timeout or deadline-exceeded on a step that is not a correctness gate (runner teardown, cache restore, network fetch).
- Runner-level failures: OOM, disk full, agent crash, "The runner has received a shutdown signal".
- Flaky-prone external dependencies: package registry 5xx, DNS, rate-limit errors.
- The repo's own flaky list: check `.atlas/findings/INDEX.md`, `docs/lessons/`, and the workflow file for previously recorded flaky jobs before classifying anything as flaky.

**Rerun mechanics (host-portable):** if the `gh` CLI is available locally, rerun once with the run ID extracted from the check's `details_url`:

```bash
gh run rerun <run-id> --failed -R <owner>/<repo>
```

Pass the run ID explicitly (omitting it drops `gh` into an interactive picker) and `-R` with the base repo (for fork PRs the run lives in the base repo, not the fork). If `gh` is unavailable, DO NOT fake it: report the flake as a residual with the run URL and let the user rerun.

A rerun is ONE attempt. If the same job fails the rerun, it is genuine — escalate to a repair round, never rerun-loop.

**Genuine failure** (repair-round path):

- A test, typecheck, lint, or build step failing on real code.
- A newly-introduced regression from this PR's own commits.
- Any failure whose log shows an assertion or compile error with a `file:line` you can trace to real code.

**A flake that is "fixed" by deleting or weakening assertions is NOT a flake** — it is a genuine failure wearing a flake's clothes. If the passing-on-rerun pattern depends on removed coverage, treat it as genuine.

## One pass, all checks

Aggregate ALL failing checks on the current head into one remediation pass. Do not dispatch one explorer per failing check when they share a run: the log artifact already contains all of them, and separate fix rounds per check would burn the round budget on what is often one root cause. If two failing checks have genuinely unrelated root causes (verified by the explorer), spend rounds on them separately — but only after the explorer confirms the causes are distinct.

## Never weaken a check

- Never edit a test's assertions to make it pass without the user's explicit approval.
- Never delete a flaky test silently: fixing flaky tests (real determinism fixes) is legitimate repair-round work; removing the test is a needs-human residual.
- Never touch CI workflow files to skip a failing job for this PR.