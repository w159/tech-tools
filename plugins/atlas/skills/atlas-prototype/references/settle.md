# Settle: promote or discard

Load this when the user settles the run - they chose, adjusted, or moved past the question.

## Fail closed to the recap

The recap - the decisions from the capsule, plus the prototype path when the run left one behind (an overlay or temp-root run may have none; say so rather than pointing at something you undid) - is a complete outcome, not a degraded settlement. What fails closed is the promotion write, never the run.

- If the run has no directly related brainstorm or plan file (passed on invoke, passed by the calling skill, or named in this session as the file this prototype is for), and product-level questions remain: recap in chat from `decisions.md`, then recommend `atlas-brainstorm` with this session as the seed. If the session is enough to plan, recommend `atlas-plan` instead.
- If more than one file could be the promotion target: do not pick one because it exists in the repo. Ask which, or recap and let the user route it.
- If a durable docs write is warranted (a settled decision that outlives the session, e.g. a spec-level fact), dispatch `atlas:docs-curator` to record it under `docs/specs/` or `docs/decisions/` with the date-first naming from the docs SSOT (`plugins/atlas/skills/atlas-loop/references/docs-ssot.md`). Never write durable docs inline in this skill when a curator pass is warranted; when the curator is unavailable, write the dated file yourself following the SSOT exactly.

## Promoting into an existing brainstorm or plan

When a directly related `atlas-brainstorm` or `atlas-plan` artifact exists and is named:

1. Read the artifact first. Constrain edits to the sections that record requirements and settled decisions (its product/requirements/decisions sections). Never edit its HOW content - stage maps, implementation plans, verification plans - as content; note instead that implementation planning must be regenerated to reflect the changed requirements, and let `atlas-plan` do that regeneration.
2. Write the settled decisions as prose: what won and why, what was rejected, stated adjustments that were not in the prototype, what is still open. Cite the prototype path when the run left one behind; never paste prototype source into the artifact (containment rule 4).
3. Preserve the artifact's own structure and IDs; do not mint a parallel section scheme.
4. Edit only the file you were given. Canonicality across same-basename siblings is not this skill's call.

## Discarding the code

Discard is the default posture for throwaway code once decisions are captured, and it deletes **only what this run created**:

- Isolated mode: remove the run directory when the user agrees, or leave it - `decisions.md` content has already been promoted or recapped, so nothing durable is lost either way. Ask once when unsure; never delete a prototype the user said to keep.
- Real-app scratch worktree: `git worktree remove <path>` and `git branch -D prototype/<slug>` once the user agrees. These are destructive local git operations on throwaway state the run itself created - confirm with the user before removing if any uncommitted work in the worktree is not obviously this run's.
- Overlay mode: revert this run's changes to the named files, then verify with `git status`/`git diff` that only the pre-run state remains. If a clean revert is impossible, name every file left modified in the recap.
- Never touch: user work outside this run, product source, `.atlas/evidence/`, or the findings ledger.

## Stamp the outcome

Record the settlement in `.atlas/.run/findings.json` via the standard finding script - the human's reaction is the verification of record, so the orchestrator stamps it directly rather than dispatching a verifier agent:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" \
  --id "PROTO-<slug>" --status verified \
  --title "Prototype settled: <one-line decision>" \
  --evidence "<decisions.md path>" \
  --evidence "<prototype path or 'overlay run - no artifact'>" \
  --surface "<question surface>" --category prototype \
  --reproduction "<URL or command that showed the settled variant>"
```

If the run ended without a settlement (user moved past the question, run abandoned), stamp `--status needs-evidence` with the same evidence lines so the next session finds the capsule instead of re-asking the question cold.

## Close out

- Stop the preview server (unless the user is still looking).
- Confirm containment rule 7: product tree `git status` is clean of this run or matches the overlay exception, with any left-modified files named in the recap.
- Recap in one short block: decisions, prototype path (or its absence), where the decisions went (artifact, durable doc, or chat only), and the recommended next skill (`atlas-brainstorm` when product-level questions remain, `atlas-plan` when the session is enough to plan).
