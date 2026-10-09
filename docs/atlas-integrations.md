# Atlas integrations (herdr tooling, tode, cmux browser)

Last verified against the source on 2026-10-07: `plugins/atlas/scripts/atlas_integrations.py` (logic), `atlas_dash_integrations.py` (routes), `plugins/atlas/scripts/dashboard_ui/js/integrations.js` and `js/hp.js`, `contracts/mcp-servers.json`, `scripts/atlas_doctor.py`. Route-level detail also lives in `plugins/atlas/scripts/dashboard_ui/design/API.md` (section "Integrations"). The dashboard itself is described in `docs/atlas-workboard.md`.

## Rules

- **Atlas never installs or configures anything.** An absent tool reports `installed: false` with the upstream install command; the operator runs it.
- Every subprocess is an argv list (no shell) with a timeout (10 s reads, 60 s `thread start`, 15 s viewer open) and a 1 MiB output cap. Paths, titles and tasks are data: they land only in argv elements or stdin.
- GETs never spawn a mutating process. POSTs need the per-daemon `X-Atlas-Token` like every other mutation.
- Tool state (`GET /integrations`) is cached 5 s server-side; the UI caches reads 5 s as well and its Recheck buttons bypass the cache.

## Tools and install state

| Tool | What Atlas does with it | Install command (shown, never run) | State on the author's machine at check time (2026-10-07) |
|---|---|---|---|
| herdr-projects (`eliasstravik/herdr-projects`) | Lists projects and threads read-only; starts a thread only on an explicit POST | `herdr plugin install eliasstravik/herdr-projects` | installed, enabled (0.2.34), **not configured** (`configured: false`) |
| herdr-file-viewer (`smarzban/herdr-file-viewer`) | Opens a read-only viewer pane pinned to a root | `herdr plugin install smarzban/herdr-file-viewer` | **not installed** |
| Captain's Deck (`deimantasnork/captains-deck`, plugin id `herdr-firstmate-flow`) | Read-only Firstmate kanban status | `herdr plugin install deimantasnork/captains-deck` | installed, enabled (0.7.1); `available: false`, reason "Firstmate not installed" |
| tode | Detached CLI launch of an editor on a folder or file | `curl -fsSL https://tode.sh/install \| bash` | installed (v0.4.2) |
| cmux-browser-mcp | Browser automation for agents through the cmux app (see below) | `git clone https://github.com/jasonraz/cmux-browser-mcp && cd cmux-browser-mcp && ./install.sh` | **not installed / not registered** |

This is one machine's state, read by calling `atlas_integrations.detect()` and `deck_status()` during this doc pass; it is not a property of Atlas.

- **Captain's Deck needs Firstmate.** `deck_status()` reports `available: false` with reason "Firstmate not installed" unless a Firstmate home exists: `~/firstmate`, `~/.treehouse/*/*/firstmate`, or a directory listed in `FM_FLOW_HOMES` (colon separated). With homes and the plugin enabled, `discovered` carries the first 50 lines of the plugin's documented read-only probe `scripts/kanban-view.sh --homes`.
- **tode's code-server is never embedded.** tode runs code-server with `--auth none`; Atlas therefore only launches the `tode` CLI detached (stdin/stdout/stderr to `/dev/null`, new session) and never reads, returns, frames or proxies the code-server URL or port.
- **herdr-projects `configure` has side effects, so Atlas never runs it.** The UI shows the exact command `herdr-projects configure --dry-run` with a copy button and the warning that configure edits agent hook configs (Claude, Codex and others) and herdr's `config.toml` and links a skill. Atlas also never starts the herdr-projects ticker and sends no profile, yolo or safety flags.

## Routes

All under the dashboard daemon (`http://127.0.0.1:7421`). Failures are `{ok: false, error: <code>, ...}` with the HTTP status in the table; the route layer uses the module's `http` hint as the status code.

