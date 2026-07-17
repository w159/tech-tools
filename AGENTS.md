# Agent operating rules for this repo

This file is the canonical AGENTS.md directive set for any AI agent (Claude Code, Codex, Cursor, Copilot, Kimi Code CLI, custom orchestrators) operating in this repository. It is loaded every session.

## 0. Repository identity: atlas and armada are products built here, not tools to run here (READ FIRST)

This repository is the **atlas marketplace** (`.claude-plugin/marketplace.json`). It publishes two Claude Code plugins whose source code lives in this tree:

- **atlas** - source at `plugins/atlas/` (a multi-agent coding architect: skills, agents, hooks, output styles, MCP config, scripts).
- **armada** - source at `plugins/armada/` (an organizational deployment layer for atlas: department agents and skills).

When the user says "atlas" or "armada" in a prompt in this repository, they mean **the plugin as a software product you are developing** - its code, functionality, skills, agents, hooks, docs, and dependencies. Every request to "add", "fix", "change", "improve", "rename", or "remove" something in atlas or armada is a request to **edit the plugin source under `plugins/atlas/` or `plugins/armada/`** (and the shared dependencies that back them), then verify the change.

The user is **never** asking you to:

- install these plugins, add the marketplace, or run `/plugin` / `/plugins install`;
- set up, onboard, or configure an atlas or armada *deployment* inside this workspace;
- invoke `atlas-setup`, `/armada:armada`, or any atlas/armada skill *as the way to do the work* (e.g. do not run `/armada:armada` to "provision a department" as if this repo were a customer environment);
- treat this workspace as a live atlas installation to be operated.

Do the opposite: open the relevant files under `plugins/atlas/` or `plugins/armada/` and change the code.

### Runtime artifacts are not the product

atlas and armada happen to be *active in the harness* while you work here (this session's output style, the loaded skills, the subagent registry). That is incidental. The following are runtime state written by a running atlas, **not** the product source, and are not your edit target unless the user explicitly asks about atlas's own runtime files:

- `.atlas/` (departments, evidence, nudge, self-improvement), `.fallow/`, `.supermemory/`, `.taskmaster/`

If a request seems to ask you to operate atlas here rather than change its code, stop and confirm scope before acting. The default interpretation is always: change the plugin source.

### What "dependencies" covers

"atlas/armada or their dependencies" includes: the shared skill and standard libraries under `plugins/` (`plugins/_standards/`, `plugins/_templates/`, top-level `skills/`), and the vendor tooling the armada department agents call - the MCP servers (`mcp_servers/<svc>-mcp/`), their `.mcpb` archives, and the Node client libs (`mcp_node/node-<svc>/`). Changes to those propagate under the same rules as Section 1 and 2 below.

Full explanation, source maps, and worked correct-vs-incorrect examples: `docs/plugin-development-scope.md`.

## 1. Definition of "tools" in this repo

"Tools" is a load-bearing word here. It refers to **all of the following, together, as one product surface**:

- MCP servers (`mcp_servers/<svc>-mcp/`)
- Their bundled `.mcpb` archives
- The Node.js client libraries those servers depend on (`mcp_node/node-<svc>/`)
- Plugins (`plugins/<svc>-*/`) with their commands and skills
- Repository-level documentation: README.md, docs/, .env.template
- Test harness `test-mcp-tools.mjs`

When the user asks to "add", "improve", "fix", "rename", or "remove" anything described as a tool, the change **propagates across every one of those layers for the affected vendor**. Never edit just one file in isolation.

## 2. Propagation checklist (mandatory)

Before declaring a task done that touched any vendor's tooling, verify:

- [ ] `mcp_node/node-<svc>/src/...` updated (if the underlying API surface changed)
- [ ] `mcp_servers/<svc>-mcp/src/domains/*.ts` tool definition + handler updated
- [ ] `mcp_servers/<svc>-mcp/manifest.json` description / user_config updated where relevant
- [ ] `mcp_servers/<svc>-mcp/package.json` version bumped if user-visible surface changed
- [ ] `npm run build && npm run pack:mcpb` re-ran successfully; `.mcpb` artifact is fresh
- [ ] `plugins/<svc>-*/skills/.../SKILL.md` updated if any skill references the touched tool
- [ ] `plugins/<svc>-*/plugin.json` kept current (mcp_servers list, description, keywords)
- [ ] `README.md` table rows and counts still accurate
- [ ] `.env.template` updated if env contract changed
- [ ] `test-mcp-tools.mjs` probes still target tools that exist
- [ ] Boot test (`node test-mcp-tools.mjs <svc>`) passes without tool-count regression

Any unchecked box on a vendor change is a partially-shipped feature — treat it as a bug.

## 3. Base URL is always optional

Every supported vendor publishes one or more stable default API base URLs in their developer documentation. The MCP servers in this repo **must hardcode those defaults**. Operators should not need to fill in a base URL for the common case. Override env vars exist only for staging/sovereign-cloud shards.

Specifically:

- `manifest.json` `user_config.<vendor>_base_url` → `"required": false` + description naming the documented default
- Server runtime → resolve env var; if empty, fall back to the hardcoded default; never throw on missing base URL
- `.env.template` → leave the value blank with a comment naming the default

## 4. Quality bar for every tool

A tool that an agent might call must be:

- **Discoverable**: top-level description starts with a verb and states purpose + when-to-use. Argument descriptions name type, format, default.
- **Safe**: destructive or externally-visible actions prefixed with `DESTRUCTIVE:` or `VISIBLE-TO-OTHERS:`.
- **Robust**: missing or malformed credentials produce an actionable error message (which env var, which endpoint, which doc page), not a stack trace.
- **Self-aware**: every server exposes a `<vendor>_status` tool that runs without credentials and reports configuration state.
- **Idempotent where possible**: read tools never have side effects; write tools document their effects.

## 5. Validation expectation

When the user asks for a multi-step or wide-blast-radius change, prefer to spawn parallel implementers followed by **chained skeptical validators** (each validator re-reads files, re-builds where appropriate, and assumes the prior agent over-claimed). One validator pass is the bare minimum; for high-impact changes do three.

## 6. Memory / continuity

The `memory/` directory at the user's `~/.claude/projects/.../memory/` is for cross-session facts. This repo's own facts live here in `CLAUDE.md` and `AGENTS.md`. Both files are authoritative; keep them in sync.
