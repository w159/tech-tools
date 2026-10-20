# Atlas Colony TUI (OpenRig-style team workspace in the terminal)

Status: spec, 2026-10-20. Source: planner-colony-tui report on top of
`.atlas/.run/audit-2026-10-20/openrig-inventory.md`. Depends on stage B1 of
`2026-10-20-atlas-feature-audit.md` (TUI crash fixes) landing first.

## Intent (user's words)

"the atlas-tui should be an 'Atlas Colony' branded version of OpenRig's team workspace. i
wanted to have a way to see the atlas-colony and atlas-mux sessions running; as well as see
the subagents using the IRC chat to communicate back and forth; and gain the ability to
interact and steer as needed when i see things going wrong."

## Decisions taken by the lead

1. Steering the lead is allowed: a steer to the lead writes a board note `to=<lead>` on the
   colony channel; the lead's own hook drains it at its next turn. The UI says so ("lead
   reads the board at its next turn") instead of refusing as today (atlas_tui.py:1259).
2. Pause is a soft hold: new sends to the seat are refused, running work is untouched (the
   wave-file flag in atlas_dash_colony.py:674-705). The key and label say "hold", not
   "pause", so the UI does not claim a SIGSTOP it cannot do.
3. The colony workspace is the default landing section; `W` returns to it; the old topology
   section stays reachable.

## What already exists (extend, do not rebuild)

- Explorer plus six right tabs (table, wall, recent, overview, graph, health), seat view with
  live pane capture, command bar, mouse hitmap, y/n confirm gate, send/broadcast/stop/term
  effects, `--once --fixture` (atlas_tui.py: render :911, hitmap :959, handle_key :1298,
  run_command :1224, loop :1614, once :1892; MIN_W/MIN_H 60x18 :33; COMPACT_W 100 :32).
- Snapshot already carries feed[{ts,seq,from,to,kind,text,channel}], needs, terminals,
  colonies[{id,session,transport,channel,created,pods}] (atlas_colony_model.py:1134-1159),
  with notes tailed and cached by mtime (:674-700). No new file reads per tick.
- kill_member (atlas_dash_colony.py:934) is already what the TUI's stop uses (:1745).

## Adaptation map (OpenRig -> Atlas Colony)

| OpenRig (inventory section) | Atlas Colony | data source | verdict |
|---|---|---|---|
| Team roster and states (3) | SESSIONS tree colony > pod > seat with state glyph | colony_model.snapshot :823 | keep; add seat count, age, transport per colony row |
| Space switcher (2) | PROJECTS section, `a` all projects | colony_model._projects | keep |
| "Agents - N" (2) | "Seats N" header, live only | len(snap.seats) | adapt |
| Per-agent latest status (2,3) | seat "now" line and 5-line tile | seat.now, _pane_activity :312, wall tiles | keep |
| Terminal grid cards (2) | WALL tab | _wall_layout :732 | keep |
| Enlarge / back (2,4) | seat view, Esc | _seat_view :616 | keep |
| Terminal attach (5) | `t` attach via tmux grouped session | attach() :1484, attach_argv (model :109) | keep; B1 fixes the exit code |
| Conversation surface (3, not shown on page) | CHANNEL region, who to whom, newest at bottom | snap.chat (new) from _recent_notes :708 | new |
| Inbox for human attention (3) | NEEDS strip atop CHANNEL | snap.needs :1154 | keep |
| Talk to any agent (6); pause/kill/approve not found | STEER input plus hold/kill/attach keys | atlas_todo.note (:1546, :1763), kill_member, new hold helper | adapt |
| nativeSize density (7) | width tiers: >=100 two-pane, 60-99 stacked | COMPACT_W, MIN_W/H | adapt |
| Keyboard model (4) | existing keymap plus region focus | handle_key :1298 | keep, extend |
| Click targets (4) | hitmap rects per row and button, region rects | hitmap :959 | keep, extend |
| Error/empty states (2) | _snap_error, EmptyStates, "no colonies", tmux-absent banner | atlas_tui :806-851 | keep, add 3 strings |
| Help panel (2) | `?` help list | _help_lines :892 | keep, add steer rows |
| Branding (7: amber mark, Menlo) | "ATLAS COLONY" title bar, ASCII only, optional 256-color 173 accent | render title :943, argparse :1932 | adapt |
| Snapshot date line (2) | header "last HH:MM" | _clock :102 | keep |
| Embedded iframe, phone pan, SQLite daemon, rig CLI | none | n/a | skip |

