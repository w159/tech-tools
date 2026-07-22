---
name: tpp-audit
description: This skill should be used when the user asks to "audit my codebase against The Pragmatic Programmer", run a "pragmatic audit", "check what pragmatic principles are implemented", "review codebase for pragmatic practices", "find what's missing from the pragmatic programmer in this project", or wants a structured review of a codebase/project/monorepo against the book's principles, tips, and practices. Produces a ranked report of what is implemented, partially implemented, and missing, each finding cited to the book concept and to file:line evidence. Supports --chapters to scope dimensions and --report to set output path.
argument-hint: "[path] [--chapters 1,2,5] [--report <file>]"
allowed-tools: Read, Grep, Glob, Bash, Agent, Write
---

# Pragmatic Programmer Codebase Audit

Run a structured audit of a codebase, project, or monorepo against the 10 dimensions of The Pragmatic Programmer (20th Anniversary Edition). Produce a ranked report of what is implemented, partially implemented, and missing, each finding cited to the book concept and backed by file:line evidence.

## Arguments

Parse the argument string:
- A bare path (no flag) is the target directory. Default: the current working directory.
- `--chapters 1,2,5` restricts the audit to those dimension numbers (1-10). Default: all 10.
- `--report <path>` sets the report output file. Default: `.tpp-audit-report.md` in the target root.

Dimension numbers: 1 Philosophy, 2 Approach, 3 Tools, 4 Paranoia, 5 Decoupling, 6 Concurrency, 7 While-Coding, 8 Before-Project, 9 Projects, 10 Ethics.

## Procedure

1. Read the rubric at `references/dimensions.md` to load the evidence signals for each selected dimension. This file is the operational definition of implemented / partial / missing / n/a.

2. Confirm the target exists and is non-trivial (has source files). If the target is empty or unreadable, stop and report that.

3. For each selected dimension, dispatch the `tpp-auditor` agent via the Agent tool. Put every Agent call in a single message so they run in parallel. Each Agent prompt passes: the dimension number and name, the target path, and an instruction to read the matching section of `references/dimensions.md` plus the concept files under `../tpp-principles/references/concepts/` for that dimension's concepts, then return the JSON findings array.

4. Collect every auditor's JSON array. Validate shape: each finding has `concept`, `tip`, `status` (one of implemented/partial/missing/n/a), `evidence` (array of file:line strings), `note`. If an auditor returned prose instead of JSON, re-dispatch that one dimension with a stricter instruction.

5. Synthesize a single report (template below). Rank findings by gap severity: all `missing` first (by impact, then by number of evidence patterns searched and absent), then `partial`, then `implemented` summarized as a count. Each finding line cites: dimension, concept file, the book tip number, status, and up to 3 file:line evidence citations.

6. Write the report to the `--report` path.

7. Print a summary table to the conversation: one row per dimension with counts of implemented / partial / missing / n/a. Then list the top 10 gaps (missing and partial) with one-line evidence. Do not dump the full report into the conversation - it is in the file.

## Report Template

```markdown
# Pragmatic Programmer Audit Report

Target: <path>
Date: <run date>
Dimensions: <list>

## Summary

| Dimension | Implemented | Partial | Missing | N/A |
|---|---|---|---|---|
| 1 Philosophy | n | n | n | n |
...

## Gaps, ranked (missing first, then partial)

### 1. <concept>.md (Tip n) - <status>
Dimension: <n Name>
Evidence:
- path/file.ext:line - <what it shows>
- ...
Note: <auditor note>

(repeat per finding)

## What is in force

Bullet list of concepts marked implemented, with one citation each, grouped by dimension.
```

## Citation discipline

Every non-n/a finding in the report must carry at least one real `path:line` citation that the auditor actually opened. If the auditor could not find a citation for a `missing` verdict, that is acceptable (absence is the evidence) but the note must say what was searched. No finding may assert a status without either a positive citation or a documented negative search.

## Out of scope

The audit reports only. It does not modify, refactor, or fix any code. Re-running the audit after fixes is how progress is verified; that is the user's call, not this skill's.

## Resources

- `references/dimensions.md` - the per-dimension rubric with grep-able evidence signals.
- `../tpp-principles/references/concepts/<file>.md` - the book's actual text for each concept, for citation and depth.
- Agent: `tpp-auditor` - one dispatch per dimension, returns the JSON findings array.