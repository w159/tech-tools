# References and evidence

How this direction was derived. Every description below is of the image the Mobbin device returned (I looked at each preview); nothing is inferred from metadata. Local copies are the `image_url` downloads in `refs/` (Mobbin image URLs expire after 30 days; the `mobbin_url` is the canonical link). Credit: curated by Mobbin. No Mobbin `ai_usage_notice` was returned in any result.

Task intent sent with every query: "Design a developer command center dashboard for supervising many coding agents", output destination `code`, platform `web`.

## 1. Mobbin queries (15 issued, 13 returned results, 2 timed out)

Devices used: `xd://mcp__mobbin_search_screens` (11 calls), `xd://mcp__mobbin_search_flows` (1), `xd://mcp__mobbin_search_sections` (1). Two screen queries failed with `MCP failure ... stage: send, failure: timeout, Request timeout after 30000ms, retryable: no` (Q6, Q9); the stop condition (same error twice) was therefore NOT treated as "Mobbin unavailable" because 13 other calls succeeded; both topics were re-queried with different wording (Q6b, Q9b) and returned.

### Q1 screens: "agent monitoring dashboard dark with list of running agents and status indicators"

| App / screen | URL | Local | What is actually there | What was taken |
|---|---|---|---|---|
| Better Stack, Monitors | https://mobbin.com/screens/bf3fbed5-e633-4df4-aa6f-320ac608270b | `refs/betterstack-monitors.jpg` | Dark navy; a narrow icon rail plus a second 150px section list (Incidents, On-call, Monitors, Heartbeats); main "Monitors" with a search field showing a `/` keycap, a primary "Create monitor" split button, and a 2-row list: green dot, name, "Up . 7m", interval and overflow at the right | The `/` keycap inside the search trigger (kept as our palette trigger); status as dot + word + duration in one row. Rejected: two stacked navs (the exact defect the user reported) |
| Sentry, Dashboards | https://mobbin.com/screens/ac81ee7f-550f-4395-aafe-13da3dc10e05 | `refs/sentry-dashboard.jpg` | Purple-black; icon rail; filter bar (projects, envs, 24H, releases); two large KPI tiles ("Crash rates 4.17%", "Crash total 72"), two area charts with legends, a small status table | KPI tile = big numeral with a plain label and no ornament; chart legends inline with a pager. Rejected: purple palette, large empty gutter |
| Vapi, Monitors | https://mobbin.com/screens/71356d1f-1640-4e8a-a449-e55fb8142a2b | `refs/vapi-monitors.jpg` | Near-black; a grouped sidebar (Build, Test, Observe) with a Search row showing `⌘K`; table with checkbox column, Status, Summary (title + grey description line), Alert, Category chip; a red "Delete 3" bulk bar replacing the toolbar when rows are selected | Table with title + dim second line; bulk-action bar that replaces the toolbar (MASTER 9.8); sidebar group titles in sentence case |
| PlayAI, My Agents | https://mobbin.com/screens/d725a9c0-5973-4026-9ec8-3e97c8d648fe | `refs/playai-agents.jpg` | Pure black; a sidebar with nested "Agents > My Agents"; one agent card: avatar, name, key string, three stat lines (conversations, minutes, knowledge), "View Agent" button | Rejected as a model: one identical large card per agent does not scale to 30 agents; informed the density target of the agent card (3 lines max) |

