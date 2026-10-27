# Command Center overhaul: real terminals, settings with full control, one operate surface

Date: 2026-10-22. Status: shipped 13.0.0 (unreleased); polish branch worker/w3-polish in flight. Target version: 13.0.0.

## Why

User verdict on the Command Center: Overview and Health are good; Colony, Agents, Supervise, Channels, Board and above all Terminal are painful, and the Terminal "doesn't work and is 99% fake". Settings is one long scroll with free text fields, "set in shell" rows the user cannot change, and saves that are never verified.

Audit evidence (read-only, this session): `.atlas/.run/cc-audit-terminal.md`, `cc-audit-settings.md`, `cc-audit-operate.md`, runtime `cc-runtime-terminal.md` with screenshots in `cc-shots/`.

What the audits established:

- The Terminal page streams a real PTY over `/api/v2/term/ws` (atlas_dash_term.py), but the process it runs is `atlas_tui`, a curses mock-up of colony state. A curses picture of the colony is what reads as fake. Seats' real terminals (tmux/herdr panes) are reachable through `kind=pane` but never shown as a grid.
- Settings: 13 sections, 87 controls, 17k px of scroll in one column; 30 curated knobs plus an "advanced" scan; six shell-scope rows refused by the server; a save flashes "Saved" on any 200 without comparing the value; model names are free text; numbers are not range-checked in the knob path.
- Operate: roster drawn four ways (agents, colony, supervise, fleet drawer), four send paths with the wave gate on only one, Agents "Stop" kills a pane with no confirm and no identity check, `#/board` is a 404 (board lives at `#/agents?lens=board`), pause/resume/cancel routes exist with no UI, the board has no loading or error state and no JS tests, five refresh cadences.

User decisions (AskUserQuestion, this session): Terminal becomes an openrig-style seat grid of real terminals; all three waves run in sequence with one report at the end; shell-scope settings become writable through the harness config layers AND a managed shell rc snippet.

## Reference look: openrig team workspace

Indexed in context-mode as `openrig-workspace-mjs`, `openrig-staged-terminal`, `openrig-player-css`, `openrig-workspace-json`. The parts we copy:

- Grid of `article.terminal-card` per seat (`seat.address` such as `builder@factory`, `seat.role` as the subtitle); click or Enter enlarges one seat (`.enlarged`), "← All agents" returns, sidebar lists `Agents · N` with the active one marked `aria-current`.
- Card: `.runtime-title` (runtime name left, seat right), `.terminal-body` with `.terminal-content`, optional `.activity` footer (`✻ spinner` + text), `.tool-dot` for `⏺`, prompt `❯ ` with a blinking `.cursor` that stops when offscreen or with reduced motion.
- Tokens: `--terminal-bg:#161616; --terminal-ink:#dedede; --terminal-muted:#8b8b8b; --terminal-prompt:#3c4249; --terminal-orange:#d79878; --terminal-model:#d9bd7e; --terminal-cwd:#a4d397`; card `font:14px/1.45 Menlo,monospace; padding:18px; border:1px solid #383838; border-radius:4px; min-height:480px`; page bg `#0c0a09`; two-column grid `repeat(2, minmax(0,1fr))`, one column under 760px.
- Space switcher (`factory`, `ops`, `tui`): the `tui` space is the native TUI in an iframe with a "How to navigate" details block. Our equivalent: spaces = projects/colonies; `TUI` space = the existing `kind=tui` atlas_tui session.

## Wave 1: Terminal

### U1 (server) seats API, shell seats, ticket auth, idle timeout

Files: `plugins/atlas/scripts/atlas_dash_term.py`, `atlas_colony_model.py` (read), `atlas_dashboard.py` (route table only), `test_atlas_dash_term.py`.

- `GET /api/v2/term/seats?project=<root>|all` returns `{ok, machine, clock, spaces:[{id,name,kind:"colony"|"host", seats:[{address, name, role, runtime:"claude"|"omp"|"codex"|"shell", state, pane, target, kind:"pane"|"shell"|"tui", project, cwd, started_at, last_activity}]}]}`. Colony seats come from `atlas_colony_model.snapshot` (lead first, then workers, same order as the Colony page). Every colony space ends with one synthetic `shell` seat (`address:"shell@<space>"`, `kind:"shell"`, cwd = project root) and the host space carries `shell@host` (cwd = home) and `tui@host` (`kind:"tui"`). A seat whose pane is gone keeps its row with `state:"ended"` and `target:null`.
- `kind=shell` on `/api/v2/term/ws`: `pty.fork` of `$SHELL -l` (fallback `/bin/zsh`, then `/bin/sh`) with `cwd` from the ticket, `TERM=xterm-256color`, `COLUMNS/LINES` from the query. Same `_slots` cap, same `_pump`.
- Ticket auth (closes audit gap 1): `POST /api/v2/term/ticket {kind,target?,project?,cols,rows}` with the usual `X-Atlas-Token` returns `{ticket, expires_in: 30}`; `/api/v2/term/ws?ticket=...` accepts a ticket once and burns it. The old `token=` query form keeps working for one release and logs a deprecation line.
- Idle timeout (gap 4): a PTY with no client frames for `ATLAS_TERM_IDLE_S` (default 900) is closed with code 1000 reason `idle`; the slot is released; test.
- Placeholder timeout support (gap 3): the server sends a first frame within 1 s of upgrade (`\x1b[?25l` is enough) so the client can distinguish "connected, nothing yet" from "dead".
- `term/ws` is registered in the v2 route table (gap 2) or a test asserts every `/api/v2/` literal in `do_GET` appears in the table.

