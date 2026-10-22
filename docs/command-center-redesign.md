# Atlas Command Center: redesign brief (v14)

Status: build contract. Every implementer of `plugins/atlas/scripts/dashboard_ui/` builds to this file.
The backend (`atlas_dashboard.py` and the `atlas_dash_*.py` route modules) stays; only the settings
metadata in `atlas_control.py` changes (section 8). The previous UI (v13 and earlier: shell, pages,
CSS, tests, the design/ folder except API.md) is deleted, not migrated. Nothing from it is reused:
no file, no class name, no token name, no copy.

Why: the v13 UI exposed four overlapping "Operate" pages (Agents, Colony, Terminal, Channels) with
lenses, sub-tabs and view toggles that nobody could explain, and a Settings page that printed
"Undocumented", used free-text fields where the value set is finite, hid the current value, and
reported failed saves. This brief replaces the information architecture, the visual system, and the
settings contract.

## 1. Product in one paragraph

Atlas Command Center is the one window an engineer keeps open while coding agents (Claude Code, omp,
Codex, shells) work across several projects on this machine. It answers, in order: who needs me,
what is each agent doing, what broke, is Atlas itself healthy, and lets the engineer act (prompt,
message, assign, stop, launch) without leaving the page. It is a local, loopback, no-build,
no-network web app served by the dashboard daemon.

## 2. Information architecture (final)

Nine pages, one flat sidebar, no groups, no lenses, no sub-tabs inside the sidebar.

| Route | Page | One job | Primary data |
|---|---|---|---|
| `#/overview` | Overview | The five-second answer | `/api/v2/overview`, `/api/v2/agents`, `/api/v2/health` |
| `#/agents` | Agents | Every running agent and seat, one table, one detail drawer | `/api/v2/agents`, `/api/v2/term/seats`, peek, prompt, ticket + `/api/v2/term/ws` |
| `#/board` | Board | Tasks by status, per project | `/api/v2/todos` |
| `#/channels` | Channels | Agent-to-agent and human-to-agent messages | `/api/v2/channels`, `/api/v2/channels/<name>` |
| `#/activity` | Activity | What happened, filterable | `/api/v2/activity` |
| `#/health` | Health | Subsystem status with evidence | `/api/v2/health` |
| `#/improve` | Improve | Findings, lessons, self-fix | `/api/v2/improve` + POSTs |
| `#/projects` | Projects | Which projects Atlas sees and their numbers | `/api/v2/projects`, `/api/v2/prefs` |
| `#/settings` | Settings | Change how Atlas behaves, with the current value in view | `/api/behavior`, `/api/v2/prefs`, `/api/connectors`, `/api/ecosystem` |

Removed as pages: Colony, Terminal. Their content lives inside Agents (section 5.2). Old hashes
redirect: `#/colony`, `#/terminal`, `#/herd`, `#/work`, `#/irc` -> the new page that owns them.

Deep links: every page reads and writes `project` (root or `all`) from the hash query. Agents also
carries `agent=<key>` (drawer open) and `tab=`. Board carries `status=`. Channels carries `channel=`.

## 3. Visual system

### 3.1 Principles

- Instrument panel, not marketing site. Dense but breathing: 13px body, 8px rhythm, 32px gutters.
- One accent (brand teal) used for: brand mark, active nav rule, primary button, focus ring, links.
  Status never uses the accent.
- Five status colours, each always paired with a word or glyph (never colour alone).
- Surfaces are flat. Depth comes from one hairline and one step of surface tone, not shadows.
  Shadows only on floating layers (drawer, popover, modal, toast).
- Motion budget: 120ms ease-out for hover/open; one slow pulse (1.6s) on the "working" dot. Nothing
  else animates. `prefers-reduced-motion` stops the pulse.
- Copy is plain English sentences. No "lens", "roster", "seat", "colony" in the UI. Say agent, shell,
  task, message, project.

### 3.2 Typography

Geist Sans and Geist Mono, variable, vendored (OFL 1.1). Files come from the `geist` npm package
(`dist/fonts/geist-sans/Geist-Variable.woff2`, `dist/fonts/geist-mono/GeistMono-Variable.woff2`), a copy
is staged at `/private/tmp/claude-501/-Users-jerry-MEGA-Projects-Agentic-tech-tools/6439d9b7-4edc-4df3-9965-b63b80b6e164/scratchpad/fonts/package/`
with its LICENSE. Ship them as `dashboard_ui/fonts/Geist-Variable.woff2`,
`dashboard_ui/fonts/GeistMono-Variable.woff2`, `dashboard_ui/fonts/OFL-Geist.txt`. Delete the
Pretendard and JetBrains Mono files.

