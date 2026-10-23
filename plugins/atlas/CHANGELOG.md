# Changelog

## Unreleased

### Breaking changes

- The vendor connectors moved from the atlas plugin to the armada plugin. Tool names change from `mcp__plugin_atlas_<vendor>__*` to `mcp__plugin_armada_<vendor>__*`, so permission rules and prompts that name the old tools need updating.
- Connector credentials are now set in `/plugin` config for armada, with the same key names. The loaders fall back to values saved under atlas and to `~/.config/atlas/atlas.env`, so existing credentials keep working. Install atlas and armada together.
- The dashboard stream and terminal no longer accept `?token=`. The browser uses `POST /api/v2/stream/ticket` for a single-use ticket; non-browser callers send the `X-Atlas-Token` header.

### Security

- Self-fix verify no longer runs a database-supplied command through a shell. The command is parsed into arguments and must be a known test runner; anything else falls back to the contract test.
- The git commit and push gate can no longer be skipped with a newline, a subshell, a wrapper such as `env` or `time`, or a git global option such as `--no-pager`.
- The read-only SQL guard checks the command both with and without comments, so `SELECT 1 -- x'; DROP TABLE ...` is blocked, and it blocks instead of allowing when jq or perl is missing.
- ConnectWise connector: turning off certificate checks now affects only ConnectWise requests, not every connection in the process. Token-exchange failures log the status and error code only.
- Self-fix treats finding text as untrusted data, holds worker changes that touch test or build config for human review, and runs verify with credentials removed from the environment. Self-fix remains on by default.
- Board notes reach agents wrapped as untrusted data instead of as instructions to act on.
- Recalled memory is framed as untrusted, and imperative entries are flagged.
- One shared redactor, with best-effort SSN, routing number, account number, card number and date-of-birth patterns, is applied to stored transcript text and thinking. Existing rows are not rewritten.
- The dashboard access log redacts token and ticket values.
- Self-heal only execs a verified sibling install.
- Hooks have time budgets, and the decision classifier URL must be loopback unless `ATLAS_DECISION_ALLOW_REMOTE=1`.
- Self-fix verify runs in a clean temp checkout without network where `unshare` is available. Tests run with `ATLAS_SELFFIX=0` so a test dashboard never starts the scheduler.
- tmux workers: team size is capped at 6 (`ATLAS_MAX_TEAM`), workers cannot dispatch subagents, scrollback is limited and secrets are masked in captured output, and orphan sessions are swept.

### Fixed

- The findings ledger is written under a lock, and a corrupt ledger is set aside instead of being silently replaced.
- The completion gate's loop limit resets after a passing Stop, so it no longer turns itself off for the rest of a session.
- Fewer false alarms: credential warnings ignore 4xx fields inside successful results, and the secret warning ignores credentials piped into another command.
- Docs drift now counts new, untracked files. The nudge hook honors `ATLAS_HOME`.
- `atlas_todo.py --help` prints usage. TypeScript types match the board's real data.
- Live leads are no longer reaped on hosts without `ps`.
- Seat routing falls back to herdr when rig errors, and never raises when no backend exists.
- The inbox reads only new bytes, and a corrupt cursor no longer replays history.
- Torn note lines are repaired before the next append. A corrupt `channels.json` is preserved instead of overwritten.
- The lead-channel lock wait is bounded at 2 seconds.
- The completion gate counts evidence in nested dated folders, and only checks CHANGELOG, ROADMAP, README and stale ROADMAP items on runs that shipped code.
- The dispatch template now passes the dispatch tripwire, and the docs say never to pass `model`.
- Broken skill references are fixed.
- Test suites pass regardless of session environment, user id or checkout path.
- Serena heal no longer guesses a python interpreter.
- The Stop hook gives each step its own time slice, so one slow step cannot starve the rest.
- Rig spec writes take a lock. A live-pane reap guard now protects panes at boot, in the dashboard, in mux and in ingest.
- herdr pane capture works.
- The project selector needs a project marker unless the folder is pinned (`ATLAS_PINNED_PROJECTS`). The gateway strips the ticket too, and the health payload is split.
- The dashboard has one HTML escape helper, and `keys.js` ignores shortcuts while you type in a field.

### Changed

