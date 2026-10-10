# Batch / Queue Mode

Queue mode of `atlas-review`: review a list of PRs — or everything open from an org query — in one run, and deliver ONE cross-PR triage table instead of N separate chat reports. Everything else about the skill is unchanged: each item runs the exact per-PR pipeline (Phases 1-7), every P0/P1 still routes through `atlas:verifier`, the output is still report-only, and the hard behavioral lines all still apply per item.

Out of scope, by design: this mode never watches CI (`atlas-babysit-pr`), never resolves reviewer threads (`atlas-resolve-pr-feedback`), and never pushes or posts. It reviews and ranks; the orchestrator decides what happens next.

## Trigger

Queue mode activates when the invocation names more than one changeset, or carries an explicit queue instruction:

- `atlas-review queue 12 14 15` — explicit PR-number list.
- `atlas-review queue https://github.com/org/repo/pull/101 https://github.com/org/repo/pull/102` — PR URLs (fork PRs use the existing fork-to-upstream parsing).
- `atlas-review queue --org <repo> --state open` (or plain "review the team's open PRs") — org query.
- A single changeset in the invocation is normal single-PR mode; do not over-trigger.

## Step 0 — Assemble the queue

1. Resolve every item to `PR number` + head SHA + title + author. For an org query, fetch with `gh pr list --state open` (add `--limit`); for explicit lists, verify each PR exists and is open before review.
2. Assign each item its own `<run-id>` up front (`<run-id>` = `review-<date>-<pr>` or the existing convention); items never share a run dir — reviewer isolation, `findings.json` stamping, and verifier rows are per-item.
3. Cap the batch: default cap 10 PRs per run (cost discipline, not a hard limit). Over the cap, present the first 10 and list the remainder as deferred — the confirmation is where the user widens it.
4. Items that fail resolution (closed, missing, gh error) are recorded as `UNREVIEWED` rows; they do not abort the batch.

## Step 1 — ONE batch confirmation

Present the assembled queue and confirm once — this replaces the per-PR-per-round interrupt pattern:

```
## Queue: N PRs (repo <org/repo>)
| # | PR | Title | Author | Size | Depth | Roster preview |
Deferred (over cap): ...
Proceed with the full batch? (y / adjust / abort)
```

- One gate, one answer, covering depth and roster for every item. Per-item reviewer selection still happens from each diff's risk signals (Phase 3) — the preview is indicative, not binding.
- After approval, run the entire batch to completion with no further interruptions: the skill is report-only, so no other gate can apply mid-run.
- A mid-run user interrupt pauses remaining items, never abandons reviewed ones.

## Step 2 — Per-item pipeline (unchanged)

For each PR, in order:

1. Run Phases 1-7 exactly as the single-PR mode defines them: scope & depth → intent → persona selection → reviewer dispatch → synthesis → `atlas:verifier` validation → report & verdict. Reuse every primitive as-is — `references/dispatch-reviewers.md` payloads, `references/findings-envelope.md` gates, `references/synthesis-and-verdicts.md` verdict rules.
2. Reviewer independence, verifier routing, and verdict computation are per-item. Items are processed sequentially by default (verifier waves already batch internally); parallelizing whole items is allowed only if tool budget permits — never share reviewer outputs or verdicts between items.
3. Findings stamp `.atlas/.run/findings.json` per item with the item's own `review-<run-id>-R-00N` / `review-<run-id>-verdict` rows.
4. Render each item's full report (the standard skeleton) — the triage table in Step 3 summarizes; it does not replace per-PR reports.

## Step 3 — Cross-PR triage table (the batch's single output summary)

After the last item, emit exactly one triage table over all items, ranked by merge-blocking risk:

```
## Cross-PR triage (N of M reviewed)
| PR | Verdict | Worst open | Open P0 / P1 | Run-id |
|----|---------|-----------|--------------|--------|
```

- `Verdict` — the item's final verdict (Ready-to-merge / Ready-with-fixes / Not-ready) or `UNREVIEWED`.
- `Worst open` — highest open severity after validation (`P0` > `P1` > `P2` > `P3` / none), counting verified findings plus needs-evidence P0s, exactly as the verdict rules count them.
- Ranking: `Not-ready` items first, then `Ready-with-fixes`, then `Ready-to-merge`, then `UNREVIEWED` last. Within a rank: more open P0s first, then more open P1s, then lowest PR number. Advisory findings never influence rank, mirroring the verdict rules.
- Close the table with one line naming the items that should merge first and the single worst finding in the batch.

## Durable review ledger index

Every review run — queue or single-PR — writes a one-page ledger index at `.atlas/.run/review/<run-id>/index.md` alongside the reviewer artifacts (same operational-state discipline: under `.atlas/.run/`, not `docs/`):

```markdown
# Review run <run-id> — <YYYY-MM-DD>
Scope: <base..head or PR>  Depth: <auto|full>  Mode: single|queue
| PR | Verdict | Worst open | Open P0/P1 | Finding IDs |
```

- For a queue run, the index carries one row per PR — the same rows as the triage table — plus the deferred list.
- Finding IDs are the stable `R-00N` IDs (post-validation, so dropped refuted findings are absent), letting a later round diff "what reviewers flagged last time vs this time" without re-running anything.
- Cross-round comparison: locate prior indexes for the same PR by searching `.atlas/.run/review/*/index.md` for the PR number. The run dir remains operational state; a durable docs/ copy still requires the explicit user ask and `atlas:docs-curator` conventions.
