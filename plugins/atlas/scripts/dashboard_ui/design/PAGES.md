# Atlas Command Center: pages

Read `MASTER.md` first (tokens, components, shell, navigation). This file gives, for each page: purpose, wireframe (1280 wide, comfortable), data contract (endpoints that exist today, read from `atlas_dashboard.py`, `atlas_dash_insights.py`, `atlas_dash_work.py`, `atlas_dash_irc.py`, `atlas_dash_herd.py`, `atlas_herdr.py`), states, and interactions.

Conventions
- All `GET /api/v2/*` accept `?project=<root|all>`; mutations need header `X-Atlas-Token` (the `<meta name="atlas-token">` value) and return the `{ok:false,error,why,do}` envelope on failure.
- "[GAP Gn]" marks a data need that today's endpoints do not satisfy. Each page works without its gaps (the fallback is stated); gaps are listed once in section 12 for the backend owner.
- Page ids and aliases are in MASTER section 8. Every page reads `project`, `window`, `agent` from the hash query and writes them back, so every view is a shareable deep link.
- Header of every page: `h1` (`--fs-xl`), then page filters on the right (window tabs, search), then actions. Sticky, 56px.

Common shell regions (not repeated per page): rail with live herdr tree (left), top bar with Fleet Strip, version chip, live pill, attention pill (top), inspector drawer (right).

Endpoint index (exists today)

| Area | Endpoint |
|---|---|
| Version/health probe (no token) | `GET /api/health` |
| Live push | `GET /api/v2/stream` (SSE; events `herd`, `agents`, `todos`, `irc`, `health`, `improve`) |
| Projects | `GET /api/v2/projects` |
| Overview | `GET /api/v2/overview?window=24h|7d|30d` |
| Activity | `GET /api/v2/activity?since=&kind=&group=project|kind|agent&limit=` |
| Health | `GET /api/v2/health?window=` |
| Improve | `GET /api/v2/improve`, `POST /api/v2/improve/finding`, `POST /api/v2/improve/remeasure`, `POST /api/v2/improve/selffix` |
| Prefs | `GET|PUT /api/v2/prefs` |
| Herd agents | `GET /api/v2/herd/agents`, `GET /api/v2/herd/status`, `GET /api/v2/herd/colony`, `POST /api/v2/herd/agents/<pane>/prompt`, `POST /api/v2/herd/ensure`, `POST /api/v2/herd/panes`, `POST /api/v2/herd/panes/<pane>/kill` |
| Work board | `GET /api/v2/todos?project=&archived=`, `POST /api/v2/todos` with `op` in add, update, status, remove, claim, assign, move, reorder, start, restore |
| Channel | `GET /api/v2/irc?project=&since=&agent=&limit=`, `POST /api/v2/irc` |
| Settings (legacy v1 still used) | `/api/connectors`, `/api/connectors/export|env|import|test`, `/api/behavior`, `/api/ecosystem`, `/api/mcp/toggle|add|remove`, `/api/plugins/toggle`, `/api/agents[/<name>]`, `/api/memory` |
| Other v1 | `/api/status`, `/api/projects`, `/api/sessions[/<id>/transcript]`, `/api/findings`, `/api/runs`, `/api/todo` |

Payload shapes used below (read from source): agent row `{pane_id, workspace_id, workspace, tab_id, agent, status, cwd, title, focused, state_change_seq, completion_seq, deep_link}`; `agents` response `{ok, herdr:{reachable,reason}, web_ui:{healthy,url,auth_required}, counts:{working,blocked,idle,done,unknown}, workspaces:[{workspace_id,label,focused,agent_status,pane_count}], agents:[...], fetched_ms}`; todo view `{id, content, status:open|in_progress|done|blocked, phase, owner, claimed_by, updated, origin, evidence, launch, live, archived_reason}` inside `{project, phases:[{name,items}], counts:{open,in_progress,done,blocked}, updated}` (all-projects items also carry `project`); irc message `{id, ts, from, to, body, kind:note|irc|exit|system, status, tracked, run, project, channel}` inside `{messages, agents, channels, more}`; overview `{kpis:[{id,label,value,delta,status,hint}], attention:[{id,severity,project,title,detail,count,first,last,action:{label,target}}], recent_runs:[{id,project,started,ended,task,kind,model}], trend:{labels,series:[{name:"runs"|"failures",values}]}, enforcement, tool_errors}`; activity `{groups:[{key,label,count,last,items:[{ts,kind,project,agent,title,detail,status,class,count,ref:{table,id}}]}]}`; projects `{projects:[{root,name,last_active,runs_7d,agents_active,todos:{open,done},health,failures_7d,enforcement_7d,tool_errors_7d,findings_open}], findings_open}`; health `{subsystems:[{id,label,status,detail,last_ok,last_fail,evidence[]}], silent_failures:[{id,kind,count,project,sample,hint,first,last,source}], successes:[{kind,count,last}], enforcement, tool_errors}`; improve `{loop:{stages}, findings, ledger, nudges, lessons, scores, by_rule, improvements, asset_verdicts, enforcement, selffix}`.