- Skills: atlas-ux-test is self-sufficient (ships `templates/`, runs through `scripts/ux-swarm-driver.sh` and atlas agents, no references to an unshipped harness). Duplicated references now have one owner copy (workflow-template, graphify-wiring, self-telemetry, docs-ssot) and `validate_skills.py` fails on byte-identical reference files across skills.
- Skills: three manual skills (atlas-setup, atlas-prompt, atlas-tui) are described accurately; `allowed-tools` lists match what each body uses; descriptions trimmed; ASCII-only typography; lineage notes moved to `skills/PROVENANCE.md`.
- The recall gate checks its cached result before scanning the plugin directory, removing about 16 ms from most tool calls.
- The prompt optimizer has one 25-second budget in total (was up to 220 seconds).
- The native Grep/Glob deny message names its escape hatch.
- Notes are capped at 8 KB (system exit and wrap-up notes are truncated instead of refused) and archived after 14 days once a file passes 2 MB.
- Backend detection is cached for 30 seconds.
- The install-parity checks are opt-in: set `ATLAS_CHECK_INSTALL_PARITY=1`.
- Docs: Apache-2.0 `LICENSE` files for the repo root, atlas and armada; rewritten root README (quick start, what it changes on your machine); shorter plugin manifest and marketplace descriptions with shared keywords; changelog entries before 12.5.10 moved to `docs/archive/atlas-changelog-pre-12.5.10.md`; reference pages cleaned of dated logs and workspace data (observed connector logs are in `docs/archive/connector-config-observed-2026.md`).
- `atlas_mux.py wait` can kill the team on timeout (opt in with `--kill-on-timeout` or `ATLAS_WAIT_KILL=1`). The feed is coalesced, and a team window is added when panes get narrow. tmux and rsync are checked before a spawn.
- Hooks: one `event_dispatch.py` process per Pre/PostToolUse event replaces up to eight; Read, Bash and Edit hook overhead is about 30-45% lower. 18 hook programs / 22 bindings.
- Friction events carry metadata. The database has versioned migrations (schema 2). `gate_block_spike` is a new alert-only finding miner. `atlas_doctor.py --redact-history [--apply]` backfills redaction over stored history. `atlas_todo.py notes-archive` archives old notes on demand.
- New env vars documented in the reference: `ATLAS_MAX_TEAM`, `ATLAS_WAIT_KILL`, `ATLAS_PINNED_PROJECTS`, `ATLAS_DECISION_ALLOW_REMOTE`, `ATLAS_NOTE_MAX_BYTES`, `ATLAS_NOTE_ARCHIVE_BYTES`, `ATLAS_CHECK_INSTALL_PARITY`.
- Skills: `atlas-ux-test` drives the browser through `atlas:ui-runtime-tester` and cites only files inside the plugin; lineage lines in reference files moved to `skills/PROVENANCE.md`.

## 15.0.0 - 2026-10-22

Command Center v15: the dashboard becomes a band, a seats rail and six routes. The nine v14 pages fold into Run, Agents, Board, Channels, Health and Settings.

### Breaking changes

- Routes are now Run, Agents, Board, Channels, Health and Settings. Old hashes redirect: Activity, Improve, Projects, Colony and Terminal land on the page that absorbed them.

### Added

- Band: title row, chevron phase rail and live counts. Seats rail and channel feed with steer (`POST /api/v2/channels`), a needs-you list, gates chips and a last-7-days table on Run.
- `GET /api/v2/gates` (token required, `?project=` or `?session=`) feeds the gates chips.
- Keys `1`, `2`, `3`, `f`, `i`, `m`, `h`, `Escape` and the `/` palette, wired into run and shell.
- `BRAND` tokens from `mod/contract.ts`, gated by `design/contrast.py`. Glyphs are pinned to `mod/theme.ts` by a contract test.

### Changed

- Settings keeps every control from v14 on the band shell.

### Removed

- The separate Activity, Improve, Projects, Colony and Terminal pages.

### Known

- Band phase n/m is not wired (the header value is null).
- The terminal-focus key guard is untested.

## 14.0.0 - 2026-10-22

Command Center v14: the dashboard UI is rebuilt from scratch as a sidebar shell with nine flat pages, and every `ATLAS_*` key is editable in Settings with its current value. Contract: `docs/command-center-redesign.md` (sections 1-11). Breaking changes are listed first.

### Breaking changes

- The Colony and Terminal pages are removed, and the Agents lenses (Roster, Supervise, Board) are gone. `#/colony`, `#/terminal`, `#/herd`, `#/work` and `#/irc` redirect to the page that now owns them (Agents, Board or Channels). Bookmarks of `?lens=` URLs land on the owning page.
- `plugins/atlas/scripts/dashboard_ui/` is deleted and rebuilt: the v13 pages, CSS, design notes, `contrast.py` and their tests are removed. Pretendard and JetBrains Mono are replaced by vendored Geist fonts (OFL).
- Settings rows now show the current value, its source and when it applies. `behavior_state()` entries gained `current {value, source, applies}`, `live {value, differs}`, `editable` and `read_only_reason`.

### Added

- Shell and pages: sidebar plus nine flat pages (Overview, Agents, Board, Channels, Activity, Health, Improve, Projects, Settings); component kit `js/ui.js`, plus `api.js`, `state.js`, `router.js`, `pages/*.js` with `*-model.js` and `node:test` files, and a `drawer/` (terminal, messages, tasks).
- Terminal inside the Agents drawer: `POST /api/v2/term/ticket` then `ws?ticket=`.
- Settings backend (`scripts/atlas_control.py`): 20 new `_AD` rows so every documented `ATLAS_*` key has a row, 16 keys became toggles, 3 selects (`ATLAS_GATES`, `ATLAS_MODE`, `ATLAS_SEAT_BACKEND`), 7 bounded numbers, and `ATLAS_TYPESAFE_URL` has kind `url`. Tests: `scripts/test_atlas_control_settings.py`.

### Changed

- 5 internal keys moved from the settings catalog to `_INTERNAL` (not shown in the UI).
- Docs: `README.md`, `plugins/atlas/README.md`, `docs/atlas-workboard.md` and `docs/ROADMAP.md` use the new page list.

### Known

- herdr pane ids are not streamable through `term/ws`; only tmux targets stream in the drawer.
- The Needs-you wait time is blank when the API row has no `state_changed_at`.

## 13.0.0 - 2026-10-22

Command Center overhaul: the Terminal becomes a grid of real terminals, Settings becomes a categorized page with verified saves, and the operate pages collapse into one Agents surface. Plan: `docs/plans/2026-10-22-command-center-overhaul.md`. Breaking changes are listed first.

### Breaking changes