```
--font-sans: "Geist", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| page title | 22 / 28 | 600 | letter-spacing -0.01em |
| section title | 15 / 22 | 600 | |
| body | 13 / 20 | 400 | |
| meta | 12 / 16 | 400 | `--text-2` |
| label (table head, badges) | 11 / 16 | 500 | uppercase, letter-spacing 0.04em, `--text-3`. The only uppercase in the UI. |
| mono | 12.5 / 18 | 400 | ids, paths, commands, terminal, message bodies from agents |
| number | body | 500 | `font-variant-numeric: tabular-nums` |

### 3.3 Colour tokens (CSS custom properties on `:root`; `html[data-theme=light]` overrides)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--canvas` | `#0B0E13` | `#F5F7F9` | page background |
| `--panel` | `#11151C` | `#FFFFFF` | sidebar, tables, drawer |
| `--raised` | `#171C25` | `#EEF1F5` | hover rows, inputs, code blocks |
| `--line` | `rgba(255,255,255,.08)` | `rgba(15,20,25,.08)` | hairlines |
| `--line-strong` | `rgba(255,255,255,.18)` | `rgba(15,20,25,.22)` | control borders |
| `--text` | `#E8ECF1` | `#0F1419` | primary |
| `--text-2` | `#9AA4B2` | `#4A5564` | secondary |
| `--text-3` | `#6B7684` | `#6F7A88` | tertiary, labels |
| `--brand` | `#3DDBB8` | `#0E8A74` | accent |
| `--brand-ink` | `#04221B` | `#FFFFFF` | text on brand fill |
| `--brand-soft` | `rgba(61,219,184,.12)` | `rgba(14,138,116,.10)` | selected row, active nav |
| `--ok` | `#56C98A` | `#1B7A45` | done, healthy |
| `--working` | `#5BB2F0` | `#0B6BB5` | running |
| `--needs` | `#F5B14A` | `#8A5300` | needs input, warn |
| `--fail` | `#F2705F` | `#B3261E` | failed |
| `--idle` | `#8793A3` | `#5C6875` | ready, idle, unknown |
| `--focus` | `#7FE9D2` | `#0E8A74` | 2px ring, 2px offset |

Status tint for badges: `color-mix(in srgb, var(--status) 14%, transparent)` background, status colour
text. Every text-on-tint pair must pass 4.5:1 in both themes; check with a script in the commit.

### 3.4 Shape and space

- Radius: 6px controls and badges, 10px panels, 999px pills and dots.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48.
- Controls are 32px tall (compact density) or 36px (comfortable). Density is a pref; default compact.
- Table rows 40px; cell padding 0 12px; first column 16px.
- Sidebar 232px, collapsible to 56px (icons only, labels on hover). Drawer 440px. Modal 520px.
- Page: header block (title, one-line description under it in `--text-2`, actions right), 24px below
  it, then content. Content is fluid; Settings content caps at 960px.

### 3.5 Signature element

The brand mark is the hex cube (`M12 2l9 5v10l-9 5-9-5V7z` outline plus `M12 12l9-5M12 12v10M12 12L3 7`
inner edges). It is the only Atlas asset kept. In the sidebar it sits at 22px in `--brand` next to the
wordmark "Atlas" (15px, 600) with "Command Center" under it (11px label style).

The one ownable UI element: the **state dot**. An 8px circle in the status colour, always followed by
the state word. Working pulses. Needs-input gets a 1px ring at 40% opacity. It appears in the sidebar
footer (fleet summary), every agent row, every seat, every board card, and the browser title prefix
`(N)` when N agents need input. Nothing else carries status.

## 4. Shell

```
┌ sidebar 232 ───────┬ page ───────────────────────────────────────────────┬ drawer 440 (when open) ┐
│ [hex] Atlas        │ Title                                   [actions]   │ Agent name      [x]    │
│       Command Ctr  │ one-line description                                │ ● Working · 4m          │
│ project ▾          │ ───────────────────────────────────────────────────  │ [Terminal][Messages]    │
│ Overview           │ content                                             │ [Tasks]                 │
│ Agents           3 │                                                     │                         │
│ Board            2 │                                                     │                         │
│ Channels           │                                                     │                         │
│ Activity           │                                                     │                         │
│ Health           ! │                                                     │                         │
│ Improve            │                                                     │                         │
│ Projects           │                                                     │                         │
│ Settings           │                                                     │ composer                │
│ ───────────────    │                                                     │                         │
│ ● 2 working        │                                                     │                         │
│ ● Live  v14.0.0    │                                                     │                         │
│ [theme] [collapse] │                                                     │                         │
└────────────────────┴─────────────────────────────────────────────────────┴─────────────────────────┘
```

- Sidebar: brand, project select (native `<select>` styled; "All projects" + each project name),
  nav (icon 16px + label, count badge right when non-zero: Agents = needs input count, Board = blocked,
  Health = failing subsystems as "!"), footer with fleet summary line, live indicator (dot + "Live" or
  "Reconnecting" or "Offline"), version, theme toggle, collapse toggle.
