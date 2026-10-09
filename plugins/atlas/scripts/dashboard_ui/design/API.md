# Atlas Command Center: API contract

Every route the Command Center UI calls. JSON bodies below are trimmed copies of real responses from an isolated dashboard (a read-only backup of the real `~/.atlas` database, the live herdr socket read-only); paths are shortened to `~`.

Conventions
- `GET` routes accept `?project=<root|all>` unless noted. Mutations (`POST`, `PUT`) need `X-Atlas-Token` (the `<meta name="atlas-token">` value) and `Content-Type: application/json`. Failures return `{ok:false, error, why, do}`.
- Token is also required for GETs that expose terminal output or message text: `/api/v2/stream` (`?token=` allowed), `/api/v2/irc`, `/api/v2/channels[/<name>]`, `/api/v2/agents/<id>/peek`, `/api/v2/herd/agents/<pane>/peek`.
- `agents`, `herd`, `todos`, `irc`, `health`, `improve` are SSE topics on `GET /api/v2/stream` (event name = topic, data = the same body as the GET). A topic is re-sent only when its body changes, ignoring volatile fields (`fetched_ms`, `updated`, `last_ok`, `last_ts`, `now`, `generated_at`, `age_seconds`, `idle_seconds`, `preview`).
- Timestamps are ISO-8601 UTC strings.

## Routes the UI calls

| Area | Route |
|---|---|
| Live push | `GET /api/v2/stream` (SSE: `agents herd todos irc health improve`, `route_error`, `tick`) |
| Agents (unified) | `GET /api/v2/agents`, `GET /api/v2/agents/<id>/peek?lines=N`, `POST /api/v2/agents/<id>/prompt {text}` |
| Herd (legacy rows, enriched) | `GET /api/v2/herd/agents`, `GET /api/v2/herd/agents/<pane>/peek?lines=N`, `GET /api/v2/herd/status`, `GET /api/v2/herd/colony`, `POST /api/v2/herd/agents/<pane>/prompt {text}`, `POST /api/v2/herd/ensure`, `POST /api/v2/herd/panes {name,prompt,project,harness,run}`, `POST /api/v2/herd/panes/<pane>/kill` |
| Channels | `GET /api/v2/channels`, `GET /api/v2/channels/<url-encoded name>?since=&limit=`, `POST /api/v2/channels {channel,to,body,from,project}` |
| Channel (legacy, unchanged) | `GET /api/v2/irc`, `POST /api/v2/irc` |
| Work board | `GET /api/v2/todos`, `POST /api/v2/todos {op,...}` |
| Overview / Activity / Health | `GET /api/v2/overview`, `GET /api/v2/activity`, `GET /api/v2/health` |
| Projects / Improve / Prefs | `GET /api/v2/projects`, `GET /api/v2/improve` (+ `POST finding|remeasure|selffix`), `GET|PUT /api/v2/prefs` |

`<id>` for `/agents/<id>/...` is a pane id (`wA:p1`), a colony worker name, or the herdr title. Pattern: `[A-Za-z0-9:_.-]{1,64}`; it is matched against the live herdr list before any socket call (no shell string is ever built).

## GET /api/v2/agents (G2, G4)

The unified `AgentRecord` list. Sources joined server-side: herdr agents (`agent.list` + `workspace.list` + `tab.list`), colony (mux) workers (`pane.list` of `atlas-*` workspaces), board todo owners / launched panes, channel participants. `?project=<root>` keeps records whose cwd is under that project root.