Tests: seats shape (lead, worker, ended seat, shell seats present), ticket single use and expiry, shell PTY round trip (`echo ok`), idle close, deprecation path.

### U2 (client) seat grid page with the openrig look

Files: `plugins/atlas/scripts/dashboard_ui/js/pages/terminal.js`, `css/terminal.css`, `js/terminal.test.js`, `js/terminal-placeholder.test.js`, `js/xterm-fill.test.js`; `js/nav-order.js` and `app.js` only for the deep-link fix.

- Layout: left rail = spaces (projects/colonies) then `Agents · N` seat list with role subtitles; main = card grid (two columns, one under 760px); each card is an openrig `terminal-card` whose body is an xterm instance (theme from the tokens above, JetBrains Mono from `fonts/`, 14px, fit addon), `runtime-title` left = runtime label (`Claude Code`, `omp`, `Codex CLI`, `Shell`, `TUI`), right = address; footer `.activity` shows the seat state and `last_activity` age, with the `✻` spinner while `state === "running"`.
- Connection policy: a card connects when it scrolls into view (IntersectionObserver) and disconnects after 60 s offscreen; the enlarged seat always connects; at most 6 live sockets, the rest show the last capture text (`term/capture`) with a "paused" badge. Connect via `POST term/ticket` then `ws?ticket=`.
- Enlarge: click, Enter or `?seat=<address>` deep link; `← All agents` returns and restores scroll; keyboard: arrows move between cards, Escape backs out, Shift+Tab leaves the terminal (document the keys in a `details` block like openrig).
- Shell seat and TUI seat use `kind=shell` / `kind=tui`; the TUI keeps the OSC 7717 handler.
- Placeholder: `connecting to <address>…`; after 5 s without a frame it becomes an error line with a Retry button (never stays as a silent placeholder).
- Deep-link race from the runtime report (cold load of `#/terminal` landed on `#/overview`): find the cause in `app.js` route boot and fix it with a test.
- Remove the old `render` grid code paths that polled captures for every card at once.

Tests (node, existing runner): seats render in order, shell seat present, enlarge/back, ticket then ws URL, offscreen disconnect, placeholder timeout, deep link, `#/terminal` cold load.

### W1 verification

