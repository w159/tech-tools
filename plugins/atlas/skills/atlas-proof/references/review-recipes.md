# Review recipes

Exact mechanics for atlas-proof's three modes. Read once before first use.

## Annotations file format

One file per review copy, stored beside it:

```
.atlas/.run/proof/<YYYY-MM-DD>-<slug>/
  review.md          # the review copy (verbatim source bytes)
  annotations.md     # the review state
```

`annotations.md` is append-at-top, newest first. Schema:

````markdown
# Annotations: <review copy title>

Source: <canonical source path, if any>
Review surface: .atlas/.run/proof/<YYYY-MM-DD>-<slug>/review.md
Opened: <YYYY-MM-DD>
Reviewer: atlas (or the persona/agent name, e.g. atlas:verifier)

## a-003 | open | severity: high | collected: <artifact path>   <- status line only when collected/resolved

**Anchor** (exact quote, must appear verbatim and uniquely in review.md):

> ...quoted text from the doc...

**Comment:** what is wrong or worth discussing, and why.

**Proposal** (only when a concrete change is warranted — tracked change, never applied directly):

```diff
- current line as it appears in review.md
+ proposed replacement
```

**Resolved:** <YYYY-MM-DD> — <reason | superseded-by: a-004>
````

Rules:

- **Anchors are visible text.** Quote prose as a human sees it, not markdown syntax (`**bold**` markers, block refs, link targets). Before writing any annotation, verify the quote appears exactly once in `review.md`:
  ```bash
  grep -cF '<anchor line>' '.atlas/.run/proof/<YYYY-MM-DD>-<slug>/review.md'   # must print 1
  ```
  Count 0 → the doc changed since you read it; re-read and re-anchor. Count >1 → lengthen the quote or add the preceding/following line; never annotate on a multiply-matching anchor and never assume first-match.
- **Ids are stable and monotonic** (`a-001`, `a-002`, ...). Replies and resolutions reference ids; nothing is ever deleted. Superseded threads get `resolved: superseded-by: <id>`.
- **Proposals are diffs, not edits.** A proposal becomes a real change only through mode 3 (collect) with explicit user approval. If the user asks you to apply one directly, apply it to the canonical source with a normal `edit`, then mark the annotation `applied: <source path>`.
- **Severity** is one of `blocker | high | medium | low | note`. `blocker`/`high` items must land in the ROADMAP or findings during collect; `note` may resolve without an artifact.

## Publish checklist

1. Read the source file in full. If it is HTML or non-markdown, do not publish it — return the local path and say why.
2. Decide the surface:
   - Durable (plan/spec/feature/decision) → its docs SSOT path: `docs/plans/<task-slug>.md`, `docs/specs/<YYYY-MM-DD>-<slug>.md`, `docs/features/<slug>.md`, `docs/decisions/<slug>.md`. Date-first naming per `plugins/atlas/scripts/lint_docs_names.py`.
   - Ephemeral → `.atlas/.run/proof/<YYYY-MM-DD>-<slug>/review.md` (verbatim bytes) plus the scaffolded `annotations.md` header shown above.
3. For copies, verify byte fidelity:
   ```bash
   diff <src> '<surface path>' && echo IDENTICAL
   ```
4. Hand the user the surface path (one line), plus the source path if they differ. Do not delete anything, do not commit (offer `atlas-commit` if asked), do not push.

When a planning skill hands off a publish (`atlas-plan`, `atlas-feature`), it supplies the file path and title. Label the title by readiness when known, e.g. `Plan: <title> (requirements-only)` or `Plan: <title> (implementation-ready)` — carry that label into the H1 and the ROADMAP status.

## Collect recipe

1. Read `annotations.md` top to bottom. For each `open` annotation:
   - Actionable now → `docs/ROADMAP.md` row with status (`planned` or `in-progress`) and the annotation id + evidence path.
   - Corrects durable docs content → dispatch `atlas:docs-curator` (Task, per `subagent-kit.md` schema) scoped to the affected `docs/` files.
   - Claims a prior verdict is wrong or a fix incomplete → confirm via `atlas:verifier` in a fresh context before stamping; then:
     ```bash
     python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" \
       --id proof-<slug>-a-003 --status needs-evidence \
       --title "<one line>" --evidence "<annotations path + anchor id>"
     ```
     Upgrade to `verified` only after the verifier's PASS lands in `.atlas/.run/findings.json`.
   - `note` with no follow-up → resolve with reason `no-action`.
2. Update each annotation's status line: `collected: <artifact path>` (or `resolved`), never delete the thread.
3. Report the ledger: annotation id → artifact path, one line each. Every open annotation ends the run as `collected`, `resolved`, or explicitly `deferred` with a reason — no silent drops.

## Gated PR review (only on explicit user request)

The user must name the PR (number/URL/branch). Surface PR threads live on GitHub — no sidecar file. Before posting anything, show the user the exact comment text and stop for their confirmation; posting is an external side effect. Never push branches, open PRs, or merge here.

```bash
# Line-anchored review comment (request-changes carries your threads):
gh pr review <number> --request-changes \
  --body "atlas review (<run date>) — <n> findings below"

# One comment per finding, anchored by quoting the code/doc text in the body:
gh pr comment <number> --body "Anchor: '<exact quoted line>' — <comment> (atlas a-003)"

# Read the reviewer side before collecting:
gh pr view <number> --json reviews,comments
gh api repos/<owner>/<repo>/pulls/<number>/comments
```

Collect from a PR only when the user asked for that PR's feedback: distill threads the same way as the sidecar recipe (ROADMAP rows, docs-curator, findings rows). Attribution: label every posted comment with `(atlas)` and the annotation id so threads are traceable back to the run.

If `gh` is unavailable or unauthenticated in the target environment, do not fake it: say so in one line and publish to the file surface instead.