### Q2 screens: "CI pipeline run detail with job timeline and step statuses"

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| GitLab, Pipelines | https://mobbin.com/screens/957013f7-8afb-4932-a788-4a08c14bb6d5 | `refs/gitlab-pipelines.jpg` | Light; left project nav with a collapsible tree; tabs (All 7, Finished, Branches, Tags); list of runs, each with a red "Failed" pill + age in the first column, then title link, `#id`, branch chip and commit hash chip, label chips | State pill and age stacked in the first column; id/branch/hash as small chips, mono only for those. Informs the Activity run row |
| Laravel Cloud, Deployment details | https://mobbin.com/screens/f9a999ee-f498-4a02-b17f-be383d866950 | `refs/laravel-deployment.jpg` | Light; top tabs (Environment, Deployments, Commands, Logs, Metrics); title "Deployment details . 2d300ac", a status line "Building . commit . 4s", two grouped step lists (Build logs, Deployment logs) with row, "Pending" in mono, chevron; a dark toast at the bottom center with a Cancel button | Step list with a right-aligned status word and chevron to expand; the toast as a single line + one action (MASTER 9.15) |
| Databricks, Sample Pipeline | https://mobbin.com/screens/6446ee2e-ff15-40e9-8cf2-3fc475a94117 | `refs/databricks-pipeline.jpg` | Light; a vertical step graph (check, check, red ring "Initializing", 4, 5) on the left, a "Pipeline details / Update details" side panel on the right with key-value rows, and a bottom "Event log" panel with All/Info/Warning/Error filter chips and a `level:info` search | The bottom-or-side detail panel with key-value rows (Inspector Now tab); chips for level filter |
| HoneyBook, Automation run | https://mobbin.com/screens/6b0c0c5b-4b33-4767-a2c1-6baafed1f422 | `refs/honeybook-automation-run.jpg` | A right-side panel over the page: "Test run: Pricing guide, COMPLETED" green pill, a vertical node flow where each node has a title and timestamp and a green "COMPLETED" tab | A right drawer for a run with a vertical sequence of steps and timestamps (Inspector for runs); drawer opened over, not replacing, the page |

### Q3 screens: "command palette modal with search input and grouped actions with keyboard shortcuts"

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| Magnific | https://mobbin.com/screens/e22e26e2-f813-4f1e-beda-43c9ecf26419 | `refs/magnific-palette.jpg` | Dimmed page; centered 340px panel: "Ask Magnific or navigate to tools" input with mic and camera icons and `⌘K`, groups "Recents" and "Quick actions" with keycap hints at the right, a footer bar `Navigate / Select / ESC Close / Open in new tab` | Footer legend (MASTER 9.10); recents first |
| Vapi | https://mobbin.com/screens/593d7acd-2e16-4365-bcd6-02ce52f48f3b | `refs/vapi-palette.jpg` | Dark panel; "Search pages..." input; groups Actions, Recent, All Pages; each page row has a dim section label ("Metrics - Observe"); footer with "14 results" | Result count in the footer; page rows carry their group as dim text |
| Mistral AI | https://mobbin.com/screens/8450c1c7-7c10-40a3-9af3-c9c234ac4b53 | `refs/mistral-palette.jpg` | Light panel on an orange blurred background; groups Agents, Batches, Settings, Navigation ("Go to Home", ...), first row highlighted | "Go to <page>" verb pattern for navigation entries |
| Supabase | https://mobbin.com/screens/9b4725f5-e038-4fc7-98ad-64a59f74b4d7 | `refs/supabase-palette.jpg` | Light panel; "Run a command or search..."; groups Shortcuts (New project with keycaps `O N`), Queries, Actions with "Switch project..." | Chord keycaps shown as two separate caps (`g` `o`), ellipsis on actions that open a second step |

### Q4 screens: "log viewer with level filter chips, search bar and streaming log lines in monospace"

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| Laravel Cloud, Logs | https://mobbin.com/screens/4f139e8e-788e-479c-b86a-021b34156276 | `refs/laravel-logs.jpg` | Light; search field, "Application logs" select, "Last 7 days" select, refresh icon; each log line is a bordered row with an expand chevron, timestamp, `[INFO]` in blue, message in mono | Expandable log rows (Activity detail); level token colored |
| Sentry, Logs | https://mobbin.com/screens/4ade8a5e-270c-4950-b6c7-343fab511a4b | `refs/sentry-logs.jpg` | Dark; a query bar with filter chips under it, a count histogram, a table whose first row is expanded into a two-column key-value grid (payload_size, browser, severity, trace, with "Add to filter / Exclude from filter" and "Copy as JSON") | Expand-in-place key-value grid with per-key filter actions; "Copy" affordances |
| Railway, Logs | https://mobbin.com/screens/db28e670-1edb-48bf-b34f-73bf7a1c2e62 | `refs/railway-logs.jpg` | Very dark; filter input with `/` keycap, "Last week" select; a mini histogram strip on top; dense lines with a 3px left color edge (blue normal, red error rows with a tinted row background), service column, mono data | The 3px left edge + faint row tint for severity (MASTER 9.5 uses the edge only, not the tint: a tint costs contrast); histogram strip as the Overview trend idea |