---

## 0. The join: one entity, four lenses

The Agents canvas (Fleet, Board, Channel, Colony) is one entity model built client-side from four sources and refreshed by SSE. This is how the herdr data, tasks and channel become one live surface instead of four pages.

```
AgentRecord {
  key        // stable id: pane_id when a herdr pane exists, else worker name
  name       // worker name if title/label matches /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/ (same rule as the old host), else herdr title
  kind       // agents[].agent  (omp, claude, codex, shell, unknown)
  state      // agents[].status -> MASTER 5.2 (blocked -> input)
  pane_id, workspace_id, workspace, cwd, deep_link, focused
  project    // project root whose path is a prefix of cwd (from /api/v2/projects[].root), else null
  tasks[]    // todos where claimed_by===name || owner===name || launch.target===pane_id
  messages[] // irc messages where from===name || to===name || from/to===pane_id
  colony     // true when pane_id appears in GET /api/v2/herd/colony panes[]
  children[] // subagents  [GAP G2]
  since      // age: client clock minus first time this state_change_seq was seen (no server timestamp) [GAP G4]
}
```

Sources and refresh: `/api/v2/herd/agents` (event `herd`), `/api/v2/todos` (`todos`), `/api/v2/irc` (`irc`), `/api/v2/herd/colony` (polled at 8s, only while the Colony lens or the rail tree is visible), `/api/v2/projects` (once, then 60s). All four are fetched with the same `project` filter. A failure in one source degrades only the columns it feeds, never the list (MASTER 9.14).

---

## 1. Overview (`#/overview`)

Purpose: the 5-second answer. Who needs me, what is happening, what broke, is the system healthy.

```
┌ Overview                                   [24h][7d][30d]  [Refresh] ───────────────────────────────┐
│ ┌ Needs you ───────────────────────────────┐ ┌ Fleet now ───────────────────────────────────────┐ │
│ │ ⬡! omp · Redesign Herd page   Needs input │ │     ⬡ ⬡ ⬡       3 working   2 ready   1 needs   │ │
│ │     waiting 6m             [Open terminal]│ │    ⬡ ⬡ ⬡ ⬡      honeycomb of agents (cells 56x64) │ │
│ │ ▲ Hooks  3 circuit-breaker trips  [Health]│ │     ⬡ ⬡                    [Open Agents]         │ │
│ │ ▲ 2 blocked todos             [Open Board]│ └───────────────────────────────────────────────────┘ │
│ │ (empty: ✓ Nothing needs you)              │                                                       │
│ └───────────────────────────────────────────┘                                                       │
│ ┌ KPI ─────┐ ┌ KPI ─────┐ ┌ KPI ─────┐ ┌ KPI ─────┐ ┌ KPI ─────┐ ┌ KPI ─────┐                       │
│ │ Runs 41  │ │Dispatches│ │ Silent   │ │ Tool     │ │ Findings │ │ Blocked  │   (sparkline each)    │
│ │ ▁▂▅▃▆ +4 │ │ 118      │ │ failures │ │ errors   │ │ open 12  │ │ todos 2  │                       │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘                       │
│ ┌ Runs and failures ─────────────────────────────┐ ┌ Recent runs ──────────────────────────────────┐ │
│ │ bar series (runs) + line (failures), 7d        │ │ 14:02  tech-tools  omp  "Fix terminal…"  42m  │ │
│ │ [Show data]                                    │ │ 13:40  gwh-first…  claude  "Plaid sync"  done │ │
│ └────────────────────────────────────────────────┘ └───────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Data:
- Needs you = agents with `state=input` (from `/api/v2/herd/agents`) first, then `overview.attention[]` sorted fail before warn (use `action.target`, form `health#<id>` or `work#blocked`, to deep link: `health#x` -> `#/health#x`, `work#blocked` -> `#/agents?lens=board&status=blocked`).
- Fleet now = honeycomb of AgentRecords from `/api/v2/herd/agents`, counts from `counts`.
- KPI tiles = `overview.kpis[]` in returned order; ids today: `runs`, `dispatches`, `silent_failures`, `tool_errors`, `findings_open`, `todos_blocked`. Sparkline = `overview.trend.series` for `runs` and `failures`; the other tiles have none yet [GAP G5: per-KPI series], so they omit the sparkline rather than draw a flat line. Targets: runs -> Activity?kind=run, dispatches -> Activity?kind=dispatch, silent_failures/tool_errors -> Health, findings_open -> Improve, todos_blocked -> Agents Board.
- Chart = `overview.trend` (labels are ISO buckets: hourly if window < 2d else daily).
- Recent runs = `overview.recent_runs[]`; row click opens inspector with run detail (id, model, project, start/end) and links to Activity (`ref.table=runs`).
- Refresh: window tab or `r`; SSE `health` event refreshes the attention column.

