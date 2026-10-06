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

Atlas ships a **single shared loopback dashboard** ("Atlas Workboard") for all concurrent coding-agent terminals. One daemon serves one static single-page UI (`scripts/dashboard_ui/`) and one JSON API. Source of truth for every fact below: `scripts/atlas_dashboard.py` (HTTP layer, guard, SSE, legacy routes), `scripts/atlas_dash_colony.py` and `scripts/atlas_dash_insights.py` (v2 `ROUTES` tables), `scripts/dashboard_ui/js/` (client).

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
- **Sensitive GETs** that require the token (regex `_SENSITIVE_GET`): `/api/v2/stream`, `/api/v2/irc`, `/api/v2/colony/capture`, `/api/v2/colony/agent`, `/api/v2/<segment>/transcript`, and `/api/sessions/<id>/transcript`.
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
| `/api/health`, `/health` | liveness (no token) | `ok, service, url, pid, db_path, script, time` |
| `/api/status[?project_id=]` | full snapshot | `snapshot()` payload |
| `/api/projects` | project list | `ok, projects` |
| `/api/sessions[?project_id=&limit=]` | sessions across agents (default limit 40) | `ok, sessions` |
| `/api/sessions/{id}` | session detail (tools, prompts, dispatches) | `ok, session, ...` ; `404 session_not_found` |
| `/api/connectors` | connector env coverage, no secrets | `ok, connectors, user_config, settings_path` |
| `/api/connectors/export` | `.env` template, secrets blanked | `ok, text, env_path` |
| `/api/behavior` | `ATLAS_*` knob groups + advanced list, each with the `file:line` that reads it | `ok, ...behavior_state()` |
| `/api/ecosystem` | installed plugins, MCP servers, atlas hook wiring, skills/agents/output styles | `ok, ...ecosystem_inventory()` |
| `/api/findings` | doctor findings | `ok, findings` |
| `/api/runs[?limit=&project_id=]` | recent runs / run health (default limit 20) | `ok, health` |
| `/api/todo?project_id=` | durable todo board `<project>/.atlas/.run/todos.json` | board payload; `400 unknown_project` |
| `/api/agents?project_id=` | agent roster: plugin agents plus same-name overrides in `<project>/.claude/agents/` | roster payload; `400 unknown_project` |
| `/api/agents/{name}?project_id=` | one agent's effective body (override wins) | content payload |
| `/api/memory` | shared memory snapshot from `~/.atlas/memory/` | `ok, ...load_snapshot()` |

### POST (legacy)

| Path | Body | Behavior |
|---|---|---|
| `/api/connectors/env` | `{"updates": {key: value}}` | allowlisted credential writes (userConfig keys or UPPER env keys); `400 updates_required` |
| `/api/connectors/import` | `{"text": "KEY=VALUE\n..."}` | bulk `.env` paste, same allowlist; `400 no_assignments_found` |
| `/api/connectors/test` | `{"name": "<connector>"}` | start the connector bundle and complete an MCP handshake |
| `/api/behavior` | `{"updates": {ATLAS_KEY: value}}` | allowlisted writes to `settings.json` `env`; empty value removes the override; one bad key rejects the batch |
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

Counts: `atlas_dash_colony.ROUTES` = 11, `atlas_dash_insights.ROUTES` = 9, plus `/api/v2/stream` handled directly by `Handler.do_GET` = **21 v2 routes**.