- `key` = pane id when a pane exists, else the worker/participant name. `name` = colony label, tab label or title when it matches `^[a-z][a-z0-9]*(-[a-z0-9]+)+$`, else the title.
- `status` is herdr's raw status; `state` is the UI vocabulary: `working`, `input` (herdr `blocked`), `idle`, `done`, `unknown`, plus `fail` for a participant whose last exit note was non-zero.
- `counts` covers panes only and equals `herdr agent list`; `states` covers all records.
- Participants without a pane (`pane_id:null`) appear only while recent: a clean exit for 1 hour, a failed exit for 6 hours, an open task owner for 6 hours.
- `state_changed_at` (G4): herdr reports only `state_change_seq`, so the daemon stamps when it first saw each `(status, seq)`. `state_changed_source` is `observed` (the transition was seen) or `first_seen` (the pane was already in this state when first listed: the age is a lower bound). The map lives for the daemon's lifetime and drops panes that disappear.
- `tab_label` (G2): the herdr tab label. `tabs[]` lists every tab.
- `children` / `children_total` (G2): subagents that pane's own agent session dispatched in the last 30 minutes (`dispatches` joined through `runs.session_id` = the id inside `agent_session`). The session path/id is never returned. Max 8 items.
- `parent_pane` (G2): from the launch record of a board item (`launch.parent_pane`) when the launcher recorded it, else `null`. See NEXT in the hand-off: `atlas_launch.launch` should record `parent_pane=$HERDR_PANE_ID`.
- `layers`: `atlas` always ok when this answers; `herdr_socket` `{reachable, reason}`; `herdr_web_ui` `{healthy, url, auth_required}`. herdr down: records are only the pane-less participants, `layers.herdr_socket.reachable=false`; HTTP is still 200.

```json
{
  "ok": true,
  "layers": {
    "atlas": {
      "ok": true
    },
    "herdr_socket": {
      "reachable": true,
      "reason": null
    },
    "herdr_web_ui": {
      "healthy": true,
      "url": "http://127.0.0.1:7317",
      "auth_required": false
    }
  },
  "counts": {
    "working": 2,
    "blocked": 0,
    "idle": 0,
    "done": 2,
    "unknown": 0
  },
  "states": {
    "input": 0,
    "fail": 0,
    "working": 2,
    "idle": 0,
    "done": 2,
    "unknown": 13
  },
  "workspaces": [
    {
      "workspace_id": "wA",
      "label": ".omp",
      "focused": false,
      "agent_status": "done",
      "pane_count": 1
    }
  ],
  "tabs": [
    {
      "tab_id": "wA:t1",
      "workspace_id": "wA",
      "label": "1",
      "number": 1,
      "focused": false,
      "pane_count": 1,
      "agent_status": "done"
    },
    {
      "tab_id": "wC:t1",
      "workspace_id": "wC",
      "label": "atlas colony feature",
      "number": 1,
      "focused": false,
      "pane_count": 1,
      "agent_status": "done"
    }
  ],
  "agents": [
    {
      "key": "wA:p1",
      "name": "π > Fix terminal display issues in tmux",
      "kind": "omp",
      "status": "done",
      "state": "done",
      "pane_id": "wA:p1",
      "workspace_id": "wA",
      "workspace": ".omp",
      "tab_id": "wA:t1",
      "tab_label": "1",
      "cwd": "~/.omp",
      "title": "π > Fix terminal display issues in tmux",
      "focused": false,
      "deep_link": "http://127.0.0.1:7317/?pane=wA%3Ap1&machine=local",
      "project": "/Users/jerry/.omp",
      "colony": false,
      "run": null,
      "parent_pane": null,
      "children": [],
      "children_total": 0,
      "state_change_seq": 15,
      "completion_seq": 15,
      "state_changed_at": "2026-10-07T06:09:37+00:00",
      "state_changed_source": "first_seen",
      "tasks": [],
      "messages": {
        "count": 0,
        "unread": 0,
        "last_message_at": null
      },
      "sources": [
        "herdr"
      ]
    },
    {
      "key": "CCBackend",
      "name": "CCBackend",
      "kind": "unknown",
      "status": "unknown",
      "state": "unknown",
      "pane_id": null,
      "workspace_id": null,
      "workspace": "",
      "tab_id": null,
      "tab_label": "",
      "cwd": "",
      "title": "",
      "focused": false,
      "deep_link": null,
      "project": null,
      "colony": false,
      "run": null,
      "parent_pane": null,
      "children": [],
      "children_total": 0,
      "state_change_seq": null,
      "completion_seq": null,
      "state_changed_at": null,
      "state_changed_source": null,
      "tasks": [],
      "messages": {
        "count": 4,
        "unread": 3,
        "last_message_at": "2026-10-07T06:07:59+00:00"
      },
      "sources": [
        "irc"
      ]
    }
  ],
  "fetched_ms": 213.1
}
```

