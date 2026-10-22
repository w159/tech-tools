# Command Center v15 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard_ui frontend with the "Band and Rail" design: terminal band and phase rail on top, seats rail, channel feed with steer, needs-you and gates, on the existing v2 API.

**Architecture:** Vanilla ES modules and CSS served by atlas_dashboard.py, no build step. A pure adapter layer (run-data.js) turns API payloads into view models so every region is unit-tested without a browser; page modules render HTML strings from those view models and wire events. One new read-only backend route (/api/v2/gates) wraps the existing completion-gate evaluator.

**Tech Stack:** ES2022 modules, CSS custom properties, node:test, Python 3 (http server, pytest-style unittest in plugins/atlas/hooks/test_atlas_contract.py), vendored Geist fonts.

**Spec:** docs/plans/2026-10-22-command-center-v15-design.md (approved). Facts: .atlas/.run/cc15-plan-facts.md and .atlas/.run/cc15-identity-inventory.md. Visual reference: https://claude.ai/artifact/LRNAHfehc5XrUYFPuy6tJ3

## Global Constraints

- Edit target is plugins/atlas/scripts/dashboard_ui/** and plugins/atlas/scripts/atlas_dash_*.py in this tree. Never ~/.claude/plugins/cache.
- JS tests run with: `cd plugins/atlas/scripts && node --test dashboard_ui/js/*.test.js dashboard_ui/js/**/*.test.js` (the bare directory form fails on Node 22; facts a). Baseline today: 18 pass, 0 fail.
- Python tests: `python3 -m unittest plugins/atlas/hooks/test_atlas_contract.py` plus any new test module named below.
- Colors come from BRAND in plugins/atlas/mod/contract.ts:103-105: accent #2fbd9f, focus #7fe0cb, bg #0c1215, surface #121a1e, text #e6edf0, dim #9fb0b8, ok #52c872, working #62b8e6, input #f2aa40, fail #ff7570, idle #93a4ac, subagent #b5a3fa. Light values: the v14 light set (tokens.css:69-87) remapped to the same role names.
- Glyphs and spinner frames are copied from plugins/atlas/mod/theme.ts (facts section 10) and pinned by a contract test. No new glyphs.
- Copy uses U.S. keyboard characters only. UI words: seats, colony, channel, steer, wave, gate, finding, lead, worker.
- Fonts: keep the vendored Geist-Variable.woff2 and GeistMono-Variable.woff2 (OFL-Geist.txt). Every fact column (timestamps, counts, ids, states, paths) uses the mono face.
- Motion: only the lit-pill shimmer, the working-seat spinner (250 ms tick) and the needs-you pulse; all disabled under prefers-reduced-motion.
- Contrast: text >= 4.5:1, control edges and focus >= 3:1 in both themes, checked by dashboard_ui/design/contrast.py (exit 0).
- The old hashes redirect: overview -> run, activity -> channels, improve -> health, projects -> settings, colony and terminal -> agents.
- Deviation from the spec, decided here: the band title row shows `project . branch . lead`, not `wave N of M`. build_colony carries no wave number (facts e); the phase rail's `n/m` comes from the orchestrator header's todo count. Spec updated in Task 9.

## Review Focus

1. SSE drops mid-session: the band must show "reconnecting" and the feed must not duplicate rows when the stream resumes. Test added to Task 4 (dedupe by `seq`/`id`).
2. A project with no colony (fresh repo): seats rail renders its empty line, the band shows phase "research" with no n/m, steer target defaults to `@lead` disabled. Test added to Task 4.
3. A needs-you item whose `since` is missing: render the state word with no duration, never "NaN" or "waiting undefined". Test added to Task 4.
4. Steer POST rejected with 401 bad_token or 409 held: the bar shows the server message inline and keeps the text. Test added to Task 6.
5. Window narrower than 700px: the three columns stack, the rail collapses to the current pill, no horizontal page scroll. Checked in Task 10 at 390px.

---

### Task 1: Glyph and role tables pinned to theme.ts

**Files:**
- Create: `plugins/atlas/scripts/dashboard_ui/js/glyph-table.js`
- Test: `plugins/atlas/scripts/dashboard_ui/js/glyph-table.test.js`
- Modify: `plugins/atlas/hooks/test_atlas_contract.py` (append one test)

**Interfaces:**
- Produces: `export const PHASE_GLYPH = { research, theory, test, validate, implement, verify, done, blocked }` (values from CONTRACT_GLYPH, theme.ts:228; validate is U+2630); `export const STATE_GLYPH = { spawning, running, idle, input, stuck, parked, finished, failed, dead }` (theme.ts:32-42); `export const SPIN` (10 braille frames, theme.ts:142); `export const PHASE_FRAMES = { research, theory, test, implement, verify }` (theme.ts:147-153); `export const ROLE_LETTER = { lead: "L", implementer: "I", verifier: "V", explorer: "E", runner: "R", "docs-curator": "D", "test-engineer": "T" }`; `export function roleLetter(role: string): string` (table hit, else first letter upper-cased, else "?"); `export function spin(frame: number, phase?: string): string` (phase table when present, else SPIN; `frame % length`).

- [x] **Step 1: Write the failing test** in glyph-table.test.js: `STATE_GLYPH.input === "◇"`, `PHASE_GLYPH.implement === "⚒"`, `spin(7, "verify") === "◓"`, `spin(10) === "⠋"`, `roleLetter("docs-curator") === "D"`, `roleLetter("zebra") === "Z"`, `roleLetter("") === "?"`.
- [x] **Step 2: Run** `cd plugins/atlas/scripts && node --test dashboard_ui/js/glyph-table.test.js`. Expected: FAIL, module not found.
- [x] **Step 3: Implement** glyph-table.js with the exports above; values copied from facts section 10 as `\uXXXX` escapes, not pasted glyphs.
- [x] **Step 4: Run** the same command. Expected: PASS.
- [x] **Step 5: Write the failing contract test** `test_dashboard_glyphs_match_theme_ts` in plugins/atlas/hooks/test_atlas_contract.py: regex-extract STATE_GLYPH and CONTRACT_GLYPH entries from plugins/atlas/mod/theme.ts and the `\uXXXX` literals from glyph-table.js; assert the two maps are equal (keys and codepoints) for the nine states and eight phases.
- [x] **Step 6: Run** `python3 -m unittest plugins.atlas.hooks.test_atlas_contract -k glyphs` (or the file path form the module supports). Expected: PASS. Then change one escape in glyph-table.js, run again, expected FAIL, revert.
- [x] **Step 7: Commit** `feat(cc15): glyph and role tables pinned to theme.ts`.

### Task 2: Tokens and the contrast gate

**Files:**
- Modify: `plugins/atlas/scripts/dashboard_ui/css/tokens.css` (rewrite)
- Restore then modify: `plugins/atlas/scripts/dashboard_ui/design/contrast.py` (from `git show HEAD:plugins/atlas/scripts/dashboard_ui/design/contrast.py`)

**Interfaces:**
- Produces CSS custom properties on `:root` (dark default, `color-scheme: dark`) and `:root[data-theme="light"]` plus `@media (prefers-color-scheme: light) :root[data-theme="system"]`: `--canvas --chrome --well --rule --rule-2 --text --dim --faint --brand --brand-ink --focus --ok --working --needs --fail --idle --sub --mono --sans --s1..--s7 --r1 --r2 --t-tick: 250ms`. Dark values: canvas #0c1215, chrome #0a0e11, well #121a1e (BRAND surface), text #e6edf0, dim #9fb0b8, brand #2fbd9f, focus #7fe0cb, ok #52c872, working #62b8e6, needs #f2aa40, fail #ff7570, idle #93a4ac, sub #b5a3fa; `--rule`, `--rule-2`, `--faint`, `--brand-ink` chosen by the builder to pass contrast.

- [x] **Step 1: Restore** contrast.py from HEAD into design/ and run `python3 plugins/atlas/scripts/dashboard_ui/design/contrast.py`. Expected: exit 0 on the v14 palette (baseline).
- [x] **Step 2: Edit** the DARK and LIGHT dicts in contrast.py to the v15 token values above; run it. Expected: FAIL list names any pair under threshold (this is the failing check).
- [x] **Step 3: Rewrite** tokens.css with the same values (one source: copy the dict values; add a comment line naming contract.ts as origin). Adjust `--rule`, `--rule-2`, `--faint`, `--brand-ink` until contrast.py exits 0; keep tokens.css and contrast.py in sync.
- [x] **Step 4: Run** contrast.py. Expected: exit 0, no FAIL lines. Run the JS suite. Expected: 25 pass (18 + 7 from Task 1), 0 fail.
- [x] **Step 5: Commit** `feat(cc15): BRAND tokens and restored contrast gate`.

### Task 3: Shell, router and band

**Files:**
- Modify: `plugins/atlas/scripts/dashboard_ui/index.html` (new frame: `<header id="band">`, `<div id="cols">` with three `<section>` landmarks, `#toasts`)
- Modify: `plugins/atlas/scripts/dashboard_ui/js/app.js` (NAV at :37-47 becomes six entries; keep the page contract `mod.render({ root, route, params, project, navigate, setParams })` at :275 and the cleanup return)
- Modify: `plugins/atlas/scripts/dashboard_ui/js/router.js` `redirectOld` (:59-63) for the six redirects
- Create: `plugins/atlas/scripts/dashboard_ui/js/band.js`, `plugins/atlas/scripts/dashboard_ui/css/shell.css` (rewrite), `plugins/atlas/scripts/dashboard_ui/css/base.css` (rewrite)
- Test: `plugins/atlas/scripts/dashboard_ui/js/band.test.js`, `plugins/atlas/scripts/dashboard_ui/js/router.test.js` (extend)