- Terminal page semantics. `#/terminal` is now a seat grid (one card per colony seat plus shell and TUI seats). `atlas_tui`, which the page used to stream as the whole page, is demoted to one TUI seat (`tui@host`). Anything that assumed a single full-page `atlas_tui` stream no longer holds.
- `#/colony`, `#/board` and `#/supervise` are aliases of `#/agents` (to the `roster`, `board` and `supervise` lenses). Colony is no longer a separate page.
- Shell-scope settings (the six rows the server used to refuse) are now writable. A save writes `~/.claude/settings.json` `env`, `~/.omp/agent/config.yml` `env`, and `~/.atlas/env.sh` (a block between `# >>> atlas managed >>>` and `# <<< atlas managed <<<`), plus one guarded `[ -f ~/.atlas/env.sh ] && . ~/.atlas/env.sh` line in `~/.zshenv` inside the same markers. Nothing outside the markers is touched.
- Terminal websocket auth is by single-use ticket: `POST /api/v2/term/ticket` returns `{ticket, expires_in: 30}`, then `ws?ticket=`. The old `token=` query form still works for one release and logs a deprecation line.
- The colony worker transport defaults to tmux whenever it is installed; `claude-bg` is only the fallback (or forced).

### Added

- Terminal (W1-U1, W1-U2): `GET /api/v2/term/seats?project=<root>|all` lists spaces and seats (`address, name, role, runtime, state, pane, target, kind, project, cwd, started_at, last_activity`); every colony space ends with a `shell@<space>` seat and the host space carries `shell@host` and `tui@host`. `kind=shell` on `term/ws` forks `$SHELL -l`. A PTY with no client frames for `ATLAS_TERM_IDLE_S` (default 900) closes with code 1000 reason `idle`. The page is an openrig-style grid of xterm cards, connects a card when it scrolls into view (at most 6 live sockets), enlarges on click, Enter or `?seat=` deep link, and shows an error line with Retry after 5 s without a frame. The lead seat attaches through `TMUX_PANE` (W3-U7, `7ab8f588`, `28824b4c`).
- Settings (W2-U3, W2-U4): every behavior knob carries `kind`, `options`, `range`, `effect`, `applies`, `scope` and `layers`; ranges are enforced on write. A write returns `{ok, key, wanted, layers[], applies}` and the UI shows `✓ verified` with the layers that read back, or `✗ not saved`. `ATLAS_OPTIMIZE_CMD` needs `confirm:true` (409 `needs_confirm`). The page is a sticky category nav with one category visible at a time and a filter across all of them. The model picker has Local, Cloud and All chips, sort by Latest, Size, Name or Popular, search, current/reset/capabilities, and a `Pull another...` job.
- Ollama API (`atlas_ollama.py`): `GET /api/v2/ollama/models|status`, `POST /api/v2/ollama/pull`, `GET /api/v2/ollama/jobs/<id>`, `DELETE /api/v2/ollama/models/<name>` (with `confirm:true`). Model-kind knobs are validated against the local list (400 `unknown_model`).
- Agents (W3-U5, W3-U6): one roster with `Roster`, `Supervise` and `Board` lenses and a single send path with the wave gate; Stop/Kill asks for confirmation and goes through the identity-checked colony kill (409 `member_dead`); Pause, Resume and Cancel are wired to the colony routes. The Board lens has loading, empty and error states with a stale banner. Channels refresh on the SSE `irc` event instead of a 5 s timer. The all-projects roster (Agents without `&project=`) exposes the same Stop, Pause, Resume and Cancel controls per worker seat, posting with that seat's own project root (finding W3-runtime-c, test `colony-embed.test.js`).
- Releases: `.github/workflows/release.yml` publishes a GitHub release `atlas <version>` (tag `atlas-v<version>`) when `plugin.json` changes on main, with the CHANGELOG section as notes (`scripts/release_notes.py`, exit 2 when missing or unreleased). docs-curator owns keeping the CHANGELOG release-ready. Contract tests tie `plugin.json`, `marketplace.json` and the CHANGELOG top version together (`34d6d99b`).

### Changed