`python3 -m unittest plugins/atlas/scripts/test_atlas_dash_term.py`, `node --test plugins/atlas/scripts/dashboard_ui/js/*.test.js` (or the repo's js test command), then `atlas:ui-runtime-tester` on the merged tree: start the source server on 7499, open `#/terminal` cold, screenshot the grid with at least the lead seat live and a shell seat where `echo hello` echoes, enlarge one seat, back, mobile width.

## Wave 2: Settings

### U3 (server) settings registry with options, layers and verified writes; ollama API

Files: `plugins/atlas/scripts/atlas_control.py`, `atlas_dashboard.py` (routes), new `atlas_ollama.py`, tests `test_atlas_control.py`, new `test_atlas_ollama.py`.

- Every knob in `behavior_state()` carries: `kind` (`toggle|select|number|text|model|url|command`), `options` (list of `{value,label,hint}` for `select`; the audit lists ATLAS_OPTIMIZE, ATLAS_OPTIMIZE_TRIGGER prefixes, ATLAS_TYPESAFE_MODEL and every other finite set), `range` `{min,max,step}` for numbers (enforced in `write_behavior_updates`), `effect` (one sentence: what changes when it changes), `applies` (`now` | `next-session` | `dashboard-restart`), `scope` and `layers`.
- Layers: `{live_env, store, claude_settings, omp_config, shell_rc}` each `{supported, value}`. Shell-scope knobs (the six S rows) become writable: the write goes to `claude_settings` (`~/.claude/settings.json` `env`), `omp_config` (`~/.omp/agent/config.yml` `env:` map, created if absent, YAML written with the stdlib-safe writer already used for config reads, or a minimal line-based editor that preserves the rest of the file) and `shell_rc` (`~/.atlas/env.sh` holding `export K=V` lines between `# >>> atlas managed >>>` / `# <<< atlas managed <<<` markers, plus one idempotent `[ -f ~/.atlas/env.sh ] && . ~/.atlas/env.sh` line in `~/.zshenv`, guarded by the same markers; never touch anything outside the markers; `ATLAS_HOME`/`ATLAS_DB` path values must be absolute and are validated to exist or be creatable).
- Verified write: after writing, read back every layer written and return `{ok, key, wanted, layers:[{layer, wrote, got, ok}], applies}`; `ok` is false if any written layer does not read back equal. The UI never flashes Saved on a 200 alone.
- `ATLAS_OPTIMIZE_CMD` (gap 4): write requires `confirm:true` in the body; the response otherwise is 409 `needs_confirm` with the command echoed.
- Ollama: `atlas_ollama.py` wraps the CLI (`ollama list`, `ollama ps`, `ollama show <m> --modelfile`/json, `ollama pull`, `ollama rm`) using `OLLAMA_HOST`/`ATLAS_OLLAMA_URL`. Routes: `GET /api/v2/ollama/models?scope=local|cloud|all&sort=latest|size|name|popular&q=` returning `[{name, tag, family, params, size_bytes, modified_at, cloud:bool, running:bool, context, quant, popularity_rank?}]` (cloud = tag ends with `:cloud` or size unknown; `popular` uses a cached fetch of `https://ollama.com/library?sort=popular` parsed for model names, cached 10 min in `~/.atlas/ollama-library.json`, failure leaves rank null), `GET /api/v2/ollama/status` (reachable, version, `ps`), `POST /api/v2/ollama/pull {name}` starting a background job with `GET /api/v2/ollama/jobs/<id>` progress lines, `DELETE /api/v2/ollama/models/<name>` with `confirm:true`. All mutations need the token and `Content-Type: application/json`. Every model-kind knob (`ATLAS_OPTIMIZER_MODEL`, `ATLAS_DECISION_MODEL`) is validated against the local list on save; an unknown name returns 400 `unknown_model` with the closest matches.

Tests: options present for each finite knob, range enforcement, layer read-back with a forced mismatch, shell rc marker idempotency (write twice, one block), zshenv guard line once, needs_confirm, ollama list parsing of real `ollama list` output (fixture from this machine includes `:cloud` rows with size `-`), sort and filter, pull job lifecycle with a fake binary.

### U4 (client) settings page restructure

Files: `pages/settings.js` (rewrite allowed), new `js/settings-row.js`, new `js/model-picker.js`, `css/pages.css` or a new `css/settings.css`, tests `js/settings.test.js`, `js/model-picker.test.js`.

- Layout: sticky left category nav (Preferences, Session automation, Guardrails, Prompt optimizer, Decision model, Storage, Colony, Scoring, Integrations, Ecosystem, Connectors, Agents, Advanced); content in a two-column responsive grid of setting cards (`repeat(auto-fit, minmax(420px, 1fr))`), one column under 900px. Filter box at the top filters across all categories and shows counts per category.
- Row contract: title, one-line description, `effect` line, `applies` badge (`applies now`, `next session`, `restart dashboard`), the control, current live value vs saved value when they differ (`live: on · saved: off`), and a status glyph after save: `✓ verified` with the layers that read back, or `✗ not saved: <layer> has <got>`.
- Controls by kind: `toggle` → switch; `select` → `<select>` from `options`; `number` → number input with min/max/step and a stepper; `model` → model picker; `url` → text with a Test button that calls the matching status route; `command` → text with the confirm dialog; `text` only when the server gives no options. No empty free text where options exist.
- Shell-scope rows: editable; the layers list shows exactly which files were written (claude settings, omp config, `~/.atlas/env.sh`) and the badge says `next session`.
- Model picker: dropdown fed by `GET /api/v2/ollama/models`; chips for `Local`/`Cloud`/`All`; sort select `Latest`/`Size`/`Name`/`Popular`; search; each row shows name, params, size or `cloud`, modified age, `running` dot; `Pull another…` opens an input that calls the pull job and shows progress; status line shows ollama reachability from `/ollama/status`; the picked value is written through the normal knob save and verified.
- Preferences keep their current semantics but use the same row component.

Tests: category nav renders all sections, filter narrows, select rendered for an options knob, number clamps to range, save mismatch renders `not saved`, model picker filters local/cloud and sorts, shell-scope row editable.

### W2 verification

`python3 -m unittest plugins/atlas/scripts/test_atlas_control.py plugins/atlas/scripts/test_atlas_ollama.py`, js tests, then ui-runtime-tester: settings page scroll height under 6000 px at 1280 wide, two columns visible, change ATLAS_TRIPWIRE_THRESHOLD and see `✓ verified`, open the model picker and see this machine's models with cloud rows filtered, save `ATLAS_DECISION_MODEL` to `nimble:latest` and read it back from `~/.claude/settings.json` (then restore the previous value), shell-scope row writes `~/.atlas/env.sh` (inspect the file; restore).

## Wave 3: Operate pages

### U5 one operate surface

Files: `pages/agents.js`, `pages/colony.js`, `pages/supervision-lens.js`, `pages/work.js`, `js/fleet.js`, `js/nav-order.js`, `app.js`, tests; server: `atlas_dash_colony.py` only for a shared kill guard if needed.

- `Agents` becomes the one roster: lenses `Roster` (today's colony table with Send/Kill), `Supervise` (supervision-lens content), `Board` (work.js). `Colony` nav entry redirects to `#/agents` (alias in nav-order), `#/board` aliases to `#/agents?lens=board`, `#/supervise` to `#/agents?lens=supervise`. The fleet drawer "Open in Colony" opens the roster lens with the seat selected; "Open terminal" opens `#/terminal?seat=`.
- One send path: every composer posts through the colony send handler with the wave gate; remove the other three client paths.
- Stop/Kill: one action, confirm dialog naming the seat, routed through the identity-checked colony kill (409 `member_dead` shown as such). Pause/Resume/Cancel buttons wired to the existing colony routes with confirm on Cancel.
- Board lens: loading, empty, error states; failed refresh shows a stale banner with the last good time; SSE as today.
- Refresh: roster and supervise on the SSE `herd`/`agents` events with the 8 s poll fallback already in agents.js; the colony 8 s timer and channels 5 s timer go away in favor of SSE events (`irc` event exists).
- Delete the unreachable agents.js channel-lens branch.

### U6 channels

Files: `pages/channels.js`, `pages/channel-lens.js`, `atlas_dash_irc.py` (read), tests.

- SSE-driven refresh (`irc` event), composer through the single send path from U5, delivery-state chips kept, loading/empty/error states checked, a JS test file added.

### W3 verification

Unit tests, then ui-runtime-tester: `#/board`, `#/colony`, `#/supervise` all land on Agents with the right lens; Stop shows a confirm; Pause/Resume present; board error state shown by stopping the server mid-session; channels update on a posted note without a 5 s wait.

## Cross-cutting

- Version 13.0.0 in `plugins/atlas/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; CHANGELOG `## 13.0.0` with Added/Changed/Removed/Verified; `plugins/atlas/README.md` Command Center section rewritten for the new Terminal, Settings and Agents pages; `dashboard_ui/design/PAGES.md` and `design/API.md` updated with the new routes and page contracts.
- Every unit: proof-first (failing test, then pass), worktree per implementer (`atlas_wt.py add <unit>`), verifier per branch, merge one at a time, full suites rerun on the merged tree.
- No edits under `~/.claude/plugins/cache` or `~/.omp`; the runtime tester uses port 7499 and never stops the user's 7421 instance.
- Browser tests are headless only (user correction 2026-10-22): no chrome-devtools MCP, no playwright MCP (the plugin's launches a headed Chrome), no cmux browser. Testers drive `playwright-core` from a node script with `chromium.launch({headless: true, channel: "chrome"})` (`NODE_PATH=~/.npm/_npx/9833c18b2d85bc59/node_modules`), saving screenshots to `.atlas/.run/`.

## Outcome

Merged on main (merge commit, verified finding):

| Unit | Merge commit | Finding |
|---|---|---|
| W1-U1 server | `320d969b` (feat `128dc289`) | W1-U1 |
| W1-U2 client | `0663499d` (feat `3cd9964c`); flake fix `76369382` (`37d8a75a`) | W1-U2, W1-U2-flake |
| W2-U3 server | `98e47ece` (feat `2ced5b87`) | W2-U3 |
| W2-U4 client | `f97ccfa9` (feat `9045e2d3`) | W2-U4 |
| W2 contract fixes | `a7986654` (`47158f65`) | W2-fix |
| W2 polish | `cd53dc66` (`e14abd5e`) | W2-polish |
| W3-U5 operate surface | `66d70aa4` (`dfcf501f`) | W3-U5 |
| W3-U6 channels | `9a2998f5` (`387aadea`) | W3-U6 |
| W3-U7 lead seat attach | `895a6c5e` (`7ab8f588`, `28824b4c`) | W3-U7 |
| W3 mock-leak fix | `4053f426` (`b1fe6a9c`) | W3-mockleak |
| tmux default transport | `1d24ddd7` (`77c7e803`) | transport-default |
| Releases workflow | `91ab0bc5` (`34d6d99b`) | releases |

Runtime reports: `.atlas/.run/cc-w1-runtime.md`, `.atlas/.run/cc-w2-runtime.md`, `.atlas/.run/cc-w3-runtime.md`. Open items are in `docs/ROADMAP.md` under "Command Center next".

