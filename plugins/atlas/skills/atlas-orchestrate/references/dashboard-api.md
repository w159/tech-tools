# Dashboard API & Workboard v2

## Contents

- [Access](#access)
- [Request guard](#request-guard)
- [Static UI routes](#static-ui-routes)
- [Legacy routes (v1)](#legacy-routes-v1)
- [v2 routes](#v2-routes)
- [Live stream (SSE)](#live-stream-sse)
- [Pages](#pages)
- [Preferences file](#preferences-file)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Design system](#design-system)
- [Connector credentials](#connector-credentials)
- [Daemon and DB pinning](#daemon-and-db-pinning)

Atlas ships a **single shared loopback dashboard** ("Atlas Workboard") for all concurrent coding-agent terminals. One daemon serves one static single-page UI (`scripts/dashboard_ui/`) and one JSON API. Source of truth for every fact below: `scripts/atlas_dashboard.py` (HTTP layer, guard, SSE, legacy routes), `scripts/atlas_dash_work.py`, `scripts/atlas_dash_irc.py`, `scripts/atlas_dash_herd.py` and `scripts/atlas_dash_insights.py` (v2 `ROUTES` tables), `scripts/dashboard_ui/js/` (client). Remote access never opens this port: the vendored herdr web UI proxies it same-origin at `/atlas/**` (see [Same-origin gateway](#same-origin-gateway-atlas-on-the-herdr-web-ui)).

The old single-file inline-HTML page (`UI_HTML`) no longer exists. The UI is the static bundle under `scripts/dashboard_ui/`, served from `/` and `/ui/*`. See `docs/atlas-workboard.md` in the repository for the product overview.

## Access

Default URL (port from `ATLAS_DASHBOARD_PORT`, default `7421`):

```text
http://127.0.0.1:7421/
```

- Open it **once**. Every terminal that activates atlas shares the same page.
- `session_boot.py` (SessionStart) runs `atlas_dashboard.py ensure` and injects the URL into boot context. It does **not** open a browser.
- Disable auto-start with `export ATLAS_DASHBOARD=off`.

```bash
python3 plugins/atlas/scripts/atlas_dashboard.py ensure   # start if needed, print result JSON
python3 plugins/atlas/scripts/atlas_dashboard.py status   # snapshot JSON to stdout
python3 plugins/atlas/scripts/atlas_dashboard.py url      # print URL if the port is open
python3 plugins/atlas/scripts/atlas_dashboard.py stop
python3 plugins/atlas/scripts/atlas_dashboard.py serve [--port N] [--host H] [--foreground] [--allow-remote]
```

`serve` refuses a non-loopback `--host` unless `--allow-remote` is passed. PID/log: `~/.atlas/dashboard.pid`, `~/.atlas/dashboard.log`.

## Request guard

Every route and every method passes `Handler._guard` first. Order and failure codes:

| # | Check | Applies to | Failure |
|---|---|---|---|
| 1 | `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` | all | `403 bad_host` |
| 2 | `Content-Type` must be `application/json` (charset suffix ignored) | every method except `GET`/`HEAD` | `415 unsupported_media_type` |
| 3 | If an `Origin` header is present it must be `http://127.0.0.1:<port>` or `http://localhost:<port>` | all | `403 bad_origin` |
| 4 | `X-Atlas-Token` must equal the per-daemon secret (constant-time compare) | every mutation (`POST`/`PUT`), `/api/v2/stream`, and the sensitive GETs below | `401 bad_token` |

- `/api/health` and `/health` are **Host-checked only** (no token) so hooks and `ensure` probes keep working.
- **Sensitive GETs** that require the token (regex `_SENSITIVE_GET`): `/api/v2/stream`, `/api/v2/irc`, `/api/v2/<segment>/transcript`, and `/api/sessions/<id>/transcript`. The herd GETs (`/api/v2/herd*`) carry no token: they expose no agent session paths and no pane output.
- **Token source:** `DASH_TOKEN = secrets.token_urlsafe(32)`, regenerated every daemon start. The server substitutes it into `index.html` (placeholder `__ATLAS_TOKEN__` in `<meta name="atlas-token" content="...">`; if the placeholder is missing it injects the tag after `<head>`). The client sends it as the `X-Atlas-Token` header on every request. `EventSource` cannot set headers, so `/api/v2/stream` alone also accepts `?token=<token>`.
- A `401 bad_token` means the page predates the daemon: reload the dashboard to get a fresh token.
- `OPTIONS` returns `204` with `Allow: GET, HEAD, POST, PUT` and **no** CORS headers, so cross-origin pages are blocked by the browser.
- Mutating bodies must be a JSON object, at most 4 MiB (`413 body_too_large`), else `400 invalid_json` / `400 bad_length`.
- Error envelope for guard and v2 failures: `{"ok": false, "error": "<code>", "why": "<reason>", "do": "<next step>"}`. v2 success bodies from mutations carry `ok: true` plus `state` (refreshed counts or board) and `next` (human hint).
- Static responses carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Loopback bind only. GET responses never echo secret values.

## Static UI routes

| Method | Path | Behavior |
|---|---|---|
| GET, HEAD | `/`, `/index.html`, `/dashboard`, `/dashboard/` | `dashboard_ui/index.html` with the token injected. `404 ui_missing` if the bundle is absent. |
| GET, HEAD | `/ui/<path>` | Static file under `dashboard_ui/`. Rejects `..`, dotfiles, backslashes, NUL, and symlink escape. MIME from a fixed table (`.html .css .js .mjs .json .svg .png .jpg .jpeg .ico .woff2 .txt .map`). |
| GET | `/assets/mark.svg`, `/assets/logo.svg` | Inline brand mark SVG. |
| GET | `/assets/hero.jpg`, `/assets/hero.png` | Marketplace `img/` hero if present (under 3.5 MB), else generated SVG placeholder. |

## Legacy routes (v1)

These live in `Handler._legacy_get` / `Handler._legacy_post`, are dispatched **after** the v2 table, and keep their original shapes. Query param `project_id` is the numeric `projects.id`. Logic beyond sessions lives in `scripts/atlas_control.py`.

### GET

| Path | Purpose | Response keys |
|---|---|---|
| `/api/health`, `/health` | liveness (no token) | `ok, service, url, pid, db_path, script, version, time` |
| `/api/status[?project_id=]` | full snapshot | `snapshot()` payload |
| `/api/projects` | project list | `ok, projects` |
| `/api/sessions[?project_id=&limit=]` | sessions across agents (default limit 40) | `ok, sessions` |
| `/api/sessions/{id}` | session detail (tools, prompts, dispatches) | `ok, session, ...` ; `404 session_not_found` |
| `/api/connectors` | connector env coverage, no secrets | `ok, connectors, user_config, settings_path` |
| `/api/connectors/export` | `.env` template, secrets blanked | `ok, text, env_path` |
| `/api/behavior` | `ATLAS_*` knob groups + advanced list; each knob and `ATLAS_*` var shows value, source (process > store > claude settings > default), reached harnesses, default, `file:line` ref and last-changed | `ok, ...behavior_state()` |
| `/api/ecosystem` | installed plugins, MCP servers, atlas hook wiring, skills/agents/output styles | `ok, ...ecosystem_inventory()` |
| `/api/findings` | doctor findings | `ok, findings` |
| `/api/runs[?limit=&project_id=]` | recent runs / run health (default limit 20) | `ok, health` |
| `/api/todo?project_id=` | durable todo board `<project>/.atlas/.run/todos.json` | board payload; `400 unknown_project` |
| `/api/agents?project_id=` | agent roster: plugin agents plus same-name overrides in `<project>/.claude/agents/`; without `project_id` it returns the plugin roster (the UI shows it when no projects are registered) | roster payload; `400 unknown_project` |
| `/api/sessions/<id>/transcript`, `/api/v2/<id>/transcript` | the session's durable transcript (the original recorded file, see `ATLAS_SOURCE_TRANSCRIPT`) | transcript payload |
| `/api/agents/{name}?project_id=` | one agent's effective body (override wins) | content payload |
| `/api/memory` | shared memory snapshot from `~/.atlas/memory/` | `ok, ...load_snapshot()` |

### POST (legacy)

| Path | Body | Behavior |
|---|---|---|
| `/api/connectors/env` | `{"updates": {key: value}}` | allowlisted credential writes (userConfig keys or UPPER env keys); `400 updates_required` |
| `/api/connectors/import` | `{"text": "KEY=VALUE\n..."}` | bulk `.env` paste, same allowlist; `400 no_assignments_found` |
| `/api/connectors/test` | `{"name": "<connector>"}` | start the connector bundle and complete an MCP handshake |
| `/api/behavior` | `{"updates": {ATLAS_KEY: value}}` | allowlisted writes to the atlas settings store `<ATLAS_HOME or ~/.atlas>/settings.json` (`{env, changed}`, atomic, 0600) and Claude `settings.json` `env`; the omp hook bridge exports the store into hook env; empty value removes the override; one bad key rejects the batch; advanced vars are editable; survives a daemon restart |
| `/api/mcp/toggle` | `{"name", "enabled"}` | enable/disable one server via `disabledMcpServers` |
| `/api/mcp/add` | server config object | user-scope server in `~/.claude.json` |
| `/api/mcp/remove` | `{"name"}` | remove a user-scope server |
| `/api/plugins/toggle` | `{"key", "enabled"}` | `enabledPlugins` (atlas cannot disable itself) |
| `/api/todo` | `{"project_id", "action", "id", ...}` | `action` in `add` (origin `manual`, never blocks the gate), `claim` (`owner`, `force`), `complete` (`owner`, `evidence`), `reopen`, `remove`; else `{"ok": false, "error": "unknown_action"}` |
| `/api/agents` | `{"project_id", "action", "name", "content"}` | `action` in `save` (writes `<project>/.claude/agents/<name>.md`, frontmatter required, safe names only) or `reset` (deletes the override) |

Unmatched paths return `404 {"ok": false, "error": "not_found", "path": ...}`. There is no legacy `PUT`.

## v2 routes

Modules are mounted by `_mount_v2_routes()` at import time. Each exposes `ROUTES = [(method, regex, handler)]`; the regex is matched with `fullmatch`. A module that fails to import is skipped and recorded in `V2_MOUNT_ERRORS`; it never stops the server. A handler exception becomes `500 {ok:false, error, why:"the route raised an exception", do:"check dashboard.log"}`.

Common query param `project`: omitted or `all` means every project; otherwise a numeric project id or an absolute project root path. Handlers receive a `ctx` (`.query`, `.json()`, `.groups`, `.db()`, `.project_root(param)`).

Counts: `atlas_dash_work.ROUTES` = 2, `atlas_dash_irc.ROUTES` = 2, `atlas_dash_herd.ROUTES` = 8, `atlas_dash_insights.ROUTES` = 9, plus `/api/v2/stream` handled directly by `Handler.do_GET` = **22 v2 routes**. The tmux-era colony routes and the module that served them are gone: todos and IRC live in `atlas_dash_work.py` and `atlas_dash_irc.py`, and the colony is served by the herd routes below.

### Todos (`atlas_dash_work.py`) and IRC (`atlas_dash_irc.py`), regex unanchored in source

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/v2/irc` * | `?project=&since=&agent=&limit=200` (limit clamped 1-1000) | `{messages:[Message], agents[], channels[], more}`. `since` is a message id (`m...`) or an epoch; with it the OLDEST `limit` messages after it come back and `more` says newer ones remain |
| POST | `/api/v2/irc` | `{project (required), to ("all" or agent), body, from ("human")}` | `{ok, delivered, message, next}`. A message to a named agent whose idle interactive `claude`/`omp` herdr pane is found (by pane id, tab title or workspace label) is typed into it through `atlas_herdr.send_prompt` and the note is stamped `delivery=delivered`. A pane that runs anything else is **`409 pane_not_steerable`** (`{ok:false, error, why, do, message, delivered:false}`, note stamped `refused`, nothing typed); a busy or unreachable pane answers `409 agent_busy` or the herdr status (`herdr_refused`) with the note still recorded and `queued`. The message is always recorded on the board. `400 unknown_project`/`body_required`/`invalid_to` |
| GET | `/api/v2/todos` | `?project=` (required) | `TodosState` (below). `400 unknown_project` |
| POST | `/api/v2/todos` | `{project, op, id?, ...}` | `{ok, state: TodosState, next: "<op> applied"}`. `op` in `add, update, status, remove, claim, assign, move, reorder`. Errors: `404 not_found`, `409 claimed_by_other / not_claim_owner / already_completed`, `400` otherwise, `500 todo_write_failed` |

\* token required (sensitive GET).

Todo op fields: `add` (`content`, `phase?`, `owner?`); `update` (`content?`, `phase?`, `owner?`); `status` (`status` in `open|in_progress|done|blocked`, `evidence?`); `claim` (`owner`, `force?`); `assign` (`owner`); `move` (`phase`); `reorder` (`phase`, `ids[]` of existing items in that phase); `remove`.

Shapes:

- **Message**: `{id, ts, from, to, body, kind: irc|note|exit|system, status: queued|read|delivered|refused|undeliverable, tracked, run, project, channel ("all" or "@<agent>")}`. `status` is only meaningful for a `human` message to a named agent: `queued` = on the board, waiting for the worker's PostToolUse hook (`hooks/worker_inbox.py`) to drain it; `read` = the hook drained it; `delivered` = the dashboard typed it into an idle interactive herdr pane; `refused` = the pane was not steerable, nothing was typed; `undeliverable` = still `queued` after 900 s. `delivered` and `refused` are terminal and persisted on the note, so the hook never injects a delivered message a second time.
- **TodosState**: `{project, phases:[{name, items:[{id, content, status: open|in_progress|done|blocked, phase, owner, claimed_by, updated, origin, evidence}]}], counts:{open,in_progress,done,blocked}, updated}`.

### Herd / Colony (`atlas_dash_herd.py`, anchored regexes)

The colony is herdr: the installed `herdr` binary plus the one vendored `herdr-web-ui` build (`colony/herdr-web-ui`; `http://127.0.0.1:7317` when that port is free, otherwise a fallback port, reported as `colony_url` and `url` in the status). These routes read herdr over its unix socket (`HERDR_SOCKET_PATH`) and never spawn herdr itself. GETs carry no token and never expose agent session paths, except the peek routes (terminal output), which need `X-Atlas-Token`; every POST needs `X-Atlas-Token` through the central guard.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/v2/herd`, `/api/v2/herd/status` | none | `{ok, running, healthy, state: ok\|server_down\|web_ui_down, herdr_server, herdr_version, herdr_protocol, auth_required, url, colony_url (the colony web UI base URL the Colony page and the inspector Terminal tab frame), pids[], duplicates (extra managed.ts instances), upstream_plugin_on_port, upstream_url? and takeover[]? (only while an upstream herdr-web-ui holds the configured port), installed, plugin_root}` (`atlas_herdr.status()`, cached 2 s) |
| GET | `/api/v2/herd/agents` | none | Always HTTP 200: `{ok, herdr:{reachable, reason}, web_ui:{healthy, url, auth_required}, counts:{working,blocked,idle,done,unknown}, workspaces[], agents:[{pane_id, workspace_id, workspace, tab_id, agent, status, cwd, title, focused, state_change_seq, completion_seq, deep_link}], fetched_ms}` |
| GET | `/api/v2/herd/colony` | none | `{ok, ...status, panes:[{pane_id, workspace_id, workspace, tab_id, label}], panes_error?}`. `panes` lists the colony's own panes (workspaces labelled `atlas-<run>`) |
| POST | `/api/v2/herd/agents/<pane>/prompt` | `{text}` (at most 8000 chars) | `{ok, pane_id, result}`. Only an idle agent accepts it: `400` missing/too-long text, `404` no such pane, `409` agent not idle, `502` herdr rejected it, `503` herdr server unreachable. Body on failure: `{ok:false, error, why}` |
| POST | `/api/v2/herd/ensure` | `{}` | `{ok, action: reused\|waited\|started\|unavailable, url, why?, do?}`. HTTP 200 on success, 503 when herdr is not running, the plugin is not installed or the web UI did not come up |
| POST | `/api/v2/herd/panes` | `{name, prompt, project, harness?: omp\|claude (default omp), run? (default "work")}` | Opens one worker pane through `atlas_launch.launch` (so the env pins and prompt file are the ones every launch gets); the body never carries a command. `200` with the launch result, `502` when the launch failed, `400` for a missing `name`/`prompt`, a bad `harness` or an unknown project |
| POST | `/api/v2/herd/panes/<pane>/kill` | `{}` | Closes one colony pane: `200 {ok:true, pane_id}`. An id that is not a colony pane, or a herdr socket failure, answers `404 {ok:false, reason}` |
| GET | `/api/v2/herd/agents/<pane>/peek`, `/api/v2/agents/<id>/peek` | `?lines=N` (bounded) | Token-guarded. Recent pane text, ANSI/control characters stripped and secrets masked. The `agents/<id>` form resolves a pane id, worker name or title to a live pane (`404 no live pane for that agent`, `503` herdr unreachable) |
| GET | `/api/v2/agents` | `?project=` | The unified `AgentRecord` list the Fleet lens renders (see `scripts/dashboard_ui/design/API.md`) |
| POST | `/api/v2/agents/<id>/prompt` | `{text}` | Like `herd/agents/<pane>/prompt` but resolved by pane id, worker name or title; a pane that is not an interactive `claude`/`omp` session answers `409 pane_not_steerable` |
| GET | `/api/v2/herd/console` | none | Where the Command Center frames the herdr UI: `{ok, url, chrome_full_url (<url>/?chrome=full), herdr_ui_url (<url>/herdr), pane_url_template (<url>/?pane={pane_id}&machine=local&chrome=pane&theme={theme}), reachable, auth_required, layers:{atlas, herdr_socket, herdr_web_ui}}`; the url fields are `null` when no colony URL is known |

### Front door and the herdr embeds

The Atlas dashboard is the shell and herdr-web-ui is framed by two of its surfaces. The dashboard itself stays on loopback; the vendored herdr-web-ui Bun server (the only listener `atlas_remote.py` maps through `tailscale serve`) is the front door and, after its own access decision, does two things (`colony/herdr-web-ui/server/atlas-landing.ts`, `server/atlas-gateway.ts`):

- `GET`/`HEAD /` for a plain browser navigation (`Accept: text/html`, `Sec-Fetch-Dest` absent or `document`, no `embed`, `pane`, `machine` or `chrome` query, full access) answers `302 /atlas/#/herd` (the Command Center maps `#/herd` to the Colony page, `#/colony`). A request with a `chrome`, `embed`, `pane` or `machine` query, and non-browser requests, get the herdr-web-ui SPA; `ATLAS_LANDING=off` disables the redirect.
- `/atlas/**` is proxied same-origin to the dashboard (`ATLAS_DASHBOARD_URL`, loopback only, default `http://127.0.0.1:7421`): `Host` and `Origin` are rewritten, the per-daemon `X-Atlas-Token` is attached and the browser's herdr-web-ui credentials are never forwarded. The gateway injects `<meta name="atlas-base" content="/atlas">`, which `js/api.js` honours so the UI's `/api/v2/*` calls and the SSE stream go through the prefix. A dashboard that is down answers `502 {"ok":false,"error":"atlas_dashboard_unreachable"}` (an HTML page for a navigation).

There are no herd or irc page modules. The **Colony** page (`js/pages/herdr.js`, `#/colony[?pane=<id>]`) reads the shared agents store (`herd/agents` `web_ui.url`, `herd/colony`, `herd/agents`, `todos`, `irc`; `js/agents-store.js`) and frames `<web_ui.url>/?chrome=full&theme=<t>` edge to edge (`consoleUrl` in `js/fleet.js`; `&pane=<id>&machine=local` when a pane is given). The page is only that iframe: no header, lens bar or second view. A recovery card replaces the frame when herdr or its web UI is down: "herdr isn't running" with **Recheck**, or "The terminal service isn't running. The agent list is live; terminals need it." with **Start terminal service** (`herd/ensure`) and **Recheck**. `GET /api/v2/herd/console` returns the same frame URLs for other clients; no dashboard page calls it. The Fleet inspector's Terminal tab frames `/?pane=<id>&machine=local&chrome=pane&theme=<t>` (`paneUrl`), and its "Open in Colony" button goes to `#/colony?pane=<id>`. Under `/atlas/` (`<meta name="atlas-base">`) both frames use the page origin; direct mode uses the colony URL. The herdr host rewrites the legacy `?embed=1` to `chrome=pane` (with `pane=`) or `chrome=full`. The frame is not built when the dashboard is itself framed (the page then says "Colony cannot open inside itself").


### Insights and prefs (`atlas_dash_insights.py`, anchored regexes)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/v2/projects` | none | `{projects:[{root, name, last_active, runs_7d, agents_active, todos:{open,done}, health: ok\|warn\|fail\|idle, failures_7d, findings_open}], findings_open}`. Only projects with runs in 7 days; max 500 |
| GET | `/api/v2/overview` | `?project=&window=7d` (`<n>h\|d\|w`) | `{kpis:[{id,label,value,delta,status,hint}], attention:[{id,severity,project,title,detail,count,first,last,action:{label,target}}], recent_runs[], trend}`. KPI ids: `runs, dispatches, silent_failures, findings_open`, plus `todos_blocked` when a project is selected |
| GET | `/api/v2/health` | `?project=&window=7d` | `{subsystems:[{id,label,status,detail,last_ok,last_fail,evidence[]}], silent_failures[], successes[]}`. Subsystem ids: `hooks, mux, dashboard, db, connectors, doctor, chronicle` |
| GET | `/api/v2/activity` | `?project=&since=<epoch\|ISO>&kind=&group=project\|kind\|agent&q=&limit=200` | `{groups:[{key,label,count,last,items:[{id,ts,kind,project,agent,title,detail,status,count,ref:{table,id}}]}]}`. Duplicates collapse unless `noise.collapse_duplicates` is false. `400 bad group` |
| GET | `/api/v2/improve` | `?project=` | `{loop:{stages:[observe,mine,propose,apply,remeasure]}, findings[], ledger[], nudges, lessons, scores:{labels,series}, by_rule[]}`. Finding ids are `doctor:<n>` or `ledger:<id>` |
| POST | `/api/v2/improve/finding` | `{id: "doctor:<n>", status: open\|accepted\|fixed\|dismissed\|wontfix, note?}` | `{ok, state:{id,status,db_status,note}, next}`. Only doctor findings are settable; ledger entries are append-only (`400 unsupported finding`). `404 no such finding`, `503 findings store unavailable` |
| POST | `/api/v2/improve/remeasure` | `{id: "doctor:<n>"}` (`?project=` optional) | `{ok, state:{id,current,resolved}, next}`. `422 cannot measure`, `503 doctor unavailable` |
| GET | `/api/v2/prefs` | none | the prefs object (see [Preferences file](#preferences-file)) |
| PUT | `/api/v2/prefs` | partial prefs object | `{ok, state, prefs, next}`; `400 invalid prefs` on unknown key or bad value, `500` when the file cannot be written |

### Stream

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/v2/stream` * | `text/event-stream`, `?project=` optional, `?token=` accepted here only. See [Live stream](#live-stream-sse) |

### Route inventory (all routes, one line each)

`atlas_dash_work.ROUTES` (2): `GET /api/v2/todos`, `POST /api/v2/todos`.

`atlas_dash_irc.ROUTES` (5): `GET /api/v2/irc`, `POST /api/v2/irc`, `GET /api/v2/channels`, `POST /api/v2/channels`, `GET /api/v2/channels/<name>`.

`atlas_dash_herd.ROUTES` (13): `GET /api/v2/herd`, `GET /api/v2/herd/status`, `GET /api/v2/herd/agents`, `GET /api/v2/herd/agents/<pane>/peek`, `GET /api/v2/herd/colony`, `POST /api/v2/herd/agents/<pane>/prompt`, `POST /api/v2/herd/ensure`, `POST /api/v2/herd/panes`, `POST /api/v2/herd/panes/<pane>/kill`, `GET /api/v2/herd/console`, `GET /api/v2/agents`, `GET /api/v2/agents/<id>/peek`, `POST /api/v2/agents/<id>/prompt`.

`atlas_dash_insights.ROUTES` (9): `GET /api/v2/projects`, `GET /api/v2/overview`, `GET /api/v2/health`, `GET /api/v2/activity`, `GET /api/v2/improve`, `POST /api/v2/improve/finding`, `POST /api/v2/improve/remeasure`, `GET /api/v2/prefs`, `PUT /api/v2/prefs`.

`atlas_dashboard.Handler` direct (1 v2 + 18 legacy + static): `GET /api/v2/stream`; legacy GET `/api/health`, `/health`, `/api/status`, `/api/projects`, `/api/sessions`, `/api/sessions/{id}`, `/api/connectors`, `/api/connectors/export`, `/api/behavior`, `/api/ecosystem`, `/api/findings`, `/api/runs`, `/api/todo`, `/api/agents`, `/api/agents/{name}`, `/api/memory`; legacy POST `/api/connectors/env`, `/api/connectors/import`, `/api/connectors/test`, `/api/behavior`, `/api/mcp/toggle`, `/api/mcp/add`, `/api/mcp/remove`, `/api/plugins/toggle`, `/api/todo`, `/api/agents`.

## Live stream (SSE)

`GET /api/v2/stream[?project=<root|id>][&token=<token>]` keeps one connection per browser and replaces the old fixed-interval polling as the primary update path.

- Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`, `Connection: close`, `X-Accel-Buffering: no`.
- First frame: `retry: 3000` (the browser reconnects after 3 s).
- Every **5 s** (`SSE_TICK_S`) the server re-runs six topic routes in-process (`SSE_TOPICS`: `herd`, `agents`, `todos`, `irc`, `health`, `improve`) and emits a topic **only when its snapshot hash changed** (SHA-256 of the sorted JSON):

| Event name | Source route | Data |
|---|---|---|
| `herd` | `GET /api/v2/herd/agents` | the live herdr agents snapshot |
| `agents` | `GET /api/v2/agents` | the unified `AgentRecord` list (Fleet lens) |
| `todos` | `GET /api/v2/todos` | the `TodosState` |
| `irc` | `GET /api/v2/irc` | the IRC payload |
| `health` | `GET /api/v2/health` | the health payload |
| `improve` | `GET /api/v2/improve` | the improve payload (loop stages, findings, ledger, by-rule, improvements, scores); the Improve page re-renders only when `data.findings` is present |
| `tick` | (always) | `{"ts": <epoch seconds>}` every cycle |

- A `: heartbeat` comment line is written every **15 s** (`SSE_HEARTBEAT_S`) to keep proxies and the socket alive.
- Frames are `event: <name>\ndata: <compact JSON>\n\n`. Topics whose route returns non-200 are skipped for that cycle.
- The `project` query param is forwarded to the topic routes; `/api/v2/todos` therefore only emits when a project resolves.

**Client fallback** (`js/api.js`): if `EventSource` is unavailable, or after two consecutive errors, the client switches to **polling every 8 s** (`pollMs`, default 8000) and shows "Polling every 8s" in the topbar; it keeps retrying SSE (reopen after 5 s when the source closes) and returns to "Live" on the next `open`. Polling is the degraded mode, not the normal one. Pages receive `onEvent(name, data, ctx)`; a `health` event also refreshes the attention badge (debounced 1.5 s).

## Pages

Hash-routed single page (`#/<page>[#anchor][?k=v]`, plus `?lens=<lens>`), default `#/overview`. Page modules are `js/pages/<id>.js` (`agents`, `activity`, `health`, `improve`, `projects`, `settings`; `overview` is built in; `work.js` is the Board lens content; the `colony` page id is served by `js/pages/herdr.js`). There are no `herd`, `work` or `irc` page modules: `herd`, `herdr` and `console` are `ALIASES` in `js/app.js` that redirect to `colony`, `work` and `irc` redirect to `agents?lens=board|channel`, and `#/agents?lens=colony` (or `lens=console`) redirects to `colony`, keeping the query. A route with no module renders "This page is not available in this build.":

| Group | Page id | Label | Reads | Writes |
|---|---|---|---|---|
| Observe | `overview` | Overview | `overview` (7d), attention list | none |
| Observe | `activity` | Activity | `/api/v2/activity` | `PUT prefs` (saved views, filters) |
| Observe | `health` | Health | `/api/v2/health` | none |
| Operate | `agents` (lens `fleet`, default) | Fleet | `herd/agents`, `agents`, `herd/colony`, `todos`, `irc`, `channels`, `projects` (shared store) | `POST herd/agents/<pane>/prompt`, `herd/panes/<pane>/kill`, `herd/ensure`; the inspector's Terminal tab frames `/?pane=<id>&machine=local&chrome=pane&theme=<t>` |
| Operate | `agents` (lens `board`) | Board | `todos` | `POST todos` (all ops) |
| Operate | `agents` (lens `channel`) | Channel | `channels`, `channels/<name>`, `irc` | `POST channels` |
| Operate | `colony` | Colony (one page: the herdr-web-ui frame edge to edge; the legacy `herd`, `herdr`, `console` ids and `agents?lens=colony` redirect here; on mobile one `Colony` entry in the More menu) | `herd/agents` (`web_ui.url`), `herd/colony`; frames `<web_ui.url>/?chrome=full&theme=<t>` | `herd/ensure` (**Start terminal service** in the web-UI-down card) |
| Improve | `improve` | Self-improvement | `/api/v2/improve` | `improve/finding`, `improve/remeasure` |
| Configure | `projects` | Projects | `/api/v2/projects` | `PUT prefs` (pinned/hidden projects) |
| Configure | `settings` | Settings | `prefs`, `projects`, legacy `/api/behavior`, `/api/ecosystem`, `/api/connectors`, `/api/projects`, `/api/agents`, `/api/agents/{name}` | `PUT prefs`; legacy `POST /api/behavior`, `/api/plugins/toggle`, `/api/mcp/toggle`, `/api/connectors/env`, `/api/connectors/test`, `/api/agents` |

Chrome: project switcher (persists `default_project`), connection indicator (`Live` / `Polling every 8s`), attention badge ("N need attention" or "All clear", severity from the overview `attention` list, click opens `overview#attention`), theme and density toggles, command palette, toasts, drawer, modal. Behavior, Ecosystem, connectors (credential entry, test, enable), and the Agents override editor are sections of **Settings**; see [Connector credentials](#connector-credentials).

## Preferences file

`~/.atlas/dashboard-prefs.json` (`$ATLAS_HOME/dashboard-prefs.json` when `ATLAS_HOME` is set). Written atomically (temp file + replace in the same directory). A missing or corrupt file falls back to defaults.

| Key | Default | Rule |
|---|---|---|
| `theme` | `"dark"` | `dark`, `light`, `system` |
| `density` | `"comfortable"` | `comfortable`, `compact` |
| `default_project` | `"all"` | `"all"` or an absolute project root |
| `pinned_projects`, `hidden_projects`, `muted_kinds`, `muted_projects`, `nav_order` | `[]` | list of up to 200 unique non-empty strings (each up to 1024 chars) |
| `saved_views` | `[]` | up to 50 of `{id, name (1-80), page (^[a-z][a-z0-9_-]{0,31}$), params{}}` |
| `refresh_seconds` | `8` | integer 2-3600 by the API (the Settings field limits input to 2-300) |
| `noise` | `{collapse_duplicates: true, min_severity: "info"}` | `min_severity` in `info`, `warn`, `fail` |

Unknown keys and invalid values are rejected with `400 invalid prefs`. The browser also mirrors `theme`, `density`, and `default_project` in `localStorage["atlas.dashboard.prefs"]` so the first paint is correct before the API answers.

## Keyboard shortcuts

Ignored while typing in an input, textarea, select, or contenteditable (the typing guard of the UI); `Ctrl/Cmd+K` and `Esc` always work.

| Keys | Action |
|---|---|
| `Ctrl/Cmd + K` | Command palette |
| `/` | Focus the page search field, else open the palette |
| `g` then `o` / `a` / `l` / `h` / `i` / `p` / `,` | Overview / Agents / Activity / Health / Improve / Projects / Settings |
| `g` then `d` / `s` / `w` / `c` / `n` / `x` | Agents / Improve / Board lens / Colony / Channel lens / Colony (`x` is a second chord for the same page) (chord window 1.5 s) |
| `Esc` | Close palette, then modal, then drawer |
| `?` | Shortcut list |

## Design system

`dashboard_ui/css/tokens.css` is binding for every page module (dark first; light via `[data-theme="light"]`; also follows `prefers-color-scheme`; density via `[data-density]`; durations drop to 0 under `prefers-reduced-motion`). `theme-boot.js` applies the stored theme before paint.

| Group | Tokens |
|---|---|
| Surface | `--bg --surface-1 --surface-2 --surface-3 --border --border-strong --overlay --shadow` |
| Text and accent | `--text --text-dim --accent --accent-ink --focus` |
| Status | `--ok --warn --fail --info --working --idle` |
| Spacing (4 px scale) | `--s-1 --s-2 --s-3 --s-4 --s-5 --s-6 --s-8 --s-10` |
| Radius | `--r-1 6px --r-2 10px --r-3 14px` |
| Type | `--font-sans --font-mono --fs-xs --fs-sm --fs-base --fs-lg --fs-xl --fs-kpi --lh` |
| Layout | `--sidebar-w 224px --topbar-h 48px --content-max 1320px` |
| Density-controlled | `--pad-card --pad-row --gap --ctl-h` (compact tightens all four) |
| Motion | `--dur-fast --dur --ease` |

Dark values: `--bg #0e1213`, `--accent #2fbd9f`, `--ok #3fb950`, `--warn #e0823c`, `--fail #f8514f`, `--info #a690f7`, `--working #f2c14e`, `--idle #7d8c94`.

Stylesheets: `tokens.css`, `base.css`, `components.css`, `pages.css`, `pages-insights.css`.

Components (`js/components.js`): `StatusDot`, `Badge`, `Card`, `Kpi`, `Table`, `Tabs`, `Drawer` (`openDrawer`, `closeDrawer`, `hasOpenDrawer`), `Modal` (`openModal`, `closeModal`, `hasOpenModal`), `confirm`, `toast`, `toastError`, `EmptyState`, `CommandBlock`, `Sparkline`, `LineChart`, `BarChart`, `Timeline`, `Terminal`, `LogView`, `FilterBar`, and the helper `stripAnsi`. DOM helpers (`js/dom.js`): `h`, `s`, `icon`, `iconNames`, `clear`, `debounce`, `fmtDuration`, `fmtRelative`, `fmtTime`, `fmtNumber`, `normStatus`, `statusLabel`. The API client (`js/api.js`) exports `api` (`get`, `post`, `put`, `stream`, `hasToken`, `mode`) and `ApiError`.

## Connector credentials

The credential and agent-override APIs below are unchanged and still enforced by the guard (Content-Type, Origin, token). The v2 Settings page uses them directly through `api.post`, so the `X-Atlas-Token` header is carried automatically:

- **Credential form** (per connector): secret keys render as `type="password"` inputs and are never pre-filled. The page shows only `set` / `missing` (plus the source) for a saved key, never the value, and sends only the fields you changed to `POST /api/connectors/env`. Unsaved edits trigger a dirty-draft guard (prompt on reload/close and when leaving Settings through the sidebar). **Test** calls `/api/connectors/test`; the enable switch calls `/api/mcp/toggle`.
- **Agents editor**: pick a registered project and an agent; **Save override** and **Reset** call `POST /api/agents` (`action` `save`/`reset`). The legacy agent routes take the numeric `projects.id` from `GET /api/projects`, not the v2 root path.
- The same routes stay callable directly (the caller must hold the token from the served page) and `/plugin config` still works.
- `POST /api/connectors/env` body `{"updates": {"auvik_api_key": "..."}}` (userConfig keys or UPPER env keys). Writes, in order: `~/.claude/settings.json` `pluginConfigs["atlas@tech-tools"].options`; this plugin root's `.env`; `~/.atlas/credential_marks.json` set-markers (key names and timestamps, never values).
- Allowlist: keys from plugin `userConfig` and `.env.example`. GET routes report set/missing and source only, never values.
- Reload Claude Code after saving so MCP servers re-read credentials.
- **Test** starts the connector's own entry point (`mcp/<name>/server.mjs` under node, or the vendored Python project under `uv run`) with its resolved `${user_config.*}` environment and completes an MCP `initialize` + `tools/list`. It proves the connector runs; vendor credentials are proven only by a live call to the connector's `*_status` tool.
- Bulk export marks a set secret on its own comment line, never inline.
- Full flow and E2E matrix: `references/connector-config-flow.md`.
- Behavior writes go to the atlas store `<ATLAS_HOME or ~/.atlas>/settings.json` and to `~/.claude/settings.json` `"env"` (where Claude hooks read); omp sessions get the store through the hook bridge. Atlas refuses to disable itself; use `claude plugin disable atlas` from a terminal.
- Daemon isolation: `ensure`/`serve` refuse a temp env on the shared port 7421 (`temp_env_on_shared_port`); a healthy daemon on a different DB is never replaced (`port_held_by_other_db`); `stop_daemon` kills only its own pidfile pid or a same-DB listener; `session_boot` skips under a temp HOME.
- The Integrations page lists atlas MCP connectors with health, configured state and missing env var names (never secret values).
- Agent overrides: `project_id` resolves to the registered `root_path` first, so the server never reads agent files from client-supplied paths.

## Daemon and DB pinning

- The dashboard serves `ATLAS_DASHBOARD_DB` or `~/.atlas/atlas.db`, never an ambient pytest `ATLAS_DB`.
- `ensure` restarts the daemon if health or status reports a different `db_path`.
- It does **not** re-ingest transcripts on every request (avoids locking hooks out of the DB).
- v2 insight routes never run `atlas_db.init` per request; missing tables degrade to empty data.
