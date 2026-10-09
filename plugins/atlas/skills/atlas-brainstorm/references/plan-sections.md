# Phase 3-4: Requirements artifact contract and handoff

Ported from CE `ce-brainstorm` `references/plan-sections.md` (Goal Capsule + Product Contract shape), adapted to atlas date-first naming and docs-ssot write ownership. This artifact is **requirements-only**: NO implementation units, NO U-IDs, NO file lists, NO test scenarios, NO launch block.

## Path

`docs/plans/<YYYY-MM-DD>-<slug>-brainstorm.md`

- `<YYYY-MM-DD>` = today's date (atlas date-first convention, enforced by `${CLAUDE_PLUGIN_ROOT}/scripts/lint_docs_names.py` - never CE's undated or HHMM names).
- `<slug>`: lowercase, every character outside `a-z 0-9 . _ -` replaced by `-`, collapsed and trimmed (Windows-safe per docs-ssot).
- Collision: if the exact path exists and is NOT the resume target, suffix `-2`, `-3`, ... Do not overwrite.

## Section contract

```markdown
# Brainstorm: <topic>

Date: <YYYY-MM-DD>
Source: atlas-brainstorm
Status: requirements-only (implementation planning: atlas-plan)

## Goal Capsule

**Model of success:** <1-3 sentences - the elevated model from Phase 2: what the user is actually trying to achieve, for whom, and what outcome counts as success.>
**Primary actor:** <who uses/ benefits; "system" for non-user-facing work>
**Non-goals:** <explicit exclusions surfaced in dialogue - empty is not allowed; at minimum restate the coherent-work split>

## Product Contract

### Requirements

Stable IDs, never renumbered - `atlas-plan` and downstream artifacts reference them:

- **R-001** <requirement statement, actor-observable, testable in principle> <grounding citation if any: `(pack: <id>, <path>)` or repo evidence `(grounded: <path or explorer finding>)`>
- **R-002** ...

Rules for requirement statements: observable outcome, not mechanism ("quotes render with currency from the client's locale", not "use Intl.NumberFormat in the quote renderer"); one requirement per ID; IDs are stable for the life of the topic - a superseded requirement is marked `[superseded by R-XXX]`, never deleted or reused.

### Open questions and assumptions

- **Assumption A-001:** <every unknown that survived dialogue, phrased as a decision the plan may take unless challenged> 
- <Open question Q-001: ... - only if a genuine blocking question was consciously deferred>

### Settled decisions

- **D-001** <decision made in dialogue or by resume from a prior plan> - binding for atlas-plan.

### Prior art

- <explorer findings, related docs/specs/decisions paths, findings ledger entries; Compound Pack matches cited `(pack: <id>, <path>)`>
```

Non-software requests use the same skeleton with a reduced Product Contract (no error-path/integration requirements); the Goal Capsule carries the weight.

## Four Ready checks (gate before handoff)

1. **Complete:** no unresolved actor/outcome/scope/success gap; no placeholder, TBD, or `...`; every requirement has an ID.
2. **Consistent:** requirements don't contradict each other or the settled decisions; scope is one coherent piece.
3. **Focused:** requirements-only - grep the draft for implementation leakage (`U-0`, "edit `", "test scenario", "implementation unit"); any hit is a violation to remove.
4. **Usable:** atlas-plan could consume this without a single clarifying question back to the user; every assumption is explicit.

A failed check is fixed by returning to dialogue (Complete/Consistent) or rewriting the draft (Focused/Usable) - never handed off as-is.

## Write via atlas:docs-curator

Per docs-ssot, `docs/` writes belong to `atlas:docs-curator`. Dispatch it (subagent-kit shape, fork per `subagent-kit.md` when `CLAUDE_CODE_FORK_SUBAGENT=1`): ROLE = write the assembled brainstorm artifact verbatim to the target path, creating `docs/plans/` if missing; TOOLS ALLOWED: Read, Glob, Grep, Bash, Edit, Write with writable scope `docs/plans/**` only; DELIVERABLE: the written path + confirmation the section contract is complete. Supply the full assembled artifact verbatim in the prompt. If subagent dispatch is genuinely unavailable on the host, write the file directly and state that in the report.

## Verification

Dispatch `atlas:verifier` (read-only, subagent-kit shape): adversarially check the written artifact against repo facts - each grounded claim traces to a real file/pattern or pack citation, no placeholder survived the write, IDs are stable and complete, Ready checks hold. It stamps its verdict (PASS/FAIL + evidence) into `.atlas/.run/findings.json` per the atlas verifier contract. A FAIL routes back to the failing Ready check.

**Lightweight exception:** a Lightweight-tier artifact with zero external claims (no pack citations, no explorer findings beyond trivial reads) may run the Ready checks themselves as verification - state this choice in the report.

## Handoff

**Interactive:** one recommendation, not a menu sprawl:

- **`atlas-plan`** (default and near-always correct): consumes the Product Contract, produces the implementation-ready plan with stable unit IDs.
- **`atlas-orchestrate`** directly, ONLY when the requirements are already mechanically precise enough that planning would be a single-unit formality - rare; say why it qualifies.
- Offer `atlas-prototype` explicitly when a visual/interaction fork was deferred (see `references/dialogue.md` prototype escalation) - before either recommendation above.

**Noninteractive / return-to-caller** - return exactly:

```json
{
  "status": "complete" | "blocked",
  "artifact_path": "docs/plans/<...>-brainstorm.md",
  "requirement_count": <N>,
  "open_assumptions": ["A-001: ..."],
  "recommended_next": "atlas-plan" | "atlas-orchestrate" | "atlas-prototype",
  "key_decisions": ["D-001: ..."]
}
```