- Keyboard: `g o`, `g a`, `g b`, `g c`, `g t` (activity), `g h`, `g i`, `g p`, `g s` navigate; `/` focuses
  the page search when present; `Esc` closes drawer/modal; `?` shows the shortcut list.
- Live data: one `EventSource` on `/api/v2/stream?token=`; topics update stores; pages subscribe.
  Fallback polling every `prefs.refresh_seconds` when the stream drops.
- Mobile (< 760px): sidebar becomes a top bar with the brand and a menu button; drawer becomes full
  screen. Everything must work at 390px wide.
- Error envelope: every failed mutation shows a toast with `error` and `why`, and `do` as a second line.

## 5. Pages

### 5.1 Overview

Header: "Overview" / "What needs you, what is running, what broke." Window segmented control
(24h, 7d, 30d) on the right.

Content, top to bottom:
1. **Needs you** panel. Rows: agents in `input` state (dot, name, project, "waiting 6m", button
   "Open") then `overview.attention[]` (severity dot, title, detail, action button). Empty: a single
   calm line "Nothing needs you." with the ok dot. This panel is first and full width.
2. **Numbers** row: six KPI tiles from `overview.kpis[]`: label (label style), value (22/600,
   tabular), delta in `--text-2` with sign, each tile links to its page. No sparklines unless the
   series exists (`runs`, `failures` from `overview.trend`).
3. Two columns: **Running now** (compact agent table, max 8 rows, "See all agents" link) and
   **Recent runs** (`overview.recent_runs[]`: time, project, kind, task, duration or "running").

### 5.2 Agents

Header: "Agents" / "Everything running on this machine, live." Actions: search input, state filter
chips (All, Needs input, Working, Ready, Done, Failed) with counts, buttons "Open shell", "Launch agent".

Content: one table grouped by project (group row = project name + counts). Columns: state (dot +
word), name (mono when it is a worker name, sans otherwise), kind (claude, omp, codex, shell, tui),
task (current task line, truncated), since (age, tabular), actions (icon buttons: Open, Prompt when
ready, Stop when a colony pane).

Row sources, merged client-side into one list keyed by `pane_id || address || name`:
- `/api/v2/agents` records (herdr panes, colony workers, channel participants).
- `/api/v2/term/seats` seats not already present (adds shells and the host TUI seat; a seat with
  `kind=shell` shows as kind "shell", state "ready").

Clicking a row opens the **drawer** (`agent=<key>` in the hash):
- Head: dot + name, kind, project, cwd (mono), age, deep link to herdr when `deep_link` exists.
- Tabs: **Terminal**, **Messages**, **Tasks**.
  - Terminal: xterm (vendored `dashboard_ui/vendor/xterm/`, keep those three files and licenses) in a
    440px-wide pane. Connect by `POST /api/v2/term/ticket {kind, target|cwd, cols, rows}` then
    `ws(s)://host/api/v2/term/ws?ticket=` with the documented frame protocol
    (client text `{"t":"in","d":...}` / `{"t":"resize",...}`; server binary = PTY bytes). `kind=pane`
    when the row has a `target`; `kind=shell` with `cwd` for shell seats; `kind=tui` for the host TUI
    seat. A row with no target and no shell shows `GET /api/v2/agents/<id>/peek?lines=40` as a
    read-only mono block with "Refresh", and the `attach_hint` sentence when the API gives one.
    "Expand" button opens the same terminal full-page inside the main area (route `#/agents?agent=&tab=terminal&full=1`).
  - Messages: `/api/v2/channels/<channel>` messages where the agent is `from` or `to`, newest last,
    mono bodies for agent-authored messages, sans for human. Composer at the bottom: "Message
    <name>" textarea + Send (`POST /api/v2/channels {channel,to,body,from:"you"}`), or "Prompt"
    (`POST /api/v2/agents/<id>/prompt {text}`) when the agent is ready. One composer, a segmented
    switch between Message and Prompt; Prompt disabled with a reason when not steerable.
  - Tasks: todos where `claimed_by`, `owner` or `launch.target` match, with status pills and "Open on
    board".
- Footer actions: Stop (confirm modal; only when `colony` and a pane exists; `POST /api/v2/herd/panes/<pane>/kill`).

"Open shell" opens the drawer on the host shell seat. "Launch agent" opens a modal: name (mono,
pattern `^[a-z][a-z0-9]*(-[a-z0-9]+)+$`), prompt (textarea), project (select), harness (claude | omp,
radio), submit `POST /api/v2/herd/panes`. Success toast "Launched <name>".

