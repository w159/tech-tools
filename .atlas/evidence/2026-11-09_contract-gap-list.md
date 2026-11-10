# Atlas operating contract: gap list (2026-11-09)

Version note: this audit read the atlas 16.4.2 source on branch `claude/gateway-broker-mode-main`. Users run atlas 17.4.x from `main`, where line numbers differ. Check each row on `main` before you act on it. Atlas 17.4.1 (commit a3bc4076 on `main`) closed rows A6, A7, B1, B2, B4, B7, B12 and C1 to C4.

Scope: `plugins/atlas/` source tree, read-only audit. No file was changed.
Method: 7 `atlas:explorer` passes. The lead confirmed the lines marked `L` with one direct search. Rows marked `E` are explorer-read only. Rows marked `U` are not confirmed.

Contract sources: `contracts/operating-contract.json:13-14` (template and regex), `output-styles/atlas-orchestrator.md:14-15, 41-47, 81` (header, done, n/n rules), `hooks/session_boot_core.py:422-423` (session injection).

## A. The rule is stated but not enforced

| # | Rule | Where it breaks | What the user sees in the terminal | Conf |
|---|---|---|---|---|
| A1 | Header uses one of 8 glyphs | `contracts/operating-contract.json:14`: glyph is `\S+` | `ATLAS \| x verify \| ok` passes gate (n), no message | L |
| A2 | "One header per reply, no exemption" | `hooks/completion_gate_core.py:1325`: gate (n) blocks one time per session | Second reply with no header: no message | E |
| A3 | Same rule | `completion_gate_core.py:1320-1323, 2216-2226`: sidechain skip, four fail-open paths | Reply with no header: no message | E |
| A4 | Same rule | `completion_gate_core.py:1455-1472`: a session that is not orchestrating gets gate (m) only | No header check, no todo check | E |
| A5 | Same rule | `completion_gate_core.py:98`: `ATLAS_GATE_HEADER=off` | No header check; no surface is known to show that the gate is off | E/U |
| A6 | "`done` is forbidden while a subagent runs" | `completion_gate_core.py:1473`: `if _has_in_flight_dispatch(data): return 0` | `ATLAS \| done \| ...` passes while a subagent runs | L |
| A7 | "`done` requires n/n" | `completion_gate_core.py:1265`: `... if code_changed else 0` | In a run with no code change, `done` passes with open todos | L |
| A8 | A block holds until repaired | `completion_gate_core.py:1653`: `BLOCK_LOOP_LIMIT = 3` | The 4th identical Stop passes | L |
| A9 | Phase check on `done` | `completion_gate_core.py:1329`: gate (o) runs only when code changed | No phase check on a no-code `done` | E |
| A10 | Missing header is a breach | `mod/discipline.ts:200`: toast only | `atlas: reply is missing the ATLAS \| <phase> \| <state> header` | E |

## B. The terminal shows something that is not true

| # | Expectation | Where it breaks | What the user sees | Conf |
|---|---|---|---|---|
| B1 | Pill phase equals the header phase | `mod/restyle.tsx:199`: `PHASE_RE.exec(mid)?.[1] ?? snap.phase` | A pill with a phase the reply did not state | L |
| B2 | Missing contract file does not match all text | `mod/snapshot.ts:19` (`''`), `mod/restyle.tsx:196` | Each reply gets the ` ATLAS ` pill (render inferred, not run) | L code, U render |
| B3 | `blocked` shows as blocked | `mod/band.tsx:100-104`: rail lights `lastPhase` | The rail shows an old phase as current (comment says intended) | E |
| B4 | One header parser | `mod/register.ts:129` (full line) vs `mod/restyle.tsx:199` (middle segment) | Band and pill can show different phases | E, no failing string |
| B5 | Card says `done` only for verified work | `mod/transcript/cards.tsx:106`: `state === 'failed' ? 'fail' : 'done'` | `done <result>` on each card that returns text | L |
| B6 | Finished is not verified | `mod/pane/sidebar-team.tsx:17`: `finished` maps to done mood | A stopped worker looks verified | E |
| B7 | A failed read is not "no todos" | `mod/data/todos.ts:61,65,71` | Empty todo panel, no error | L |
| B8 | Old data has a stale mark | `mod/data/todos.ts:62`: cache keyed on mtime only | Old items, no mark | E, not run |
| B9 | Bad statusline config is reported | `scripts/atlas_statusline.py:212-213`: `except Exception: raw = {}` | Default statusline, no warning | E |
| B10 | Missing board differs from corrupt board | `scripts/atlas_status_segment.py:173` | Same empty segment | E, U render |
| B11 | Gate and panels read one todo source | Gate: transcript, board, `LEDGER` (`completion_gate_core.py:1264-1270`). Panels: board only (`mod/data/todos.ts`) | Panel count can differ from the gate count | E |
| B12 | `header 1/1` score is strict | `scripts/turn_scoring.py:40`: `^ATLAS \|` | A malformed header counts as present | L |