**Interfaces:**
- Produces: `export function renderBand(model: { project, branch, lead, phase, n, m, counts: { working, needs, failed, parked }, live: "live"|"connecting"|"reconnecting"|"offline", clock: string, narrow: boolean }): string` (HTML). Phase pills: past = check + name, current = `◆ NAME n/m` with class `now`, future = name dim; `narrow` renders only the current pill. Counts use STATE_GLYPH-colored dots; the live word uses LIVE_WORD (app.js:49-54).
- NAV: `[["run","Run"],["agents","Agents"],["board","Board"],["channels","Channels"],["health","Health"],["settings","Settings"]]`.

- [x] **Step 1: Write the failing tests**: band.test.js: `renderBand({...phase:"implement", n:3, m:5...})` contains `IMPLEMENT 3/5` inside `class="pill now"`, contains four `pill past`, two future pills, and the string `1 needs you`; with `narrow:true` contains exactly one `pill`; with `live:"reconnecting"` contains `Reconnecting`. router.test.js: `redirectOld("#/overview") === "#/run"`, `"#/activity" -> "#/channels"`, `"#/improve" -> "#/health"`, `"#/projects" -> "#/settings"`, `"#/colony" -> "#/agents"`, `"#/terminal" -> "#/agents"`.
- [x] **Step 2: Run** the JS suite. Expected: FAIL (band.js missing, redirects wrong).
- [x] **Step 3: Implement** band.js, the NAV and redirect changes, index.html frame, shell.css (band two rows sticky; grid `272px 1fr 336px`; under 1100px the third column spans below; under 700px one column, rail scrolls x) and base.css (mono/sans, `.label`, `.hd`, rules). Delete sidebar markup and its CSS.
- [x] **Step 4: Run** the JS suite. Expected: PASS. Start `python3 plugins/atlas/scripts/atlas_dashboard.py serve --port 7499` and open `/#/overview`; expected URL becomes `/#/run` and the band renders with a phase rail (page body may be empty until Task 6).
- [x] **Step 5: Commit** `feat(cc15): band, six-route shell, redirects`.