- Docs and knob metadata match the code: `ATLAS_COLONY_TRANSPORT` knob default is `tmux`; contract test in `test_atlas_mux.py` (`77c7e803`).
- W2 contract fixes (`47158f65`): `modified_at`, `percent` and the status URL.
- Settings polish (`e14abd5e`): one-category view, range errors shown instead of silent clamping, inferred kinds, model picker current/reset/capabilities.
- Channels tests inject the send path instead of a global module mock (`b1fe6a9c`, finding W3-mockleak).
- Root and plugin READMEs: install versus update commands, current counts and pages (`a9d69f92`).
- Fallow baselines (`fallow-baselines/dead-code.json`, `health.json`, `dupes.json`) re-saved with fallow 3.26.0 so the plugin commit gate (`fallow audit`, gate new-only) passes again; the Oct 13-16 baselines matched 224 of 2064 health entries and blocked every commit from this checkout.
- Dead code (finding W3-deadcode): every fallow unused-export finding in sonicwall-mcp, panos-mcp and the dashboard JS is cleared (module-private where the only caller is in-file, deleted where nothing calls it, including the dead fleet overflow menu and the herdr tab/pane rename and close actions); `.fallowrc.json` exempts the dynamically imported `*Handler` exports and registers `theme-boot.js` as an entry; `usage-statusline.ts` render, computeTallies and scopedWindows are split into helpers under cyclomatic 20 with byte-identical output.
- Dead code, whole repo (finding W3-deadcode-2): every remaining fallow finding outside the vendored tree is cleared. `.fallowrc.json` ignores the vendored herdr-web-ui under `plugins/atlas/colony/`, skill templates and assets; registers the `_shared` templates, per-server dev scripts, the omp test preload and the ninjaone Cloudflare worker as entries; exempts the dynamically imported `*Handler` exports of all nine domain-based servers; and turns `unused-class-member` off under `mcp_node/*/src/` because the node SDKs mirror vendor endpoints the servers only partly consume. In code: `effectClassFor` and `annotationsFor` are module-private in the annotate-tool template and every copy; unused `_helpers` re-exports, list-tool helpers, `resetClient`, `errorResult`, knowbe4 `elicitText`/`elicitConfirmation`, cipp's unused type barrel and `ToolHandler.setServer`, and 20 omp/mod constants are removed or de-exported; `ToolResult` is declared once in `_shared/error-envelope.ts`; the omp `channels` <-> `hook-bridge` cycle is broken by `omp/fault-log.ts` and the dashboard `app.js` <-> `pages/agents.js` cycle by a direct `work.js` import.
- Live-UI checks are headless only: ui-runtime-tester and tool-routing forbid headed browser windows; Playwright MCP is driven with PLAYWRIGHT_MCP_HEADLESS=1. Root .prettierignore keeps the format_after_edit hook off markdown so agent frontmatter stays single-line.

### Removed

- The Terminal page's full-page `atlas_tui` stream and the old render path that polled captures for every card at once.
- Three of the four client send paths and the separate Colony page; the colony 8 s and channels 5 s refresh timers (replaced by SSE events); the unreachable `agents.js` channel-lens branch.

### Fixed

- Deterministic terminal JS tests (finding W1-U2-flake, `37d8a75a`).
- Cold load of `#/terminal` no longer lands on another page (deep-link race, W1-U2).
- W2 runtime failures fixed by the polish branch: Settings main height 25799 px at 1280 wide is now 1090 px with one visible category, and `99999999` for `ATLAS_TRIPWIRE_THRESHOLD` shows `not saved: 99999999 is outside 1..50` instead of being clamped to 50 and saved.
- Boot probes (finding W3-probe-home): the panos and sonicwall probes spawn the server with a throwaway `HOME`, because the shared env loader reads `~/.config/atlas/atlas.env` and `~/.claude/settings.json` through homedir() before the probe's missing `ATLAS_ENV_FILE`; a developer's real credentials made the panos probe fail ten cases on a machine with PANOS_ entries.

### Verified

Findings `W1-U1`, `W1-U2`, `W1-U2-flake`, `W1-runtime`, `W2-U3`, `W2-U4`, `W2-fix`, `W2-polish`, `W3-U5`, `W3-U6`, `W3-U7` (re-verified at `28824b4c` after a first rejection), `W3-mockleak`, `transport-default` and `releases` are `verified` in `.atlas/.run/findings.json`. Runtime verdicts, quoted:

- W1 (`.atlas/.run/cc-w1-runtime.md`): "The Terminal page renders an openrig-style grid of cards: real xterm terminals for shell and TUI seats (echo round trip proven in the shell, atlas_tui screen live in tui@host), placeholders for Claude seats without an attached terminal, working enlarge, Escape, Enter and deep link, and styling matching the plan tokens. Unverified: websocket 101 count, scroll restoration, and the 700 px mobile width (resize did not apply). No app console errors."
- W2 (`.atlas/.run/cc-w2-runtime.md`): "Settings saves are solid: stepper, model picker, shell-scope and theme writes all returned "✓ verified" with the written layers, API read-back matched, the managed env.sh/.zshenv block appeared in the temp HOME only, and the console and network were clean." It also failed two plan criteria (25799 px height, silent clamp); both are fixed in `e14abd5e` and the 1090 px height and the range error were re-observed in the W3 run.
- W3 (`.atlas/.run/cc-w3-runtime.md`): "W3 operate pages work headless: aliases redirect to the right lenses, Board shows counts and a clear offline card with Retry and clean recovery, Channels gets a posted note via SSE in about 1 s, Open terminal routes to the seat, and Settings is 1090 px tall with two columns and one category."
- Real home untouched in the W2 and W3 runs: `~/.atlas/env.sh` absent, `grep -c atlas ~/.zshenv` 0; port 7421 untouched.

### Known

A polish branch (`worker/w3-polish`) is in flight for these open items from `cc-w3-runtime.md`:

- `channel-sync.js:16` throws `TypeError: Illegal invocation` when the SSE connection is not live (`timers.set(tick, fallbackMs)` calls `setInterval` with `this = timers`), so the 30 s fallback poll never starts.
- The roster has no Stop, Kill, Pause, Resume or Cancel buttons (only "Open terminal" per row), and the Cards and List views show the runtime-not-running card; the kill confirm dialog could not be exercised.
- The Agents header says "No agents running" while the roster lists working members (it counts the runtime fleet only).
- The Settings status line keeps a stale `not saved` message after the value is restored.
- Not verified in W1: the websocket 101 count, scroll restoration after leaving an enlarged seat, and the 700 px width. In W3, "Enlarged seat" after Open terminal was not confirmed from text.

## 12.8.0 - 2026-10-22

Atlas statusline: the omp usage widget ships with atlas, and Claude Code gets the closest equivalent from the `statusLine` stdin JSON. Design: `docs/plans/2026-10-22-atlas-statusline.md`.

