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
| POST | `/api/connectors/env` | allowlisted credential writes (pluginConfigs + `.env` + set-markers) |

Binds loopback only.

## UI surfaces

1. **Live metrics** — active orchestrating sessions, dispatches, inline ops, verifier coverage, est. tokens, open findings  
2. **Session switcher** — by project name + session id  
3. **Selected session** — task summary, agent/model, gate blocks, tool feed  
4. **Savings proxies** — dispatch/inline ratio, recall hit rate (not vendor invoices)  
5. **Connectors** — configured hint + missing env keys  
6. **Findings** — open self-improvement / doctor rows  

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

## Daemon DB pinning
- Dashboard serves `ATLAS_DASHBOARD_DB` or `~/.atlas/atlas.db` — never ambient pytest `ATLAS_DB`.
- `ensure` restarts the daemon if health/status reports a different `db_path`.
- Does **not** re-ingest transcripts on every poll (avoids locking hooks out of the DB).