States: loading = skeleton of the real grid. Empty (fresh install, no runs): the page keeps its layout, tiles show `0`, "Needs you" says "Nothing needs you", Fleet now says "No agents running" with [Launch agent]. herdr down: only the Fleet now panel shows the 9.14 layer-2 state; everything else unaffected. Error: whole-page State only if `/api/v2/overview` fails; otherwise per-panel stale marker.

---

## 2. Agents canvas (home of Colony, Herd, IRC, Work)

`#/agents?lens=fleet|board|channel|colony&agent=<key>&tab=now|channel|tasks|terminal&project=&q=`

One page, four lenses, one inspector. Sticky header: title "Agents", state counts as chips (Needs input N, Working N, Ready N, Done N, Failed N; click filters), search, lens segmented control, `Launch agent` primary button.

### 2.1 Fleet lens (was Herd): every herdr workspace, tab, pane, agent

```
┌ Agents                  [Needs 1][Working 3][Ready 2][Done 4]   🔎 filter   [Fleet|Board|Channel|Colony]  [Launch agent] ┐
│ ▾ tech-tools · 3 panes                                                                                 ⬡⬡⬡ roll-up      │
│ ┌ card ───────────────────┐ ┌ card ───────────────────┐ ┌ card ───────────────────┐                  ┌ INSPECTOR ──────────┐
│ │ ⬡! Redesign Herd page   │ │ ⬡◔ Fix terminal display │ │ ⬡  tech-tools (omp)     │                  │ ⬡ Redesign Herd pa… │
│ │ omp · wA:p3             │ │ omp · wA:p1             │ │ omp · wA:p2             │                  │ [Needs input] 6m    │
│ │ Waiting on you in term. │ │ Editing PaneTerminal…   │ │ Idle since 12:10        │                  │ Now│Channel│Tasks│Term│
│ │ [Needs input] 6m  [Open]│ │ [Working] 4m      [Open]│ │ [Ready] 2h        [Open]│                  │ cwd  /Users/…/tech- │
│ └─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘                  │ task Redesign Herd… │
│ ▾ gwh-firstrespondersapp · 1 pane                                                                     │ ─ last activity ──  │
│ ┌ card ───────────────────┐                                                                           │ 14:02 edit herd.js  │
│ │ ⬡✓ first-responders     │                                                                           │ ┌ composer ───────┐ │
│ └─────────────────────────┘                                                                           │ │Prompt|Post  [Send]│ │
│                                                                                                       └─────────────────────┘
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Grouping: by herdr workspace (`agents[].workspace`, count from `workspaces[].pane_count`), groups ordered by worst state, cards inside ordered by urgency. Toggle "Group by project" (uses `AgentRecord.project`). View toggle: Cards / List (agent rows, 9.2) / Map (honeycomb at `--cell`).
- Card contents 9.3. "Now" line = newest of: unread irc message addressed to the agent, the claimed todo `content`, `agents[].title`. Counts: `tasks.length`, `messages.length`.
- Actions per agent: Open terminal (inspector Terminal tab), Prompt (only if Ready), Message (Post mode), Assign task (todos op `assign`), Stop (colony panes only: `POST /api/v2/herd/panes/<pane>/kill`, modal confirm; non-colony panes have no Stop, the menu item is absent, not disabled).
- Launch agent: modal form (name, prompt, project select, harness omp|claude, run) -> `POST /api/v2/herd/panes {name,prompt,project,harness,run}`; success toast "Launched <name> in <project>", the new card arrives via SSE with `data-fresh`.
- Subagents: nested under the parent as small hexes on the card footer and as indented rows in the rail tree and List view [GAP G2: no parent/child link in agents payload; fallback: show dispatches from `GET /api/v2/activity?kind=dispatch&group=agent` as a "Dispatched" list in the parent's Now tab, no nesting].

States:
- Loading: 6 skeleton cards.
- Empty (herdr reachable, zero agents): "No agents running" / "Start one in herdr or launch one from Atlas." / [Launch agent].
- herdr unreachable: layer-2 State replaces the canvas ("herdr isn't running", [Recheck]); rail tree shows the same single line.
- Web UI down: cards render normally; only Open terminal buttons switch to "Start terminal service" (layer 3).
- Partial (todos or irc source failed): cards render; the affected count shows `-` with title "Tasks unavailable: <why>".
- Stale: MASTER 9.13.

### 2.2 Board lens (was Work)

```
┌ Agents · Board     project [tech-tools ▾]   phase [All ▾]   🔎    [Fleet|Board|Channel|Colony]   [Add task] ┐
│ Open 8              In progress 3             Blocked 2               Done 14                                │
│ ┌ task ─────────┐   ┌ task ─────────────┐     ┌ task ─────────────┐   ┌ task ─────────────┐               │
│ │ Wire health…  │   │ Redesign Herd page│     │ Fix auth gate     │   │ Vendor fonts      │               │
│ │ phase impl    │   │ ⬡◔ omp wA:p3  4m  │     │ ⬡! implementer-a  │   │ ✓ evidence ▸      │               │
│ │ [Start][Assign]│  │ [Open terminal]   │     │ blocked: needs key│   │                   │               │
│ └───────────────┘   └───────────────────┘     └───────────────────┘   └───────────────────┘               │
│ phase groups collapse; unphased last                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Columns = todo `status` (Open, In progress, Blocked, Done); counts from `todos.counts`. Inside a column, tasks group by `phase` (order from payload). All-projects view is read-only (writes need one project: header shows "Pick a project to edit" on the Add button tooltip).
- Task card: content (clamped 3 lines), phase chip, owner/claimed agent as a mini AgentRecord (hex + name; click opens the agent in the inspector), `live:true` shows the working hex with the pane id, `evidence` expands under the card (mono), `updated` age.
- Actions via `POST /api/v2/todos {project, op, id, ...}`: Add (`add`), edit (`update`), status move by drag or menu (`status`; also keyboard `Shift+←/→` on a focused card), Claim (`claim`), Assign to a ready agent (`assign` with `launch` when starting a new pane; else `assign`), Start (`start`: opens a worker pane through `atlas_launch`), Move phase (`move`), Reorder (`reorder`), Remove (modal confirm), Restore from archive (`restore`, list via `archived=1`).
- Drag and drop is an enhancement; every move has a menu and keyboard path.
- Empty: "No tasks on this board" / "Tasks you or agents add show up here." / [Add task]. Error on write: inline on the card using `error`+`why`+`do`, card reverts.
- SSE `todos` refreshes; changed cards `data-fresh`.