### Task 4: Run page data adapters (pure)

**Files:**
- Create: `plugins/atlas/scripts/dashboard_ui/js/run-data.js`
- Create: `plugins/atlas/scripts/dashboard_ui/js/fixtures/overview.json`, `agents.json`, `colony.json`, `channel.json`, `gates.json` (captured from the live 7499 server in step 1; gates.json hand-written to the Task 5 shape)
- Test: `plugins/atlas/scripts/dashboard_ui/js/run-data.test.js`

**Interfaces:**
- Consumes: `/api/v2/overview` (overview.js:216; `overview.attention[]` items with `severity, title, detail|what, action.target, action.label`; `waitingAgents` from agents with `name, project, since, key`; the runs/dispatches/silent-failures/tool-errors/doctor fields and deltas inside `runsPanel(overview)` at overview.js:239, which the implementer reads first and names in the fixture), `/api/v2/agents` (per-agent keys from atlas_dash_herd.py build_agents :614-720: at least `name, key, project, state, kind, session_id, state_changed_at, last_message_at, colony`), `/api/v2/colony` (`ok, project, lead{name,channel}, channel, members[]{name, kind, state, parked, steerable, queued, wave{paused,canceled}, last_active, tasks[]}`), `/api/v2/channels/<name>` (note records; dedupe key `seq` else `id` else `ts+from+text`), `/api/v2/gates` (Task 5 shape).
- Produces: `toBand(overview, colony, header) -> BandModel` (Task 3 shape; phase and n/m parsed from the lead's last `ATLAS | <glyph> <phase>( n/m)? | ...` line with the regex in contracts/operating-contract.json:14, default phase "research"); `toSeats(agents, colony) -> Seat[]` where `Seat = { name, role, letter, state, glyph, tool, elapsedCells: 0..8, age, colony, lead, selected }`; `toFeed(notes) -> FeedRow[]` where `FeedRow = { key, t, kindGlyph, kindClass, from, fromClass, text, needs: boolean, phase?: string }`, dedupes by key and sorts by ts; `toNeeds(overview, agents) -> NeedItem[]` where `NeedItem = { key, title, detail, state: "waiting"|"failing"|"warning", stateLine, actions: [{label, target}] }` and `stateLine` omits the duration when `since` is missing; `toGates(gates) -> GateChip[]` `{ letter, label, ok, message }`; `toMetrics(overview) -> MetricRow[]` `{ id, label, n, cells: 0..13, delta: string, tone: "up"|"dn"|"flat"|"bad" }`.

- [x] **Step 1: Capture fixtures** with the 7499 server running: `curl -s -H "X-Atlas-Token: $(grep -o 'atlas-token" content="[^"]*' <(curl -s http://127.0.0.1:7499/) | cut -d'"' -f3)" http://127.0.0.1:7499/api/v2/overview?window=7d > fixtures/overview.json` and the same for agents, colony and `channels/<lead channel>`; redact any home paths to `~`. Read overview.js:239-300 and note the metric field names in a comment at the top of run-data.js.
- [x] **Step 2: Write the failing tests** against the fixtures: `toSeats` returns one row per agent with `letter` from ROLE_LETTER and `glyph` from STATE_GLYPH; `toFeed` of a fixture concatenated with itself has the same length as the fixture; `toNeeds` of an item with `since: null` has a `stateLine` that does not match `/NaN|undefined/` and starts with the state word; `toBand` of a colony with `ok:false` gives `phase:"research"` and `n === null`; `toMetrics` gives five rows in the spec order with `cells` between 0 and 13; `toGates` maps `lines[]` to chips with `ok === line.passed`.
- [x] **Step 3: Run** the suite. Expected: FAIL, run-data.js missing.
- [x] **Step 4: Implement** run-data.js (pure functions only; no DOM, no fetch).
- [x] **Step 5: Run** the suite. Expected: PASS.
- [x] **Step 6: Commit** `feat(cc15): run page adapters with live fixtures`.

### Task 5: Read-only gates route

**Files:**
- Create: `plugins/atlas/scripts/atlas_dash_gates.py`
- Modify: `plugins/atlas/scripts/atlas_dashboard.py` v2 route table (the list that holds `/api/v2/health` etc. near :2242-2249) to register the new module's routes
- Test: `plugins/atlas/scripts/test_atlas_dash_gates.py` (unittest, same style as neighbouring test_*.py files in plugins/atlas/scripts if any; else plain unittest)

**Interfaces:**
- Consumes: `atlas_gates.completion_group(session: str, root: Path, transcript: str) -> {"id","title","lines":[{letter,label,passed,message,gist}], "error"?}` (atlas_gates.py:73-100).
- Produces: `GET /api/v2/gates?session=<id>` returning `{ ok: true, session, lines: [...] }` with the `lines` list passed through, HTTP 400 `{ok:false, error:"session_required"}` when the param is missing, 404 `{ok:false, error:"session_not_found"}` when `_session_detail(conn, session_id)` (atlas_dashboard.py:854) finds none. Handler signature follows the pattern used by `h_channels_post(ctx, b, root)` in atlas_dash_irc.py:659; transcript path resolved the way the completion gate hook resolves it (search `transcript` in plugins/atlas/hooks/completion_gate.py and reuse that helper).

- [x] **Step 1: Write the failing tests**: `test_gates_requires_session` (400), `test_gates_unknown_session` (404), `test_gates_passthrough` (monkeypatch `atlas_gates.completion_group` to return two lines; assert the response carries both and `ok` is true).
- [x] **Step 2: Run** `python3 -m unittest plugins/atlas/scripts/test_atlas_dash_gates.py`. Expected: FAIL (module missing).
- [x] **Step 3: Implement** atlas_dash_gates.py and register it.
- [x] **Step 4: Run** the test. Expected: PASS. With the 7499 server up: `curl -s -H "X-Atlas-Token: ..." "http://127.0.0.1:7499/api/v2/gates?session=<a live session id from /api/sessions>"`; expected a JSON object with `lines`. Also `curl ... /api/v2/gates` (no param); expected 400.
- [x] **Step 5: Commit** `feat(cc15): read-only /api/v2/gates`.

### Task 6: Run page

**Files:**
- Create: `plugins/atlas/scripts/dashboard_ui/js/pages/run.js`, `plugins/atlas/scripts/dashboard_ui/css/run.css`
- Create: `plugins/atlas/scripts/dashboard_ui/js/steer.js`
- Delete: `plugins/atlas/scripts/dashboard_ui/js/pages/overview.js`, `pages/activity.js`, `pages/improve.js`, `pages/projects.js` and their CSS once Tasks 8 and 9 have moved what they still need (delete in Task 8).
- Test: `plugins/atlas/scripts/dashboard_ui/js/run.test.js`, `plugins/atlas/scripts/dashboard_ui/js/steer.test.js`

**Interfaces:**
- Consumes: Task 4 adapters; Task 1 glyphs; `startStream()` and `primeTopics()` from api.js (:151, :192); `post("/api/v2/channels", { channel, to, text, kind: "steer" })` (atlas_dash_irc.py:659-674; confirm the text field name by reading `_post` at :346 and record it in steer.js).
- Produces: `render({ root, route, params, project, navigate, setParams })` returning a cleanup; region renderers exported for tests: `renderSeats(seats, selected) -> string`, `renderFeed(rows) -> string`, `renderNeeds(items) -> string`, `renderGates(chips) -> string`, `renderMetrics(rows) -> string`, each with `loading`, `empty`, `error(message)` variants exported as `renderRegionState(kind, name, message?) -> string`; `steer.js`: `export function sendSteer({ channel, to, text }) -> Promise<{ok, error?}>` and `export function steerTarget(selectedSeat, lead) -> string` (`@<seat>` when a seat is selected, else `@lead`, `@all` on request).
- Keyboard: `1/2/3` focus regions, `f` filter feed to the selected seat, `i` and `m` focus the steer input, `h` hold the selected seat (POST the same note with `kind:"hold"`), `esc` blur, `/` palette (Task 7).

- [x] **Step 1: Write the failing tests**: run.test.js renders each region from the Task 4 fixtures and asserts: seats HTML contains `class="seat sel"` once and the letters `L` and `I`; feed HTML contains the needs row with `class="ev need"` and a `daymark`; needs HTML has `Answer` for waiting items and `Open` for warnings; gates HTML has one `gate ok` per passed line; metrics HTML has five rows; `renderRegionState("empty","seats")` contains "No seats"; `renderRegionState("error","channel","timeout")` contains "Retry". steer.test.js: `steerTarget(null, "lead-x") === "@lead"`, `steerTarget({name:"impl-a"}, "lead-x") === "@impl-a"`; `sendSteer` with a stubbed `post` rejecting `{status:409, data:{error:"held"}}` resolves `{ok:false, error:"held"}` and never throws.
- [x] **Step 2: Run** the suite. Expected: FAIL.
- [x] **Step 3: Implement** run.js, steer.js, run.css following the mockup: left rail groups per colony, seat rows (glyph, letter, name, age; tool, 8-cell bar, spinner or state word), machine line at the bottom; center `CHANNEL` header, feed rows with 72px mono gutter and 24px kind column, steer bar; right needs-you items (amber inset, red for failing), gates chips, metrics table with 13-cell bars. Stream updates re-render only the affected region. Spinner advances every 250 ms only while a seat is `running`.
- [x] **Step 4: Run** the suite. Expected: PASS. In the browser at 7499: `/#/run` shows all regions with live data; disconnect the server for 10 s and reconnect; expected the band shows Reconnecting then Live and the feed has no duplicate rows.
- [x] **Step 5: Commit** `feat(cc15): run page`.

### Task 7: Keys and palette

**Files:**
- Create: `plugins/atlas/scripts/dashboard_ui/js/keys.js`
- Modify or reuse: the v14 palette module if one exists under dashboard_ui/js (search for `palette`); otherwise create `plugins/atlas/scripts/dashboard_ui/js/palette.js`
- Test: `plugins/atlas/scripts/dashboard_ui/js/keys.test.js`

**Interfaces:**
- Produces: `export function bindKeys(map: Record<string, () => void>, { isTyping: () => boolean }) -> () => void` (returns unbind; ignores keys while `isTyping()` is true); `export const RUN_KEYS = ["1","2","3","f","i","m","h","Escape","/"]`; palette: `export function openPalette(commands: {id,label,run}[])` with the six routes plus `Steer lead`, `Hold selected seat`, `Toggle theme`.

- [x] **Step 1: Write the failing test**: dispatching a synthetic `keydown` for `f` calls the handler once; with `isTyping` true it is not called; `Escape` is delivered even while typing.
- [x] **Step 2: Run** the suite. Expected: FAIL.
- [x] **Step 3: Implement** keys.js and wire RUN_KEYS in run.js; palette entries.
- [x] **Step 4: Run** the suite. Expected: PASS. Browser: press `/`, expected the palette; press `3` then `Tab`, expected focus lands in the needs-you region.
- [x] **Step 5: Commit** `feat(cc15): keymap mirroring the TUI and palette`.

### Task 8: Agents, Board, Channels, Health, Settings on the new shell

**Files:**
- Modify: `plugins/atlas/scripts/dashboard_ui/js/pages/agents.js` (seats as full rows; drawer via `drawer/agent-drawer.js` reused), `pages/board.js`, `pages/channels.js` (absorbs activity history), `pages/health.js` (absorbs improve and doctor), `pages/settings.js` (absorbs projects list; keeps all 71 controls and the preference-first paint)
- Modify: `plugins/atlas/scripts/dashboard_ui/css/pages.css`, `css/settings.css`, `css/terminal.css` (restyle to rules, mono fact columns, no cards)
- Delete: `pages/overview.js`, `pages/activity.js`, `pages/improve.js`, `pages/projects.js`, `css/ui.css` if no longer imported
- Test: one `*.test.js` per page asserting `render` returns a function and that the four `renderRegionState` variants appear for its main region.

- [x] **Step 1: Write the failing page tests** (five files, same assertions).
- [x] **Step 2: Run** the suite. Expected: FAIL for the pages not yet exporting the state renderers.
- [x] **Step 3: Restyle and merge** each page; remove the four deleted pages and any import of them; keep every Settings control id stable (the platform preserves form state by id).
- [x] **Step 4: Run** the suite. Expected: PASS. Browser: visit each of the six routes and the six old hashes; expected no console errors and each old hash lands on its new route. In Settings, change the theme; expected the band repaints before the projects request completes.
- [x] **Step 5: Commit** `feat(cc15): remaining pages on the band shell`.

### Task 9: Version, docs and spec sync

**Files:**
- Modify: `plugins/atlas/.claude-plugin/plugin.json` (version 15.0.0), `.claude-plugin/marketplace.json`, `plugins/atlas/CHANGELOG.md` (15.0.0 entry), `docs/CHANGELOG.md`, `docs/ROADMAP.md` (move the CC15 items to done), `plugins/atlas/README.md` and `README.md` (Command Center section: six routes, keys), `docs/command-center-redesign.md` (top line: superseded by the v15 design), `docs/plans/2026-10-22-command-center-v15-design.md` (note the title-row deviation from Global Constraints)
- Test: `plugins/atlas/hooks/test_atlas_contract.py` version-alignment test (exists per claude-mem #45411) must pass.

- [ ] **Step 1: Run** `python3 -m unittest plugins/atlas/hooks/test_atlas_contract.py`. Expected: FAIL on version alignment after bumping plugin.json alone (do that first to see the red).
- [ ] **Step 2: Update** every file above.
- [ ] **Step 3: Run** the same command. Expected: PASS. `grep -rnP "[\x{2013}\x{2014}\x{2018}\x{2019}\x{201C}\x{201D}\x{2026}]" docs/plans/2026-10-22-command-center-v15-*.md plugins/atlas/CHANGELOG.md` expected no output.
- [ ] **Step 4: Commit** `release(atlas): 15.0.0 command center band and rail`.

### Task 10: Runtime acceptance

**Files:** none (evidence under `.atlas/evidence/cc15/`)

- [ ] **Step 1:** Start the source server on 7499. Run the full JS suite and the Python contract test; record both summary lines.
- [ ] **Step 2:** With a browser tool, at 1440x900, 1000x800 and 390x844: visit `/#/run`, `/#/agents`, `/#/settings`; save screenshots to `.atlas/evidence/cc15/<route>-<width>.png`; assert `document.documentElement.scrollWidth <= window.innerWidth` on each; console error count 0.
- [ ] **Step 3:** Exercise states: stop the server and reload `/#/run` (error state with Retry visible); start it and press Retry (success); open a project with no colony (seats empty line). Screenshot each.
- [ ] **Step 4:** Send one steer note from the bar to `@lead`; expected it appears in the feed within one stream tick and `atlas_todo.py` board shows the note. Then send with the token meta tampered; expected the inline 401 message and the text retained.
- [ ] **Step 5:** Run contrast.py (exit 0). Write `.atlas/.run/findings.json` entry `cc15-accept` with status verified and the evidence paths. Stop the 7499 server.
