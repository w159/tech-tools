# Atlas verify2 VERDICT (uncommitted plugins/atlas tree)
ATLAS_CHANNEL/LEAD_NAME/WORKER_NAME unset and DASHBOARD/COLONY=off everywhere. ATLAS_PROJECT_ROOT = a temp repo under /tmp/atlas-verify2 in V1 and V5 (v5c.py now sets it to the fixture repo in the gate subprocess; rerun: none/lead_chatter/foreign_report (p) present, reports (p) absent). V6 pytest ran with `-u ATLAS_PROJECT_ROOT` as you specified (tests make their own roots). Scripts: v1b.py v1c.py v1cde.py v5c.py.

## V1(a) VERIFIED
Copy of real .atlas into temp git repo, inbox/lead-01a118.json deleted, drain('lead-01a118', aliases=('lead',)) (v1b.py):
board 149 notes; delivered 1: `owner=FixColonyBackend to=lead-01a118 channel=tech-tools@main/lead-01a118 seq=35`. FixColonyBackend is in the lead channel member list.
No fix-1 / fix-48 / IrcLive / ConnectorRuns delivered (previous run leaked fix-1; now gone). Second drain: ''.
Breakdown (v1a2.py): 76 notes addressed to lead/lead-01a118: 74 excluded as other/no channel (67 channel-less, 7 in tech-tools@main), 1 excluded as owner-not-member of the lead channel (fix-1, seq 34, in lead channel), 1 delivered (FixColonyBackend, member). fix-48 (20), IrcLive (2), ConnectorRuns (1): all channel-less, none delivered. fix-1: 36 channel-less/main notes + the seq-34 non-member note, none delivered.
## V1(b) VERIFIED (v1c.py)
B drain1 = 1 msg "hello B"; drain2 = ''; legacy no-seq line -> drain3 = only "legacy no seq"; drain4 = ''.
## V1(c) VERIFIED (v1cde.py)
Lead-side register_member opened `<proj>@main/lead-abc123`. Process env ATLAS_WORKER_NAME=Stranger ATLAS_CHANNEL=<lead chan> ATLAS_LEAD_NAME=lead-abc123, `atlas_todo.py note --owner Stranger --to lead-abc123`:
note stamped channel=`<proj>@main` (inherited env dropped); lead drain = ''. Also with explicit `--channel <lead chan>`: stamped main again, lead drain = ''.
Spoofed-owner variant (v1spoof.py) -- LIMITATION, not covered by your criteria: process with ATLAS_WORKER_NAME=Stranger posting `--owner Member1 --to <lead>` IS delivered to the lead (owner is self-asserted; env identity is not checked against --owner). Unregistered owner Stranger2 with only ATLAS_CHANNEL set (no worker env): stamped main, not delivered. So the guard blocks unregistered names, not impersonation of a registered member.
## V1(d) VERIFIED
Registered member Member1 report (kind=report) -> lead drain1 delivered once ("from Member1: member report"), drain2 = ''. Same via CLI with member env: delivered once, channel = lead channel.
## V1(e) VERIFIED
note owner=human to=Member1 in the lead channel: Member1 drain1 delivered "from human: hi member", drain2 = ''.
## V5 VERIFIED (with fixture correction)
Gate derives lead name as lead-<first 6 of session id> = `lead-sess-v`; my first run used channel lead `lead-v5` and so (p) stayed present even for the reports case. That is my fixture mismatch, not a product bug; I fixed the fixture (v5c.py) to lead-sess-v.
none -> (p) present: True | lead-owned plain note -> (p) present: True | stranger kind=report foreign channel -> (p) present: True | W1,W2 report notes on run's lead channel -> (p) present: False (absent).
Caveat: a report by a registered member on a lead channel whose lead name != the session-derived lead_name does NOT clear (p) (by design in _colony_channel_used).
## V6 VERIFIED
`pytest hooks/ scripts/ -q`: 1 failed, 2697 passed, 422 subtests passed (186s). Only failure: hooks/test_atlas_contract.py::InstalledParityContract::test_installed_hook_files_match_repo (completion_gate.py, dispatch_tripwire.py, worker_inbox.py differ from install) = allowed. Output in suite.txt.

## Real-repo snapshot
.atlas/.run/channels.json sha256 before == after (d45fa6ab...956927a4): EQUAL. Board file listing (`find .run/board -type f | ls -l` hash) before == after: EQUAL (4298402339bec259...).
Whole-.atlas content hash differs before/after (e4e5593f... vs 103850ae...): other files under the real .atlas changed during the ~10 min run; I wrote none (no real path was ever used as root) and a grep of .atlas/.run for my fixture names (v1cde, Stranger) = 0 hits; likely the live session. Not attributable by me; flagged.

## OVERALL VERDICT: VERIFIED (V1 a-e, V5, V6) against the stated criteria; with the spoofed-owner limitation above. Caveat: whole-.atlas hash drift unexplained but unrelated to channels.json/board.
