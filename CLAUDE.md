# Repository directives — read every session

## CORE RULE: what "tools" means in this repo

When the user (or any task) refers to **tools**, they mean the **entire surface area** of this monorepo:

- **MCP servers** under `mcp_servers/<svc>-mcp/` (TypeScript source, dist build, manifest.json, package.json, scripts, tests)
- **Bundled extensions** — the `.mcpb` archive each server packs into (`mcp_servers/<svc>-mcp/<svc>-mcp.mcpb`)
- **Plugins** under `plugins/<svc>-*/` (plugin.json, commands/*.md, skills/*/SKILL.md, any nested skill resources)
- **Node libraries** under `mcp_node/node-<svc>/` (TypeScript source, dist, package.json, README) that the MCP servers depend on
- **Repo-root docs and configuration**: README.md, docs/ tree, .env, .env.template, .gitignore, test-mcp-tools.mjs
- **CLAUDE.md and AGENTS.md** (this file and its peer)

### Propagation rule (NEVER violate)

Whenever the user asks to add/modify/remove a capability on any vendor (e.g. "add a feature to ConnectWise Manage tools"), the change must land **consistently across every layer** for that vendor:

1. Node library (`mcp_node/node-<svc>/src/...`) — the underlying API surface.
2. MCP server domain handler (`mcp_servers/<svc>-mcp/src/domains/*.ts`) — expose the new capability as a tool with rich description + arg schema.
3. Server manifest (`mcp_servers/<svc>-mcp/manifest.json`) — bump version if the user-visible surface changed.
4. Server bundle — `npm run build && npm run pack:mcpb` to regenerate the `.mcpb`.
5. Plugin commands/skills (`plugins/<svc>-*/`) — update any skill that references the touched area; add new skills if the new capability unlocks a new workflow.
6. Plugin manifest (`plugins/<svc>-*/plugin.json`) — keep mcp_servers list, keywords, description current.
7. Repo root README.md — keep the tables and counts accurate.
8. .env.template — add/rename env keys if auth surface changed.
9. test-mcp-tools.mjs — keep the tool-call probes representative (rotate if a probed tool is removed).
10. docs/vendors/<svc>.md (if it exists) — keep behavior documentation aligned.

**Do not ship a change that touches only one of these layers.** Disparities between layers are bugs even when no test fails.

### Base URL fields must be TRULY optional

For every vendor whose API has a documented stable default base URL (Auvik regional endpoints, Vanta `https://api.vanta.com/v1`, KnowBe4 regional endpoints, Paylocity `https://api.paylocity.com`, ThreatLocker regional endpoints, NinjaOne regional endpoints, Spanning per-platform endpoints, etc.):

- The server **must hardcode the vendor default** in code from the public developer documentation.
- The corresponding `<VENDOR>_BASE_URL` env var must be **optional** — empty/missing values resolve to the documented default with no warning, no error.
- The manifest.json `user_config.<vendor>_base_url` entry must have `"required": false` and a description like `"Optional. Leave blank to use the vendor default (<documented URL>). Only set for staging/sovereign shards."`
- The .env.template line for `<VENDOR>_BASE_URL` should be empty or omitted with a comment explaining the default.

### Tool description and implementation quality bar

Every tool must:

- Have a one-line top-level description starting with a verb, stating what it returns AND when an agent should call it.
- Prefix destructive or visible-to-others tools with `DESTRUCTIVE:` or `VISIBLE-TO-OTHERS:` so agents pause before auto-firing.
- Have argument-level descriptions that name the type, format, default, and effect on behavior. Required args call out "(required)" or use the JSON schema `required` array.
- Return errors that a downstream agent can act on — surface vendor HTTP status, response body excerpt, and a remediation hint (which env var to set, which endpoint to enable, etc.).
- Never silently swallow exceptions; always surface them as `isError: true` content with a human-readable message.
- Boot without crashing even when credentials are missing — the `<vendor>_status` tool must always run and report the missing-creds state instead of throwing during server initialization.

## Testing

- `node test-mcp-tools.mjs` runs the full suite.
- `node test-mcp-tools.mjs <server> [<server>...]` runs a subset.
- The harness extracts the `.mcpb`, spawns it over stdio, calls `tools/list`, then calls a couple of safe tools and prints PASS/FAIL.
- A tool count regression after a code change is a bug; investigate before continuing.

## Build conventions per server

- Most servers use `tsup` (TypeScript bundler). Build with `npm run build`; pack with `npm run pack:mcpb`.
- `cipp-mcp` uses raw `tsc` instead of tsup -- both `npm run build` and `npm run pack:mcpb` work the same way.
- The pack script lives at `mcp_servers/<svc>-mcp/scripts/pack-mcpb.js` and is the canonical packer.

## Build flow -- iCloud path constraints

This repo lives under iCloud Drive. These rules apply for any build or pack operation:

1. **Never run `npm install` inside the repo directory.** `node_modules` under an iCloud path syncs
   continuously and causes file-lock errors, churn, and corrupted installs. Stage builds in `/tmp`
   instead: `cp -r mcp_servers/<svc>-mcp /tmp/<svc>-build && cd /tmp/<svc>-build && npm install && npm run build && npm run pack:mcpb`.
   Copy the resulting `.mcpb` back to the repo path when done.

2. **IDE TypeScript diagnostics show missing-module errors by design.** Because `node_modules` is
   never present under the repo path, editors (VS Code, Cursor, etc.) will flag `Cannot find module`
   for `@modelcontextprotocol/sdk`, `zod`, and local `mcp_node` packages. These are false positives --
   the `dist/` outputs that matter are built in `/tmp` where `node_modules` is present.

3. **`mcp_servers/**/dist/`, `node_modules/`, and `mcp_servers/**/*.mcpb` are NOT tracked** (they are
   gitignored). Build them locally before running `test-mcp-tools.mjs`. The runnable, distributable
   artifact is the `.mcpb` bundle (server `dist/` + `node_modules`), produced by `npm run pack:mcpb`.

4. **Connectors ship to the marketplace bundled inside plugins.** Each connector-bearing cluster
   (`it-operations`, `security-compliance`, `microsoft-365`, `hr-payroll`) commits the vendor `.mcpb`
   under `plugins/<cluster>/mcp/<name>.mcpb` (re-included in `.gitignore` Section 5). The plugin
   extracts it to `${CLAUDE_PLUGIN_DATA}` on first use via `mcp/launch.sh` and runs it over stdio;
   `.mcp.json` maps the plugin's `userConfig` to the server's env vars. After changing a server,
   rebuild it AND refresh the copy under the owning plugin's `mcp/` (see PLUGIN_INVENTORY.md), or the
   marketplace will ship a stale connector.