### Q5 screens: "kanban work board with columns, task cards with assignee avatars and status labels"

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| Todoist, Board | https://mobbin.com/screens/866c59ab-6ea2-4bee-bdea-ad3efdff8507 | `refs/todoist-board.jpg` | Light; 3 narrow columns (To Do 2, This Week 3, Review 1), cards: round check, title, small meta line (date, comments), "Add task" at each column bottom, "Add section" ghost column | Counts next to column titles; "Add task" at the bottom of each column |
| Asana, Board | https://mobbin.com/screens/0a9f2bf5-409a-4af8-9493-531dd6868124 | `refs/asana-board.jpg` | Dark chrome with light board; columns (Untitled section, To Do 3, In Progress 3, Done 2), cards with priority pill (High red, Medium orange), percentage chip, assignee avatar, due date | Card footer: assignee + age; priority as a small colored label. Rejected: many colored labels per card (noise) |
| ClickUp, Board | https://mobbin.com/screens/0c287f59-753c-4e28-92ad-9dff95fcde36 | `refs/clickup-board.jpg` | Colored column headers per status (OPEN, IN RESEARCH, IN DESIGN, IN DEVELOPMENT), a "Customize view" side panel with toggles, two stacked toasts bottom right | Rejected: saturated column headers (too loud for a status board that must show agent urgency); stacked toasts informed the 3-toast cap |

### Q6 (failed) and Q6b screens: team chat with presence; then "Slack channel with messages and composer"

Q6 "team chat channel with member presence list on the side and message composer": timeout (error text above). Q6b result:

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| Slack, DMs | https://mobbin.com/screens/375a5c15-e9f7-442c-87b3-35bbc8c2e996 | `refs/slack-dm.jpg` | Aubergine theme; left DM list with unread toggle, message list with day separators ("Friday, June 14th", "Today") and a red "New" line, system rows ("Onboarding happened"), a composer with a formatting toolbar and send icon | Day separators + "New" marker (Channel lens); system events as compact rows |
| Slack, Home | https://mobbin.com/screens/5a187c24-47f1-4813-97c9-9d9d5d44a100 | `refs/slack-channels.jpg` | Dark; sidebar with Channels (#all-...), Direct messages with presence dots, Apps; message with attached file card; large composer | Presence dot next to names -> our hex glyph in the Channel lens presence column |

### Q7 screens: "terminal sessions list with a live terminal preview panel in a developer cloud IDE"

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| Devin, session | https://mobbin.com/screens/f7e9f607-dc8f-49ab-b42e-26f9270fd31b | `refs/devin-session.jpg` | Left list "Recent" of sessions each with title and a status line ("PR is ready . 2"), a center chat/transcript with a "Worked for 11s" collapsed step list and a bottom composer; a right panel with tabs (Changes, PR #5, Desktop, Shell) and a second row of terminal tabs (backend6, backend5, ...), a green terminal, "Live" pill and a command history table | THE closest analog: agent list + transcript + terminal in one view; terminal as a tab in the right panel; session rows with a status line. Directly informed the inspector (Now / Channel / Tasks / Terminal) and the composer at the bottom |
| Browserbase, Sessions | https://mobbin.com/screens/5937f71b-ca6a-4e42-9526-32ca171807d2 | `refs/browserbase-sessions.jpg` | Light; filter chips "Status is Completed", "Date is Jul 29 - Aug 1", "Clear filters", a sort select; table with a green "Completed" pill, truncated session id with copy icon, started, duration `00:02:35`, region | Filter chips as "field is value" sentences; id with copy affordance |
| Modal, App | https://mobbin.com/screens/29f42649-b28c-4749-91f2-b63a844218c2 | `refs/modal-app.jpg` | Dark; function list on the left with a green-outlined selected item and "Containers: 0 live . Calls: 0 running", a timeline bar chart with a time-range control, tabs (Function Calls, Containers, Metrics, Details, Files) | Selected-item treatment (outline in the status color); tab set under a header summary |

