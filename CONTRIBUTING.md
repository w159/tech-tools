# Contributing

This repo is a monorepo of MCP servers, Node libraries, and Claude plugins for MSP, security/
compliance, and HR/payroll operations. Read `CLAUDE.md` and `AGENTS.md` before making changes -
they define the layout and the propagation rules that keep the layers in sync.

## Layout

- `mcp_servers/<svc>-mcp/` - MCP server source, built `dist/`, `manifest.json`, and the packed
  `<svc>-mcp.mcpb` bundle.
- `mcp_node/node-<svc>/` - Node libraries the servers depend on.
- `plugins/<name>/` - one folder per plugin, where the folder name equals the `plugin.json`
  `name`. Each plugin holds `.claude-plugin/plugin.json` plus `commands/`, `skills/`, and
  `agents/` as needed.
- `skills/` - standalone skills not tied to a single plugin.
- `plugins/_standards/` - the quality checklists every contribution is held to.

## Propagation rule

A change to a vendor capability must land consistently across every layer for that vendor:
node library, server domain handler, manifest (version bump), rebuilt `.mcpb`, plugin
commands/skills, plugin manifest, and the relevant README and `.env.template` entries. A change
that touches only one layer is incomplete. See `CLAUDE.md` for the full checklist.

## Building servers (iCloud-safe)

This repo lives under iCloud Drive. Do not run `npm install` inside the repo - `node_modules`
syncs continuously and corrupts. Stage builds in `/tmp`:

```
cp -r mcp_servers/<svc>-mcp /tmp/<svc>-build
cd /tmp/<svc>-build && npm install && npm run build && npm run pack:mcpb
```

Copy the resulting `.mcpb` and `dist/` back to the repo when done. The `dist/` directories are
committed so the test harness runs against a fresh clone without a build step.

## Testing

- `node test-mcp-tools.mjs` runs the full suite; `node test-mcp-tools.mjs <server>` runs a subset.
- The harness extracts the `.mcpb`, spawns it over stdio, lists tools, and calls a couple of safe
  tools. A tool-count regression after a change is a bug - investigate before continuing.

## Quality bar

- Every tool has a one-line description that says what it returns and when to call it; destructive
  or externally-visible tools are prefixed `DESTRUCTIVE:` or `VISIBLE-TO-OTHERS:`.
- Servers boot without crashing when credentials are missing; the `<vendor>_status` tool always
  runs and reports the missing-creds state.
- Vendor base-URL env vars are optional and default to the documented vendor URL.
- Plugins: folder name equals `plugin.json` `name`; skills have a `name` and a description that
  states what the skill does and when to use it, with concrete trigger phrases.

## Writing style

Documentation and prose use standard US-keyboard characters only - no em dashes, en dashes,
curly quotes, or unicode ellipsis. Be concise and specific.
