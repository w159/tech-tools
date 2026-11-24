# Project standards

One file per cross-cutting convention (a UI pattern, naming rule, API shape,
error-handling rule). Each standard lists `applies_to` globs in its frontmatter;
when an agent edits a file that matches, the standards_nudge hook injects the
standard into its context as advice (never a block). `atlas:docs-curator` creates
and updates standards in place, `atlas:docs-auditor` flags stale or missing ones,
and `atlas-review` checks diffs against them. A rule only one file needs is not a
standard. This README is not a standard. Name files in lowercase-kebab, no date.

Template (`applies_to` may also be inline: `applies_to: ["a/**", "b/*.tsx"]`;
`reference` is optional):

```markdown
---
title: Data tables for taxonomy objects
applies_to:
  - "src/pages/**"
  - "src/components/**/*Table*"
reference: src/components/HoldingsTable.tsx:12
last_updated: 2026-11-24
---
## Rule
- Every row: type icon, hover background token, pencil then trash at row end.
- Row click opens that object's form modal.
## Why
## Example
## Decision log
- 2026-11-24: <what changed, who decided, link>
```
