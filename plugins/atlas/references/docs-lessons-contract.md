# docs/lessons contract (docs-curator)

Read by `atlas:docs-curator` when the `atlas-compound` skill hands it learnings to write or update under `docs/lessons/`. Path: `docs/lessons/<category>/<YYYY-MM-DD>_<slug>.md` (enforced by `scripts/lint_docs_names.py`); the `date:` frontmatter must match the filename date.

## Frontmatter contract (write and validate)

Validate it; if a handed learning cannot support a required field, say so in your report rather than inventing a value.

```yaml
---
title: <clear problem title>
date: YYYY-MM-DD            # matches the filename date
category: <docs/lessons subdirectory>
module: <module or area>
problem_type: <enum>        # bug track: build_error, test_failure, runtime_error, performance_issue, database_issue, security_issue, ui_bug, integration_issue, logic_error
                            # knowledge track: best_practice, documentation_gap, workflow_issue, developer_experience, architecture_pattern, design_pattern, tooling_decision, convention
component: <component or area>
severity: <critical|high|medium|low>
# bug track only:
symptoms:                   # 1-5 observable symptoms
  - <symptom>
root_cause: <the cause>
resolution_type: <enum>
# knowledge track:
applies_when:
  - <condition>
tags: [lowercase-hyphenated keywords]
# when updating an existing lesson in place:
last_updated: YYYY-MM-DD
---
```

Body follows the track. **Bug track** section order: `# title`, `## Problem`, `## Symptoms`, `## What Didn't Work`, `## Solution`, `## Why This Works`, `## Prevention`, `## Related Issues`. **Knowledge track**: `# title`, `## Context`, `## Guidance`, `## Why This Matters`, `## When to Apply`, `## Examples`, `## Related`.

Corpus-first vocabulary: check existing `docs/lessons/` category directories and frontmatter spellings first. Reuse the existing category directory and the existing `component`/`root_cause` wording (root_cause matches by cause, not module). YAML safety: double-quote array values that begin with a YAML reserved indicator or contain `: `.

## Overlap-update rule

If the caller says an existing lesson has high overlap (same problem, root cause, solution, files, or prevention), do NOT create a duplicate: update it in place, merge in the new material, add or bump `last_updated`. A new file is for low or no overlap only. Preserve the existing path and metadata shape; do not normalize unrelated legacy metadata.

## Prose-quality rule

You condense learning material into durable prose without losing information; a plainer text that drops a qualifier has failed as much as a dense text full of AI tells:

- Preserve every concrete fact, number, name, quote, citation, identifier, path, command and threshold verbatim. A sentence that could move to another project unchanged carries no fact about this one: cut it or replace it with the fact it displaced.
- Never smooth away a caveat, qualifier or specific value ("only on Linux", "under 200ms").
- Prefer the mechanism over the feeling; the first sentence carries the outcome the reader needs.
- Flag, never silently drop, any claim you cannot ground in the material given. Carry it as `[unverified]` in the doc or your report.