### 2.3 Channel lens (was IRC)

```
┌ Agents · Channel    [All ▾ channel]  agent [any ▾]   🔎    [Fleet|Board|Channel|Colony] ────────────────┐
│ ┌ presence ───────┐ ┌ messages ─────────────────────────────────────────────────────────────────────┐ │
│ │ ⬡◔ implementer-a │ │ ── Today ──                                                                  │ │
│ │ ⬡! reviewer-b    │ │ 14:02  implementer-a → @human   Finished herd.js; tests pass        ✓✓      │ │
│ │ ⬡  omp·tech-tools│ │ 14:05  human → @reviewer-b     please re-check the gate                ✓ read │ │
│ │ ⬡✓ verifier-c    │ │ 14:06  ⬡ implementer-a exited 0                                              │ │
│ │ channels: all    │ │ ┌ composer: To [reviewer-b ▾]  [Prompt agent|Post to channel]  [Send] ┐      │ │
│ │ @reviewer-b      │ │ └────────────────────────────────────────────────────────────────────┘      │ │
│ └─────────────────┘ └───────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Left presence column = AgentRecords (state glyph = presence) plus `irc.channels` (`all`, `@name`). Click filters `agent=`.
- Messages = `GET /api/v2/irc` (200 newest; `since=<id>` + `more` pages forward during a burst). Render per 9.11; `kind:"exit"` parsed from the body (`exit N [failed: …]`) into an event row.
- Send: `POST /api/v2/irc {project, to, body, from:"human"}`. `project` is required: if the filter is All, a project select appears in the composer. Delivery: response `delivered:true` means typed into an idle claude/omp pane; otherwise "recorded on the board, the worker reads it on its next tool call" (the server's `next` text, shown as-is). `409` refused: show the message under it with the `why`.
- Empty: "No messages yet" / "Agents and you can leave notes for each other here." / [Post a message].

### 2.4 Colony lens (was Colony)

The atlas-launched worker panes (herdr workspaces labelled `atlas-*`), joined with their tasks.

```
┌ Agents · Colony     run [all ▾]                [Fleet|Board|Channel|Colony]   [Launch agent] ┐
│ atlas-2026-10-07a  ·  4 panes                                                                 │
│ ┌ tile 280x168 ──────────┐ ┌ tile ─────────────────┐ ┌ tile ─────────────────┐                │
│ │ ⬡◔ implementer-auth    │ │ ⬡! reviewer-api       │ │ ⬡✓ verifier-tests     │                │
│ │ task: Wire login guard │ │ task: Review gate     │ │ task: Run suite       │                │
│ │ (mono) last output ... │ │ waiting on you        │ │ done 0 failed         │                │
│ │ [Open terminal][Prompt]│ │ [Open terminal]       │ │ [Open terminal]       │                │
│ └────────────────────────┘ └───────────────────────┘ └───────────────────────┘                │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Source `GET /api/v2/herd/colony`: `{ok, ...status, panes:[{pane_id, workspace_id, workspace, tab_id, label}], panes_error}`. Tiles = panes joined to `/api/v2/herd/agents` by `pane_id` for state, and to todos by `launch.target`.
- Tile "last output" lines require [GAP G1]; without it the tile shows `cwd` and the claimed task and no mono block.
- Stop = `POST /api/v2/herd/panes/<pane>/kill` (colony only), modal confirm "Stop implementer-auth? Its pane closes; unsaved work in that pane is lost."
- Degraded: `panes_error` set -> one State (layer 2 wording) in place of the tiles; the status banner never repeats "web UI" wording when `healthy` is true.