States: loading = 6 skeleton rows; empty = "No agents running." + "Launch agent" button; herdr
unreachable = a single inline notice at the top of the table ("herdr is not running, so only channel
participants are listed." + Recheck); web UI down = Open links disabled with title text.

### 5.3 Board

Header: "Board" / "Tasks Atlas and its agents are working through." Actions: project select
(only when sidebar project is All), "Add task".

Four columns: Open, In progress, Blocked, Done (Done collapsed to a count with "Show" link). Card:
content (2 lines max), phase label, owner dot + name, age. Card menu: Start, Mark done, Reopen,
Assign (select from agents), Remove. `POST /api/v2/todos {op,...}`. Archived hidden; "Show archived"
toggle in the header. Drag not required.

### 5.4 Channels

Header: "Channels" / "Messages between you and the agents." Two-pane: channel list (280px: name,
member count, last activity, unread dot) and feed. Feed rows: time (meta), from -> to, body (mono
when `from` is an agent), kind pill for `exit` and `system`. Composer: "To" select (channel members +
"everyone"), body, Send. Empty feed: "No messages yet."

### 5.5 Activity

Header: "Activity" / "Everything Atlas recorded, newest first." Filters: window (24h, 7d, 30d), kind
select (run, dispatch, gate, tool_error, finding...), group (project | kind | agent). Grouped table:
group row with count and last time, item rows: time, kind pill, project, agent, title; detail
expands inline on click.

### 5.6 Health

Header: "Health" / "Is Atlas itself working?" Window control.

Subsystem list: one row per `subsystems[]`: dot + status word, label, detail sentence, last ok /
last fail (relative time, tabular), 10-bucket bar sparkline from `history` (ok green, fail red), row
expands to evidence lines (mono). `measured:false` rows say "Not measured: <reason>" in `--text-2`,
no bar. Then **Silent failures** table and **Successes** list from the same payload.

### 5.7 Improve

Header: "Improve" / "What Atlas learned and what it wants to fix." Actions: "Re-measure", "Run
self-fix" (POSTs with toasts). Sections: Loop stages (the only numbered list in the UI), Findings
table (status, title, project, age; row expands to evidence), Lessons, Nudges. Everything from
`/api/v2/improve`.

### 5.8 Projects

Header: "Projects" / "Where Atlas has worked on this machine." Table: name (root as mono subline),
last active, runs 7d, agents active, open tasks, failures 7d, findings open, health dot. Row actions:
Pin, Hide (both via `PUT /api/v2/prefs`). Hidden projects in a collapsed section.

### 5.9 Settings

Header: "Settings" / "How Atlas behaves. Every row shows its current value." Search input on the
right filters rows across all sections.

Layout: left section list (sticky, 200px), right content capped at 960px. Sections, in order:
Dashboard, Sessions, Guardrails, Prompt optimizer, Scoring, omp extension, Storage, Advanced,
Connectors, Plugins and MCP servers.

Row anatomy (one `<div class="setting">` per key):

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ Completion gate                                            [ ● On  ] (switch)      │
│ Blocks a "done" claim that has no verified finding.                               │
│ Current: on (default) · applies to new sessions                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- Line 1: title, control right-aligned.
- Line 2: description sentence(s).
- Line 3 "Current:" line, always present: the value a new session will get, then the source in
  parentheses (`default`, `saved`, `shell env`), then when it applies (`applies now`, `new sessions`,
  `restart dashboard`). When the dashboard's own process env differs from the saved value, add:
  "This dashboard was started with <live value>; saved value wins for new sessions."
- Details (optional, collapsed `<details>` "More"): the long `details` text, the reading
  `file:line`, and the layers table.
- Controls by `kind`: `toggle` -> switch (instant save); `select` -> native select (instant save);
  `number` -> input with stepper and Save button, min/max shown as placeholder text; `model` ->
  select populated from the Ollama model list when available, else text; `url`/`text`/`command` ->
  text input + Save (command asks for confirmation as the API requires); `path` -> text input + Save.
- Read-only rows (`editable:false`): no control; the Current line explains why and shows the exact
  `export KEY=value` line to put in a shell profile, with a Copy button.
- Save feedback lives inside the row: "Saved" with the ok dot for 3 seconds, or the error sentence in
  `--fail` that stays until the next change. Never a toast for settings.
- Dashboard section: theme (segmented Dark/Light/System), density, default project, refresh seconds,
  activity noise, sidebar order (no reordering UI: dropped), self-fix scheduler. All via `/api/v2/prefs`.
- Connectors: one row per connector: name, status dot (configured/missing/errored), fields as
  password inputs with Save, Test button, last test result. Plugins and MCP: list with switches.

Search: filters rows by key, title, description; section list shows counts; empty state "No setting
matches <q>".

## 6. Component kit (one file `js/ui.js`, one `css/ui.css`)

`Button` (primary | default | ghost | danger, sizes sm | md, icon slot), `IconButton`, `Switch`,
`Select`, `Input`, `Textarea`, `Segmented`, `Badge` (status), `StateDot`, `Table` (head, rows, group
rows, empty row), `Panel` (title, actions, body), `KPI`, `Drawer`, `Modal` + `confirm()`, `Toast`,
`Skeleton`, `Empty` (title, body, action), `Tabs`, `Sparkline` (inline SVG bars), `Kbd`, `Copy`.
Icons: a small inline SVG set in `js/icons.js` (16 and 20 px, 1.5 stroke), no icon font.

DOM helper `h(tag, attrs, ...children)` and `replace(el, next)` in `js/dom.js`. No framework, no build.

## 7. Code layout (all new)

```
dashboard_ui/
  index.html
  css/ tokens.css  base.css  ui.css  shell.css  pages.css  settings.css  terminal.css
  fonts/ Geist-Variable.woff2  GeistMono-Variable.woff2  OFL-Geist.txt
  js/ app.js (boot, router, shell)  api.js (fetch, token, SSE, stores)  dom.js  icons.js  ui.js
      router.js  state.js (store, agent merge, status vocabulary)  shortcuts.js  theme.js
      pages/ overview.js agents.js board.js channels.js activity.js health.js improve.js projects.js settings.js
      drawer/ terminal.js messages.js tasks.js
      *.test.js  (node:test, pure modules only: router, state merge, settings model, format helpers)
  vendor/xterm/ (kept as is)
  design/ API.md (kept)  README.md (points here)
```

Tests run with `node --test plugins/atlas/scripts/dashboard_ui/js/`. The Python contract tests that
check `dashboard_ui/index.html` exists keep passing.

## 8. Settings backend contract (atlas_control.py)

`GET /api/behavior` must return, for every key in `groups[].knobs[]` and `advanced[]`:

- `documented: true` for every key. The `_AD` table gets a real sentence for each scanned key that
  lacks one (read the file:line in `ref` and describe what the value does; 19 keys today:
  ATLAS_AUTONAME, ATLAS_BUILTIN_AGENT_NUDGE, ATLAS_BURST_SECS, ATLAS_DOCTOR_HOOK_TTL_MIN,
  ATLAS_GATE_BLOCK_LOOP, ATLAS_HERDR_AUTOSTART, ATLAS_LEAD_AGENT, ATLAS_LEAD_IDLE_TTL, ATLAS_MODE,
  ATLAS_RIG_PORT, ATLAS_SCOPE_GATE, ATLAS_SEAT_BACKEND, ATLAS_SESSION_ID, ATLAS_SOURCE,
  ATLAS_STATUSLINE_CONFIG, ATLAS_TASKS_MIRROR, ATLAS_TERM_IDLE_S, ATLAS_TERM_TUI_CMD, ATLAS_TUI_BRIDGE,
  ATLAS_WT_GATE). Keys that are set by Atlas itself (session id, source, lead agent name) move to
  `_INTERNAL` instead of being documented as settings.
- `kind` is never `text` when the accepted values are finite: every key whose doc says "`off` ..." is
  a toggle (on/off); numeric keys (`_SECS`, `_TTL`, `_MIN`, `_S`, `_PORT`, thresholds) are `number`
  with a range; keys with a fixed vocabulary are `select` with `options`. Free text only for paths,
  URLs, model names, commands, and lists.
- `current` block: `{value, source: "default"|"saved"|"shell", applies}` where `value` is what a new
  session reads (store, then claude settings, then default; for shell scope: claude settings, omp
  config, shell rc, then default). `live` block: `{value, differs}` for the dashboard process env.
- `editable: bool` with `read_only_reason` when false (shell-scope keys the save path cannot reach,
  internal keys).
- Existing fields stay for compatibility.

`POST /api/behavior` is unchanged. A `node`/Python test covers: every advanced key documented;
no `text` kind for a key with finite values; `current` resolves store over default.

## 9. Acceptance (checked in a real browser, headless, against the repo source served on a spare port)

1. Every route renders with no console errors and no network 4xx/5xx except the documented
   herdr-down 503s when herdr is off.
2. Agents: the live lead agent appears, clicking it opens the drawer, the Terminal tab either streams
   or shows the attach hint; Open shell streams a real shell (type `echo ok`, see `ok`).
3. Settings: every row shows a Current line; toggling a switch persists (reload shows the new value);
   a select persists; a number out of range shows the range error inline; a text field persists;
   search narrows rows; zero rows say "Undocumented".
4. Board: add a task, move it to In progress, mark done, see it in Done count.
5. Channels: send a message to the lead channel, see it in the feed.
6. Light theme and 390px width: no clipped text, no horizontal scroll.
7. `node --test` passes; `python3 -m pytest plugins/atlas/scripts/test_atlas_dashboard.py
   plugins/atlas/hooks/test_atlas_contract.py -q` passes.

## 10. References

Mobbin screens consulted for the settings row and list-plus-detail patterns:
Mintlify settings (https://mobbin.com/screens/dfc67d57-50f5-473e-8567-7c1f11332e0b),
Replit user settings (https://mobbin.com/screens/093752e0-185b-45e6-b6b9-10ae944810a2),
Browserbase agents (https://mobbin.com/screens/91fff3d4-82a6-4d59-95bd-0da39f7d3d51),
Snowflake tasks (https://mobbin.com/screens/9c20b48a-7605-41fc-b000-c8ca4b18771e).
Taken from them: section label left, rows right; the control on the row's right edge; the current
value stated in words under the title; a single table with a status column as the agent list.

## 11. Settings key catalog

Produced by `behavior_state()` (plugins/atlas/scripts/atlas_control.py). Every entry also carries `current {value, source, applies}`, `live {value, differs}`, `editable`, `read_only_reason`. `current.value` is what a new session reads: hooks scope = store, then claude settings, then default; shell scope = claude settings, omp config, shell rc, then default. `current.source` is default|saved|shell. `live` is the dashboard's own process env. A toggle's `on`/`off` are the literal values saved; an empty `on` means clearing the key turns it on. Atlas-set keys (ATLAS_SESSION_ID, ATLAS_SOURCE, ATLAS_LEAD_AGENT, ATLAS_TUI_BRIDGE, ATLAS_TERM_TUI_CMD) are in `_INTERNAL` and not listed.

| Group | Key | Scope | Kind | Default | Doc |
|---|---|---|---|---|---|
| Session automation | `ATLAS_DASHBOARD` | hooks | toggle ('on'/'off') | `on` | Each new session launches this dashboard if it is not already running. |
| Session automation | `ATLAS_DASHBOARD_PORT` | hooks | number 1024-65535 | `7421` | Loopback port the dashboard listens on. |
| Session automation | `ATLAS_INGEST` | hooks | toggle ('on'/'off') | `on` | At session end, read the transcript into the telemetry database that feeds Overview, Activity and Health. |
| Session automation | `ATLAS_CHRONICLE` | hooks | toggle ('on'/'off') | `on` | Record what kind of work each session was, so atlas-doctor can mine patterns across sessions. |
| Session automation | `ATLAS_MEMORY_CAPTURE` | hooks | toggle ('on'/'off') | `on` | At session end, save durable lessons to ~/.atlas/memory/. Never creates skills or commands. |
| Session automation | `ATLAS_CONNECTOR_WATCH` | hooks | toggle ('on'/'off') | `on` | Warn in-session when a connector call fails because its credentials are missing or stale, instead of reporting a permissions problem. |
| Guardrails | `ATLAS_GATE` | hooks | toggle (''/'off') | `` | Blocks a 'done' claim that has no verified finding, and flags source changes with no matching docs/ update. |
| Guardrails | `ATLAS_TRIPWIRE` | hooks | toggle ('on'/'off') | `on` | Coaches a session back toward dispatching subagents when it does too much work inline. |
| Guardrails | `ATLAS_TRIPWIRE_HARD` | hooks | toggle ('on'/'off') | `on` | Allow the tripwire to deny a tool call instead of only advising. |
| Guardrails | `ATLAS_TRIPWIRE_THRESHOLD` | hooks | number 1-50 | `4` | How many inline operations an armed orchestration run may do before the tripwire acts. |
| Guardrails | `ATLAS_ENGINE_ARM` | hooks | toggle ('on'/'off') | `on` | Classify each prompt and arm the orchestration run up front, so substantive work is nudged toward dispatch before the first inline edit. |
| Guardrails | `ATLAS_FALLOW` | hooks | toggle ('on'/'off') | `on` | On git commit/push, run `fallow audit` and deny when the verdict is fail. Skipped when the fallow CLI is missing. |
| Prompt optimizer | `ATLAS_OPTIMIZE` | hooks | select: off, trigger, always | `trigger` | When the prompt optimizer runs: only for trigger prefixes, for every non-trivial prompt (adds model latency each time), or never. |
| Prompt optimizer | `ATLAS_OPTIMIZE_TRIGGER` | hooks | select: opt:,optimize:,++, opt:,optimize:, opt:, optimize:, ++ | `opt:,optimize:,++` | Comma-separated prompt prefixes that request optimization in trigger mode. |
| Prompt optimizer | `ATLAS_OPTIMIZER_MODEL` | hooks | model | `prompt-optimizer:latest` | Name of the local model that rewrites the prompt. |
| Prompt optimizer | `ATLAS_OLLAMA_URL` | hooks | url | `http://127.0.0.1:11434` | Where Ollama listens. When unset, $OLLAMA_HOST is used, then the default. |
| Prompt optimizer | `ATLAS_OPTIMIZE_MINLEN` | hooks | number 0-500 | `12` | Prompts shorter than this many characters skip the optimizer before any model call. |
| Prompt optimizer | `ATLAS_OPTIMIZE_TIMEOUT` | hooks | number 1-115 | `110` | Give up and pass the original prompt through after this long. Keep it under the 120 s hook timeout in hooks.json. |
| Prompt optimizer | `ATLAS_OPTIMIZE_CMD` | hooks | command | `` | Run this command instead of Ollama. `{prompt}` is substituted; otherwise the prompt is appended as the last argument. Blank uses Ollama. |
| Prompt optimizer | `ATLAS_OPTIMIZE_VERBOSE` | hooks | toggle ('1'/'') | `` | Print a one-line banner on stderr each time the optimizer rewrites a prompt. |
| Prompt optimizer | `ATLAS_OPTIMIZE_LOG` | hooks | text | `` | Append an original-to-optimized line to this file for every rewrite. Blank keeps no log. |
| Turn scoring | `ATLAS_TYPESAFE_SCORING` | hooks | toggle ('on'/'off') | `on` | Model-score recent assistant replies via api.typesafe.ai. Transcript excerpts leave this machine (secrets scrubbed). |
| Turn scoring | `ATLAS_TYPESAFE_MODEL` | hooks | model | `jev-latest` | Model id sent with every scoring request. |
| Turn scoring | `ATLAS_TYPESAFE_MAX_CALLS` | hooks | number 1-5000 | `200` | Upper bound on scoring requests one scoring pass may make. |
| omp extension | `ATLAS_HOOK_BRIDGE` | shell | toggle (''/'off') | `` | The omp extension runs atlas's Claude hooks inside omp. `off` disables every bridged guardrail under omp. |
| omp extension | `ATLAS_BRIDGE_HOOK_TIMEOUT_S` | shell | number 1-30 | `25` | Hard cap per bridged hook: the lower of this and the hook's own timeout. omp cuts a handler at 30 s. |
| omp extension | `ATLAS_WORKER_MAX_TOKENS` | shell | number 1000-200000 | `32000` | Atlas workers have any larger max_tokens request lowered to this. It is never raised. |
| omp extension | `ATLAS_ADVISOR_GATE` | shell | toggle (''/'off') | `` | Blocks stopping under omp while advisor items are open on the atlas board. `off` skips it. |
| Storage paths | `ATLAS_HOME` | shell | text | `/Users/jerry/.atlas` | Holds atlas.db, memory/, the saved-settings file, the dashboard pidfile and log. |
| Storage paths | `ATLAS_DB` | shell | text | `/Users/jerry/.atlas/atlas.db` | The sqlite file every hook writes to and this dashboard reads. Pointing elsewhere hides existing history. |
| Advanced | `ATLAS_AUTONAME` | hooks | toggle ('on'/'off') | `on` | `off` makes a dispatch of an atlas agent that carries no name a denial; on, the hook names it for you. |
| Advanced | `ATLAS_BUILTIN_AGENT_NUDGE` | hooks | toggle ('on'/'off') | `on` | `off` stops the dispatch check that denies a built-in agent type where an atlas agent should be used. |
| Advanced | `ATLAS_BURST_SECS` | hooks | number 0-600 | `10` | Seconds within which back-to-back dispatches trigger the burst advisory. 0 silences it. |
| Advanced | `ATLAS_CHANNELS` | hooks | toggle ('on'/'off') | `on` | `off` stops atlas steering subagent dispatches onto a colony channel. |
| Advanced | `ATLAS_COLONY` | hooks | toggle ('on'/'off') | `on` | `off` skips starting the herdr colony when a session begins. |
| Advanced | `ATLAS_COLONY_LIVE_WINDOW` | hooks | number 0-86400 | `1800` | Seconds an agent counts as live in the colony roster after its last activity. |
| Advanced | `ATLAS_COLONY_TRANSPORT` | shell | select: herdr, tmux, claude-bg | `tmux` | `herdr`, `tmux` or `claude-bg` forces a transport; the default is tmux when installed, else claude-bg (`claude --bg`). |
| Advanced | `ATLAS_DECISION` | hooks | toggle ('on'/'off') | `on` | `off` skips the local-model prompt classifier and keeps the regex result. |
| Advanced | `ATLAS_DECISION_MODEL` | hooks | model | `nimble` | Model the prompt classifier asks. |
| Advanced | `ATLAS_DECISION_URL` | hooks | url | `` | Loopback endpoint for the prompt classifier. Blank uses Ollama on 127.0.0.1:11434. |
| Advanced | `ATLAS_DOCS_REPAIR` | hooks | toggle ('on'/'off') | `on` | `off` skips the session-start check for a project that has no docs/ tree, and its notice. |
| Advanced | `ATLAS_DOCTOR_HOOK_TTL_MIN` | shell | number 0-1440 | `30` | Minutes a healthy atlas-doctor hook check stays fresh before it runs again. 0 runs it every time. |
| Advanced | `ATLAS_FOOTPRINT_FILES` | hooks | number 0-100 | `3` | Distinct code files an unflagged run may touch before the tripwire treats it as orchestration. 0 disables. |
| Advanced | `ATLAS_GATES` | hooks | select: on, always, off | `on` | `always` arms the orchestration gates even in scratch directories; `off` disarms them everywhere; `on` arms them only inside project directories. |
| Advanced | `ATLAS_GATE_BLOCK_LOOP` | hooks | number 1-7 | `3` | How many identical consecutive completion-gate blocks are allowed before the gate lets the stop through (1 to 7). |
| Advanced | `ATLAS_GATE_COLONY` | hooks | toggle ('on'/'off') | `on` | `off` skips the check that a run with two or more workers actually used its colony channel. |
| Advanced | `ATLAS_GATE_HEADER` | hooks | toggle ('on'/'off') | `on` | `off` skips the completion-gate check that a final reply starts with the ATLAS header line. |
| Advanced | `ATLAS_GATE_PHASES` | hooks | toggle ('on'/'off') | `on` | `off` skips the check that the board covers the required todo phases after code shipped. |
| Advanced | `ATLAS_GATE_REPORT` | hooks | toggle ('on'/'off') | `on` | `off` disables the gate that blocks a worker's final message when it is not the fixed report container. |
| Advanced | `ATLAS_HERDR_AUTOSTART` | hooks | toggle ('on'/'off') | `on` | `off` stops session start from launching the headless herdr server. |
| Advanced | `ATLAS_LEAD_IDLE_TTL` | shell | number 60-86400 | `7200` | Seconds an idle lead channel with no exit code is kept before it is treated as a crashed session. |
| Advanced | `ATLAS_LEAN_SHELL` | shell | toggle ('on'/'off') | `on` | `off` stops omp routing bash through lean-ctx. |
| Advanced | `ATLAS_MANDATES` | hooks | toggle ('on'/'off') | `on` | `off` silences the recall reminder and the one-time commit nudge. |
| Advanced | `ATLAS_MODE` | hooks | select: team, solo | `team` | `solo` relaxes the completion gate for a single-session run: one executed test command pairs with direct main-thread changes. `team` is the normal gate. |
| Advanced | `ATLAS_MUX_OMP_CONFIG` | shell | text | `~/.omp/agent/config.yml` | omp config file the colony reads model roles from. |
| Advanced | `ATLAS_MUX_OMP_EXTENSION` | shell | text | `` | omp extension path passed to colony workers. |
| Advanced | `ATLAS_PACKS_CACHE_ROOT` | shell | text | `<repo>/.atlas/.run/packs-cache` | Where the packs git cache lives. |
| Advanced | `ATLAS_PACKS_GIT_TIMEOUT` | shell | number 0-86400 | `60` | Seconds before a packs git operation is abandoned. |
| Advanced | `ATLAS_REMOTE_PORT` | shell | number 1-65535 | `8443` | Tailnet port for remote colony access, clamped to 1024-65535. |
| Advanced | `ATLAS_RIG_PORT` | shell | number 1024-65535 | `7437` | Local port of the rig seat backend. |
| Advanced | `ATLAS_SCOPE_GATE` | hooks | toggle ('on'/'off') | `on` | `off` turns the missing-SCOPE dispatch denial into an advisory. |
| Advanced | `ATLAS_SEAT_BACKEND` | shell | select: auto, rig, herdr, off | `auto` | `rig`, `herdr` or `off` forces the seat backend for colony panes; `auto` detects rig, then herdr. |
| Advanced | `ATLAS_SELFFIX` | shell | toggle ('1'/'0') | `1` | `0` disables the dashboard's self-fix scheduler. |
| Advanced | `ATLAS_STATUSLINE_CONFIG` | shell | text | `~/.omp/agent/usage-statusline.json` | JSON file the usage statusline reads its settings from. |
| Advanced | `ATLAS_STOP_BRIDGE` | shell | toggle ('on'/'off') | `on` | `off` disables only omp's session-end bridge. |
| Advanced | `ATLAS_STYLE` | shell | toggle ('on'/'off') | `on` | `off` stops omp injecting the atlas output style. |
| Advanced | `ATLAS_TASKS_MIRROR` | shell | toggle ('on'/'off') | `off` | `on` adds a paragraph to colony worker prompts asking them to mirror the atlas board into TaskCreate. |
| Advanced | `ATLAS_TERM_IDLE_S` | shell | number 10-86400 | `900` | Seconds a Command Center terminal may sit with no client attached before it closes. |
| Advanced | `ATLAS_TODO` | hooks | toggle ('on'/'off') | `on` | `off` stops copying the session's todo list onto the atlas board. |
| Advanced | `ATLAS_TYPESAFE_URL` | hooks | url | `https://api.typesafe.ai` | Alternate scoring endpoint. A loopback URL scores locally with no API key. |
| Advanced | `ATLAS_WT_GATE` | hooks | toggle ('on'/'off') | `on` | `off` skips the completion-gate check for unmerged or dirty worker worktrees. |
