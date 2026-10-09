# Scope & Depth

Phase 1-2 of `atlas-review`. Determine exactly what is under review and how hard to look.

## Scope resolution (in precedence order)

Resolve the first that applies; state which one you used:

1. **Explicit base ref argument** (`atlas-review main`, `atlas-review origin/main...HEAD`) — review `git diff <base>...HEAD`.
2. **PR number/URL** — review the PR's merge-base diff; if the PR has review comments, this also activates the `previous-comments` persona (see `persona-selection.md`).
3. **Branch with an upstream** — `git merge-base` against the upstream, review the three-dot diff.
4. **Staged + unstaged changes** — no branch context: review the working-tree diff against HEAD. Untracked files are included as new-file context ONLY when a tracked file imports/references them or the diff clearly depends on them; otherwise list them under Coverage as unexamined, never silently ignored.
5. **Named files** (`atlas-review src/auth/`) — review the diff limited to those paths, but roster selection may still consider the surrounding subsystem's risk.

Mechanics:

```bash
git diff --stat <base>...HEAD          # shape: files, insertions, deletions
git diff <base>...HEAD                 # the review target
git log --oneline <base>..HEAD         # commit intent trail
```

For very large diffs, generate per-file diffs and hand each reviewer only the files in its lane plus direct dependencies — a reviewer drowning in 5000 lines finds nothing. Cap per-reviewer payload at roughly 1500 diff lines; split oversized files across the reviewers whose lanes cover them.

Record an immutable scope line for the report: `base..head`, head SHA, file count, +/- line counts. Everything after this point reviews exactly this scope; late tree changes invalidate the run — note them and stop rather than reviewing a moving target.

## Depth

- `depth:auto` (default): the roster and per-reviewer effort scale with risk. Small mechanical diffs (config, docs, generated code, lockfiles) get correctness-only at low effort. High-risk signals (see `persona-selection.md`) get the full roster.
- `depth:full`: every triggered persona runs at full effort regardless of diff size; use when the change rides on a high-consequence surface (payments, auth, data migration) even if the diff is small.

Depth never widens scope. A `depth:full` review of a 10-line diff is 10 deep lines, not a repo audit.

## Exclusions (both depths)

Out of diff scope automatically: generated/vendor/lock files (note their presence under Coverage), whitespace-only hunks, and CI-mechanical reruns. Style/lint-only complaints are suppressed at the persona level (`findings-envelope.md`), not by scope.

## § Intent

Every reviewer needs one intent paragraph — what this change claims to do — because a finding is a gap between claimed behavior and actual behavior, and without a claim there is no gap.

Resolve intent from the first that exists:

1. A plan or spec in `docs/plans/`/`docs/specs/` referenced by the branch or invocation (`plan:` flag) — read its Goal section and verification contract.
2. Commit messages on the branch (`git log`) — usually enough for multi-commit work.
3. The PR description, when reviewing a PR.
4. Diff inference — read the changes and state the inferred intent in one sentence. Mark it `inferred` in the report so reviewers know it is hypothesis, not contract.

Write the intent line into the dispatch payload for every reviewer. If intent is ambiguous enough that two plausible readings would select different rosters, review against BOTH readings (worst case wins) and say so in the report — do not ask the user.