## Screen spec

New section "colony" (default). Tabs: table merges into SESSIONS, recent merges into
CHANNEL; wall, overview, graph, health stay under topology.

100x30 (left 34, right 65, body 25 rows):

```
cmd > _  Tab region . ? help . last 11:00:02 . filter /impl-1
-{ SESSIONS }-----------------+-ATLAS COLONY . macbook-pro . 3 colonies 9 seats ---
 lead-01 tmux 4s 5m  working  | CHANNEL  lead-01 (all)      NEEDS 1: impl-1 blocked
 > ><lead   * work            | 10:58 lead     > all      go, split the parser
   impl-1   ! blocked         | 10:58 impl-1   > lead     need contract    [blocked]
   impl-2   . idle            | 10:59 ex-1     > impl-1   see parse.py:40
 ops herdr 2s 1h idle         | 10:59 lead     > ex-1     ack
   cx-1     * work            | 11:00 tui      > impl-1   rerun the test        (you)
 bg-9 claude-bg 1s 2m         |                                             [tail]
 term atlas-old 1win          |-PEEK impl-1  (t attach . v view)------------------
                              | > running pytest -x   ...pane tail 8 lines...
-------------------------------+-STEER -> impl-1 ---------------------------------
 [x stop][h hold][t term]     | say to impl-1 > _                 @all @lead @seat
hints: i steer . b all . l lead . h hold . x stop . t term . f filter . 1-3 region
[atlas] colony > lead-01 > impl-1
```

Regions: SESSIONS (every colony and mux/herdr/claude-bg session: id, transport, seat count,
state, age, plus orphan atlas-* terminals), CHANNEL (selected colony's channel, newest at
bottom, NEEDS strip on the top row, lead drawn bold with a "lead" tag, the TUI user tagged
"(you)", kind tags in brackets), PEEK (selected seat pane tail; reuses seat_text/capture),
STEER (target in the title, input line, button row). Degrade on shorter heights: PEEK drops
first, then the NEEDS strip, then the button row.

60x18 (minimum; stacked, focused region zoomed to 6 rows, others 2 each):

```
cmd > _  Tab region . ? help . 11:00
-ATLAS COLONY . 3 col 9 seats ------------------------
SESSIONS 1/3  lead-01 tmux 4s 5m working   (3 more)
 >lead * work  impl-1 ! blocked  impl-2 . idle
-CHANNEL lead-01  NEEDS 1 ------------------------[f]
10:58 impl-1 >lead  need contract [blocked]
10:59 ex-1 >impl-1  see parse.py:40
11:00 tui >impl-1  rerun the test (you)
-STEER -> impl-1 ---------------------------------
 say > _
------------------------------------------------------
i steer . b all . h hold . x stop . t term . 1-3
[atlas] colony > lead-01 > impl-1
```

Below 100 cols the explorer column is hidden. Below 60x18 the existing one-line "terminal
too small" message stays (loop :1669).

## State and data

Snapshot additions (optional keys; readers use .get so old fixtures still render):

- `snap.chat`: {channel_name: [{seq, ts, from, to, kind, text, lead: bool}, ... last 100]}
  from colony_model._recent_notes tails grouped by note.channel; lead flag from the channel
  registry role (:838) or seat.lead.
- `colony.seat_count`, `colony.age_s` derived from pods and colony.created (:1142).
- `seat.held`: bool from the wave file via a read-only helper beside kill_member.
- Orphan terminals: computed in the TUI from snap.terminals with no colony.session match.

Polling unchanged: snapshot thread every 2s (loop :1658), seat capture 1s only while a seat
is open (:1660). Added cost: one dict grouping over at most FEED_MAX notes per snapshot.
`ui.chat_seq` remembers the last rendered seq for tail-follow and an "N new" badge.
Delivery receipts (atlas_dash_irc._normalize_note :179) are skipped in v1.

## Keymap

Kept: arrows, PgUp/PgDn, Enter, Esc, Tab, q, ?, :, /, r, a, t, v, x, y/n, mouse click and
wheel.

New: `W` colony workspace; `1`/`2`/`3` focus SESSIONS/CHANNEL/STEER; Tab cycles regions in
the colony section (elsewhere it still cycles right-pane tabs: same key, context-dependent,
flagged); `i` steer the selected seat (lead if none), Esc cancels, Enter sends, steer mode
swallows printable keys like cmd/filter modes; `b` steer prefilled "@all"; `l` steer
prefilled "@lead"; `@name` inside steer retargets; `h` hold/release selected seat; `f`
toggle CHANNEL filter to the selected seat; End follows tail; Home jumps to oldest.
Replaced: `m` now opens steer mode (the `send`, `msg`, `broadcast` commands stay in the
command bar). Kill stays `x` with the existing guard (:1518). Attach stays `t`.

