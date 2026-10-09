---
name: armada-connect
description: 'Provision a vendor MCP connector for a department: report which connectors are live, which are missing credentials, and the exact userConfig keys and /plugin config steps to enable one. Records status in the department config. Never collects credentials in chat.'
when_to_use: enabling a vendor connector for a department, or checking which connectors are live versus missing credentials
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
paths: [".atlas/departments/"]
argument-hint: '[vendor or department | blank for status]'
---

Connector: $ARGUMENTS

## Status first, always

Whether or not an argument was given, open with the real state. Detect it, do
not ask:

- **Live in this session**: the vendor's MCP tools are present as
  `mcp__plugin_atlas_<vendor>__*`. If the tools are callable, the connector is
  configured and authenticated enough to load.
- **Recorded**: `connectors:` entries in `.atlas/departments/*.yaml`.
- **Available but unprovisioned**: a `.mcp.json` exists under the department dir
  in the plugin tree but nothing is live.

```bash
ls "${CLAUDE_PLUGIN_ROOT}/skills/armada/departments"/*/.mcp.json 2>/dev/null
grep -l 'connectors:' .atlas/departments/*.yaml 2>/dev/null
```

Print one table: vendor, department, status (live / configured-not-loaded /
missing credentials / not provisioned), and the blocking userConfig keys for
anything not live.

## Where credentials live

Credentials are declared on the **atlas** plugin, not armada.
`plugins/armada/.claude-plugin/plugin.json` declares no `userConfig` and no
`mcpServers` by design. The per-vendor keys and their defaults are in
`${CLAUDE_PLUGIN_ROOT}/skills/armada/references/connector-provisioning.md`.

Collect them through `/plugin config` on the atlas plugin. Never accept a
credential pasted into chat, never write one into a yaml, never echo one back.
If a user pastes a secret, tell them to rotate it.

## Enabling one

1. Resolve the argument to a vendor (`ninjaone`, `vanta`, `cipp`, ...) or to a
   department, in which case handle each of that department's vendors in turn.
2. Read the required keys for that vendor from
   `references/connector-provisioning.md`. Do not invent key names.
3. Report the exact steps: which keys, set via `/plugin config` on atlas, then
   restart the session so the MCP server picks them up.
4. Once the tools are live, verify with the vendor's cheapest authenticated
   call (each connector exposes a `*_status` or `*_ping` tool). One call, not a
   sweep. A 400 or 401 means the server has stale credentials and needs a
   restart, not a retry against every endpoint.
5. Record the outcome in `.atlas/departments/<dept>.yaml`:

   ```yaml
   connectors:
     - vendor: ninjaone
       status: enabled          # enabled | disabled
       required_keys: [ninjaone_client_id, ninjaone_client_secret, ninjaone_region]
   ```

   Key names only. Never values.

## Base URLs

Every vendor has a documented default base URL. Set a `*_base_url` key only for
a staging or sovereign-cloud shard. Leaving it unset is correct for normal use.

## Verify before you report

- The status call ran and returned: paste its actual output.
- `cat .atlas/departments/<dept>.yaml` shows the recorded status.
- `grep -riE '(secret|token|key)["'"'"']?\s*[:=]\s*["'"'"']?[A-Za-z0-9_-]{16,}' .atlas/` returns
  nothing. A credential in `.atlas/` is a defect to fix now, not a note.

## Report

Per vendor: status, the verifying call and its output, and for anything still
blocked, the exact keys plus `/plugin config` step. If a connector could not be
verified in-session, say `UNVERIFIED - needs session restart` rather than
calling it enabled.
