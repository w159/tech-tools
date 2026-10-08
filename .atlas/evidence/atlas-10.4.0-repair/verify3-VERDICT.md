# Atlas verify3: Colony Send/Kill (3034cd83, 7428c999 + uncommitted pid-identity change)

Env per run: ATLAS_PROJECT_ROOT=temp repo (~/zz-atlas-verify3/colonyproj), ATLAS_CHANNEL/LEAD_NAME/WORKER_NAME unset, ATLAS_DASHBOARD=off ATLAS_COLONY=off, temp ATLAS_HOME/DB/DASHBOARD_DB/HOOKSTATE_DIR, ATLAS_CLAUDE_SETTINGS=/tmp/atlas-verify3/settings.json.
Dashboard on :17891 (not 7421/7317), headless Chrome over CDP (`drive.py`, adapted from /tmp/atlas-verify/cdp4.py). The project was inserted into the temp DB with a run so `/api/v2/projects` lists it. Seed: `seed.sh`.
Click mechanism: DOM `.click()` via Runtime.evaluate (not synthesized mouse events); the page's real fetch path ran. The first run used `sleep 300`, which could expire on its own, so I re-seeded with `sleep 3600` and recorded `kill -0` and wall-clock before/after every action.

## K1 Browser Send: VERIFIED
- Page `#/colony`, project selected via `#project-select`. M1 (live, headless) Send box filled, Send clicked.
- Captured POST: `/api/v2/colony/M1/send` body `{"text":"hello-from-browser-K1","project":"/Users/jerry/zz-atlas-verify3/colonyproj"}` -> status 200, `{"ok":true,"delivered":false,"queued":true}`. Toast: "Queued for M1: delivered on its next tool call".
- `ATLAS_PROJECT_ROOT=<temp> atlas_todo.py inbox --owner M1` -> `- from human: hello-from-browser-K1`.
- Finished member M2: roster row `input.disabled=true|sendBtn.disabled=true`, text "Finished (exit 0): nothing to send to." No Kill button. N1/P1 (dead): both controls disabled. API-level 409 on a finished member was only seen in the earlier /tmp/atlas-verify run, not re-run here.

## K2 Browser Kill: VERIFIED
- K1 recorded via real path `atlas_todo.set_member_handles(R,"K1",pid=32690)`; the registry stored `pid_start 'Thu Oct 8 11:55:38 2026'` (output of seed.sh).
- Browser: Kill on K1 -> modal "Kill K1?" -> confirm "Kill". POST `/api/v2/colony/K1/kill` body `{"project":...}` -> 200 `{"ok":true,"killed":"K1","via":"pid"}`.
- `kill -0 32690`: alive at 11:55:47 (before), gone at 11:56:03 (after). K2 (32693), P1 (32691) and N1 (32692) stayed alive. The sleep was `sleep 3600`, so this is not natural expiry.

## K3 Pid reuse: VERIFIED
- P1: pid=live `sleep 3600` (32691), pid_start edited to `Mon Jan  1 00:00:00 2001` via `atlas_todo._reg_update`. N1: pid=live sleep (32692), pid_start removed.
- Both were alive at 11:56:03, immediately before the POST.
- POST kill P1 -> `409 {"error":"member_dead","why":"'P1' is already dead"}`. POST kill N1 -> same 409. Both with token. Both sleeps still alive afterwards.
- GET /api/v2/colony: P1 dead, N1 dead.
- Caveat [INFERENCE]: the guard compares `ps lstart`, which has 1 s resolution. A reused pid started within the same second as the recorded one would match. I did not test that.

## K4 Cross-project pane: VERIFIED (function level, no herdr; `k4.py`)
`atlas_herdr.agents/list_panes/close_pane/send_prompt` monkeypatched. Foreign panes labelled A1, A2 and A3 (and an extra label ZZ) with cwd in another project.
- A1 (recorded pane_id "pA1-recorded", not live; foreign pane pFOREIGN1 has the same label): roster `pane_id=None`.
- A2 (no recorded pane_id; foreign pane pFOREIGN2 has the same label): `pane_id=None`.
- A3 (recorded pA3, live; a foreign pF3 also carries label A3): `pane_id=pA3`, steerable.
- ZZ (foreign-only label): not on the roster.
- kill A1/A2 -> 409 member_dead. send A1/A2 -> queued on the board, delivered=False.
- kill A3 -> 200 via pane. send A3 -> delivered=True.
- `close_pane` calls: `['pA3']`. `send_prompt` calls: `['pA3']`. No foreign pane id (pFOREIGN1, pFOREIGN2, pF3, pOTHERONLY) was ever passed.

## Snapshot
sha256 of tech-tools/.atlas/.run/channels.json before = after = d45fa6abd61a60dd46ed837fd07be6177764037f6d537322a94d757b4956927a (equal).

## Cleanup
Dashboard :17891 stopped (`pgrep` none, curl down). Headless Chrome stopped. The four sleeps are gone. ~/zz-atlas-verify3 removed and chrome profile dir removed. :7421/:7317 untouched. No files edited under plugins/ or tech-tools/.atlas. Leftover: /tmp/atlas-verify3 scripts, home/ and home4/ temp state.

## OVERALL VERDICT: VERIFIED (K1-K4)
Notes: the first run in this session used 300 s sleeps; the re-run with 3600 s sleeps is the evidence cited above. Not covered: real herdr panes (K4 is monkeypatched), same-second pid reuse.
