# Dashboard API & multi-session UI

Atlas ships a **single shared loopback dashboard** for all concurrent coding-agent terminals (same idea as claude-mem’s worker UI on `:37777` and Serena’s dashboard — but without opening a new browser tab on every session).

## Access

Default URL:

```text
http://127.0.0.1:7421/
```

- Open that URL **once** in your browser.
- Every Claude Code / coding-agent terminal that activates atlas shares the same page.
- Use the **Project** and **Session** dropdowns (or the left session list) to switch between concurrent runs.

### Auto-start

`session_boot.py` (SessionStart) runs:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_dashboard.py" ensure
```

and injects the URL into boot context. It does **not** auto-open a browser (avoids Serena-style focus stealing when many terminals start).

Disable with:

```bash
export ATLAS_DASHBOARD=off
```

### Manual

```bash
python3 plugins/atlas/scripts/atlas_dashboard.py ensure
python3 plugins/atlas/scripts/atlas_dashboard.py status
python3 plugins/atlas/scripts/atlas_dashboard.py stop
```

PID/log: `~/.atlas/dashboard.pid`, `~/.atlas/dashboard.log`.

## Multi-session model

| Concern | Behavior |
|---|---|
| Many terminals | One daemon, one port (`7421`) |
| Many projects | Project dropdown filters sessions by `projects.name` / root |
| Many sessions | Session list + dropdown keyed by `session_id` |
| Live run | **LIVE** only when tool/event activity exists in the last 10 minutes |
| Data source | Shared `~/.atlas/atlas.db` (runs, metrics, session_logs, tool_calls, findings, connectors) |
| Lists | Recent projects (14d, max 40) and sessions (7d, max 40); folder labels + age |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | SPA UI |
| GET | `/api/health` | liveness + URL |
| GET | `/api/status[?project_id=]` | full snapshot |
| GET | `/api/projects` | project list |
| GET | `/api/sessions[?project_id=]` | sessions across agents |
| GET | `/api/sessions/{id}` | session detail (tools, prompts, dispatches) |
| GET | `/api/connectors` | connector env coverage (no secrets) |
| GET | `/api/runs` | recent runs/metrics |
| GET | `/api/findings` | doctor findings |
| GET | `/api/behavior` | `ATLAS_*` knob groups + advanced list, with the file:line that reads each |
| GET | `/api/ecosystem` | installed plugins, MCP servers, atlas hook wiring, skills/agents/output styles |
| GET | `/api/connectors/export` | `.env` template, secrets blanked |
| POST | `/api/connectors/env` | allowlisted credential writes (pluginConfigs + `.env` + set-markers) |
| POST | `/api/connectors/import` | bulk `KEY=VALUE` paste, same allowlist |
| POST | `/api/connectors/test` | start the connector bundle and complete an MCP handshake |
| POST | `/api/behavior` | allowlisted `ATLAS_*` writes to `settings.json` `env` |
| POST | `/api/mcp/toggle` | enable/disable one server via `disabledMcpServers` |
| POST | `/api/mcp/add` / `/api/mcp/remove` | user-scope servers in `~/.claude.json` |
| POST | `/api/plugins/toggle` | `enabledPlugins` (atlas cannot disable itself) |

Binds loopback only. All read/write logic beyond sessions lives in
`scripts/atlas_control.py`; `atlas_dashboard.py` stays the HTTP + UI layer.

## UI surfaces

1. **Live metrics**: active orchestrating sessions, dispatches, inline ops, verifier coverage, est. tokens, open findings  
2. **Session switcher**: by project name + session id  
3. **Selected session**: task summary, agent/model, gate blocks, tool feed  
4. **Savings proxies**: dispatch/inline ratio, recall hit rate (not vendor invoices)  
5. **Connectors**: configured hint, missing env keys, editable non-secret values, per-connector enable and connection test, bulk import/export  
6. **Behavior**: the `ATLAS_*` knobs the hooks read, with the file:line that reads each  
7. **Ecosystem**: atlas hook wiring, installed plugins, MCP servers, skills and agents  
8. **Findings**: open self-improvement / doctor rows  

Tabs are deep-linkable: `/#overview`, `/#live`, `/#settings`, `/#behavior`,
`/#ecosystem`, `/#findings`.

