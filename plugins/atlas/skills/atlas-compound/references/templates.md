# Body Templates (verbatim from CE)

Ported verbatim from `skills/ce-compound/assets/resolution-template.md` (w159/compound-engineering-plugin). Only two things differ from CE's originals: `category` now names a `docs/lessons/` subdirectory, and new files are named `docs/lessons/<category>/<YYYY-MM-DD>-<slug>.md` (atlas date-first) instead of CE's undated slug-only name. Bracketed parts are filled; every section is required for its track - a missing section fails schema validation in `references/schema.md`.

## Bug track

Use for `problem_type`: `build_error`, `test_failure`, `runtime_error`, `performance_issue`, `database_issue`, `security_issue`, `ui_bug`, `integration_issue`, `logic_error`.

```markdown
---
title: [Clear problem title]
date: [YYYY-MM-DD]
category: [docs/lessons subdirectory]
module: [Module or area]
problem_type: [schema enum]
component: [corpus value, else schema suggested default]
symptoms:
  - "[Observable symptom 1]"
root_cause: [corpus value, else schema suggested default]
resolution_type: [schema enum]
severity: [schema enum]
tags: [keyword-one, keyword-two]
---

# [Clear problem title]

## Problem
[1-2 sentence description of the issue and user-visible impact]

## Symptoms
- [Observable symptom or error]

## What Didn't Work
- [Attempted fix and why it failed]

## Solution
[The fix that worked, including code snippets when useful]

## Why This Works
[Root cause explanation and why the fix addresses it]

## Prevention
- [Concrete practice, test, or guardrail]

## Related Issues
- [Related docs or issues, if any]
```

## Knowledge track

Use for `problem_type`: `best_practice`, `documentation_gap`, `workflow_issue`, `developer_experience`, `architecture_pattern`, `design_pattern`, `tooling_decision`, `convention`.

```markdown
---
title: [Clear, descriptive title]
date: [YYYY-MM-DD]
category: [docs/lessons subdirectory]
module: [Module or area]
problem_type: [schema enum]
component: [corpus value, else schema suggested default]
severity: [schema enum]
applies_when:
  - "[Condition where this applies]"
tags: [keyword-one, keyword-two]
---

# [Clear, descriptive title]

## Context
[What situation, gap, or friction prompted this guidance]

## Guidance
[The practice, pattern, or recommendation with code examples when useful]

## Why This Matters
[Rationale and impact of following or not following this guidance]

## When to Apply
- [Conditions or situations where this applies]

## Examples
[Concrete before/after or usage examples showing the practice in action]

## Related
- [Related docs or issues, if any]
```

## Section rules

- Every section for the track is present and substantive; an empty section means the lesson is not ready (or the wrong track was chosen).
- `Symptoms` mirrors frontmatter `symptoms`; `When to Apply` mirrors `applies_when` - keep them consistent.
- Code snippets cite current source (`file:line`) and are re-verified by the grounding check (`references/grounding.md`) before dispatch.
- `Related Issues`/`Related` cross-reference the other tree when the lesson spans `docs/lessons/` and `.atlas/findings/` (see `references/overlap.md`).
- Writing quality follows the operating contract: evidence over assertion, no speculation, no "might also".