### Q8 screens: "system status overview with services grouped and uptime bars per component"

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| OpenAI Platform, Service health | https://mobbin.com/screens/d605f83d-3869-4ecc-8874-b913e09e2930 | `refs/openai-service-health.jpg` | "All systems operational" with a green check and a "Live" pill; "uptime 100.00%" and a single area chart; collapsible component rows with green checks (Chat Completions, Responses, ...); a right column "API incident history" with date, title and "resolved" text | Header sentence summarizing system state; collapsible component rows; incident history as a dated list (Health evidence). The "Live" pill informed ours |
| incident.io, Status pages | https://mobbin.com/screens/9618b478-1dc4-428c-b34d-5f4115112f4d | `refs/incidentio-status.jpg` | Dark rail; an in-page vertical tab list (Happening now, Past events, Maintenance), a green success banner "You're not reporting any issues", a Components list with check icons | The calm all-clear banner as one line; local tab list |
| Customer.io, Workspace Performance | https://mobbin.com/screens/b9743841-5a29-4454-bc39-133d7b0d7d9c | `refs/customerio-performance.jpg` | Left card with a green ring check "Healthy / Everything is running smoothly. No issues detected." and "Last updated today, 5:14:16 PM"; right table "All services" with a green "Normal" pill per row and info icons | "Last updated" timestamp under the state; one status pill per row with a word ("Normal"). This is the honest-timing pattern used in the Health redesign |

### Q9 (failed) and Q9b/Q13 screens: settings with sections; then "Vercel project settings page"

Q9 "settings page with a left list of sections and grouped form rows with toggles": timeout. Q13 result:

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| Vercel, Project Settings, General | https://mobbin.com/screens/a54fee2e-b776-42c2-bd7c-93f7e223c87c | `refs/vercel-settings-general.jpg` | Light; a left section list (General, Build and Deployment, Environments, Git, ...); main = stacked blocks, each with a title, one sentence of purpose, the control, and a footer strip with "Learn more" on the left and a Save button on the right that is disabled until a change | Section blocks with title + purpose + control + footer action (PAGES 11); Save only active when dirty (we use auto-save + "Saved" instead) |
| Vercel, Settings, Git | https://mobbin.com/screens/b8ac567f-9d4f-4a98-9c11-0354771f7f20 | `refs/vercel-settings-git.jpg` | Same layout; toggles with "Enabled / Disabled" word beside the switch; a highlighted (blue-outlined) primary block | Toggle always has a text state next to it |

### Q10 screens: "empty state for a list with illustration-free message and a primary action button"

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| [untitled] | https://mobbin.com/screens/f52cbd50-b067-4ac9-83f0-1b45b18fd451 | `refs/untitled-empty.jpg` | Completely blank white page with a breadcrumb and a dark pill "+ Add" at the bottom center | Counter-example: blank is not an empty state |
| LangChain, Automations | https://mobbin.com/screens/8e744fe3-f3d0-482b-9b88-9e3f76a614eb | `refs/langchain-empty.jpg` | A small icon, "No automations found", one sentence ("Setup workflows that run automatically based on your rules."), a blue primary "+ Automation" and a "Learn more" link, centered in the list area | Title + one sentence + primary action + secondary link. We drop the icon and left-align |
| Perplexity, Spaces | https://mobbin.com/screens/248fe095-0704-4097-ae99-813eec3f8a89 | `refs/perplexity-empty.jpg` | A single grey line "No Spaces yet. View examples." at the top of an otherwise empty page | Counter-example: too quiet, no primary action |

### Q11 screens: "Linear issue detail with right properties sidebar"

| App / screen | URL | Local | What is there | Taken |
|---|---|---|---|---|
| Linear, issue AS-35 | https://mobbin.com/screens/cef36326-d8ec-4c6f-acd4-a9f1e1060d33 | `refs/linear-issue.jpg` | Light; breadcrumb header with id and title; large title, description, "Add sub-issues"; a right column of property blocks (Properties: Todo, Set priority, Assign, Set estimate; Labels; Project); an Activity section ("Alex Smith created the issue . just now") and a comment box | Right properties column as stacked small blocks; activity log + comment box at the bottom of the detail (Inspector Now + composer) |
| Linear, issue with sub-issues | https://mobbin.com/screens/d0f8ebba-34b7-469c-a708-1069e55a3e02 | `refs/linear-issue-subissues.jpg` | Same, with a "Sub-issues 0/4" list, each row with a circle state icon, title, label chips, estimate, avatar | Sub-items as indented rows with state icon first (subagents under their parent) |

