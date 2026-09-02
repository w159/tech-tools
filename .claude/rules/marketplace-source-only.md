# Marketplace source-only development

This repository is the **tech-tools / atlas Claude Code plugin marketplace**.

## Always

- Implement atlas / armada / programmer changes under `plugins/<name>/` in this working tree.
- Keep `docs/` as the project SSOT. Update it; do not delete it as cleanup.
- Propagate vendor tool changes across `mcp_node/`, `mcp_servers/`, plugins, docs, and templates per `AGENTS.md`.
- Verify using paths inside this repo.

## Never

- Edit, rsync, copy into, or "deploy" to `~/.claude/plugins/cache/**`.
- Patch `~/.claude/plugins/marketplaces/**` or `~/.claude/plugins/installed_plugins.json` to pick up local work.
- Create `plugins/**/.atlas/` (runtime contamination inside product source).
- Remove or hollow out `docs/` during refactors or cleanup.
- Treat a running atlas session in this repo as a customer installation to configure instead of a product to code.

## Delivery

Edit source → version/CHANGELOG/marketplace when releasing → commit/push → consumer reinstalls from marketplace.

Companion docs: `AGENTS.md`, `CLAUDE.md`, `docs/plugin-development-scope.md`.