## GET /api/v2/agents/<id>/peek?lines=12 (G1)

Read-only. `lines` is clamped to 1..60 (default 12), each line to 240 characters. The text comes from herdr `pane.read` with `source:"recent"`, ANSI and control characters are stripped, then secrets are masked with the same redactor the memory capture uses (`[REDACTED]`). If the redactor is unavailable the route fails closed (503) rather than serve raw output. 404 when the agent has no live pane, 503 when herdr is down.

```json
{
  "ok": true,
  "pane_id": "wA:p1",
  "lines": [
    "<3 terminal lines, redacted, elided here>"
  ],
  "source": "recent",
  "redacted": true,
  "truncated": true,
  "read_ms": 0.22
}
```

## POST /api/v2/agents/<id>/prompt

Body `{text}`. Token required. Refusals never reach the pane: 404 no live pane, 409 `pane_not_steerable` (the pane runs something other than an interactive `claude`/`omp`, so typed text could run as a command), 409 `agent is not idle`, 400 empty text or over 8000 characters, 503 herdr down. Control characters (Enter, Tab, ESC, ^C) are collapsed to a space before sending, the same guard the channel uses. Success: `{ok:true, key, pane_id, result}`. `POST /api/v2/herd/agents/<pane>/prompt` keeps its original semantics (idle check only).

## GET /api/v2/herd/console

Where the Command Center frames the unmodified herdr web UI. Same-origin pages should reach it through the host gateway; `url` is the herdr-web-ui origin the daemon found healthy.

```json
{
  "ok": true,
  "url": "http://127.0.0.1:7317",
  "chrome_full_url": "http://127.0.0.1:7317/?chrome=full",
  "herdr_ui_url": "http://127.0.0.1:7317/herdr",
  "pane_url_template": "http://127.0.0.1:7317/?pane={pane_id}&machine=local&chrome=pane&theme={theme}",
  "reachable": true,
  "auth_required": false,
  "layers": {
    "atlas": {"ok": true},
    "herdr_socket": {"reachable": true},
    "herdr_web_ui": {"healthy": true, "url": "http://127.0.0.1:7317"}
  }
}
```

When the web UI is down, `reachable` is false and the URLs are `null` if no origin is known; show the calm unreachable state, not an empty frame.

## GET /api/v2/health (G3)

Per subsystem: `{id,label,status,measured,reason,detail,last_ok,last_fail,evidence[],history[],history_source,history_reason}`.

- `measured:false` means the source does not exist yet: `status` is `unknown`, `detail == reason`, and `last_ok`, `last_fail`, `history` are `null`. Any other row is measured and never `unknown`.
- `last_ok` is a real time or `null`; it is never invented. gate = newest non-denied `tool_calls.ts`; mux = newest `runs.ended_at` of worker runs; db and dashboard = the time of this response (the check ran live); doctor = newest findings activity; chronicle = newest `ingest_files.updated_at`; hooks = newest hookstate `last_run`; memory = newer of `MEMORY.md` mtime and the memory_capture hook; nudge = newer of the stamp file and the nudge hook; connectors = newest tool call on a configured connector.
- `last_fail` is the newest silent failure for that subsystem in the window (connectors: newest errored call ever).
- `history`: 10 `{t, ok, fail}` buckets across the window (`t` = bucket start); `history_source` says what ok and fail count. `null` with `history_reason` where no timestamped source exists (dashboard log, MEMORY.md, nudge stamp).
- Gate history counts allowed calls as ok and gate denials as fail; denials are enforcement, not faults, and never change the status.
- `checked_at`, `window_seconds` are top level.

