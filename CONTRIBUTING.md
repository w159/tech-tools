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

- `node test-mcp-tools.mjs` probes every connector; `node test-mcp-tools.mjs <server>` probes
  one; `--list` prints the known names.
- The harness launches each connector exactly as `plugins/atlas/.mcp.json` declares it - the
  eleven Node connectors as `plugins/atlas/mcp/<name>/server.mjs` over MCP stdio, `falcon`
  through its `uv run --project plugins/atlas/mcp/falcon ...` entry - with placeholder
  credentials in a from-scratch child environment, so it needs no real
  credentials and cannot reach a live vendor appliance. Per connector it checks BOOT
  (`initialize` + `tools/list` answered), FLOOR (no tool-count regression below the baseline
  recorded in the file), AGREEMENT (a `DESTRUCTIVE:` / `VISIBLE-TO-OTHERS:` description must
  carry `readOnlyHint: false`, and no tool may omit `readOnlyHint`), and SHAPE (non-empty
  description, object `inputSchema`).
- A tool-count regression after a change is a bug - investigate before continuing. An
  intentional tool-surface change updates that connector's floor in the same commit.
- Every tool a connector can register must be reachable by the gate: a tool the harness never
  lists is a tool whose safety signals were never checked. Connectors that swap their listed
  surface behind a `<vendor>_navigate` step are walked domain by domain and unioned (`blumira`:
  2 cold + 30 across 5 domains), and `falcon`, which registers its domain modules only after an
  OAuth exchange, is probed against a loopback stub answering `POST /oauth2/token` and nothing
  else. Current run: 523 tools across 12 connectors, all fully enumerated, 0 gated, 0 skipped.
- `GATED` and `SKIP` are still real verdicts for a surface that cannot be enumerated (a missing
  `uv` or venv for falcon reports a named SKIP with the fix command). Neither is a clean pass
  and neither is a failure; if you add a connector that cannot be fully enumerated, say why in
  its COVERAGE entry instead of passing on a partial surface.
- Some servers ship their own deeper probe, e.g. `cd mcp_servers/panos-mcp && npm run
  test:boot`. Run it too when you touch that server.

## Quality bar

- Every tool has a one-line description that says what it returns and when to call it; destructive
  or externally-visible tools are prefixed `DESTRUCTIVE:` or `VISIBLE-TO-OTHERS:`, and the MCP
  annotations must agree with that prefix. The prefix alone is not enough: `readOnlyHint` is what
  a client reads to decide it may run a tool unattended. The full contract, including the four
  annotation classes and the fail-closed rule for an unclassified tool, is
  `docs/standards/connector-safety-signals.md`.
- Servers boot without crashing when credentials are missing; the `<vendor>_status` tool always
  runs and reports the missing-creds state.
- Vendor base-URL env vars are optional and default to the documented vendor URL.
- Plugins: folder name equals `plugin.json` `name`; skills have a `name` and a description that
  states what the skill does and when to use it, with concrete trigger phrases.

## Writing style

Documentation and prose use standard US-keyboard characters only - no em dashes, en dashes,
curly quotes, or unicode ellipsis. Be concise and specific.
