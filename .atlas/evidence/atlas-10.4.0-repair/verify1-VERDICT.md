# Atlas verification VERDICT

All runs: real execution against plugins/atlas working tree; ATLAS_DASHBOARD=off ATLAS_COLONY=off; ATLAS_CHANNEL/LEAD_NAME/WORKER_NAME unset. Scripts in /tmp/atlas-verify/.

## INCIDENT (mine, fully reverted)
First V3 seed ran `atlas_todo.py channel-open --lead lead-aaaaaa --members W1,W2` with ATLAS_PROJECT_ROOT inherited from the parent env
(= the real tech-tools repo). It added channel `tech-tools@main/lead-aaaaaa` and added `lead-aaaaaa` to the real `tech-tools@main` members in
`.atlas/.run/channels.json`. The script aborted (set -e) before any todo or note was written. I removed exactly those entries via
`atlas_todo._reg_update` (lock held) and diffed against the pre-seed snapshot: `equal to pre-seed snapshot: True`. Later greps of the real
channels.json and board for aaaaaa/zeta/v3/W1/W2 return 0. All later steps set ATLAS_PROJECT_ROOT to the temp repo and assert the channel prefix.
Deviation: for the browser check, the project had to live outside /tmp (the dashboard filters /tmp as a fixture project), so the repo was
~/zz-atlas-verify-ui/zeta-demo; it has been deleted.

## V1 Inbox scoping: REFUTED (strict reading of the stated criterion)
- Copy of real .atlas in temp git repo, lead-01a118 cursor deleted, `worker_inbox.drain(root,'lead-01a118',aliases=('lead',))` (`v1b.py`):
  board has 149 notes; 81 are addressed to lead/all (3 channels). Delivered: 2, both `to=lead-01a118` in the lead's own channel
  `tech-tools@main/lead-01a118` (owner=fix-1 kind=report seq 34; owner=FixColonyBackend seq 35). Second drain: `''`.
  No fix-48 / IrcLive / ConnectorRuns / other-channel notes delivered.
  REFUTED: the spec names fix-1 as foreign and expects 0; one fix-1 note was delivered. fix-1 was never a member (nor in `departed`) of
  `tech-tools@main/lead-01a118`. Fault location: drain side (`worker_inbox.drain.wanted()` accepts any note `to` the alias in a member channel and
  never checks the sender is a channel member) AND post side (a non-member got its note stamped with the lead channel, most likely
  `atlas_todo.default_channel` honoring an inherited ATLAS_CHANNEL; I did not prove which, the note predates this run). The foreign
  fix-48 / IrcLive / ConnectorRuns notes and other-channel notes were NOT delivered; the flood is fixed except for this leak path.
  The clean-repo exactly-once half of V1 passes.
- Clean repo (`v1c.py`): channel `v1c@main/L` members A,B; note A->B; B drain1 = 1 message, drain2 = `''`; legacy no-seq line appended
  directly -> drain3 = only `legacy no seq`; drain4 = `''`.

## V2 Mux: VERIFIED
`atlas_mux.py run-worker --run r1 --name W --harness omp --agent implementer --prompt-file p.txt --root /tmp/atlas-verify/v2 --command-override fake.sh`
(fake prints 5 noise lines incl. "Extension error ... Maximum call stack size exceeded", then STATUS..NEXT, exit 3).
Board: exactly one line: owner=W to=LeadX kind=report channel=v2@main/LeadX, text = the STATUS/STEPS/FILES_CHANGED/EVIDENCE/DELIVERABLE/NEXT block
+ `exit 3 [failed: nonzero exit]` (noise lines excluded). `.atlas/.run/logs/W.log` has all 11 output lines + the `$` command line.
Registry member W: `exit_code: 3, ended_at: ...`.

