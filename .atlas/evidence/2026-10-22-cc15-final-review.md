# CC15 whole-branch review: main 38af30e7..67913c08

Reviewer: review-cc15-final (read-only). Strengths: pure renderers with one escaping convention (band.js, run.js, channels.js, health.js all escape every API string before innerHTML); region-state.js is a single copy imported by html.js and run.js; gates route is token-gated (atlas_dashboard.py _SENSITIVE_GET), SELECT-only, session and transcript path come from the DB, project comes through ctx.project_root; steer posts through the existing bounded POST path (MAX_BODY 4 MiB) with the token in a header; glyphs are guarded by a Python contract test; `node --test js/*.test.js` re-run by me: 111 pass, 0 fail; `python3 -m unittest test_atlas_dash_gates`: 6 OK; no live import of deleted overview/activity/improve/projects modules or Sparkline (grep zero hits); v14 brief is marked superseded.

### Verdict
Mergeable after the listed fixes (Important 1-6; none blocks the code from running, several make shipped UI misleading).

### Spec coverage
| Design item | Status |
|---|---|
| Six routes, v14 route set removed | shipped (router.js ROUTES) |
| Old hash redirects | shipped except `#/projects -> #/settings#projects`: redirects to `#/settings` only (router.js:36, router.test.js:58); no As-built note |
| Band two rows, chevron rail, counts, clock, narrow collapse | shipped (band.js, shell.css) |
| Band title shows wave N of M | as-built deviation noted (design As built) |
| Phase n/m and current phase | as-built noted ("not wired") but UI still lights RESEARCH (see Important 1) |
| Project selector in band | as built, noted; present on Run only (app.js paintBand passes no projectOptions) |
| Seats rail: glyph, role letter, tool, 8-cell bar, spinner, selection, click filters feed and targets steer | shipped (run.js renderSeats) |
| Seats group header with age; machine line (host, leads/seats, db, version, port, live dot, as-of) | partial: group header without age; machine line is host, seat count, live only (run.js:228). No As-built note |
| Channel feed: gutter, kind glyph, day marks, phase rows, needs inset | shipped |
| Steer bar: chip @seat/@lead/@all, enter, h, esc, i and m | shipped (steer.js, run.js); hold is a plain note "hold" (steer.js comment discloses kind is ignored) |
| Needs you: Answer/Hold for questions, Open/Dismiss for health, "N more in Health" | partial: Answer only for waiting; Open from payload; no Hold, no Dismiss. No As-built note |
| Gates chips from completion_group, read-only route | shipped, shape deviation noted |
| Last 7 days table, 13-cell bar, delta | shipped (toMetrics, renderMetrics) |
| Selected lead = most recent lead, persisted per project in localStorage (decision 6) | missing: no localStorage, no lead chooser (run.js grep). No As-built note |
| Agents page seats rows, drawer, terminal, hold/kill/attach | shipped (agents.js, drawer reused) |
| Board | shipped |
| Channels: all channels, seat filter, search | shipped (channels.js) |
| Health: attention, silent failures, doctor ledger, improve loop | shipped (health.js) |
| Settings all controls kept, projects moved in | shipped structurally; "71 controls" not re-proven by me (T8 spot check could not run) |
| Keys 1/2/3 f i m h esc, "/" palette | shipped (keys.js, palette.js, app.js:122) |
| Palette command list and fuzzy matcher | shipped (9 commands) |
| Tokens, BRAND colors, contrast gate | shipped (tokens.css, design/contrast.py) |
| Glyph contract vs theme.ts | shipped (test_atlas_contract.py) |
| Loading/empty/error states per region | shipped (region-state.js) |
| Reduced motion, landmarks | not verified by me (runtime tester) |
| Version and docs | plugin.json and marketplace 15.0.0; plugin CHANGELOG, README present |

### Findings
Critical: none.

Important
1. run.js:210, app.js:49: with no header the band always lights RESEARCH as the current phase and past/future pills follow from it. The UI states a phase it does not know. Show no lit pill (or a neutral "phase unknown") until the header source exists.
2. run.js:275 with atlas_dash_gates.py:63-70: a project with no orchestrating run returns 404 no_session_for_project, which the loader turns into the gates error state with Retry. That is the normal idle case and should render empty.
3. atlas_dash_gates.py:56-58 (T5 minor 3): a session with no stored root falls back to Path("."), the dashboard daemon's cwd, so completion_group evaluates the wrong tree and shows plausible wrong chips. Return an error or empty instead.
4. run.js:261, :275: colony, channel and gates load only when a project is selected. With project "all" (the default unless default_project is set, app.js:155) the landing page has no feed, no gates and a disabled steer bar. Needs a runtime look by the tester; at minimum pick the most recently active project by default.
5. Design items missing or partial with no "As built" entry: lead persistence (decision 6), Hold/Dismiss buttons, machine line fields, `#/projects` anchor, seats group age. Either build or add them to "As built" in the design doc.
6. run.js seats region is rebuilt via innerHTML on every agents tick (T6 minor 3): a keyboard user on a seat row loses focus every tick, against the "every control keyboard reachable" constraint.
7. Fixtures: js/fixtures/overview.json:683,688,817 carry the company path `~/Library/CloudStorage/OneDrive-HensslerFinancial/IT Dept/Staff/Recruiting`; fixtures/agents.json:407 carries internal Henssler staff project text. run-data.test.js:32 only forbids "/Users/jerry". Scrub and widen the guard (Reg S-P posture, and the repo is a published marketplace).
8. Working tree has an uncommitted edit to plugins/atlas/scripts/dashboard_ui/js/ui.js (deletes Panel, KPI and more, outside the reviewed range). Node suite is green with it, but it must be committed or reverted with an owner before release.