| Route | Request | Response |
|---|---|---|
| `GET /api/v2/integrations` | none | `{ok, herdr: bool, tools: [{name, installed, enabled, version, install_cmd, docs_url, notes}], mcp: [{name, source, type, env: {KEY: "<redacted>"}}]}`. Tools in order: `herdr-projects` (adds `configured`, `binary`), `herdr-file-viewer`, `captains-deck` (adds `plugin_id`), `cmux-browser-mcp` (adds `cmux: {installed, running, access_mode, browser_capabilities}`; installed means registered in an MCP config or `~/.claude/mcp-servers/cmux-browser` exists), `tode` (version from `~/.local/state/tode/install.json`). Plugin state comes from `herdr plugin list --json`, then `~/.config/herdr/plugins.json`, then plain `herdr plugin list`; when herdr cannot be asked the notes read "herdr not found: plugin state unknown". `mcp` lists names, sources and env **keys** from `~/.omp/agent/mcp.json`, `~/.claude.json` and `~/.mcp.json`; command, args and env values are never returned |
| `GET /api/v2/projects/hp` | none | herdr-projects not on PATH: `{ok, installed: false, configured: false, projects: [], install_cmd}`. Root absent: `{ok, installed: true, configured: false, root, projects: [], hint: "run herdr-projects configure --dry-run first"}`. Otherwise `{ok, installed, configured: true, root, needs_you, projects: [{slug, status, summary, name, goal, repos, threads: [{id, title, group, group_token, branch, cwd, repo, kind, pane_id, status, note, pr, pr_state, channel, channel_parent, channel_path}]}]}`. Root = `$HERDR_PROJECTS_ROOT`, else `root` in `~/.config/herdr-projects/config.toml`, else `~/.herdr-projects`. Runs `herdr-projects --root R list`, `thread list <slug> --json` and `needs-you --line` (max 200 projects). `channel` is `<repo-folder>@<branch>`, `channel_parent` the repo's Atlas main channel (`atlas_todo.main_channel`), `channel_path` `<parent>/<channel>`. `list` failure: 502 `hp_list_failed` |
| `GET /api/v2/deck` | none | `{ok, plugin_id, installed, enabled, install_cmd, available, reason, homes, discovered?}` (see Captain's Deck above) |
| `POST /api/v2/projects/hp/threads` | `{project, title, repo?, kind: "worktree"\|"tab"\|"checkout" (default worktree), task}` | 200 `{ok, thread: <CLI JSON>}` (or `{ok, output}` if the CLI output is not JSON) |
| `POST /api/v2/open-file` | `{path, root, line?` or `range?: [a, b], placement: "split"\|"tab" (default split)}` | 200 `{ok, root, open, output}` |
| `POST /api/v2/open-editor` | `{path, line?}` | 200 `{ok, launched: true, path}` |

### Error codes

| Status | `error` | When |
|---|---|---|
| 400 | `bad_project`, `bad_title`, `bad_kind`, `bad_task`, `repo_required`, `bad_repo` | thread start validation: project slug, title (non-empty, at most 200 chars, no control characters), kind, task (non-empty, at most 100 000 chars), repo (existing absolute directory; may be omitted only for `kind: tab`) |
| 400 | `bad_path`, `root_must_be_absolute`, `bad_root`, `not_a_file`, `unsupported_path`, `line_or_range`, `bad_line`, `bad_range`, `bad_placement` | open-file / open-editor validation (`unsupported_path`: a `:` in the relative path would clash with the `:line` suffix) |
| 403 | `unknown_root` | `root` (open-file) or `path` (open-editor) is not inside a **valid** registered root: an Atlas project root (`projects.root_path`) or the cwd of a live herdr agent that passes the checks under "Root validation" below |
| 403 | `path_outside_root` | `realpath(path)` is not inside `realpath(root)`; symlink escapes fail here |
| 403 | `forbidden_path` | the root or target, relative to the validated root, has a dot component outside a small allowlist or a secret-looking name (see "Root validation") |
| 404 | `unknown_project`, `not_found` | project directory missing under the herdr-projects root; path does not exist |
| 424 | `plugin_not_installed` + `install_cmd` | open-file and `herdr-file-viewer` absent or disabled (checked uncached, so an install a second ago counts) |
| 424 | `tool_not_installed` + `install_cmd` | thread start without `herdr-projects`, open-editor without `tode` |
| 424 | `herdr_not_found` | open-file and herdr cannot be asked at all (`install_cmd` is `https://herdr.dev`) |
| 429 | `duplicate_viewer` | a viewer for the same real root opened less than 10 s ago |
| 502 | `thread_start_failed`, `open_failed`, `spawn_failed`, `hp_list_failed` | the subprocess failed or timed out (`detail` carries up to 500 chars) |

## Root validation (open-file, open-editor)

`atlas_dash_integrations.py` builds the known roots from `projects.root_path` plus the cwd of every live herdr agent; `atlas_integrations._known_root` then accepts a candidate only through `_valid_root`, so a poisoned `projects` row or an agent cwd cannot turn the routes into an arbitrary-file opener. Each candidate root is `realpath`ed (symlinks resolved, must be an existing directory) and containment is a prefix check with a trailing separator (`_under`), so `/a/b` never contains `/a/bc`. A root is **rejected** (403 `unknown_root`, no subprocess spawned) when it is:

- `/`, `/tmp`, `/var`, `/private`, `tempfile.gettempdir()`, the home directory itself, or **any ancestor of home** (`_bad_root`);
- equal to or inside `/etc`, `/usr`, `/bin`, `/sbin`, `/System`, `/Library` or `/Applications`;
- not an existing directory;
- inside home but through any dot component (`~/.agents`, `~/.config/...`), inside `~/Library`, or bare `~/Downloads|Desktop|Documents|Library|Public`;
- without a project marker: a root must contain `.git`, `.atlas` or `.claude-plugin` (`_ROOT_MARKERS`).

Below a valid root, `_forbidden_target` refuses (403 `forbidden_path`) any path component starting with `.` unless it is one of `.github .gitignore .gitattributes .editorconfig .dockerignore .gitlab-ci.yml .prettierrc .eslintrc .nvmrc .python-version .tool-versions`, and secret-looking names (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `auth.json`, `credentials*`, `.npmrc`, `.netrc`, `.pgpass`). Order in `_resolve` (open-file): absolute root, existing directory (400 `bad_root`), known valid root, `path_outside_root`, `forbidden_path`, existence (404). `open_editor` takes only a path and runs the same known-root and forbidden-target checks on its `realpath`.

Checked by the 10.2.0 re-verification (findings entry `command-center-integrations-10.2.0-reverified`, run against an isolated dashboard and a copy of the real DB whose `projects` still contained `/` and `/Users/jerry`): open-file `{/etc,/etc/hosts}`, `{/,/etc/hosts}` and `{/Users/jerry,~/.zshrc}` and open-editor `/etc/hosts` and `~/.zshrc` all 403 with zero argv spawned; a repo-root `README.md` line 3 gave 200 with the expected viewer and `tode --goto` argv.

## argv per tool

Taken from `atlas_integrations.py`; the flags follow each tool's own documentation.

- **herdr-projects:** `herdr-projects --root <root> thread start <project> --title <title> [--repo <realpath>] --kind <kind> --task-file -` with the task on **stdin** (60 s timeout). The project must exist under the root.
- **herdr-file-viewer:** `herdr plugin pane open --plugin herdr-file-viewer --entrypoint file-viewer --placement <split|tab> [--direction right] --focus --env HERDR_FILE_VIEWER_ROOT=<realpath root> --env HERDR_FILE_VIEWER_OPEN=<relative path>[:line | :a-b]` (no `--cwd`). The viewer is pinned to the validated root.
- **tode:** a folder opens with `tode <abs dir>`; a file with `tode --goto <abs path>:<line or 1>:1`. The process is detached and reaped by a daemon thread.

## Dashboard UI

- `js/integrations.js`: cached reads (`getIntegrations`, `getHp`, `getDeck`), `openFile`, `openEditor`, `PathLink`, `linkifyPaths`, the Files panel (root, "Open in editor", an open-by-path field and the files mentioned by the agent) and the Settings **Integrations** panel and Overview row. Failures become plain-language toasts; a 424 opens a modal with the install command.
- **path:line links:** a `path:line` (or `path:a-b`) mention in text rendered through `linkifyPaths` (the shared `linkify` formatter in `js/ui-data.js`) becomes a link that POSTs `open-file` when the agent's cwd or the channel's project is known as the root.
- `js/hp.js`: the **Herdr projects** section above the Atlas project cards on Projects (goal, repos, status, threads with the channel chip, Open and Editor buttons, the needs-you count) and the **New thread** dialog. The dialog is two steps (form, then a review) and posts only from the confirm step. Unconfigured shows the backend `hint` and the `configure --dry-run` command; not installed shows `install_cmd`.
- **Palette actions** (`js/app.js`): "Open in editor: <agent>" per agent (group Files) and "New herdr project thread". The fleet agent menu also has "Open in editor".
- An hp thread's cwd is a known root only while an agent runs there or it is an Atlas project; otherwise Editor answers 403 `unknown_root`, shown as such.

## cmux browser (agent browser automation)

- `contracts/mcp-servers.json` `browserServers["cmux-browser"]` records cmux-browser-mcp (`server.mjs` v1.3.0, macOS and the cmux app only). All **45** `browser_*` tools are partitioned into three classes:
  - **read-only (11):** `browser_snapshot`, `browser_screenshot`, `browser_get_url`, `browser_get`, `browser_find`, `browser_is`, `browser_wait`, `browser_console`, `browser_errors`, `browser_identify`, `browser_is_webview_focused`.
  - **state-changing (23):** open/navigate/history (`browser_open`, `browser_open_split`, `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload`), page input (`browser_click`, `browser_fill`, `browser_type`, `browser_press`, `browser_hover`, `browser_select`, `browser_scroll`, `browser_check`, `browser_uncheck`, `browser_highlight`), and frame/tab/dialog/viewport/geolocation/offline/focus (`browser_frame`, `browser_tab`, `browser_dialog`, `browser_viewport`, `browser_geolocation`, `browser_offline`, `browser_focus_webview`).
  - **sensitive (11):** `browser_eval`, `browser_cookies`, `browser_storage`, `browser_state`, `browser_network`, `browser_add_script`, `browser_add_init_script`, `browser_add_style`, `browser_download`, `browser_trace`, `browser_screencast`. They expose cookies, storage, page JS, request bodies or files and are lead-only.
  - `subagentAllow` (24 tools) is the only set a subagent may call; `omp/agent-guard.test.ts` and `omp/hook-bridge.test.ts` pin the partition. The `cmux_browser` entry in `underscoredServers` lets omp's `xd://mcp__cmux_browser_<tool>` names split correctly.
- **Usage by `ui-runtime-tester`:** preferred driver when `cmux capabilities` answers and the `cmux-browser` MCP is registered; otherwise it falls back to Playwright via `bun`. The server shares one `defaultSurface`, so the agent opens once and passes the returned `surface` on every call. Screenshots go to `/tmp/atlas-shots/<agent-name>-<n>.png` and the report cites the path and the snapshot ref.
- **Doctor checks** (`atlas_doctor.py`, both WARN severity, so they never fail the install check):
  - `cmux-socket`: `cmux capabilities` answers within 3 s. "n/a" (ok) off macOS or without the cmux binary; WARN when the binary exists but the socket does not answer.
  - `cmux-browser`: the `cmux-browser` server is registered in `~/.omp/agent/mcp.json` or `~/.claude.json` (only the file path is reported). "n/a" without cmux; WARN "not registered" with the install command otherwise.
- **cmuxlayer MCP note:** on the author machine `cmuxlayer` is registered in `~/.omp/agent/mcp.json` as a stdio server with `timeout: 120000` (verified in that file). The operator reports `list_agents` takes about 43 s there, so omp's default timeout is too short; after editing that file run `/mcp reload` in omp. The 43 s figure is the operator's, not re-measured for this doc.

## Settings Integrations connectors (10.4.3)

The Settings Integrations page also lists the atlas MCP connectors with health, configured state and the names of missing env vars (no secret values). `/api/agents` without `project_id` returns the plugin roster. See `docs/atlas-workboard.md` "Integrations and Agents pages".

## Known limits

- The mutating herdr actions (`thread start`, the file-viewer open, the tode launch) were exercised only against stubs. No live pty output was verified.
- Another session owns `scripts/atlas_herdr.py` and `scripts/atlas_remote.py` and two environment-dependent tests there; they are outside this doc pass.
- herdr-file-viewer and cmux-browser-mcp were not installed on the author machine, so their real argv/behaviour was not exercised end to end.
- `open-file` needs a file, not a folder. The viewer has no pane-focus route on the host.
- The root check is structural, not a trust decision: a non-dot directory under home (or any directory outside home and the system trees) that carries `.git`, `.atlas` or `.claude-plugin` is accepted, and every file in it except dot components and secret-looking names is openable.