### Colony, IRC, todos (`atlas_dash_colony.py`, regex unanchored in source)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/v2/colony` | `?project=` | `{mux_enabled, tmux_available, rigs:[Rig], counts:{working,idle,needs_input,failed,exited}}` |
| GET | `/api/v2/colony/agent` * | `?run=&name=[&project=]` | Agent record plus `run, project, notes[], todos[], pane_tail`. `400 run_and_name_required`, `404 agent_not_found` |
| GET | `/api/v2/colony/capture` * | `?run=&name=[&lines=200][&project=]` (lines clamped 1-2000) | `{text, captured, source: "tmux"\|"notes"}` (falls back to the agent's board notes when there is no live pane) |
| POST | `/api/v2/colony/send` | `{run, name, text, force?, verify?, project?}` | `{ok, delivered, message, state, next, why?, verified?}`. Keys are typed only into a pane whose foreground is an interactive `claude`/`omp` session (`delivered:true`, message `status:"delivered"`); **`409 pane_not_steerable`** (`{ok:false, error, why, do, delivered:false, message}`, message recorded with `status:"refused"`, `force` never overrides) for a shell or any other process, and a headless `-p`/`run-worker` pane is not typed into but gets a board note (`delivered:"queued"` + `detail`, `status` `queued` until the worker reads it, then `read`). **`409 typing_guard`** when the pane shows an interactive prompt and `force` is not true. `400 invalid_name`/`text_required`, `404 agent_not_found`. A refusal is an HTTP **409** on this route (contrast `POST /api/v2/irc`, which answers 200 with `ok:false`) |
| POST | `/api/v2/colony/kill` | `{run, name?, project?}` | kills window `atlas-<run>:<name>` or the whole session; `{ok, state, next}`. `400 invalid_run`/`invalid_name`, `404 rig_not_found`, `409 tmux_unavailable`, `500 kill_failed` |
| POST | `/api/v2/colony/spawn-help` | `{}` | `{ok, mux_enabled, tmux_available, steps:[{label, command}], next}`. The dashboard never spawns processes itself |
| POST | `/api/v2/colony/attach-command` | `{run, name?}` | `{ok, command: "tmux attach -t atlas-<run>[:<name>]"}` |
| GET | `/api/v2/irc` * | `?project=&since=&agent=&limit=200` (limit clamped 1-1000) | `{messages:[Message], agents[], channels[]}` |
| POST | `/api/v2/irc` | `{project (required), to ("all" or agent), body, from ("human"), force?}` | `{ok, delivered, message, next}`. A refusal is **HTTP 200 with `ok:false`**, not 409: a shell/non-harness pane answers `{ok:false, error:"pane_not_steerable", why, do, delivered:false, message}` (message recorded with `status:"refused"`), and the typing guard answers the same shape with its own `error`; the message is always still recorded. `/api/v2/colony/send` returns **409** for the same `pane_not_steerable` refusal. `400 unknown_project`/`body_required`/`invalid_to` |
| GET | `/api/v2/todos` | `?project=` (required) | `TodosState` (below). `400 unknown_project` |
| POST | `/api/v2/todos` | `{project, op, id?, ...}` | `{ok, state: TodosState, next: "<op> applied"}`. `op` in `add, update, status, remove, claim, assign, move, reorder`. Errors: `404 not_found`, `409 claimed_by_other / not_claim_owner / already_completed`, `400` otherwise, `500 todo_write_failed` |

\* token required (sensitive GET).

Todo op fields: `add` (`content`, `phase?`, `owner?`); `update` (`content?`, `phase?`, `owner?`); `status` (`status` in `open|in_progress|done|blocked`, `evidence?`); `claim` (`owner`, `force?`); `assign` (`owner`); `move` (`phase`); `reorder` (`phase`, `ids[]` of existing items in that phase); `remove`.

Shapes:

- **Rig**: `{id, run, project, project_name, tmux_session, state: running|partial|stopped, started, agents:[Agent]}`. A synthetic rig `board-<project>` (run `board`, `tmux_session: null`) holds agents that have board notes or recent subagent dispatches but no tmux window.
- **Agent**: `{name, role, harness: claude|omp|other, state, window, pane_id, started, last_activity, idle_seconds, exit_code, todo_ids[], last_note, stuck:{is_stuck, reason}}`.
- **Agent state** (`infer_state`, evidence order exit > failure text > prompt > recency): `failed`, `exited`, `needs_input` (interactive prompt in the last pane lines), `working` (activity within 45 s), `idle`, `unknown`.
- **Message**: `{id, ts, from, to, body, kind: irc|note|exit|system, status: queued|read|delivered|refused, run, project, channel ("all" or "@<agent>")}`. `status` is only meaningful for a `human` message to a named agent (every other line reads `read`): `queued` = on the board, waiting for a `-p` worker's hook to drain it; `read` = the worker's hook drained it; `delivered` = the dashboard typed it into an interactive `claude`/`omp` pane (`delivered:true`); `refused` = the pane was not steerable (`pane_not_steerable`), nothing was typed. `delivered` and `refused` are terminal and persisted on the note; a message to an agent with no live pane stays `queued`.
- **TodosState**: `{project, phases:[{name, items:[{id, content, status: open|in_progress|done|blocked, phase, owner, claimed_by, updated, origin, evidence}]}], counts:{open,in_progress,done,blocked}, updated}`.
- **Stuck diagnosis** (`diagnose_stuck`): `needs_input` for 120 s or more; any `failed` agent; or `idle` for 600 s or more while claimed todos remain open.

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

`atlas_dash_colony.ROUTES` (11): `GET /api/v2/colony`, `GET /api/v2/colony/agent`, `GET /api/v2/colony/capture`, `POST /api/v2/colony/send`, `POST /api/v2/colony/kill`, `POST /api/v2/colony/spawn-help`, `POST /api/v2/colony/attach-command`, `GET /api/v2/irc`, `POST /api/v2/irc`, `GET /api/v2/todos`, `POST /api/v2/todos`.

`atlas_dash_insights.ROUTES` (9): `GET /api/v2/projects`, `GET /api/v2/overview`, `GET /api/v2/health`, `GET /api/v2/activity`, `GET /api/v2/improve`, `POST /api/v2/improve/finding`, `POST /api/v2/improve/remeasure`, `GET /api/v2/prefs`, `PUT /api/v2/prefs`.

`atlas_dashboard.Handler` direct (1 v2 + 18 legacy + static): `GET /api/v2/stream`; legacy GET `/api/health`, `/health`, `/api/status`, `/api/projects`, `/api/sessions`, `/api/sessions/{id}`, `/api/connectors`, `/api/connectors/export`, `/api/behavior`, `/api/ecosystem`, `/api/findings`, `/api/runs`, `/api/todo`, `/api/agents`, `/api/agents/{name}`, `/api/memory`; legacy POST `/api/connectors/env`, `/api/connectors/import`, `/api/connectors/test`, `/api/behavior`, `/api/mcp/toggle`, `/api/mcp/add`, `/api/mcp/remove`, `/api/plugins/toggle`, `/api/todo`, `/api/agents`.

## Live stream (SSE)

`GET /api/v2/stream[?project=<root|id>][&token=<token>]` keeps one connection per browser and replaces the old fixed-interval polling as the primary update path.

- Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`, `Connection: close`, `X-Accel-Buffering: no`.
- First frame: `retry: 3000` (the browser reconnects after 3 s).
- Every **5 s** (`SSE_TICK_S`) the server re-runs five topic routes in-process and emits a topic **only when its snapshot hash changed** (SHA-256 of the sorted JSON):

| Event name | Source route | Data |
|---|---|---|
| `colony` | `GET /api/v2/colony` | the colony snapshot |
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

Hash-routed single page (`#/<page>[#anchor][?k=v]`), default `#/overview`. Sidebar groups and page modules (`js/pages/<id>.js`; a module that is not installed renders "This page is not available in this build."):

| Group | Page id | Label | Reads | Writes |
|---|---|---|---|---|
| Observe | `overview` | Overview | `overview` (7d), attention list | none |
| Observe | `activity` | Activity | `/api/v2/activity` | `PUT prefs` (saved views, filters) |
| Observe | `health` | Health | `/api/v2/health` | none |
| Operate | `colony` | Colony | `colony`, `colony/agent`, `colony/capture` | `colony/send`, `colony/kill`, `colony/attach-command`, `colony/spawn-help` |
| Operate | `work` | Work | `todos` | `POST todos` (all ops) |
| Operate | `irc` | IRC | `irc` | `POST irc` |
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
| `g` then `o` / `a` / `h` / `c` / `w` / `i` / `s` / `p` / `,` | Overview / Activity / Health / Colony / Work / IRC / Self-improvement / Projects / Settings (chord window 1.5 s) |
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
- Behavior writes go to `~/.claude/settings.json` `"env"` (where hooks read). Atlas refuses to disable itself; use `claude plugin disable atlas` from a terminal.
- Agent overrides: `project_id` resolves to the registered `root_path` first, so the server never reads agent files from client-supplied paths.

## Daemon and DB pinning

- The dashboard serves `ATLAS_DASHBOARD_DB` or `~/.atlas/atlas.db`, never an ambient pytest `ATLAS_DB`.
- `ensure` restarts the daemon if health or status reports a different `db_path`.
- It does **not** re-ingest transcripts on every request (avoids locking hooks out of the DB).
- v2 insight routes never run `atlas_db.init` per request; missing tables degrade to empty data.
