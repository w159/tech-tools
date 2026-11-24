# Project standards (`docs/standards/`)

Atlas feature for keeping a project's cross-cutting conventions consistent across pages, files and developers, on any stack. Shipped in atlas 17.41.0.

## Problem

Decisions such as "every taxonomy table row has the type icon, the hover color token, pencil then trash, and a row click opens that object's form modal" lived in people's heads or in one PR thread. Agents editing a new page never saw them, so each page drifted.

## Shape

One living, undated, lowercase-kebab file per convention in the consumer project's `docs/standards/`:

```
---
title: Data tables for taxonomy objects
applies_to:
  - "src/pages/**"
  - "src/components/**/*Table*"
reference: src/components/HoldingsTable.tsx:12   # optional
last_updated: 2026-11-24
---
## Rule
## Why
## Example
## Decision log
```

`applies_to` globs are the only stack-specific part, which is why the feature works for React, Django templates, SwiftUI, or anything else with files.

## Moving parts

| Part | File | Role |
|---|---|---|
| Hook | `plugins/atlas/hooks/standards_nudge.py`, bound in `hooks/event_dispatch.py` PreToolUse | On Edit, Write, MultiEdit, NotebookEdit, ctx_patch: matches the target path against every standard's globs, injects the `## Rule` section (800-char cap) once per session per (agent, standard), inside the `wrap_recalled_memory` untrusted fence (class B in `hooks/test_untrusted_fence.py`), since anyone with repo access can edit a standard. Never denies; exits at once when `docs/standards/` is absent; ignores edits inside `docs/standards/`. |
| Writer | `plugins/atlas/agents/docs-curator.md` | Creates or updates a standard in place when a verified change or a user correction sets a cross-file rule; bumps `last_updated`, appends a Decision log line. One-file rules are not standards. |
| Drift | `plugins/atlas/agents/docs-auditor.md` | `stale`: a glob matches no file, or `reference` is gone. `missing`: a convention implemented in 3+ files with no standard. |
| Review | `plugins/atlas/skills/atlas-review/references/personas/standards.md` | Standards whose globs match a diff file are review sources. |
| Scaffold | `plugins/atlas/skills/atlas-setup/scripts/scaffold_docs.py`, `templates/standards/README.md` | Seeds `docs/standards/README.md` with the template. |
| Contract | `plugins/atlas/skills/atlas-orchestrate/references/docs-ssot.md` | Folder row, ownership, docs-current rule, copy-ready template. |

## Decisions (2026-11-24, user)

- Folder is `docs/standards/` (already named in docs-ssot, never scaffolded) rather than a new `docs/conventions/`.
- Enforcement is advisory injection, not a deny: a stale glob must not block real work.
- Session boot does not report a missing `docs/standards/`, so existing projects get no new warning until they rerun `atlas-setup`.
- The orchestrator output style is not changed (6969 of 7000 chars); the hook carries the rule to the agent instead.

## Limits

- Without `full_match` (Python before 3.13) globs fall back to `fnmatch`, where `**/` needs at least one directory: list `src/components/*Table*` too if files sit at that level.
- Live firing inside a real subagent session is covered by unit tests and an `agent_id` payload, not by a recorded live session.