## Stage map (one implementer dispatch each; all depend on B1)

| id | stage | role / tier | files | the one check | deps |
|---|---|---|---|---|---|
| S1 | Fixture plus golden harness | implementer sonnet/medium | scripts/fixtures/colony_snap.json (extend inline SNAP test_atlas_tui.py:62-110 with herdr colony, claude-bg colony, orphan terminal, chat, held seat), scripts/fixtures/golden/{100x30,60x18,160x48}.txt, scripts/test_colony_golden.py | `python3 -m unittest test_colony_golden` runs `--once --fixture --width --height` and diffs golden (pins today's output; later stages update intentionally) | B1 |
| S2 | Snapshot data | implementer sonnet/medium | atlas_colony_model.py (chat, seat_count, age_s, held), atlas_dash_colony.py (hold_member/release_member beside kill_member :934), test_atlas_colony_model.py | temp board dir with notes on two channels: snap.chat sliced per channel, ordered by seq, no rescan when files unchanged; hold flips the wave file read by seat.held | S1 fixture keys; B3 (same file) |
| S3 | SESSIONS region, new "colony" section, both layouts, stubs for CHANNEL/STEER/PEEK, "ATLAS COLONY" title | implementer sonnet/high | atlas_tui.py (render, hitmap, right_lines, SECTIONS, default view) | render()+hitmap() with the fixture at both sizes; golden updated; every SESSIONS row has a hit rect whose action opens that colony/seat | S1, B1 |
| S4 | CHANNEL region: chat_lines(snap, ui, w, h), lead/worker/you tags, NEEDS strip, `f` filter, tail-follow | implementer sonnet/medium | atlas_tui.py | chat_lines test on the fixture: ordering, clipping at 65 and 36 cols, filter, lead tag; golden updated (rerun S3 test) | S2, S3 |
| S5 | STEER: steer mode, @target parsing, send/broadcast/lead/hold/kill wired to existing backends | implementer sonnet/high | atlas_tui.py (handle_key, run_command, loop effects :1754-1800) | fake atlas_todo.note plus fake hold/kill: seat send -> note(to=seat); @all -> note(to="all", channel); held seat refused with message; lead target -> note(to=lead) plus hint; kill passes the y/n gate | S2, S3 |
| S6 | Keymap, regions, mouse rects, compact stacked layout | implementer sonnet/medium | atlas_tui.py, test_atlas_tui.py | table-driven test over a KEYMAP constant: no key bound twice in one mode, each key yields the expected ui diff; 60x18 golden shows all three regions | S3-S5 |
| S7 | Docs and branding | docs-curator haiku/low | skills/atlas-tui/SKILL.md, docs/atlas-colony.md, docs/atlas-channels.md, CHANGELOG, README, ROADMAP, help text | test: every KEYMAP key appears in SKILL.md and in `_help_lines` | S6 |

Then an atlas:verifier pass stamps findings.json.

## Risks and unverified

- Curses color is optional (A_REVERSE/A_DIM only, loop :1631-1691): lead vs worker must read
  in monochrome (glyph, bold, tag). Mouse wheel under tmux needs mouse mode; keyboard is
  primary. Resize is handled (KEY_RESIZE :1696); stacked layout must recompute the hitmap.
- Channel volume is bounded by tail caps (200 notes per file, 256 KB, colony_model
  :670-671); long bodies truncate to one line, expand in seat view.
- tmux absent: colonies fall to claude-bg (atlas_mux.py:254-260); roster and channel work,
  `t` shows "no tmux pane". launch() has no tmux pre-check [unverified: _run_tmux on
  FileNotFoundError, :1832].
- herdr transport: attach_argv is tmux-only (model :109); herdr panes shown in SESSIONS with
  `t` disabled and a reason [unverified].
- Windows: curses needs windows-curses, no tmux; only `--once` frames are portable
  [unverified].
- Sender identity: TUI notes use owner "tui" (:1550); atlas_dash_irc uses a HUMAN constant
  not read. The chat shows "tui" with the "(you)" tag.
- FEED_MAX value not read; per-colony slice may be short when many channels are busy (S2
  test pins the behavior).
