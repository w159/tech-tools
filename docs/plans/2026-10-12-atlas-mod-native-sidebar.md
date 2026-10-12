# Atlas mod: native-element sidebar (plan)

Status: shipped 2026-10-12, unreleased. Evidence of the current defects:
`.atlas/evidence/2026-10-12-mod-focus-and-gate-repro.md`.

## Why

Every band and pane today is a `Client` surface module (`plugins/atlas/mod/register.ts:536-568`). A Client
receives keys only after a mouse click (`ClientSurface.onKey`, types `index.d.ts:1600`), so in a live
2.1.296 session ctrl+x tab never focused the Command Center and tab hotkeys typed into the prompt.
The skill examples (`plugin-authoring/examples/pane.tsx`, `band.tsx`) draw with `$.ui.resolve(e)`
elements and `$.state` atoms; Buttons there join the engine focus ring (Tab, arrows, hotkeys).

## Decisions (user, 2026-10-12)

- Rewrite the UI on native elements; drop every `Client` module. Keep `mod/data/*`.
- Layout: docked sidebar pane, opened at `session.start` when `viewport.isFullscreen` and there is room
  (110+ columns); the AbovePrompt band stays one compact line (phase n/m, working count, open gates).
- Gates section shows all four: completion-gate conditions (with fix command per failure), dispatch
  tripwire state (armed, inline-op count vs limit, recent denies), tool-routing compliance (context tools
  used vs bypassed, tokens saved), header contract (last reply matched, declared phase).

## Sidebar sections (top to bottom)

1. Header: `ATLAS <PHASE> n/m`.
2. Contract track: every operating-contract phase (`contracts/operating-contract.json` `todoPhases`) with
   its tasks underneath, status glyph and owner; current phase highlighted. Always shown, empty phases shown.
3. Team: lead state plus one row per channel member (live state, tool, elapsed). Each row is a Button;
   pressing it selects the member, and an Input below sends a message to the selected member
   (`atlas_todo.py note --to <member>`).
4. Gates: the four groups above, one line each, expandable.

## Theme: "chart room"

Atlas is a chart: the operating contract is a route with waypoints, the team is the crew working it.
The one memorable element is the route line at the top of the sidebar; everything else stays quiet.

Revised 2026-10-12 after user feedback ("can't read anything"): the first pass hard-coded hex colors
tuned for a dark background, which washed out on a light terminal. Every color is now a Claude Code
theme key, so it follows the person's theme (`chartRoom` in `mod/theme.ts`):

| Role | Theme key | Use |
|---|---|---|
| body | none (terminal default) | body text |
| muted | `subtle` | secondary text, owners, ages |
| faint | `inactive` | "nothing planned" |
| focus | `claude` | the current phase (bold, inverse waypoint), the selected row |
| live | `suggestion` | a working agent, an in-progress task |
| ok | `success` | done, gate passing |
| fail | `error` | blocked, failed, gate open |
| warn | `warning` | advisor notes, a blocked mood |
| border | `promptBorder` | section frames |

Hex appears only on sprite runs, and only where the run sets both fg and bg (`spriteTile` backs
fg-only pixels), so their contrast never depends on the terminal theme.

Visuals (11.1.4): round-bordered sections from 40 columns, plain title rows below; a compact route line
(`◆━━━━◉────○`, fixed 4-column segments) with one plain label row; per phase a header with a 6-cell mini bar
and N/M, then one row per task with its own status glyph; team rows with a chip showing the readable persona
or member name (never a two-letter code), mood dot, name, tool and elapsed, plus a portrait with a speech
bubble for the selected or active member in a tall bordered pane; gates as collapsed group Buttons
(`Completion gate`, `Dispatch tripwire`, `Tool routing`, `Header contract`) reading `N open` / `clear`; the band
leads with the lead badge and the phase glyph.

Type: the terminal's own face; hierarchy from bold (section names, current phase), plain, and the muted key.
Sentence case everywhere, no all-caps labels, no middle-dot meta strings, no arrow suffixes.

```
 Atlas  implement, 3 of 7 done
 ◆━━━━◆━━━━◆━━━━◉────○
 research theory test implement verify

 ✓ research   map auth path
 ✓ test       failing tripwire test
 ◉ implement  sidebar module        impl-ui
 ◉            gate data             impl-gates
 ○ verify     live tmux check

 Team                    lead is conducting 2
 ▸ impl-ui     Edit sidebar.tsx      1m12
   impl-gates  Read completion_gate  0m40
   explorer    idle
 To impl-ui  [ type a message, Enter sends ]

 Gates                                2 open
 ✗ verification coverage: run the hooks suite
 ✗ todos open: 4
 ✓ header matched (implement)
 ✓ routing: 38 lean-ctx, 0 bypassed
```

Interaction: every task, member and gate row is a Button (Tab and arrows walk them, Enter acts).
A task row expands its evidence; a member row makes it the message recipient; a gate row expands its fix
command and copies it (`$.ui.copy`). Hotkeys: `m` focuses the message field, `g` expands the first gate group with open items (Button `hotkey` props, live while the sidebar holds the focus).
States: no tasks at all draws one faint "nothing planned" line (phases without tasks are not listed); an empty team says how to dispatch;
a gate source that failed to read says which file and keeps the last good value dimmed.

## Prerequisite

`plugins/atlas/hooks/dispatch_tripwire.py:168` `_in_subagent` must also accept `payload["agent_id"]`
(same in `worker_inbox.py:355`, `delegation_prewarn.py:36`); until then every atlas:implementer Write is
denied as an orchestrator edit.

## Verify

Live tmux (`claude --plugin-dir plugins/atlas`, fullscreen): sidebar opens unasked; ctrl+x tab focuses it;
Tab walks member rows; Enter selects; typing + Enter posts a note that appears in `board/<owner>.jsonl`;
phase track matches `todos.json`; `claude plugin test plugins/atlas` and `claude plugin validate` pass.