### 2.5 Inspector (shared by all lenses)

Specified in MASTER 9.6. Deep link `#/agents?agent=<key>&tab=terminal`. Terminal tab: iframe of `agents[].deep_link` when `web_ui.healthy`; if `web_ui.auth_required` is true the tab shows "Terminal service needs sign-in" with an "Open in new tab" link to `web_ui.url` (cookies cannot be shared into a sandboxed frame without it).

### 2.6 Rail tree (the herdr list, native)

Data: the same `/api/v2/herd/agents` payload; groups by `workspaces[]` (label, `pane_count`, `agent_status` roll-up), agents beneath. Tab strip is not shown: `tab_id` has no label in the payload [GAP G2], so panes of one workspace are a flat list ordered by urgency. Behaviour in MASTER 7.1. Empty/degraded: a single line under the group header using the 9.14 wording.

---

## 3. Activity (`#/activity`)

Purpose: what happened, in order, across projects and agents; find the thing that broke.

```
┌ Activity            group [Project|Kind|Agent]   kind [All ▾]   project [All ▾]   🔎      [Refresh] ───────────┐
│ ┌ list (flex 1) ─────────────────────────────────────────────────┐ ┌ INSPECTOR: record ─────────────────┐ │
│ │ ▾ tech-tools · 42 events · last 2m                              │ │ Run 8f3a… omp                      │ │
│ │  14:02 ⬡ run   Fix terminal display issues        omp           │ │ started 14:02  ended -  42m        │ │
│ │  13:58 ▲ gate  Bash denied: rm -rf                x3            │ │ model · project · task             │ │
│ │  13:40 ✓ tool  write herd.js                                    │ │ Related: findings, todos           │ │
│ │ ▸ gwh-firstrespondersapp · 9 events · last 3h                   │ │ [Open in Agents] [Copy id]         │ │
│ └─────────────────────────────────────────────────────────────────┘ └────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Data: `GET /api/v2/activity?since=<iso|epoch>&kind=&group=&limit=` -> `groups[].items[]`. Item `status` -> glyph; `class` (tool fault vs model misuse vs environment) as a chip; `count>1` shows `xN`. `ref {table,id}` opens the record in the inspector (runs -> detail from `overview.recent_runs` or `/api/runs`; findings -> Improve finding; todos -> Board). `agent` links to the Agents inspector when it matches an AgentRecord. Kind/project filters and noise prefs (`prefs.noise`, `muted_kinds`, `muted_projects`) apply client-side.
States: empty "No activity in this window" / "Widen the window or clear filters." / [Clear filters]; loading skeleton rows; error State with Retry. Live: polling at `refresh_seconds`; new items `data-fresh` and a "N new" bar when scrolled down.

---

## 4. Health (`#/health`): redesigned with real last-ok/last-failure, sparklines, evidence