### Q12 flows: "Vercel deployment from push to build logs to live"

| App / flow | URL | Local | What is there | Taken |
|---|---|---|---|---|
| Vercel, "Setting up a deployment" (6 screens; screens 1, 4, 6 inspected) | https://mobbin.com/flows/edfece19-b9e5-482a-b867-ec0e47ff61ad | `refs/vercel-flow-1.jpg`, `refs/vercel-flow-4.jpg` | A "New Project" form: GitHub import line, team select, name, framework preset, root directory, collapsible "Build and Output Settings" and "Environment Variables" (key/value rows, Add More, Import .env), a full-width black Deploy button, and a greyed "Deployment" block below that says it shows progress once you deploy | The result was a setup form, not the build-log timeline I asked for (a mismatch; recorded as such). Taken: collapsible advanced groups inside a form (Launch agent modal: advanced = harness, run) and the greyed "progress appears here" placeholder pattern |

### Q14 sections: "product section showing a dark developer dashboard with live agent status cards"

| Site / section | URL | Local | What is there | Taken |
|---|---|---|---|---|
| Cloudstudio | https://mobbin.com/sites/sections/681234c7-3cdc-4509-bf5f-e6303ef87379 | `refs/cloudstudio-section.jpg` | Black marketing hero, big grotesque headline "Agents & applied AI", a node diagram (query, rerank, vectors, sources) with a cyan outline style, small mono tag line | Style cue only: outlined nodes on dark are a coherent language; supports the outline-first hex cells. Not used for layout |
| Antimetal | https://mobbin.com/sites/sections/1a6603ec-1c43-472f-ad22-17522fe0daf2 | `refs/antimetal-section.jpg` | A product screenshot inside a browser frame: greeting "Good evening, Shreyas", sentence "Agents completed 1,460 actions today . 12 auto-resolved . 2 need you", four KPI tiles with sparklines (Health score 91%, MTTR, Uptime, Actions 14d as a cell grid), a "Needs your decision" pair of cards with Approve / Review plan, a "Pulse" list with Attention / Watch tags | Strong match to the job: the summary SENTENCE ("2 need you") above the KPIs; "Needs your decision" as the first block (our "Needs you"); an "Actions 14d" cell-grid KPI which supports the hex-cell idea. Rejected: warm cream palette (a listed AI tell) and the greeting |
| Grok (x.ai) | https://mobbin.com/sites/sections/af82f082-c333-48b4-8601-ca330ec1b109 | `refs/grok-section.jpg` | Near-black page, three columns separated by hairlines, outlined line-art above ghost buttons | Not used (decorative) |

## 2. Cross-reference: decisions traced to evidence

| Decision (MASTER / PAGES) | Evidence |
|---|---|
| One navigation, never stacked | Better Stack shows the stacking cost (two rails); the user's two screenshots show the defect |
| Agent list + transcript + terminal tab + composer in one view | Devin session (Q7) |
| Summary sentence + "Needs you" first | Antimetal (Q14), OpenAI service health header (Q8), Customer.io "Healthy" card with last-updated time (Q8) |
| Health shows a real timestamp and a reason, not "never" | Customer.io "Last updated today, 5:14:16 PM", OpenAI incident history with dates |
| Palette: grouped, recents, footer legend, keycaps | Magnific, Vapi, Mistral, Supabase (Q3) |
| Status = word + glyph + age in the first column | GitLab, Browserbase, Laravel Cloud, Customer.io |
| Severity as a thin left edge, not a row tint | Railway (tint costs contrast; edge adopted) |
| Bulk bar replaces the toolbar | Vapi (Q1) |
| Inspector as right-hand properties/activity | Linear (Q11), HoneyBook run drawer, Databricks details panel |
| Sub-items nested under parents with a state icon first | Linear sub-issues |
| Board columns by state with counts | Todoist, Asana; ClickUp rejected for saturated headers |
| Empty state: title + one sentence + primary action, no illustration | LangChain; counter-examples [untitled], Perplexity |
| Settings as section blocks with a purpose sentence | Vercel settings (Q13) |
| Channel: day separators, new marker, presence | Slack (Q6b) |

## 3. ui-ux-pro-max runs (raw output in `skill-output/`)

