# CLAUDE.md

Claude Code loads this file every session in this repo. `AGENTS.md` is the
shared canonical rule set; this file is the **hard gate** for Claude Code so
the marketplace source is never confused with a live install/cache.

`AGENTS.md` loads with this file. Read `docs/architecture/plugin-development-scope.md` when scope is unclear.

---

## HARD RULES (non-negotiable)

### 1. This checkout is marketplace SOURCE, not the installed plugin

| Path | Role |
|---|---|
| `.claude-plugin/marketplace.json` | Marketplace catalog (this repo) |
| `plugins/atlas/` | **atlas product source** - edit here |
| `plugins/armada/` | **armada product source** - edit here |
| `plugins/programmer/` | **programmer product source** - edit here |
| `mcp_servers/`, `mcp_node/` | Shared dependencies of those plugins |
| `docs/` | **Project SSOT documentation** - retain and update; never delete as "junk" |
| `.atlas/` (repo root only) | Dogfood runtime state while atlas is loaded here |
| `~/.claude/plugins/cache/**` | **Consumer install cache - FORBIDDEN to edit** |

"Fix/improve/change atlas (or armada/programmer)" means: open files under
`plugins/<name>/` (and related deps/docs) in **this** tree.

### 2. NEVER write the Claude install/cache

Never create, modify, delete, rsync, cp or deploy into `~/.claude/plugins/cache/**`,
`~/.claude/plugins/marketplaces/**` (except this repo if it *is* the working tree), or
`~/.claude/plugins/installed_plugins.json` and other install metadata.

Consumers get changes this way: edit source, update versions / CHANGELOG /
`.claude-plugin/marketplace.json`, commit and push, then the user updates the plugin
from the marketplace. Hot-copying into the cache is a process defect. To verify
after install, tell the user to reinstall.

### 3. Dogfooding atlas here is allowed; product edits stay in source

atlas may be loaded and running while you develop it here. The edit target does not change:
product behavior goes in `plugins/atlas/**`, durable knowledge in `docs/**`, scratch in
`.atlas/.run/`. Never create `plugins/**/.atlas/`. Do not operate this repo like a customer
deploy (department YAML, install flows) unless the user explicitly asks.

### 4. `docs/` is SSOT - never strip it

Do not delete, "clean" or gitignore docs content. Update `docs/` when behavior or
architecture changes.

### 5. Verify from this tree

Run tests, dashboard and scripts from repo paths (`plugins/atlas/scripts/...`,
`plugins/atlas/hooks/...`), never from the cache.

### 6. Commits never credit Claude

- Commit as `W159 <49504268+w159@users.noreply.github.com>`. Cloud sessions default
  to `Claude <noreply@anthropic.com>`: run
  `git config user.name W159 && git config user.email 49504268+w159@users.noreply.github.com`
  in every fresh clone before the first commit.
- No `Co-Authored-By: Claude`, `Claude-Session:` or "Generated with Claude Code" lines,
  in commits or PR text.
- Run `git config core.hooksPath .githooks` in every fresh clone. The hooks run `scripts/gate.sh`
  and only its fast set (under 30 s, attribution check included; the slow test files are listed in
  `scripts/gate-slow.txt`). `scripts/gate.sh full` runs everything, slow list included, and is run by hand
  before a release. The `attribution` job on GitHub is the only CI check left.

---

## Quick routing

| User intent | Do this |
|---|---|
| Fix atlas skill/hook/dashboard | Edit `plugins/atlas/...` |
| Fix connector MCP | Edit `mcp_servers/<svc>-mcp/` + `mcp_node/...` + plugin wiring |
| Update project knowledge | Edit `docs/...` |
| "Make my install pick this up" | Ship source; tell user to reinstall - **no cache writes** |
| Ambiguous develop vs operate | Default to **develop source**; confirm only if truly ambiguous |

Project `.claude/settings.json` denies Read/Edit/Write under the home plugin cache
paths. Do not ask to bypass those denials.

<!-- atlas-tooling -->
See `AGENTS.md`'s Tool Routing section (canonical, shared) for the
claude-mem / context-mode / lean-ctx / ponytail tooling bar this
project expects every agent to use. Nothing Claude-Code-specific to add
here; do not duplicate it.
<!-- /atlas-tooling -->

## Atlas gates (lead only; a subagent cannot dispatch and can skip this section)

Every denial message names its exact fix: read it and do that, do not route around it.
Full detail: `plugins/atlas/skills/atlas-orchestrate/references/subagent-kit.md` (dispatch
contract) and `references/laws-and-gates.md` (session and Stop gates).

- **First call** each session: one claude-mem search (advisory on Claude Code).
- **Dispatch prompt** for any `atlas:*` agent, each label at the start of a line:
  `SCOPE: <class>/<effort>` (exactly one; classes implement, fix, verify, audit, docs, db,
  ui-test, test; efforts low, medium, high; check the team with
  `python3 plugins/atlas/scripts/atlas_resolve.py <class> <effort>`),
  `TOOLS: ToolSearch lean-ctx (ctx_compose, ctx_search, ctx_read); context-mode for noisy output.`,
  one single-sentence `GOAL:`, then `DELIVERABLE:`, `SUCCESS CRITERIA:`, `OUT OF SCOPE:`,
  `STOP CONDITIONS:`, `REPORT:`. `atlas:runner` also needs numbered `STEPS:` (at most 7).
  Never pass a `model` param. No built-in agent types. Two concerns are two dispatches.
- **Working roles go to a tmux team**: with tmux on PATH an in-process working-role
  dispatch is denied, one-seat scopes included. Run
  `python3 plugins/atlas/scripts/atlas_mux.py spawn-team --class C --effort E --paths P --task-file F`
  (brief under `.atlas/.run/briefs/`), then `wait --team T` and `reap --team T`.
  Closing and read-only roles (planner, verifier, completeness-critic, docs-curator,
  docs-auditor, explorer, db-prober) may be in-process; explorer and db-prober may run in parallel.
  Never run two writers on the same files.
- **Inline work**: the lead may edit `docs/` and `.atlas/` and run tests, bookkeeping
  (`atlas_todo.py`, `atlas_finding.py`, `atlas_resolve.py`) and integration commands. Other
  inline shell work is denied at the 7th op since the last dispatch, and an inline Edit of
  target code is denied outright. A simple task (one working seat or effort `low`, no team
  launched this run) is exempt.
- **Before done** (the Stop gate checks these): reply opens with
  `**ATLAS** | <glyph> <phase> | <state>`; `docs/CHANGELOG.md` records any non-docs change;
  ROADMAP and README are present; each implementer dispatch is covered by a real test run
  and a `verified` finding (`plugins/atlas/scripts/atlas_finding.py`); every todo is completed
  or dropped (close advisor items with `atlas_todo.py complete --id <id> --evidence "<proof>"`,
  then re-run `list`); worker branches are merged and removed.