Purpose: trust. Which subsystem is broken, since when, with what evidence, and what to do. Replaces the grid where every tile said "Last OK never / Last failure never / unknown".

What was wrong (observed): in `atlas_dash_insights._health_payload` several subsystems pass `last_ok=None` unconditionally (gates, colony/mux, telemetry DB, doctor) so the UI printed "never" even when status was ok; "unknown" means the source file or table is absent (no hookstate, no `MEMORY.md`, no nudge stamp, empty `dispatches`, missing dashboard log) and was shown as a failure-looking neutral tile with no cause. The user's screenshot shows exactly this (Hooks, Dispatch, Dashboard daemon, Memory capture, Nudge, Chronicle ingest "unknown"). Whether that screenshot's database was empty or partially wired is for the diagnosis task; the design below is correct for both.

```
┌ Health                                            [24h][7d][30d]   [Refresh] ─────────────────────────────┐
│ ✓ 8 healthy   ▲ 1 warning   ✕ 0 failing   3 not measured            checked 14:02:11 · window 7d         │
│ ┌ Needs attention ───────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ▲ Connectors  6 of 12 need attention (6 unconfigured)   last failure 2d ago        [Show evidence] │ │
│ └─────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ Subsystems                                                                                              │
│ ┌ row ────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ✓ Hooks            Healthy   17 sessions tracked, 0 trips   ▁▁▂▁▁▁▁▂▁▁  last OK 2m ago · no failures │ │
│ │ ✓ Gates and denies Healthy   0 denied calls in window       ▁▁▁▁▁▁▁▁▁▁  last OK 14:02 · -           │ │
│ │ ◇ Memory capture   Not measured   No MEMORY.md in ~/.atlas/memory   [How to enable]                  │ │
│ │ ✕ Dispatch         Failing   4 unclassified dispatches      ▁▃▅▇▅▂▁▁▁▁  last OK 3h ago · failed 12m  │ │
│ │    ▸ Evidence (4)                                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Silent failures (table) ─────────────┐ ┌ Tool errors by cause ─────────┐ ┌ Enforcement (not faults) ┐ │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Layout: rows, not tiles. One row per subsystem (height 44, expands to show evidence), grouped by severity: Needs attention (fail then warn), Healthy, Not measured. Row columns: state hex + word, name, detail sentence, 10-bucket sparkline (80 x 20), timing column, chevron. Header summary line counts each class and shows "checked <time>" (the time of the response, not "never").

Timing column copy (replaces "Last OK / Last failure"):
- status ok and `last_ok` present: "OK 2m ago" + (`last_fail` present ? "failed 3h ago" : "no failures this window").
- status ok and `last_ok` null: "Verified at 14:02" (the response time; the check ran live) + failure part as above. Never "never".
- fail/warn: "Failing since <first failure in window>" when known, plus "last OK <age>" or "no success seen this window".
- `unknown`: state "Not measured", detail = the reason (below), no timing column, a link "How to enable".

"Not measured" reasons (shown as detail; from the code's source checks): hooks "No hook state recorded yet. Hooks write it after the first session." ; dispatch "No dispatches recorded in the database." ; dashboard "Dashboard log file not found." ; memory "No MEMORY.md in the state directory." ; nudge "No nudge has fired yet." ; chronicle "No transcript ingest has run yet." Each has a [How to enable] disclosure with the one action (command or setting) rather than a link-out.

Data today (works now, no backend change): `GET /api/v2/health?window=` -> `subsystems[]`. Client mapping for the failure side from `silent_failures[]` (`kind`, `last`, `first`, `count`, `sample`, `hint`): hooks <- `hook_crash`, `hook_burst_tripped`; dispatch <- `dispatch_unclassified`; mux <- `agent_stuck`; dashboard <- `dashboard_error`; doctor <- `doctor_miner_error`; chronicle <- `ingest_stalled`. Success side from `successes[]` (`kind,count,last`) is shown in the "Healthy operations" strip. Evidence = `subsystems[].evidence[]` as mono lines (copyable) plus the matching `silent_failures[].sample` and `hint` ("What to do").
Sparkline and honest `last_ok`: [GAP G3] add per subsystem `history:[{t,ok,fail}]` (10 buckets across the window), real `last_ok` for gates (newest non-denied `tool_calls.ts`), mux (newest `runs.ended_at`), db (now), doctor (newest `findings` update), connectors (already `usage.last_used`), and `reason` for `unknown`. Until then: sparklines are omitted (not drawn flat), and `last_ok:null` with status ok renders "Verified at <response time>".

Below the subsystem list: Silent failures table (kind, count, project, sample, last; row opens inspector with `hint` as "What to do", first/last seen, source), Tool errors by cause (model misuse vs environment; "not atlas faults" note kept), Enforcement (denies and gate blocks; "working as designed" note kept), as three flat panels, not three identical cards.

States: loading = skeleton rows; all healthy = the summary line becomes "All clear" and the attention panel is replaced by one quiet line "Nothing needs attention"; error = State with Retry; stale = MASTER 9.13. SSE `health` refreshes rows and marks changed ones.

---

## 5. Work (lens of Agents)

Section 2.2. Route `#/work` redirects to `#/agents?lens=board`. The page-level difference from before: tasks are linked to the agents doing them (click through to the inspector), and start/assign create or reuse real panes.

