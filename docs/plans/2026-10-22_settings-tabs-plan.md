# Settings page as five tabs (atlas 15.1.0)

Status: approved by the user on 2026-10-22 (AskUserQuestion, three answers below), in progress.

## Why

The 13.0.0 Settings page has a second sidebar with 13 categories. Measured on the live page at 1440 px:

| Category | Rows | Controls |
|---|---|---|
| Preferences | 6 | 4 select, 1 number, 1 custom |
| Session automation | 6 | 5 switch, 1 number |
| Guardrails | 6 | 5 switch, 1 number |
| Prompt optimizer | 9 | 3 select, 3 text, 2 number, 1 switch |
| Decision model | 2 | 1 select, 1 text |
| Storage | 2 | 2 text (read-only in practice) |
| Colony | 4 | 2 switch, 1 select, 1 number |
| Scoring | 3 | 1 switch, 1 select, 1 number |
| Integrations | 0 | read-only inventory panel |
| Ecosystem | 88 | 49 switches (plugins + MCP), read-only lists |
| Connectors | 13 | 13 switches, 58 credential inputs |
| Agents | 14 | override editor |
| Advanced | 44 | 37 text, 4 number, 3 switch; 20 rows "Undocumented" |

44 of 50 knob rows carried the badge "next session". The user's rules: no page may say "next session"; no double sidebar; fewer, balanced tabs; a closed set of values is a select or a switch, never a text field.

Reproduced defects (sandboxed dashboard on 7499, real browser):

1. Number rows: Enter saves (one POST, status "verified"), then blur fires the change handler, which hits the snapshot-equal branch in `settings-row.js` and overwrites the status with "unchanged".
2. A failed Enter save posts twice (both handlers fire).
3. Text rows do not save on blur; the field shows the new text under the old "verified" status while disk holds the old value.
4. Advanced renders on/off keys (for example `ATLAS_DOCS_REPAIR`) as free text.

## Decisions (user answers)

1. Layout: five tabs. Dashboard | Behavior | Models | Integrations | Agents.
2. Undocumented keys: document and keep the real knobs with a proper control; hide per-process plumbing (`ATLAS_SESSION_ID`, `ATLAS_SOURCE`, `ATLAS_LEAD_AGENT`, ...).
3. The read-only Integrations inventory panel is dropped from Settings. Connector state stays on the connector cards.

## Design

```
[ Dashboard ] [ Behavior ] [ Models ] [ Integrations ] [ Agents ]

Dashboard      6 preference rows (theme, density, default project, refresh, activity severity, sidebar order)
Behavior       Session automation | Guardrails | Colony | omp extension   (switches, selects, numbers)
               footer: ATLAS_HOME, ATLAS_DB, ATLAS_DASHBOARD_PORT, read-only, set in the shell
Models         Prompt optimizer | Decision model | Turn scoring
Integrations   Plugins and MCP switches (existing plugins/MCP filter) | Connectors (credentials, test)
Agents         project overrides editor
```

- Tabs follow WAI-ARIA tabs (roles, aria-selected, arrow keys). The selected tab lives in `?tab=`; legacy `?cat=` values map to the nearest tab.
- The filter searches every tab and stacks matching tabs under headings while a query is present.
- No applies badge for "now". No other applies value remains.

## "Applies now" mechanism

Hooks read knobs from `os.environ`, which Claude Code fills from `settings.json` only at session start. The dashboard also writes every hooks-scope knob to the Atlas store (`<ATLAS_HOME>/settings.json`, key `env`). The omp bridge already reads that store on every bridged hook run (`plugins/atlas/omp/hook-bridge.ts`). The change: `plugins/atlas/scripts/atlas_env.py` exposes `apply_store_env()`, called at the top of all 17 hook entry points in `hooks.json`, so a saved value wins over the stale inherited one on the next hook run. `ATLAS_HOME`, `ATLAS_DB` and `ATLAS_DASHBOARD_PORT` cannot apply this way (the store lives under `ATLAS_HOME`; the port needs a rebind), so they leave the knob list and become a read-only footer line.

Plugin and MCP switches edit Claude Code's own settings.json; Claude Code reads them when it starts. That is Claude Code's behavior, not an atlas label; the hint says so plainly.

## Server contract (GET /api/behavior)

- `groups`: ordered, titles exactly: Session automation, Guardrails, Colony, omp extension, Prompt optimizer, Decision model, Turn scoring. Every knob has a kind in toggle | select | number | model | url | command | text and `applies: "now"`.
- `advanced`: always `[]` this release.
- `paths`: `[{key, title, value, description}]` for ATLAS_HOME, ATLAS_DB, ATLAS_DASHBOARD_PORT. POST for these returns 400 `read_only`.
- `hidden`: discovered plumbing keys, not rendered.
- `note`: "Saved values reach running sessions on their next hook run."

## Work split

Three worker branches, merged one at a time after a verified finding, then one UI acceptance pass on a sandboxed dashboard (port 7499, temp HOME and ATLAS_HOME) at 1024 and 1440 with the default landing state.

| Branch | Scope |
|---|---|
| worker/settings-api | `atlas_control.py` catalog, kinds, hidden list, paths, applies now; tests |
| worker/settings-hooks | `atlas_env.py`, 17 hook entries, contract test, omp per-call knob reads; tests |
| worker/settings-ui | `settings.js`, `settings-row.js`, `settings.css`, `settings.test.js` |

## Acceptance

- Five tabs render at 1024 and 1440 with no horizontal overflow; Dashboard is the landing tab.
- No row on any tab shows "next session", "Undocumented" or "unchanged".
- Number row: Enter then blur sends one POST and keeps "verified". Text row: blur saves.
- A knob saved from the page changes a hook's behavior in an already-running session on its next hook run (subprocess test with a temp store).
- `bun test`, `test_atlas_control.py`, `test_atlas_dash*.py`, hooks `test_*.py`, `test_atlas_contract.py`, omp `bun test` all pass.
