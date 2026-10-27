# PV-06-channel-view: Channel widget keeps polling after task returns; ATLAS_CHANNELS=off -> no widget/timers; no timer leak after stop (poll and linger phases, real timers); real atlas_todo member-finish/notes read by view

- id: PV-06-channel-view
- status: verified
- verified_by: ParityVerifier
- verified_at: 2026-10-09T18:01:01+00:00

## Evidence
- /tmp/pv/view.test.ts live timers 1 -> 0 after stop; off -> 0; channel-view.test.ts:62-100 behavioural; real channel-open+note+member-finish -> finishedMembers [Alpha], note seq 1
- nit: channel-view.ts header still says one final paint when the task call ends

## Reproduction
cd /tmp/pv && bun test view.test.ts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