```json
{
  "checked_at": "2026-10-07T06:11:19+00:00",
  "window_seconds": 604800,
  "subsystems": [
    {
      "id": "gate",
      "label": "Gates & denies",
      "status": "ok",
      "measured": true,
      "reason": null,
      "detail": "22368 tool calls allowed; 817 denied, 43 gate blocks enforced in window",
      "last_ok": "2026-10-07T05:37:37+00:00",
      "last_fail": null,
      "evidence": [
        "Grep x346: Grep: Atlas enforcement: use lean-ctx ctx_search instead of grep — write JSON args to the device xd://mcp__lean_ctx_ctx_search (e.g. {\"pattern\": \"...\", \"path\": \"...\"…",
        "Bash x225: Bash: Atlas enforcement: this bash command only reads files, so use lean-ctx ctx_shell instead (write JSON args to the device xd://mcp__lean_ctx_ctx_shell; lean-ctx …"
      ],
      "history": [
        {
          "t": "2026-09-30T06:11:19+00:00",
          "ok": 622,
          "fail": 0
        },
        {
          "t": "2026-09-30T22:59:19+00:00",
          "ok": 747,
          "fail": 0
        },
        {
          "t": "2026-10-01T15:47:19+00:00",
          "ok": 65,
          "fail": 3
        },
        {
          "t": "...",
          "ok": "...",
          "fail": "..."
        }
      ],
      "history_source": "tool_calls: allowed (ok) vs denied by a gate (fail = enforcement, not a fault)",
      "history_reason": null
    },
    {
      "id": "dashboard",
      "label": "Dashboard daemon",
      "status": "ok",
      "measured": true,
      "reason": null,
      "detail": "serving; log clean",
      "last_ok": "2026-10-07T06:11:19+00:00",
      "last_fail": null,
      "evidence": [
        "dashboard.log: 1869187 bytes, modified 2026-10-07T05:22:01+00:00"
      ],
      "history": null,
      "history_source": null,
      "history_reason": "dashboard.log lines carry no timestamps"
    }
  ]
}
```

Real run, 7d window, all 11 subsystems (status, measured, last_ok, last_fail, history):

| id | status | measured | last_ok | last_fail | history |
|---|---|---|---|---|---|
| hooks | fail | True | 2026-10-07T05:44:37+00:00 | 2026-10-07T03:18:06+00:00 | 10 buckets, 322 events |
| gate | ok | True | 2026-10-07T05:37:37+00:00 | None | 10 buckets, 23185 events |
| dispatch | warn | True | 2026-10-07T05:44:19+00:00 | 2026-10-06T09:05:26+00:00 | 10 buckets, 344 events |
| mux | ok | True | 2026-07-06T12:46:28+00:00 | None | 10 buckets, 0 events |
| dashboard | ok | True | 2026-10-07T06:11:19+00:00 | None | dashboard.log lines carry no timestamps |
| db | ok | True | 2026-10-07T06:11:19+00:00 | None | 10 buckets, 23185 events |
| connectors | warn | True | 2026-09-30T15:13:24+00:00 | 2026-09-30T15:13:24+00:00 | 10 buckets, 8 events |
| memory | ok | True | 2026-10-07T05:08:57+00:00 | None | MEMORY.md keeps only its latest modification time |
| nudge | ok | True | 2026-10-07T05:08:57+00:00 | None | the nudge stamp keeps only the latest time |
| doctor | ok | True | 2026-10-07T05:15:04+00:00 | 2026-10-06T23:58:25+00:00 | 10 buckets, 72 events |
| chronicle | ok | True | 2026-10-07T05:44:37+00:00 | None | 10 buckets, 538 events |

## GET /api/v2/overview: per-KPI series (G5)

Every KPI carries `series` (counts per bucket, aligned with `trend.labels`) and `series_kind`. `trend.kpi_series` holds the same arrays by id. `todos_blocked` has `series:null` (the board keeps only current state). `silent_failures` counts atlas tool faults per bucket (the other sources are not time-bucketed); `findings_open` is findings raised per bucket (an open-count history does not exist).

```json
[
  {
    "id": "runs",
    "label": "Runs",
    "value": 269,
    "delta": 1181.0,
    "status": "ok",
    "hint": "orchestrator and worker runs in window",
    "series": [
      0,
      18,
      88,
      93
    ],
    "series_kind": "count per bucket"
  },
  {
    "id": "dispatches",
    "label": "Dispatches",
    "value": 344,
    "delta": null,
    "status": "ok",
    "hint": "subagent dispatches in window",
    "series": [
      0,
      23,
      240,
      67
    ],
    "series_kind": "count per bucket"
  }
]
```