Skill: `~/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.13.0/.claude/skills/ui-ux-pro-max/scripts/search.py`, python3, run from this repo.

| File | Command (abridged) | Result | Accepted | Rejected and why |
|---|---|---|---|---|
| `design-system.txt` | `search.py "developer agent monitoring dashboard command center dark" --design-system --density 8 --variance 4 --motion 3 -p "Atlas Command Center"` | Pattern "Real-Time / Operations Landing"; style Glassmorphism; palette `#0F172A` bg, `#22C55E` accent; type Fira Code + Fira Sans; motion Scroll Reveal; avoid "Slow updates + No automation"; checklist | Dials density 8 / variance 4 / motion 3 (adopted as targets). Pre-delivery checklist items (no emoji icons, focus states, reduced motion, 375/768/1024/1440 responsive) adopted. "Label telemetry as live only when backed by a current source, with update time and stale state" adopted as the Live pill + stale rules (MASTER 7.1, 9.13) | Glassmorphism: backdrop blur on a continuously updating dense page costs paint and lowers text contrast; also a generic tell. `#22C55E` accent: the brand teal is mandated and green is reserved for status. Fira Code/Fira Sans: not vendored locally, so no offline path without a new binary dependency; Pretendard + JetBrains Mono already exist in-repo (MASTER 5.3). Scroll reveal: conflicts with the motion budget; the page is data, not a scroll story. Landing "hero/CTA" sections: this is an app, not a landing page |
| `ux-agent-status.txt` | `-d ux "real-time status indicators loading states keyboard focus accessibility dashboard" -n 6` | Focus states; WCAG 2.2 focus appearance (2px, 3:1); focus not obscured (scroll-padding for sticky UI); keyboard navigation; loading indicators (stable skeleton, `aria-busy`) | All adopted: focus ring 2px offset 2px at 3:1 (measured, Appendix A); `scroll-padding-top` = sticky header height; skeleton + `aria-busy` (MASTER 9.13) | none |
| `ux-motion.txt` | `-d ux "reduced motion animation live updates feedback" -n 5` | Reduced motion; excessive motion ("animate 1-2 key elements per view"); contextual live badge updates announced without moving focus | Adopted: one continuous animation (working cell), reduced-motion rules, polite one-line announcement of the needs-input count (MASTER 10.2) | none |
| `ux-nav.txt` | `-d ux "navigation sidebar command palette embedded iframe" -n 5` | Sticky nav padding; keyboard navigation; breadcrumbs for 3+ levels; back button preserves history; heading hierarchy | Adopted: header offset via scroll-padding; hash routing keeps the Back button correct (deep links); one `h1` per page. Breadcrumbs not adopted: the hierarchy is at most two levels (page > record in the inspector) | Sticky "padding-top on body" tip: use `scroll-padding` + grid rows instead of a fixed header |
| `color-dev.txt` | `-d color "developer tools monitoring dark status success warning error" -n 5` | Developer Tool palette `#0F172A` / `#22C55E` / card `#1B2336` / border `#475569` / destructive `#EF4444` | Confirms dark slate surfaces and a visible 3:1-ish control border (`#475569` on `#0F172A`) | Palette not used: it is the generic slate-and-green developer look; Atlas keeps its own teal-slate surfaces, and `#22C55E` is too close to the brand teal to carry "ok" without confusion |
| `typography-dev.txt`, `google-fonts.txt` | `-d typography "developer tool monospace technical dashboard"`, `-d google-fonts "monospace technical sans"` | Space Mono, Fira Code + Fira Sans, Share Tech Mono, others, all Google-Fonts-hosted | The rule "Mono + Sans pair for data dashboards" (adopted as Pretendard + JetBrains Mono) | All fonts as listed: they assume Google Fonts delivery; the product must work offline |
| `chart-spark.txt` | `-d chart "sparkline trend timeline status distribution" -n 5` | Line chart for trends; box plot for distributions; "never distinguish series by hue alone" and "visible data table + trend summary" fallback; "fewer than 4 points: use a stat card" | Adopted: SVG charts, text summary + `Show data` table, direct labels, dashed vs solid for two series (runs bars + failures line), no sparkline under 4 points | Chart libraries (Chart.js, Recharts, ApexCharts): no build step; hand-rolled SVG |
| `icons-status.txt` | `-d icons "status terminal agent activity navigation" -n 6` | Phosphor icons (terminal, pulse, list, ...) | Icon names/semantics (terminal, pulse, list) and the rule decorative = `aria-hidden`, meaningful = text alternative | Phosphor package: needs a bundler or network; inline Lucide-style SVG instead (same set the herdr UI already uses, ISC) |
| `style-dev.txt` | `-d style "dark developer command center dense data" -n 5` | Data-Dense Dashboard: 8-12px padding, 12-14px type, sticky headers, `--table-row-height: 36px`, `--sidebar-width: 240px`, `--header-height: 56px` | Adopted as the compact density targets (rows 30 / comfortable 40, gap 12/16) and sticky table headers | 12-column grid and "chart zoom on click": not needed |
| `product-ops.txt` | `-d product "developer operations monitoring command center" -n 3` | Developer Tool: "Real-Time Monitor + Terminal"; Status Page: "Real-Time Monitoring + Timeline", "status green + incident red + maintenance amber + neutral dark" | Adopted: Real-Time Monitor + Terminal as the Agents canvas model; timeline for Activity; the green/red/amber triple (extended with blue working, grey idle, purple sub) | "Minimalism and Swiss Style": not a decision source; "Bento Box Grid": rejected (the identical rounded-cards tell) |
| `stack-plain-css.txt`, `stack-tailwind.txt` | `-s html-tailwind "custom properties css variables vanilla dark mode theme" -n 5`; `-s html-tailwind "dashboard layout accessibility performance no build" -n 6` | The html-tailwind stack gave Tailwind-specific guidance (dark: prefix, @theme); the second query returned 0 results ("no database match was found") | Nothing from Tailwind; the project is plain CSS custom properties, which the existing `tokens.css` already uses (`[data-theme]`, `[data-density]`) | Tailwind utilities and `@theme`: require a build step. There is no plain-CSS stack in the skill; this is stated, not papered over |