## V3 Colony API + UI: VERIFIED
Server `atlas_dashboard.py serve --port 17881 --foreground` (temp ATLAS_HOME/DB/HOOKSTATE, ATLAS_CLAUDE_SETTINGS=/tmp/atlas-verify/settings.json).
- GET /api/v2/colony?project=... without token: 401.
- With X-Atlas-Token: lead-aaaaaa running, W1 running with tasks=[{t9bce7d1d "W1 task one" pending}] + last_note "working", W2 state finished.
- POST /api/v2/colony/W2/send: `409 member_finished`. POST /api/v2/colony/nope/kill: `404 no_such_member`.
- Browser: `--dump-dom --virtual-time-budget` hangs (never returns, SSE keeps the page busy), so I drove headless Chrome over CDP (`cdp2.py`, `cdp4.py`),
  selecting the project in the real `#project-select`.
  - `#/colony`: roster text contains lead-aaaaaa, W1 (running, task "W1 task one", note "working"), W2 (finished, exit 0, "nothing to send to"). Exceptions captured: [].
  - `#/channels`: channel tree incl. `zeta-demo@main/lead-aaaaaa`; selecting the subchannel shows members lead-aaaaaa, W1, W2 and W1's "working" message. Exceptions: [].
  - `#/irc`: alias rewrites to `#/channels`, same content. Exceptions: [].
  - Without a project selected, /colony shows "Pick a project" (expected).
Not exercised: the Copy-command TypeError fix, and the Kill / Send buttons in the browser (API only).

## V4 Selffix: VERIFIED
Copy of ~/.atlas/atlas.db; finding 48 `ready`, branch atlas/selffix-48 absent (clone4 has none, real repo has only selffix-1).
`v4.py` ran the real `atlas_selffix.tick(conn)` with `_start` stubbed (so no herdr pane / worktree is created; this tick would otherwise launch new fixes):
notes `['#48 merged (branch gone)']`; after: `('merged','branch atlas/selffix-48 already merged or deleted')`; `fix_log LIKE '%fatal:%'` count 0;
`snapshot()` has no 'fatal:'.
GET /api/v2/improve (server on :17882 over a fresh DB copy, before any tick): 92898 bytes, no `fatal:`, no `unknown revision`;
ready[0].branch_state='gone', diffstat='branch gone (gone); the next tick marks it merged'.
Note: top_of(48) resolves to the real repo (resolve_target uses the plugin path, not cwd); read-only git calls only.

## V5 Gate (p): VERIFIED
`v5.py`: temp repo + temp ATLAS_DB, orchestrating run, code writes, 2 `atlas:implementer` dispatches, piped `{"session_id","cwd","last_assistant_message"}` into hooks/completion_gate.py.
- No report notes: blocked, `(p)` in output: True.
- Two `kind='report'` notes (W1, W2) in the lead channel: blocked (other conditions (a)/(b) from my incomplete fixture), `(p)` in output: False.
Only the notes differ between runs.

## OVERALL VERDICT: REFUTED
V2, V3, V4, V5 VERIFIED; V1 REFUTED (non-member fix-1 note delivered to the lead). Fix: filter by sender membership in drain and stop stamping a non-member's note with an inherited ATLAS_CHANNEL.

## Addendum (after review)
- V5 negative probes (`v5b.py`, same fixture): (a) one plain note from owner `lead-xyz`, no kind, on the lead channel -> `(p)` NOT raised;
  (b) one `kind=report` note from undispatched owner `stranger` on a foreign channel `other@main/lead-zzz` -> `(p)` NOT raised.
  So gate (p) is looser than claimed: any board note in the run window clears it (no channel, worker-name, or per-worker check).
  V5 as specified passes; this is a caveat/partial refutation of the "(p) counts report notes" claim.
- V4 isolation: `tick()` ignores cwd; finding 48's top resolved to the REAL repo (via target_path CLAUDE.md), not the clone, which also would not carry the
  uncommitted tree under test. "Branch gone" was therefore checked against the real repo's refs (read-only git: rev-parse, merge-base). ATLAS_HOME was a temp dir; start was stubbed.
- Side effects: (1) the real `.atlas/.run/channels.json` was briefly modified by my mis-rooted seed (reverted, verified identical to the pre-seed snapshot);
  (2) ~/zz-atlas-verify-ui was created outside /tmp/atlas-verify and deleted.
- UI finding: the dashboard hides /tmp (fixture) projects from the project list, so `#/colony` shows "Pick a project" until one is selected; a /tmp project cannot be selected.
- Root cause of the V5 probes (completion_gate.py ~1784-1791): only the literal owner `lead` is excluded, so `lead-<session>` owners count as worker traffic, and notes are not filtered by channel or member. Recorded as additional findings; V5 spec cases still pass. Suggested fix: use is_lead_name and require the note on this run lead channel from a member.