Minor
- Non-U.S.-keyboard characters in UI copy (U+00B7 middle dot): js/pages/channels.js:74, pages/settings-model.js:108,148 (102 is a comment), pages/settings-panels.js:389,401, drawer/messages.js:26,28, drawer/agent-drawer.js:25; band.js:59,72 and run.js:228 use `·` escapes (ruled acceptable, mirrors band.tsx). Docs edits: only docs/plans/2026-10-22_command-center-v15-plan.md (glyph literals inside code spans in the test step); no dashes or curly quotes found.
- api.js:156: SSE URL carries `?token=` (EventSource cannot set headers). Unchanged from v14, not a regression; note for the security doc.
- Weakest test: app-keys.test.js second test (source-regex on app.js and shortcuts.js text). Next: band.test.js near-tautology (:201).
- steer.js: hold posts a normal note with text "hold"; the server ignores kind, so "hold" is a message, not a state change. Disclosed in-code, not in docs.
- run.js feed loader appends the full channel on each refresh and relies on toFeed dedupe (run.js:272); correct but wasteful. A feed error replaces all rows (T6 minor 2).
- docs/architecture/command-center-redesign.md still lists deleted pages and Sparkline but carries the superseded banner; fine.

### Deferred minors triage
| Source | Minor | Triage | Reason |
|---|---|---|---|
| T1 | glyph-table.js:1-3 comment overstates the guard | NICE TO HAVE | one-line comment |
| T1 | test_atlas_contract.py:1938 order mapping | DROP | plan-mandated, works |
| T1 | glyph-table.test.js spot checks | DROP | Python test is the guard |
| T2 | tokens.css alias block | DROP | removed by commit e9a434bf |
| T2 | "contract test below" comment | NICE TO HAVE | wrong pointer |
| T2 | light values from contrast.py | DROP | disclosed, verified set |
| T2 | SPIN reflow | DROP | cosmetic |
| T2 | contrast.py sync check one-way | NICE TO HAVE | silent drift risk only |
| T3 | four dead defs | DROP | fallow chore cleared them |
| T3 | band repaint restarts shimmer | NICE TO HAVE | cosmetic |
| T3 | tests lack dot/tone/pulse assertions | NICE TO HAVE | Important 1 already fixed once |
| T3 | rail wrap under 700px unverified | MUST FIX BEFORE RELEASE | verify at width (tester) |
| T3 r1 | band.test.js:201 tautology, band.js:148 stray comment | NICE TO HAVE | no signal / lint |
| T4 | run-data.js:1 suppression reason | NICE TO HAVE | accurate wording |
| T4 | PREFIX_ROLE tested for impl only; no-colony role "" | NICE TO HAVE | roleLetter falls back |
| T4 | dedupe key no separator | NICE TO HAVE | unlikely collision |
| T4 | toBand unused overview note | DROP | docs only |
| T5 | ?session= returns project null | NICE TO HAVE | no consumer |
| T5 | exact realpath compare 404s symlinked roots | NICE TO HAVE | edge |
| T5 | no stored root falls back to Path(".") | MUST FIX BEFORE RELEASE | wrong-tree gate results (Important 3) |
| T5 | untested branches (runs-only, raises) | NICE TO HAVE | |
| T6 | owner flag before tail (round 1) | DROP | addressed |
| T6 | feed error wipes rows | NICE TO HAVE | transient |
| T6 | seat rows lose focus per tick | MUST FIX BEFORE RELEASE | a11y constraint (Important 6) |
| T6 | no render()/409 test; tautological href regex | NICE TO HAVE | |
| T6 | run.js size mixing | DROP | |
| T6 | skeleton unstyled | DROP | base.css landed |
| T7a | isTyping takes no arg | DROP | wiring passes activeElement |
| T7a | openPalette DOM untested | NICE TO HAVE | tester covers |
| T7a | non-element root TypeError | DROP | |
| T7a | xterm check gap in isTypingIn | DROP | wiring adds .xterm check (app.js:124) |
| T7b | holdSelected from another route dropped | NICE TO HAVE | new mount has no selection anyway |
| T7b | app-keys source-regex test | NICE TO HAVE | |
| T7b | palette placeholder and aria-activedescendant | NICE TO HAVE | combobox a11y polish |
| T7b | no visible f filter indicator | NICE TO HAVE | data-filter attr exists |
| T7b | top:56px magic number | NICE TO HAVE | |
| T7b | steerLead 400 ms wait | NICE TO HAVE | |
| T7b | --line to --rule alias swap | DROP | harmless |
| T8 | pages.css:617 comment | DROP | |
| T8 | page tests renderer-only | NICE TO HAVE | |
| T8 | settings.js ~470 lines | DROP | |
| T8 | 10-id Settings spot check not run | MUST FIX BEFORE RELEASE | "71 controls kept" unproven; run it |
| T8c | dropped assertions | DROP | functions deleted |
MUST FIX count: 4 (T3 width check, T5 cwd fallback, T6 focus loss, T8 control spot check).

### Files read
Full: js/app.js, js/band.js, js/run-data.js, js/steer.js, js/keys.js, js/html.js, js/region-state.js (first 30 lines), js/pages/run.js (lines 1-150 summarized by ctx_read truncation, 150-436 full), atlas_dash_gates.py, js/app-keys.test.js. Diff hunks: api.js, router.js, ui.js, shortcuts.js, atlas_dashboard.py. Partial: pages/channels.js 25-55, pages/health.js 100-142, router.js. Design doc in full, ledger Ruling and minor lines, per-task Minor sections T1-T8c. Fixtures checked by grep. Not read: CSS, board.js, agents.js, settings*.js bodies, palette.js, glyph-table.js, tests other than listed. The 446 KB diff package was not opened; I worked from the checkout at 67913c08.
