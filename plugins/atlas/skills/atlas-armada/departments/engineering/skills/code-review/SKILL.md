---
name: code-review
description: Review code for bugs, security vulnerabilities, performance issues, and maintainability. Use when the user says "review this code", "check this PR", "look at this diff", or "is this code safe?", or shares code and asks for feedback.
when_to_use: "When reviewing a diff, PR, files, or pasted code for security, performance, correctness, or maintainability findings with file and line references"
allowed-tools: Read, Glob, Grep, Bash
---

# Code Review

Structured code review covering security, performance, correctness,
and maintainability. Works on diffs, PRs, files, or pasted code
snippets.

## First Move

Read the diff once to learn what changed and why, before grading it.
Then pick the review dimensions that match the change surface: a SQL
change leans on Security and Performance; a refactor leans on
Maintainability and Correctness. Do not apply every checklist to every
diff.

## Review Dimensions

- **Security** - injection, authn/authz flaws, secrets in code,
  insecure deserialization, path traversal, SSRF.
- **Performance** - N+1 queries, unnecessary allocations, hot-path
  complexity, missing indexes, unbounded queries, resource leaks.
- **Correctness** - edge cases, race conditions, error handling and
  propagation, off-by-one errors, type safety.
- **Maintainability** - naming clarity, single responsibility,
  duplication, test coverage, documentation for non-obvious logic.

The full per-dimension checklists and how to apply them live in
`references/review-checklists.md`. Read the section for the dimension
you are reviewing; do not apply every item to every diff.

## Output Format

Rate each reviewed dimension and provide specific, actionable
findings with file and line references. Prioritize critical issues
first, then minor, then positives. Always include positive
observations alongside issues so the author sees what to keep.