### Added

- omp: `omp/usage-statusline.ts` exports `registerUsageStatusline(pi)` and `USAGE_STATUSLINE_WIDGET_KEY`; `atlasOmpExtension` registers it unless `ATLAS_STATUSLINE=off` or a personal copy exists at `~/.omp/agent/extensions/usage-statusline.ts` or `<cwd>/.omp/extensions/usage-statusline.ts` (two copies would race on one widget key). `fallow` is found with `Bun.which("fallow")` only; the fallow column is skipped when it does not resolve.
- Claude Code: `scripts/atlas_statusline.py` (stdlib Python) renders rows from the `statusLine` stdin JSON. `install` writes `statusLine` into `~/.claude/settings.json` and saves the previous value once to `~/.atlas/statusline.previous.json`; `uninstall` restores it (or deletes the key); `--settings <path>` and `--width N` exist for tests.
- Both harnesses read the shared config file `~/.omp/agent/usage-statusline.json`, so one edit restyles both.
- Field mapping (Claude Code source for each omp element):

| omp element | Claude Code source |
|---|---|
| project | `workspace.current_dir` basename, else `cwd` |
| model and effort | `model.display_name`, `effort.level` (effort omitted when absent) |
| activity lane | `cost.total_duration_ms`, `cost.total_lines_added/removed`, rendered `2m14s · +12/-3 lines` |
| ctx | `context_window.current_usage` (input + cache_creation + cache_read) over `context_window_size`; `used_percentage` when `current_usage` is null; `--%` before the first call |
| 5h and 7d | `rate_limits.five_hour` / `seven_day` `used_percentage`, `resets_at`; empty track when `rate_limits` is absent |
| session | `cost.total_cost_usd`, `total_input_tokens + total_output_tokens`, cache % from `current_usage`; cost shows `plan` when `rate_limits` is present |
| provider row | one `anthropic` row, `model.id` shortened |
| fallow row | `fallow --root <cwd> impact statusline`, first line only when it starts with `fallow impact`; cached 60 s in `~/.atlas/statusline-fallow.cache` keyed by cwd |

### Excluded on Claude Code

- Critter lane, tok/s, tools N, N runs, multi-provider rows and `+N more`, and the pi-lens/ponytail row merge: no run span events exist there.

### Changed

- `omp/tsconfig.json` gains `paths` for pi-catalog and pi-tui so bun and tsc resolve the runtime imports of `usage-statusline.ts`.

### Verified

- `python3 -m unittest plugins/atlas/scripts/test_atlas_statusline.py`: Ran 7 tests, OK.
- `cd plugins/atlas/omp && bun test`: 476 pass, 0 fail.
- tsc: the two errors in `omp/index.ts:760` and `omp/mission-panel.ts:11` are unchanged from the committed baseline; no new errors.
- Smoke render of a subscriber fixture at width 120 (ANSI stripped, `ATLAS_FALLOW=off`):

```
📁  tech-tools   ⏱ 2m14s · +12/-3 lines     👾  Claude Opus 5.5  ·  high

📚  ctx  51% ▅▅▅▅▅▁▁▁▁  513.0k / 1M         │  💰  session         plan   391.7k tok  cache 99%
⏳  5h   62% ▅▅▅▅▅▅▁▁▁  4h39m anthropic     │  🔌  anthropic       plan   391.7k tok  claude-opus-5-5
📅  7d   18% ▅▅▁▁▁▁▁▁▁  6d15h anthropic     │
```

## 12.7.0 - 2026-10-21

New vendor `sonicwall`: SonicWall firewalls over the SonicOS 7.x REST API. `mcp_node/node-sonicwall` holds the client, `mcp_servers/sonicwall-mcp` the server; the bundle lands at `plugins/atlas/mcp/sonicwall/server.mjs` (1,019,315 bytes) and is registered in `.mcp.json` with six `CFG_SONICWALL_*` values (`SONICWALL_HOST`, `USERNAME`, `PASSWORD`, `PORT`, `VERIFY_TLS`, `SESSION_OVERRIDE`). Design contract: `docs/sonicwall-connector-design.md`.

### Added

- 41 tools: 29 read, 11 mutating (`DESTRUCTIVE:` prefixed) and 1 unprefixed mutating, the generic `sonicwall_request`. The inventory `mcp_servers/sonicwall-mcp/sonicos-endpoints.json` holds 2877 rows from the vendor swagger (SonicOS 7.3.2-7010).
- Auth: Basic auth over HTTPS; the session is held in process memory and the client re-logs in once on a 401. A 401 after login surfaces as error class `auth-session`. TFA, CHAP and Digest session security are out of scope for v1.
- Writes are staged only; `sonicwall_config_commit` is a separate call. Session override is off by default (`SONICWALL_SESSION_OVERRIDE`).
- `sonicwall_request` is allowlisted against the swagger inventory and carries a hard-deny list: restart, import, factory-default, delete-all (`/all-` and `DELETE .../all`), current-config export and auth endpoints.
- Wiring: `plugin.json` userConfig (six keys), `.env.template`, `atlas-setup` `vendors.md` and `connectors.md`, `references/connector-tool-disclosure.md` row, `test-mcp-tools.mjs` registration (floor 41), `test_connectors_wiring.py` (13 harness connectors).

### Changed