## Security

- Loopback bind only  
- GET responses never echo secret values  
- POST `/api/connectors/env` only allowlists keys from `.env.example`  
- After env writes, reload plugins so MCP servers re-read credentials  


## Settings / Credentials (5.17.1+)
- Header **Credentials** button and tab **Settings / credentials**.
- POST body accepts userConfig keys or UPPER env keys:
  `{ "updates": { "auvik_api_key": "..." } }`.
- Writes, in order of importance:
  1. `~/.claude/settings.json` → `pluginConfigs["atlas@tech-tools"].options`
  2. this plugin root's `.env` (`CLAUDE_PLUGIN_ROOT/.env`)
  3. `~/.atlas/credential_marks.json` set-markers (no secret values)
- GET APIs never echo secrets (set/missing + source only).
- While typing, drafts are preserved; poll refresh does not rebuild the form.
- Reload Claude Code after saving so MCP servers re-read credentials.
- Full flow + E2E matrix: `references/connector-config-flow.md`.

## Behavior page (5.19.0+)

Tab **Behavior**, deep-linkable at `/#behavior`. Curated cards for the `ATLAS_*`
variables the hooks read, grouped as Session automation, Guardrails, Prompt
optimizer and Storage paths, plus an advanced table of every other `ATLAS_*` key
found in the shipped hooks and scripts.

- Each knob prints the `file:line` that reads it and the hook's own default, so a
  control that does nothing is visible rather than implied.
- Saves go to `~/.claude/settings.json` → `"env"`, which Claude Code exports into
  every hook subprocess. That is where the hooks actually read from; writing
  anywhere else would be a switch that does not switch.
- The allowlist is the curated list plus a scan of `hooks/` and `scripts/` for
  `ATLAS_*` names. Anything else is rejected by name, and one bad key rejects the
  whole batch.
- An empty value removes the override rather than writing an empty string.

`test_atlas_control.py` fails if a curated knob is not read by any shipped file.

## Ecosystem page (5.19.0+)

Tab **Ecosystem**, deep-linkable at `/#ecosystem`, with four panes:

| Pane | Shows | Writes |
|---|---|---|
| Atlas wiring | every `hooks.json` binding, its matcher and timeout, and whether the program exists on disk; plugin enabled state; whether hooks are globally disabled | none |
| Plugins | every installed plugin with marketplace, version, and a census of skills/agents/commands/MCP/hooks | `enabledPlugins` |
| MCP servers | plugin-provided servers (`plugin:<plugin>:<server>`) and user servers from `~/.claude.json`, with transport and command | `disabledMcpServers`, `~/.claude.json` `mcpServers` |
| Skills & agents | atlas skills, agents and output styles alongside the ones in `~/.claude` | none |

Atlas serves the page, so it refuses to disable itself; use
`claude plugin disable atlas` from a terminal instead.

## Connector operations (5.19.0+)

- Non-secret fields (base URL, region, tenant, platform) show their current value
  and are editable in place. Secrets stay write-only with a set/missing marker,
  and a save only sends fields that actually changed.
- **Test** starts the connector's own entry point (`mcp/<name>/server.mjs` under
  node, or the vendored Python project under `uv run`) with its resolved
  `${user_config.*}` environment and completes an MCP `initialize` +
  `tools/list`. It proves the connector runs and lists tools; vendor credentials
  are only proven by a live call to the connector's own `*_status` tool.
- A per-connector switch writes `disabledMcpServers`, leaving credentials intact.
- **Bulk import and export** round-trips a `.env` block. The export marks a set
  secret on its own comment line, never inline, so re-importing cannot write the
  marker text as the secret.

## Daemon DB pinning
- Dashboard serves `ATLAS_DASHBOARD_DB` or `~/.atlas/atlas.db` — never ambient pytest `ATLAS_DB`.
- `ensure` restarts the daemon if health/status reports a different `db_path`.
- Does **not** re-ingest transcripts on every poll (avoids locking hooks out of the DB).
