# Tool and capability patterns

atlas-hephaestus recommends and installs three kinds of capabilities:
skills, plugins, and MCP servers. Each has a distinct install path, a
distinct context cost, and a distinct reason to recommend it. Read this
when you are building the recommend-then-confirm shortlist in Stage 2,
or when a recommendation came back wrong (the user got a plugin where a
skill was the right answer, or the reverse).

## The three capability kinds

| Kind | Lives in | Installs via | Context cost | When it is the right answer |
|---|---|---|---|---|
| **skill** | `~/.claude/skills/<name>/SKILL.md` | a plugin install, or a directory drop | one SKILL.md body loaded on trigger | the user needs a repeatable methodology that fires on a description match |
| **plugin** | `~/.claude/plugins/<plugin>/` | `/plugin` install from a marketplace | the sum of its skills + agents + hooks | the user needs a bundled set (skills + agents + hooks that work together) |
| **MCP server** | `.mcp.json` at project or user scope | `claude mcp add` or a marketplace entry | server process + tool schemas, loaded on demand | the user needs live data or actions from an external service |

## The decision rule

Prefer the lightest kind that carries the work:

1. If the need is a methodology the model runs in its own context, use a
   **skill**. Skills are the default. They cost one SKILL.md body and
   fire on description match, so they are cheap when idle.
2. If the need is a methodology plus companion agents plus hooks that
   must load together, use a **plugin**. A plugin is a bundled skill+
   agent+hook set. Use it when the skills alone are not enough (the
   atlas plugin itself is the example: skills + agents + hooks that
   only make sense as a unit).
3. If the need is live data or actions from an external service (a
   database, a ticketing system, a cloud API), use an **MCP server**.
   Skills and plugins cannot reach outside the session; an MCP server
   can. The cost is a server process, so only add one when the project
   actually queries that service.

## How to detect which kind fits

`scripts/discover_capabilities.py <root>` is read-only and side-effect
free. It reads the project's manifests and deps and emits signals:
languages, frameworks, cloud providers, package managers. Match those
signals against `..`atlas-metis`/references/capability-catalog.md` to
build the ranked shortlist. Each shortlist entry states:

- the asset id (skill, plugin, or `server.tool` for MCP)
- the kind
- the reason it fits this project's signals
- the exact install command
- the context cost (rough: skill < plugin < MCP)

Present the shortlist as one multiSelect AskUserQuestion with
recommended items first. Install only what the user picks. Never
install silently.

## The config schema

After installs, write or update `.claude/atlas.local.md` (YAML
frontmatter, markdown body):

```yaml
---
stack: [<detected languages/frameworks>]
capabilities_installed: [<asset ids confirmed this session>]
capabilities_declined: [<asset ids the user skipped>]
nudge_window_seconds: 900
routing_notes: <project-specific subagent/model routing, optional>
---
```

The body is free-form: project conventions, gotchas, and anything
learned during setup that the team should see. Show the diff and
confirm before writing.

## The .atlas/docs/ scaffold

If `.atlas/docs/` lacks the SSOT scaffold, offer to seed it per
`..`atlas-metis`/references/docs-ssot.md`. Confirm first. Then ensure
`.atlas/docs/` is git-tracked: a deny-by-default `.gitignore` MUST
allowlist the SSOT subtree (root `*.md` plus `architecture/`,
`features/`, `specs/`, `audits/`, `lessons/`, `wiki/`, `plans/`,
`evidence/`, `reference_files/`), keep `.atlas/docs/.run/` ignored,
and never blanket-allow `.atlas/docs/**` (that would try to commit
vendored doc clones that carry their own nested `.git`). Verify with
`git check-ignore .atlas/docs/CHANGELOG.md` (should NOT be ignored).

## Hooks

A plugin install auto-loads `hooks/hooks.json`. Verify all eight hooks
are active (session boot, prompt optimizer, bash advisor,
format-after-edit, dispatch tripwire, completion gate,
self-improvement nudge, session-transcript ingest). Outside a plugin
install, offer `scripts/install_hooks.py`. The hooks themselves are
documented in `..`atlas-metis`/references/hooks-automation.md`.

## Boundaries

hephaestus boots and configures only. It never runs scoped
build/fix/audit/refactor work; that routes to atlas-metis. It never
installs or writes outside `.atlas/docs/` and `.claude/` without
explicit confirmation. Every install and every write outside those two
trees is gated on the user's explicit OK.