### frontend-design (skill://frontend-design) application

- Subject grounded in the real content: agents, panes, tasks, notes, health.
- Plan written before building and revised against the brief: first draft had a dotted-status row and a stock KPI hero; revised to the Fleet Strip (hex cells from the brand mark) and KPI tiles that carry the next action.
- Defaults checked and rejected: MASTER 3.1 table (near-black + single bright accent, SaaS card kit with identical shadows, caps eyebrows, mono data labels, arrows on links, middle-dot meta strings, gradient washes, entrance fades).
- One memorable element (Fleet Strip); everything else quiet. Chanel pass: removed per-card shadows, removed caps labels, removed hover lifts, removed skeleton shimmer.
- Writing: sentence case; the same verb in button and toast; empty/error states give a cause and a next action; errors never apologize.

## 4. Measured contrast

`design/contrast.py` computes WCAG 2.x ratios for every text/background pair in both themes (including each status color on its 16% tint over surface-1 and surface-2, focus ring, control edges). Output: `skill-output/contrast.txt`, last line `ALL PAIRS PASS`. Two iterations were needed: `--border-strong` and the light `--st-fail` were adjusted until all pairs passed (recorded here because the first run FAILED those pairs: dark border-strong 2.32-2.75, light border-strong on surface-2 2.94, light fail on its tint 4.47).

## 5. Inputs from the repository and the user

- User screenshots (read-only): `.herdr-web-ui/paste-20261007-052258-a77566af.png` (Health inside the host, two stacked navs, "never"/"unknown" everywhere) and `.herdr-web-ui/paste-20261007-053322-615722d7.png` (host rail boxed in red; Colony page showing "Agent list unavailable" + "herdr is running, but its web UI is not" + red `atlas_dashboard_unreachable` block; version chip, "Polling every 8s", "All clear").
- Code read: `dashboard_ui/css/tokens.css`, `index.html`, `js/app.js` (routes, groups, chords), `js/pages/health.js`, and the five route modules listed in PAGES.md. The herdr-web-ui host sources (`colony/herdr-web-ui/src/lib/atlas.ts`, `AtlasNav.tsx`, `server/atlas-gateway.ts`, `src/fonts/`) were read for fonts, status vocabulary (idle READY, working RUN, blocked INPUT, done DONE) and the page-id map; those host files are not modified or relied on by the design.
