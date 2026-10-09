---
name: code-review
description: This skill should be used when the user asks for a code review, PR review, adherence to software principles, or wants to know whether code matches best-practice principles from a curated book corpus. It reviews a target path or diff against 6 lenses derived from 31 books and produces a ranked, evidence-backed report.
argument-hint: "[path] [--scope diff|all] [--depth quick|standard] [--report <file>]"
allowed-tools: Read, Grep, Glob, Bash, Agent, Write
---

# Code Review

Run a structured code review against 6 lenses derived from 31 software engineering books. Produce a ranked report of blockers, majors, minors, and notes, each finding cited to a book principle and backed by `file:line` evidence.

## Arguments

- A bare path (no flag) is the target directory. Default: the current working directory.
- `--scope diff` reviews the current diff. `--scope all` reviews the whole target. Default: `diff` if the target is a git repository, otherwise `all`.
- `--depth quick` uses a targeted pass. `--depth standard` uses a broader scan. Default: `standard`.
- `--report <path>` sets the report output file. Default: `.code-review-report.md` in the target root.

## Procedure

1. Read the rubric at `references/rubric.md` to load the review lens definitions.
2. Read the book map at `references/books.md` to identify the source principles.
3. Confirm the target exists and contains source files. If not, stop and report.
4. If `--scope diff`, use `git diff --name-only` (or the equivalent in the target repo) to list changed files. If `--scope all`, enumerate the source files in the target.
5. Dispatch 6 reviewer agents in parallel. Put every Agent call in a single message so they run concurrently. Each agent gets the target path, the file list, and its assigned lens.
6. Collect each reviewer's JSON findings array. Validate shape: each finding must have `category`, `severity`, `finding`, `principle`, `source`, `evidence`, and `fix`. If an agent returns prose, re-dispatch that one lens with a stricter instruction.
7. Deduplicate findings by `category + finding + evidence`.
8. Synthesize one report using the template below. Rank findings: blockers first, then majors, then minors, then notes. Within severity, order by lens, then by impact.
9. Write the report to `--report` path.
10. Print a summary table and the top 10 findings. Do not dump the full report into the conversation.

## Review lenses

1. Architecture
2. Correctness
3. Craft
4. Security
5. Data
6. Process

## Finding schema

```json
[
  {
    "category": "architecture",
    "severity": "major",
    "finding": "Controller depends directly on the database client.",
    "principle": "Dependency rule",
    "source": "Clean Architecture",
    "evidence": [
      "src/orders.ts:42-58 - controller opens a database connection and runs SQL directly"
    ],
    "fix": "Move persistence behind an order repository interface and inject it from the composition root."
  }
]
```

## Report template

```markdown
# Code Review Report

Target: <path>
Date: <run date>
Scope: <diff|all>
Depth: <quick|standard>

## Summary

| Lens | Blocker | Major | Minor | Note |
|---|---|---|---|---|
| Architecture | n | n | n | n |
| Correctness | n | n | n | n |
| Craft | n | n | n | n |
| Security | n | n | n | n |
| Data | n | n | n | n |
| Process | n | n | n | n |

## Findings, ranked

### 1. <finding> - <severity>
Category: <category>
Principle: <principle> (<source>)
Evidence:
- path/file.ext:line - <what it shows>
Fix: <actionable next step>

## What is working

Bullet list of strengths, grouped by lens, with one citation each.
```

## Citation discipline

Every non-`note` finding must carry at least one real `path:line` citation that the reviewer actually opened. If the reviewer cannot find evidence for a suspected issue, it must either mark it as `note` and explain the search, or omit the finding entirely. No finding may assert a problem without either a positive citation or a documented negative search.

## Out of scope

The review reports only. It does not modify, refactor, or fix any code. Re-running the review after fixes is how progress is verified.

## Resources

- `references/rubric.md` - the per-lens rubric with evidence signals.
- `references/books.md` - the book map behind each review lens.
- Agents: `code-review-architecture`, `code-review-correctness`, `code-review-craft`, `code-review-security`, `code-review-data`, `code-review-process`.