- The design tool table summed to 41 while the prose and harness said 48; corrected to 41 before merge (S2-U4 commit 7fc22c3e).
- The S2-U2 commit ran with `ATLAS_FALLOW=off`: the fallow findings are the shared connector pattern (dynamic-import domain exports, panos-pattern duplication), not new defects.

### Verified

Merged tree main at e8204552, evidence `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`:

- `cd mcp_node/node-sonicwall && npm test`: vitest 1 file, 19 passed.
- `cd mcp_servers/sonicwall-mcp && npm run test:boot`: PROBE PASS; no-creds 2 tools; full 41 (read=29, mutating=11, unprefixed-mutating=1); CFG_-only through `_env/load.mjs` 41; six guard cases rejected locally.
- `node test-mcp-tools.mjs sonicwall`: PASS (placeholders) floor 41, 0 mismatches; PASS (no-creds) 2 meta tools.
- `test_connectors_wiring.py`: Ran 10 tests, OK. `test_atlas_contract.py`: Ran 108 tests, OK (skipped=3).

### Not shipped

- Live validation against an appliance. Next step: `sonicwall_status` under real `SONICWALL_*` credentials, expected to report `GET /version` output and `session.loggedIn: true`.
- TFA/CHAP/Digest login, VPN writes.

## 12.6.0 - 2026-10-20

The 2026-10-20 audit (`docs/plans/2026-10-20-atlas-feature-audit.md`) found every agent pinned to sonnet/low, docs contradicting code, 0 of 7 TUI defects fixed and silent web UI failures.
This release ships cost tiering, the Atlas Colony workspace TUI, a single-sourced status header, context cuts and the codex contract block.
Known: the installed-parity test stays red until the plugin is reinstalled; herdr-web-ui has 9 codex-binding tests that need a live herdr.

### Added

- Atlas Colony TUI workspace: `atlas_tui.py` gains the `colony` section, now the landing view of `--once` and the live loop, branded "ATLAS COLONY". SESSIONS lists every colony (transport, seat count, state, age) with its seats (lead first) and orphan `atlas-*` terminals; PEEK shows the seat pane tail. Two-pane at 100+ columns, stacked with a zoomed focused region below that. `W` returns to it, `1`/`2`/`3` focus a region, Tab cycles regions here (right-pane tabs elsewhere). Every SESSIONS row and region title has a click rect; `render()`/`hitmap()` normalize an unmarked snapshot.
- Colony TUI CHANNEL region: `chat_lines()` in `atlas_tui.py` renders the selected colony's channel as `HH:MM from > to  text [kind]`, newest last, lead rows tagged `(lead)`, TUI-sent rows `(you)`, a NEEDS strip first, `f` seat filter, PgUp/PgDn/Home/End scrolling with an "N new" title badge while scrolled up.
- Colony TUI STEER region: `i` (selected seat or lead), `b` (@all), `l` (@lead) and `m` open an input mode; `@name`/`@all`/`@lead` retarget; Enter writes a `steer` note on the colony channel (the lead gets "lead reads the board at its next turn" instead of a refusal); `h` holds/releases the selected seat (SESSIONS shows `held`, STEER title shows `(held)`); held seats refuse steering; `x` keeps the y/n stop gate. `SteerRegion` tests.
- Colony TUI keymap and mouse: `KEYMAP` table in `atlas_tui.py` drives colony/steer key dispatch and the help text (generated, with a no-duplicate-key contract test); `[ hold ]`/`[ release ]`/`[ @all ]`/`[ @lead ]` are clickable; the mouse wheel scrolls CHANNEL and moves the SESSIONS selection; stacked layouts keep CHANNEL at 4+ rows (PEEK degrades first).
- Colony TUI snapshot data: `atlas_colony_model.snapshot()` gains `chat` (per-channel last 100 notes with `seq/ts/from/to/kind/text/lead`, built from the already-tailed board files), `colony.seat_count` and `colony.age_s`, and `seat.held` (the `paused` flag in `colony_wave.json`, mtime-cached). `atlas_dash_colony` gains `hold_member` / `release_member` beside `kill_member`; the `/pause` and `/resume` routes now share the same `_hold` / `_release` helpers.
- Colony TUI golden harness: `scripts/fixtures/colony_snap.json` (tmux, herdr and claude-bg colonies, orphan terminal, chat, held seat, needs) and `scripts/test_colony_golden.py` pin `atlas_tui --once` frames at 100x30, 60x18 and 160x48 in `fixtures/golden/`. Regenerate deliberately with `ATLAS_GOLDEN_UPDATE=1`.
- Codex contract block: `scripts/atlas_codex_contract.py` renders the header rule, phases, evidence rule, dispatch spec blocks and tier table from `contracts/operating-contract.json`, `agents/*.md` and `REQUIRED_SPEC_BLOCKS` into a fenced `atlas:contract` block in the repo `AGENTS.md` (`--write` / `--check`; text outside the fence is untouched). Codex reads it but nothing enforces it.
- `plugins/atlas/omp/package.json` gains a `test` script (`bun test`), so the omp suite runs via `bun run test`. Baseline: 471 pass, 1 fail across 28 files. Known red: `channels.test.ts` "openLeadChannel: SessionStart opens the lead's channel with zero members, reusing the dispatch lead name" (fixed below).

### Changed