## 6. IRC (lens of Agents)

Section 2.3. Route `#/irc` redirects to `#/agents?lens=channel`. The host's "Notes" label maps here.

## 7. Herd (lens of Agents)

Section 2.1. Route `#/herd` redirects to `#/agents?lens=fleet`.

## 8. Colony (lens of Agents)

Section 2.4. Route `#/colony` redirects to `#/agents?lens=colony`. (Current `NAV` labels `herd` as "Colony"; the new label "Colony" belongs to this lens only.)

---

## 9. Improve (`#/improve`)

Purpose: the self-improvement loop: observe, mine, propose, apply, re-measure; findings and what was learned.

```
┌ Improve                                                         [Refresh] ──────────────────────────────┐
│ Loop   ① Observe 1,204 ──▶ ② Mine 38 ──▶ ③ Propose 6 ──▶ ④ Apply 4 ──▶ ⑤ Re-measure 3                    │
│ ┌ Findings ────────────────────────────────────┐ ┌ Score over time ────────┐ ┌ Self-fix ──────────────┐ │
│ │ ✕ high  gate-bypass-pattern   x14  open       │ │ line chart per rule     │ │ ● enabled, every 30m   │ │
│ │ ▲ med   hook-slow-start       x3   proposed   │ │ [Show data]             │ │ max concurrent 2       │ │
│ │ (row: [Re-measure] [Dismiss] [Open evidence]) │ └─────────────────────────┘ │ [Run now]              │ │
│ └───────────────────────────────────────────────┘ ┌ Lessons / nudges ───────┐ └────────────────────────┘ │
│                                                   └─────────────────────────┘                            │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The loop stages are a real sequence, so numbered markers are correct here (and only here). Data: `GET /api/v2/improve` (`loop.stages` each `{id,label,count,status}` with ids observe, mine, propose, apply, remeasure; `findings`, `ledger`, `nudges`, `lessons`, `scores {labels,series}`, `by_rule`, `improvements {verdicts,items}`, `asset_verdicts`, `enforcement`, `selffix`). Actions: `POST /api/v2/improve/finding` (set status), `POST /api/v2/improve/remeasure`, `POST /api/v2/improve/selffix` (run now / enable). Finding row opens the inspector with evidence, ledger history and verdict. SSE `improve`. States: empty "No findings yet" / "Findings appear after Atlas mines a few sessions." ; error State.

---

## 10. Projects (`#/projects`)

```
┌ Projects                              🔎   sort [Last active ▾]   [Show hidden] ────────────────────────┐
│ Name            Agents  Runs 7d  Todos open  Failures 7d  Findings  Health     Last active              │
│ ⭐ tech-tools     ⬡⬡⬡ 3    41       8           2          12      ▲ Warning   2m ago     [Open ▾]       │
│ gwh-firstresp…    ⬡ 1      9        0           0          0       ✓ Healthy   3h ago                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Data: `GET /api/v2/projects` (`projects[]` with `root,name,last_active,runs_7d,agents_active,todos{open,done},health(idle|ok|warn|fail),failures_7d,enforcement_7d,tool_errors_7d,findings_open`). Agents column hexes are the AgentRecords whose `project` matches (live from herd). Pin/hide persist via `PUT /api/v2/prefs {pinned_projects, hidden_projects}`. Row click sets the global project filter (`project=<root>`) and opens Overview; row menu: Open Board, Open Activity, Open Health, Copy path. Empty: "No projects with runs yet" / "A project appears after an agent works in it." States as table 9.8.

---

## 11. Settings (`#/settings`)