## C. `/atlas-core` report

| # | Expectation | Where it breaks | What the user sees | Conf |
|---|---|---|---|---|
| C1 | Counts use one unit | `mod/data/core.ts:353` (DONE reports) vs `:370-372` (findings entries); `mod/core-row.ts:172` | `VERDICTS  26 claims, 496 verified, 44 refuted, 25 open` | L line 172, E rest |
| C2 | Each row has id and title | `mod/data/core.ts:137, 139`: no fallback | About 30 rows with only `verified` | E |
| C3 | Report is scoped to the session | `mod/data/core.ts:126-128, 339, 342-348` | All project history, about 700 lines | E |
| C4 | Cap, dedupe, color | `mod/core-row.ts:174, 179-180` | Same id 7 times, plain text | E |

## D. Line shape and color

| # | Expectation | Where it breaks | What the user sees | Conf |
|---|---|---|---|---|
| D1 | One line shape | `hooks/prompt_optimizer_core.py:316`; `hooks/session_boot_core.py:429`; doctor warning | `[atlas-orchestrate] ...`, `LEDGER \| n/m \| ...`, `ATLAS-DOCTOR WARNING: ...` | E |
| D2 | Color only on a terminal | `hooks/prompt_optimizer_core.py:629`, `scripts/atlas_irc.py:749`, `scripts/atlas_statusline.py:26-41`: no `isatty` or `NO_COLOR` | Raw escape codes in piped output | E |

## E. Payload sent to the model (baseline inputs for requirement 3)

| Surface | Builder | Size or cap |
|---|---|---|
| Session header rule | `hooks/session_boot_core.py:422-423` | about 175 chars, one time per session |
| Orchestrate nudge | `hooks/prompt_optimizer_core.py:316` | about 330 chars, when the classifier arms |
| Channel brief per dispatch | `scripts/atlas_todo.py:2074-2092` via `hooks/dispatch_tripwire_core.py:2219` | about 1,000 chars per `atlas:*` dispatch |
| Default REPORT line | `hooks/dispatch_tripwire_core.py:789` | about 90 chars |
| Worker final report | `hooks/worker_report_gate_core.py:161-169` | no max length |
| IRC message | `scripts/atlas_irc.py:364, 723` | 400 chars per message |
| IRC who | `scripts/atlas_irc.py:767` | full JSON, no cap |

Observed this session: each explorer used about 100k to 118k tokens and returned 300 to 900 words. Each explorer spent report lines on channel posts it could not make (Bash hook `NODE_TOO_OLD`).

## Not audited

- omp header rule and omp gate (n).
- Bodies of `mod/band.tsx`, `mod/pane/sidebar*.tsx`, `mod/todo-panel.tsx`.
- `scripts/atlas_todo.py` list and note builders, `scripts/atlas_mux.py` status output, `hooks/nudge*.py`.
- Which blocks `prompt_optimizer_core.py:577-600` builds per prompt.
- Source of `gates 1 open` in `/atlas-core`; if `/atlas-core` text enters the model context.