## Channels

Storage lives in `atlas_todo` (registry, members, board-by-owner); `atlas_dash_irc` adds presence and todo views. Main channel `<folder>@<branch>` (detached HEAD: `@<short-sha>`; non-git: folder only); each orchestrating lead gets `<main>/<lead>`, with its subagents as members parented to it.

`GET /api/v2/channels?project=` returns `{channels:[{name, kind:"main"|"lead", parent, lead, members:[{name, kind:"lead"|"subagent", parent, pane_id, state, last_seen}], project, branch, created, last_activity}]}`, main first then its lead subchannels. `pane_id`/`state` come from the live herdr list (null when the member has no pane). When `project` names one project and it has no registry yet, the deterministic main channel is created (idempotent).

`GET /api/v2/channels/<encodeURIComponent(name)>?since=&limit=` returns `{channel, messages:[{id,ts,from,to,body,kind,status,channel_name,...}], more, board:{owners:[{owner,role,parent,counts,last_note,items:[todo views]}], counts}}`. `members[].last_seen` is the time of the member's newest message in this channel. Notes written before channels existed (no channel field) belong to the main channel.

`POST /api/v2/channels {channel, to, body, from?, project?}` (`from` defaults to `human`; a subagent can post to main, a human to any channel) returns `{ok, delivered, message, next}`. `to` is `all` or an agent name; a named idle claude/omp pane is typed into with the same guards as `/api/v2/irc`, otherwise the note is queued on the board. 404 `no_such_channel`, 400 `channel_required`.

## Not in scope here / known limits

- `state_changed_at` restarts when the daemon restarts (herdr exposes no timestamp).
- Colony workers on the tmux transport are not listed as panes; they appear through their board tasks and channel messages.
- `parent_pane` stays `null` until the launcher records it.

## Integrations (`atlas_dash_integrations.py`, logic in `atlas_integrations.py`)

All subprocesses are argv lists (no shell) with timeouts and a 1 MiB output cap. GETs are read-only and never spawn a mutating process; POSTs need `X-Atlas-Token`. Atlas never installs or configures anything: absent tools report `installed:false` with the upstream install command. Errors are `{ok:false, error, ...}` with the HTTP status noted below.