Layout: in-page section list on the left (Appearance, Projects, Refresh and noise, Saved views, Self-fix, Connectors, MCP servers, Plugins, Agents (definitions), Memory, Behavior), form rows on the right, each section a flat region with a title and a "Saved" inline confirmation (no global save bar). Pattern per Vercel settings references: left list of sections, each section's title, one-line purpose, controls, a right-aligned action.

```
┌ Settings                                                                                           ┐
│ Appearance        │ Appearance                                                                    │
│ Projects          │  Theme      (• Dark ) ( Light ) ( System )                                    │
│ Refresh and noise │  Density    (• Comfortable ) ( Compact )                                      │
│ Saved views       │  Rail       [ ] Collapse by default                                           │
│ Self-fix          │ Refresh and noise                                                             │
│ Connectors        │  Refresh every [ 8 ] s   [x] Collapse duplicates   Minimum severity [Info ▾]  │
│ MCP servers       │ Connectors                                                                    │
│ Plugins           │  ✓ falcon   configured     [Test]    ▲ vanta   not configured  [Configure]     │
└───────────────────────────────────────────────────────────┴───────────────────────────────────────┘
```

Data: `GET|PUT /api/v2/prefs` (keys `theme, density, default_project, pinned_projects, hidden_projects, muted_kinds, muted_projects, saved_views[{id,name,page,params}], nav_order, refresh_seconds, noise{collapse_duplicates,min_severity}, selffix{enabled,interval_min,max_concurrent}`; unknown keys are rejected with 400). Connectors/MCP/plugins/agents/memory/behavior use the v1 endpoints in the index. Secrets are never displayed (env values masked, "Set"/"Not set" only). Destructive changes (remove MCP server, import connectors) use the confirm modal. `nav_order` is superseded by the fixed navigation in MASTER section 8 (the pref is ignored by the UI; leave the key to avoid a 400 from old clients).
States: each section independent; a failing section shows its own State without blanking the page; the "Saved" confirmation is `role="status"`.

---

## 12. Backend gaps (listed once)

| Id | Need | Used by | Fallback today |
|---|---|---|---|
| G1 | Last N lines of a pane's output: `GET /api/v2/herd/agents/<pane>/peek?lines=12` (read-only, bounded, redacted like the terminal) | Colony tiles, Map cells, popovers | cwd + task text only |
| G2 | Parent/child link for subagents and tab labels in `agents[]` (`parent_pane`, `tab_label`) | rail tree, card footer, List view | flat list; dispatches from Activity shown as "Dispatched" |
| G3 | Health: per-subsystem `history[]`, real `last_ok` for gate/mux/db/doctor, `reason` for `unknown` (see section 4) | Health | omit sparkline; "Verified at <time>" |
| G4 | Server timestamp for the last state change per agent (`state_changed_at`) | agent age everywhere | client-observed age since first seen |
| G5 | Per-KPI sparkline series in `overview.kpis[].series` | KPI tiles | only runs and failures have sparklines |

None of these blocks the build: every page degrades as stated.

## 13. Page state matrix (acceptance)

| Page | Loading | Empty | Error | Stale/partial | Degraded dependency |
|---|---|---|---|---|---|
| Overview | skeleton grid | tiles 0, "Nothing needs you", Launch agent | page State + Retry | per-panel marker | herdr down: Fleet panel only |
| Agents (all lenses) | skeleton cards/rows | "No agents running" / "No tasks" / "No messages" | per-source inline | affected counts `-` | layer 2 replaces canvas; layer 3 only Terminal |
| Activity | skeleton rows | "No activity in this window" | State + Retry | "N new" bar | none |
| Health | skeleton rows | "Nothing needs attention" | State + Retry | stale banner | `unknown` rows are "Not measured" with reason |
| Improve | skeleton | "No findings yet" | State + Retry | per-panel | none |
| Projects | skeleton rows | "No projects with runs yet" | State + Retry | n/a | herd column blank if herd down |
| Settings | per-section | n/a | per-section State | n/a | none |