- Cost tiering: agent frontmatter now carries `model`, `effort`, `tier_allow`, `effort_allow` per `docs/plans/2026-10-20-atlas-tiering-design.md` (haiku: runner, schema-inventory, naming-glossary-audit, docs-auditor, explorer; medium effort: implementer, test-engineer, verifier, completeness-critic, rls-privilege-audit; planner high). `scope-matrix.json` seats gain `model`; new `db-audit` class takes `rls-privilege-audit` out of plain `audit/high`. `atlas_resolve.py` and `omp/resolve.ts` emit `model` per seat. `omp/gen-agents.ts` derives `thinkingLevel` from effort and passes through the allow lists. `squad-and-tiers.md` tier table updated; `TierTableContract` pins all four.
- Tripwire tier accept: a dispatch `model` (or `effort`) now passes when it is in the role's `tier_allow` (`effort_allow`) AND equals what `atlas_resolve` emits for the prompt's `SCOPE:` line, besides the three legacy accepts (pin, alias, parent model). No SCOPE line or an unloadable resolver accepts nothing new. The `model_override` deny names the role's `tier_allow` and the resolver's model; a new `effort_override` deny covers an `effort` arg outside the definition and the resolver.
- Status header template is single-sourced in `contracts/operating-contract.json` (`headerTemplate`, with `phases` and `headerFirstLinePattern`); session boot, gate (n) and omp `style.ts` read it and keep a literal only as the unreadable-contract fallback. Contract test guards against stray copies.
- Context cuts: the output style drops from 9,151 to 6,977 chars (header glyph/template text lives only in session_boot, the unenforced 12-line prose cap is gone, prose tightened with every rule kept once); `atlas-orchestrate/SKILL.md` loads `laws-and-gates.md`, `the-loop.md` and `squad-and-tiers.md` only on named triggers (unconditional load about 46.5 KB to 13.1 KB); the style, `omp/lead-addendum.md` (898 to 894 chars) and `subagent-kit.md` now share one TOOLS rule; new `ContextBudget` contract tests pin all three.

### Fixed

- Colony TUI lists registry-only colonies: a lead channel with no `lead_pid` and `last_activity` inside `ATLAS_COLONY_LIVE_WINDOW` (default 1800s) shows in SESSIONS (`in-proc`) and CHANNEL, its in-process subagents as pane-less seats (state from the latest board note). Merges with a team colony on the same channel; SESSIONS caps at 30 seats per colony with a `+N more` row; PEEK says `no pane (in-process subagent)`.
- Dashboard: fetch failures are no longer silent. `dashboard_ui/js/fetch-fail.js` adds one shared dismissable "Stale data" banner (page, endpoint, error, time, count; clears on the next success), reported from agents (channels), supervision lens (board), terminal (capture, snapshot), colony, overview (`/api/v2/health`) and the xterm preload in `app.js`.
- Dashboard reaper failures are visible: `/api/v2/health` has a `reaper` subsystem (`warn`, last 20 failures with path, exception class, message and time in `evidence[]`) instead of a log-only `reap_tick ... PermissionError` line.
- TUI degraded-data hardening: `atlas_tui.normalize_snapshot` fills seat/spec/project/terminal defaults once at load (no KeyError on a seat without `name`, no None format TypeError); `body_height()` is shared by `render` and `hitmap` (hit rows were off by one); an unknown `ui.tab` falls back to the table view; `attach_target` returns `attach failed (rc N)` and the `term` effect is wrapped like `attach`; `bridge_seq` strips BEL, ESC and `;` from cid/seat; the `capture()` call in the loop is documented as non-raising. `test_atlas_tui` gains `DegradedSnapshot` and the launch test no longer prints to stdout.
- TUI: STEER buttons no longer land on the wrong row when STEER is focused in the stacked layout.
- `atlas_mux.py` `cmd_spawn`: any exception raised after the member registers and before the pane exists (`_open_window`, `atlas_seats`) now leaves the member again before re-raising, so a failed spawn no longer strands a pane-less ghost on the colony board.
- `atlas_doctor` orchestration-wiring messages name the file actually scanned (`dispatch_tripwire_core.py` when the shim delegates to it) instead of always blaming `dispatch_tripwire.py`; a shim-plus-core pair with the markers in the core stays PASS.
- Tests: `test_atlas_team` follows the retiered matrix: team size and `max_parallel` are read from `atlas_resolve` instead of a hardcoded 5, and the omp team-level test expects the Claude-tier effort per role (completeness-critic medium); `_team_thinking` was already correct, the test premise was stale.
- Tests: omp `channels.test.ts` openLeadChannel test: fixture now creates `.atlas/.run` (the board marker `lead_channel_allowed` requires since 12.5.12); product code unchanged.
- Tests: `test_atlas_codex_contract.py` imports `_test_isolation`; `test_paired_verifier_no_block_condition_g` seeds a phased plan and channel report notes so gates (o) and (p) do not fire in a test aimed at (g). Product code unchanged.
- Tests: hooks suite baseline: `test_completion_gate.FailOpenUnreadablePayloadTest` now seeds a worker report note for the (p) colony-channel gate (the gate was right; the test dispatched 2 workers with no channel traffic), and `scripts/test_sweep_state.py` is plain `unittest` so it imports without pytest.
- Tests: `scripts/test_atlas_tui.py` order pollution: `curses` is imported once at module top (`mock.patch.dict(sys.modules)` evicted a lazy import and Python 3.15 refuses to reload `_curses`), and the lead-seat snapshot helpers deepcopy `SNAP` so they no longer mutate the shared colony pods that `test_topology_tree` reads.

### Docs