| Route | Result |
|---|---|
| `GET /api/v2/integrations` | `{ok, herdr, tools:[{name, installed, enabled, version, install_cmd, docs_url, notes}], mcp:[{name, source, type, env:{KEY:"<redacted>"}}]}`. Tools: `herdr-projects` (+`configured`, `binary`), `herdr-file-viewer`, `captains-deck` (plugin id `herdr-firstmate-flow`), `cmux-browser-mcp` (+`cmux:{installed,running,access_mode,browser_capabilities}`; installed = registered in an MCP config), `tode` (version from `~/.local/state/tode/install.json`). Sources: `herdr plugin list --json` -> `~/.config/herdr/plugins.json` -> plain `herdr plugin list`; `cmux capabilities`; `~/.omp/agent/mcp.json`, `~/.claude.json`, `~/.mcp.json` (only names, sources, env KEYS; command, args and values are never returned). Cached 5 s. |
| `GET /api/v2/projects/hp` | Root = `$HERDR_PROJECTS_ROOT`, else `root` in `~/.config/herdr-projects/config.toml`, else `~/.herdr-projects`. Absent root -> `{installed, configured:false, projects:[], hint:"run herdr-projects configure --dry-run first"}`. Else `{installed, configured:true, root, needs_you, projects:[{slug, status, summary, name, goal, repos, threads:[{id, title, group, group_token, branch, cwd, repo, kind, pane_id, status, note, pr, pr_state, channel, channel_parent, channel_path}]}]}`. `channel` = `<repo-folder>@<branch>`; `channel_parent` = `atlas_todo.main_channel(repo)`; `channel_path` = `<parent>/<channel>`. `needs_you` parses `herdr-projects needs-you --line` (`projects: N need you`). The ticker is never started. |
| `POST /api/v2/projects/hp/threads` | Body `{project, title, repo, kind: worktree\|tab\|checkout, task}`. Runs `herdr-projects --root R thread start <project> --title T [--repo P] --kind K --task-file -` with `task` on stdin (60 s). `project` must exist under the root (404), `repo` an existing absolute directory (400; may be omitted only for `kind: tab`). No profile, yolo or safety flags. 200 `{ok, thread:<CLI JSON>}`; 424 `tool_not_installed`; 502 `thread_start_failed`. |
| `POST /api/v2/open-file` | Body `{path, root, line?\|range?:[a,b], placement: split\|tab}`. Runs `herdr plugin pane open --plugin herdr-file-viewer --entrypoint file-viewer --placement P [--direction right] --focus --env HERDR_FILE_VIEWER_ROOT=<realpath root> --env HERDR_FILE_VIEWER_OPEN=<rel[:line\|a-b]>` (no `--cwd`). `root` must be absolute and inside a known Atlas project root or live agent cwd (403 `unknown_root`); `realpath(path)` must stay inside `realpath(root)` (403 `path_outside_root`, symlink escapes included). Plugin absent/disabled -> 424 `plugin_not_installed` + `install_cmd`. A second open for the same root within 10 s -> 429 `duplicate_viewer`. |
| `POST /api/v2/open-editor` | Body `{path, line?}`. Detached `tode --goto <abs>:<line\|1>:1` for a file, `tode <abs dir>` for a folder; same known-root and realpath validation; `tode` absent -> 424. tode's code-server URL/port is never read, returned or proxied. 200 `{ok, launched, path}`. |
| `GET /api/v2/deck` | Captain's Deck is a read-only Firstmate kanban. No `~/firstmate`, no `~/.treehouse/*/*/firstmate` and no `FM_FLOW_HOMES` -> `{available:false, reason:"Firstmate not installed", installed, enabled, install_cmd, homes:[]}`. With homes and the plugin present: `{available:true, homes, discovered}` where `discovered` is the output of the documented probe `scripts/kanban-view.sh --homes`. |

Verified herdr-projects shapes (plugin source, v0.2.34): `list` prints tab-separated `slug  status  summary`; `thread list <slug> --json` is an array of the thread record (`id, title, status starting|open|failed|resolved, kind, repo, branch, worktree_path, cwd, pane_id, pr, pr_state, machine ...`) plus `group` (label), `group_token`, `rank`, `note`, `next`, `report`, `library`. `thread start` prints `{id, kind, pane_id, prompt_pending}`. Known roots come from the `projects` table and `atlas_herdr.agents()` cwds.

### UI usage notes (Command Center)

- Reads are cached 5 s client-side (`integrations.js`): `GET integrations` (Settings card, Overview row), `GET projects/hp` (Projects section, fleet thread chips, New thread dialog), `GET deck` (Integrations card). Recheck buttons bypass the cache.
- `POST open-file` is sent as `{path: <absolute, normalized client-side>, root, placement: "split", line?|range?}`; `root` is the agent cwd (inspector, fleet), the channel's `project` (channel and colony lenses). Success is a toast; 424 reads `install_cmd` from the error body and shows it in a modal; 403 `unknown_root` / `path_outside_root`, 404 `not_found`, 400 `not_a_file`, 429 `duplicate_viewer` and 502 `open_failed` map to plain-language toasts (backend `why` / `detail` appended).
- `POST open-editor` is sent `{path}` (a folder, the agent cwd or thread cwd) or `{path, line}`; 424 shows the tode install command.
- `POST projects/hp/threads` is sent only from the confirm step of the New thread dialog: `{project, title, repo?, kind, task}`; the UI requires a title and a task, and a repo unless `kind` is `tab`. 502 `thread_start_failed` shows `detail` inline in the dialog and keeps the form.
- `GET projects/hp` unconfigured (`configured:false`) renders `hint` plus the command `herdr-projects configure --dry-run`; `installed:false` renders `install_cmd`.

