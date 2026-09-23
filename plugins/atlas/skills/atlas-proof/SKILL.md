---
name: atlas-proof
description: 'Publish, read, comment on, or edit project markdown as a human-review workflow: place a doc at its docs/-SSOT path or a PR for review, leave anchored comments and tracked-change suggestions in a sidecar annotations file, and collect reviewer feedback back into the findings ledger and docs. Use for "share/put this up for review", "comment on this doc or PR", review round-trips on plans/specs/drafts, and publish handoffs from planning workflows; avoid proofread, math, evidence, or proof-of-concept meanings.'
when_to_use: share a markdown doc or PR for review, or act on its reviewer comments
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '<file or PR to publish/review/collect, and what to do>'
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Read `${CLAUDE_SKILL_DIR}/references/review-recipes.md` before your first publish, annotation, or collection. It defines the exact annotations-file format, the publish checklist, the collection recipe, and the gated PR-review commands.

## Provenance: what was generalized and why

This skill ports Compound Engineering's `ce-proof`, which publishes and annotates markdown through a hosted third-party collaborative editor (proofeditor.ai) over a bespoke HTTP/agent API. That product has no atlas or host equivalent, and atlas forbids depending on external proprietary services or CLIs. The **concept** survives — publish a doc for human review, annotate it with anchored comments and tracked-change (never silently applied) suggestions, collect the review state back into durable artifacts, keep the local file canonical throughout — while the **surface** is generalized to atlas-native mechanisms:

- Hosted share links → the docs/ SSOT tree (durable docs) and `.atlas/.run/proof/` (ephemeral review copies), per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-loop/references/docs-ssot.md`.
- Server-side comment threads → a sidecar annotations file with anchored quotes, stored next to the review copy, format in the reference.
- Server-side tracked suggestions → fenced diff proposals in the annotations file, applied only on explicit user approval.
- Presence/identity tokens → no counterpart needed; attribution is a `reviewer:` field per annotation.
- PR review threads (proof had no analog; added because it is atlas's natural shared-review surface when the work is already on a branch) → `gh pr` commands, gated behind an explicit user request (see Boundaries).

If a future hosted-collaboration MCP connector appears, it MAY be used when the user asks for it, but nothing in this skill requires it.

## Identity and role

You are a review facilitator. You make one markdown artifact easy for a human (or another agent) to review, and you make review feedback actionable. You do not decide what the review concludes, you do not apply suggestions without approval, and you do not push anything anywhere.

## Modes

Pick the narrowest mode that satisfies the request. Act as `atlas-proof` on $ARGUMENTS; ask once if the target file/mode is ambiguous, then proceed.

### 1. Publish — make a doc reviewable

Read the source markdown in full, place it at its review surface, and hand the user the path. The local source file stays canonical; publishing syncs nothing back into it.

- Durable doc (plan, spec, feature doc, decision record): place or confirm it at the path the docs SSOT assigns (`docs/plans/<task-slug>.md`, `docs/specs/<YYYY-MM-DD>-<slug>.md`, ...) — date-first naming is enforced by `${CLAUDE_PLUGIN_ROOT}/scripts/lint_docs_names.py`, so never use CE's un-dated or HHMM-timestamped style.
- Ephemeral review copy (draft, scratch, pre-plan exploration): copy the source bytes verbatim to `.atlas/.run/proof/<YYYY-MM-DD>-<slug>/review.md` and scaffold the sidecar `annotations.md` there.
- Publish the source file's actual bytes, never hand-written or placeholder content. If the user asks for a link rather than a file, say plainly that atlas publishes to repo paths, and offer the PR surface instead if one exists.

DONE: the file exists at the stated path with the source's content (verify by diff against the source for copies), the sidecar exists for ephemeral copies, and the user holds the path.

### 2. Annotate — comment or suggest on a reviewable doc

Read the doc's current state first; annotations anchor to visible text, not line numbers or raw markdown syntax. For each comment: quote the exact anchor text, record the comment, and if a change is warranted record it as a fenced diff proposal — never edit the reviewed doc in place for review purposes. Write into the sidecar `annotations.md` per the reference format. Reply/resolve by annotation id; there is no delete — mark superseded annotations `resolved` with the reason.

For PR review: only when the user explicitly asked for comments on that PR, use the gated `gh` commands in the reference (review threads live on GitHub, no sidecar needed).

DONE: each annotation's anchor quote appears exactly once in the current doc text (verified by grep before writing), and the sidecar parses against the reference's format.

### 3. Collect — turn review state into work

Read the sidecar (or PR thread when explicitly authorized) and distill it: actionable items into `docs/ROADMAP.md` with status, corrections that change what the docs say into the affected `docs/` files via `atlas:docs-curator` conventions, and anything that invalidates a prior verdict as a row in `.atlas/.run/findings.json` via `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"` (status `needs-evidence` until re-verified). Mark each consumed annotation `collected` with the artifact path it produced. Resolving a collected thread is not verifying its claim; verification stays with `atlas:verifier`.

DONE: every open annotation is `collected` or explicitly deferred with a reason, and the ROADMAP/finding rows carry evidence paths.

## Boundaries (ported from CE's credential and delete rules)

- Never put secrets, credentials, API keys, private tokens, or sensitive personal data into a review copy or a PR comment unless the user explicitly approves. A review copy is a second copy of the content; treat its audience as wider than the source file's.
- Never silently replace a repo-tracked project doc with a review copy or a link. The tracked file stays canonical.
- Deleting a review copy wipes the review record. Do not auto-delete after a publish handoff — review artifacts must linger under `.atlas/.run/proof/` until the user asks. Delete only on explicit request, and confirm the path at the point of deletion.
- Pulling review edits into a source doc overwrites it. When applying collected changes is a side effect rather than the request, confirm the target path first.
- NEVER push, open a PR, or post PR comments without an explicit user request naming that surface. `gh pr comment`/`gh pr review` on an existing PR is an external side effect: require the user to have named the PR, show the exact comment text before posting, and stop at that gate. Local commits are not this skill's job — hand off to `atlas-commit` if the user wants the review artifact committed.
- An anchor that matches more than once means nothing was annotated: lengthen the quote or add surrounding context, never assume silent first-match. If the doc changed since you read it, re-read and re-anchor before retrying — a stale annotation is worse than none.

## Composition

- `atlas:docs-curator` — dispatch via `Task` (per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`) when collected feedback changes durable `docs/` content.
- `atlas:verifier` — dispatch in a fresh context when a collected annotation claims something is wrong/fixed and that claim must be independently confirmed before a findings row can be `verified`.
- `atlas-plan`, `atlas-feature`, `atlas-frontend` — publish handoffs from these planning workflows land here: pass the file path and title, publish per mode 1, show the path, return control.
- `atlas-commit` — the user's follow-up for committing a published review artifact.

## REPORT

- Mode run and the target doc's path (source and review surface).
- For annotations: count, ids, and the sidecar path; quote one anchor as a sample.
- For collections: every artifact produced (ROADMAP rows, docs edits, findings.json ids) with its evidence path.
- Anything deferred or gated (PR comments shown but not posted, deletions not performed) and why.
