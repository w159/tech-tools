# Eligibility, Modes, and the One-Learning Rule

The ported contract from CE's `ce-compound` (`skills/ce-compound/SKILL.md` + `docs/guides/ce-compound.md` in w159/compound-engineering-plugin), adapted to atlas's trigger and consent model.

## The hard gate

Only a lesson that is ALL of the following is captured:

1. **Solved** - a concrete fix landed. Not a diagnosis in progress, not a plan, not "we know what to do next."
2. **Verified** - proof exists: a test that passed, a command run with observed output, a `atlas:verifier` verdict in `.atlas/.run/findings.json`, or evidence under `.atlas/evidence/`. If verification is missing, the correct move is to verify first (or dispatch `atlas:verifier` per the operating contract) - never to capture on faith.
3. **Non-obvious AND durably useful - the counterfactual test:** if this learning were deleted, would a future engineer reading the final code, tests, types, comments, and docs likely **re-make the mistake or redo substantial investigation**? The learning must live where the code does not already speak. A lesson whose fix is self-documenting (a well-named function, a test that pins the behavior, a comment that explains the cause) fails this test.
4. **A real lesson, not a status report.** "We migrated the table" is not a lesson; "the migration failed silently because X, and here is the guardrail that catches X" is.

### Completion phrases identify the checkpoint; they do NOT waive the gate

Phrases like "that worked", "it's fixed", "working now", "problem solved", "tests are green" identify the moment to evaluate capture. They never lower the bar: a trivial fix that passed the counterfactual test trivially (the code explains itself) is still skipped. An explicit `atlas-compound <context>` invocation applies the identical gate - explicit invocation is a trigger, not an override.

### Failing the gate is normal

`Learning skipped` with the exact failed clause is a complete, correct outcome. Do not stretch a weak lesson to pass, and do not capture "so the invocation does something."

## One learning per invocation

Mandatory, ported from CE: each invocation captures exactly ONE lesson. If the session produced several distinct lessons, capture the most valuable one and tell the user (or the loop) to invoke `atlas-compound` again for each additional lesson. Batching breaks the grounding check (claims from two different fixes get conflated), the overlap check (a two-lesson draft matches nothing cleanly), and retrieval later (one file, two causes, unfindable by either).

## Full vs Lightweight

| Aspect | Full (default) | Lightweight |
|---|---|---|
| Trigger | default; every interactive invocation | only explicit `depth:lightweight`, `mode:non-interactive`, or unmistakable headless/no-prompts wording; bare "automatically" is NOT enough |
| Research | read diff/evidence + corpus sample + full overlap semantic scoring | same reads, but overlap is a mechanical grep/filename check only (same topic keywords in an existing lesson's frontmatter = treat as moderate overlap and create new + flag for consolidation) |
| Grounding | full mechanical claims check (`references/grounding.md`) | same - grounding is NEVER reduced; ungrounded claims are the failure mode this skill exists to prevent |
| Schema validation | full frontmatter + enum + YAML-safety validation | same |
| Session-history probe | optional: probe claude-mem for a prior session that already hit this problem (7-day window, current branch or >=2 topic-keyword hits) to enrich "What Didn't Work" | skipped |
| Enhancement reviewers | none in atlas (CE's optional doc-review personas have no atlas equivalent; a second opinion may be requested via a bounded Task dispatch to a generic read-only subagent, or a `typesafe_decide` judgment on the counterfactual question - both optional, never required) | skipped |
| Output | `Learning captured` / `Learning skipped` signal | same |

Unknown, multiple, or invalid `depth:`/`mode:` tokens fail closed: emit `Learning skipped` with reason `invalid mode token`. Fail-closed means no documentation, never a guess.

## Track selection

Determined by `problem_type` (see `references/schema.md` for the enums):

- **Bug track** - a defect/failure that was diagnosed and fixed: build_error, test_failure, runtime_error, performance_issue, database_issue, security_issue, ui_bug, integration_issue, logic_error. Adds required `symptoms`, `root_cause`, `resolution_type`.
- **Knowledge track** - guidance/practice/convention: best_practice, documentation_gap, workflow_issue, developer_experience, architecture_pattern, design_pattern, tooling_decision, convention. Adds `applies_when` (and commonly `tags`).

Prefer the narrowest applicable `problem_type`; `best_practice` is the fallback when no narrower knowledge-track value fits.