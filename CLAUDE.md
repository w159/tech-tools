# CLAUDE.md

Claude Code loads this file every session in this repo. `AGENTS.md` is the
shared canonical rule set; this file is the **hard gate** for Claude Code so
the marketplace source is never confused with a live install/cache.

Read `AGENTS.md` and `docs/plugin-development-scope.md` next.

---

## HARD RULES (non-negotiable)

### 1. This checkout is marketplace SOURCE, not the installed plugin

| Path | Role |
|---|---|
| `.claude-plugin/marketplace.json` | Marketplace catalog (this repo) |
| `plugins/atlas/` | **atlas product source** — edit here |
| `plugins/armada/` | **armada product source** — edit here |
| `plugins/programmer/` | **programmer product source** — edit here |
| `mcp_servers/`, `mcp_node/`, `skills/` | Shared dependencies of those plugins |
| `docs/` | **Project SSOT documentation** — retain and update; never delete as "junk" |
| `.atlas/` (repo root only) | Dogfood runtime state while atlas is loaded here |
| `~/.claude/plugins/cache/**` | **Consumer install cache — FORBIDDEN to edit** |

When the user says fix/improve/change atlas (or armada/programmer), open files
under `plugins/<name>/` (and related deps/docs) in **this** tree. Do not open
or patch the copy under the home-directory cache.

### 2. NEVER write the Claude install/cache

**Forbidden** (create / modify / delete / rsync / cp / deploy into):

- `~/.claude/plugins/cache/**`
- `~/.claude/plugins/marketplaces/**` (except this repo if it *is* the working tree)
- `~/.claude/plugins/installed_plugins.json` and other install metadata under `~/.claude/plugins/`

Delivery path for consumers:

1. Edit source under `plugins/…` (and deps)
2. Update versions / CHANGELOG / `.claude-plugin/marketplace.json` when shipping
3. Commit / push
4. User reinstalls or updates the plugin from the marketplace

Hot-copying `plugins/atlas/` into the cache is a process defect. If behavior
must be verified after install, tell the user to reinstall — do not mutate
their cache.

### 3. Dogfooding atlas here is allowed; product edits stay in source

It is intentional that atlas may be **loaded and running** while you develop
it in this repo (skills, hooks, dashboard, `.atlas/` dogfood state). That does
**not** change the edit target:

- Change product behavior → `plugins/atlas/**` (etc.)
- Record durable project knowledge → `docs/**`
- Ephemeral orchestration scratch → `.atlas/.run/` (do not invent
  `plugins/atlas/.atlas/` or other nested install-shaped trees inside source)

Do **not** treat "atlas is active in this session" as permission to operate
this repo like a customer deploy (department YAML setup, install flows) unless
the user explicitly asks for dogfood runtime config.

### 4. `docs/` is SSOT — never strip it

- Everything under `docs/` is project documentation.
- Do not delete, "clean", or gitignore docs content as unused junk.
- Prefer updating `docs/` when behavior or architecture changes.
- Full explanation: `docs/plugin-development-scope.md`.

### 5. Verify from this tree

Run tests, dashboard, and scripts from **repo paths**:

- `plugins/atlas/scripts/…`
- `plugins/atlas/hooks/…`
- `python3 -m unittest discover -s plugins/atlas/…`

Do not use `~/.claude/plugins/cache/tech-tools/atlas/<version>/…` as the place
to implement or "make it take effect."

---

## Quick routing

| User intent | Do this |
|---|---|
| Fix atlas skill/hook/dashboard | Edit `plugins/atlas/…` |
| Fix connector MCP | Edit `mcp_servers/<svc>-mcp/` + `mcp_node/…` + plugin wiring |
| Update project knowledge | Edit `docs/…` |
| "Make my install pick this up" | Ship source; tell user to reinstall — **no cache writes** |
| Ambiguous develop vs operate | Default to **develop source**; confirm only if truly ambiguous |

---

## Permissions intent

Project `.claude/settings.json` denies Read/Edit/Write under the home plugin
cache paths. Do not ask to bypass those denials for "faster iteration."