- In-process colonies in the colony workspace: documented in the atlas-tui skill and `docs/atlas-colony.md` (registry-backed, `ATLAS_COLONY_LIVE_WINDOW`, 30-seat cap, PEEK/`t`/steer/hold behavior).
- Colony workspace docs: atlas-tui skill rewritten for the colony workspace (full key table, mouse, hold, steer); "Colony workspace (TUI)" in `docs/atlas-colony.md`; "Reading and steering from the TUI" in `docs/atlas-channels.md`.
- Reconciled docs with code (`docs/plans/2026-10-20-atlas-feature-audit.md`): colony is tmux-default with herdr forceable (`references/dashboard-api.md:144`, `references/subagent-kit.md` mux section); bracketed correction to the 12.5.12 session-start wording; `docs/atlas-harness-parity.md` header states its reconcile version and rows (n)/(o) added; repo `CLAUDE.md` and `references/subagent-kit.md` carry the full dispatch contract with tripwire deny strings; `docs/atlas-colony.md` documents `ATLAS_COLONY=off` next to `ATLAS_CHANNELS=off`.

## 12.5.13 (2026-10-19)

### Fixed

- Session start opens the lead channel only where an atlas board already exists (`lead_channel_allowed`, shared by omp `channel-open --only-project` and Claude `session_boot`); a plain git repo no longer gets `.atlas/.run` just because a session started there.
- Scripts and hooks suites are green again (3643 passed; only the install-parity contract differs until this release is installed): `_lead_pid` binds the real `subprocess.run` so tests that patch it for other commands are unaffected; `spawn-team` tolerates a namespace without `--name`; `test_atlas_launch` follows the 12.5.0 transport contract (tmux by default, herdr only when forced); the isolation contract allows the deliberately short `TMUX_TMPDIR`; the `atlas-tui` skill uses `${CLAUDE_PLUGIN_ROOT}` (omp rewrites it to the live install) and passes skill conformance.

## 12.5.12 (2026-10-19)

### Fixed

- The session-start lead channel (12.5.11) created `.atlas/.run` in whatever directory a session started in. `channel-open --only-project` now opens it only in a real project (existing atlas board or a git repo [correction, 12.5.13: a git repo alone is not enough; `scripts/atlas_todo.py:1142-1149` requires `not_a_project_root(base) and is_project(base)`, i.e. an existing atlas board], never `$HOME`, `~/Downloads` or a bare temp root) and otherwise answers `{"skipped": "not_a_project"}` without writing; omp's `session_start` passes it. Dispatch-time opens are unchanged.

## 12.5.11 (2026-10-19)

### Fixed

- omp sessions started before `omp plugin upgrade atlas` silently ran no Python hooks afterwards: `omp/hook-bridge.ts` read `hooks.json` and set `CLAUDE_PLUGIN_ROOT` from the deleted install dir, so SessionStart never ran `session_boot.py` and a stale dashboard was never replaced. Every runtime read of scripts, hooks and contracts in `plugins/atlas/omp` (hook-bridge, agent-guard, channel-view, style, atlas-agents, contracts, mandates, resolve, run-state, worker-report, index) now resolves at call time via `pluginRoot()`/`pluginScript()` and falls back to the newest installed version. An unreadable `hooks.json` records a `StaleInstall` fault instead of failing silently; a missing `atlas_dashboard.py` in `session_boot` records a fault too.
- The lead's channel opens at session start (omp `session_start`, Claude `session_boot`), so your live session shows in the TUI as a colony with its lead seat before any dispatch.
- Stop marks the killed member finished (exit 137) so the seat shows dead at once; `kill_member` and the colony routes normalise the project path (`/var/folders` vs `/private/var`); TUI stop/msg/broadcast act on the seat's own project in all-projects mode; a failed snapshot shows a full-pane error with the diagnose command.

## 12.5.10 (2026-10-19)

### Fixed

- Dashboard heals itself after a plugin upgrade. A daemon whose install dir was deleted served `ui_missing` on every page until something ran `ensure`. A watchdog thread (`HEAL_CHECK_S`, 20 s) now re-execs into the newest sibling install (omp `tech-tools___atlas___<ver>`, Claude `<marketplace>/atlas/<ver>`) on the same port; the `ui_missing` reply names the exact `ensure` command.
- `atlas_tui.py --launch` no longer reuses a stale `atlas-tui` tmux session: it respawns its window with the current script and project (an old session from a deleted install rendered an empty TUI with no specs), and turns tmux `mouse on` for that session.
- Stop works for plain tmux colony panes: the kill ladder falls back to `tmux kill-pane` for panes in `atlas-*` sessions, then to the recorded pid.

### Changed

- Command Center TUI modelled on the OpenRig team workspace: the explorer tree lists each pod's seats; a WALL tab shows every seat's live output side by side (pane capture or transcript); the seat page is an agent detail (context, current activity, current work, queue, needs you, seat, communication, output); TERMINALS rows attach (Enter/click) or kill (`x`, y/n; never `atlas-tui` or non-`atlas-` sessions) atlas-mux sessions.
- Live leads (channel `lead_pid` alive) appear as seats with their own transcript and keep their colony listed. Empty TOPOLOGY explains what fills it; `a` toggles all projects; PROJECTS rows switch the watched project. Hints and HEALTH only offer `t term`/`x stop` and `tmux ok` when the seat or colony has panes.

Older versions (12.5.9 and earlier): [docs/archive/atlas-changelog-pre-12.5.10.md](../../docs/archive/atlas-changelog-pre-12.5.10.md).
