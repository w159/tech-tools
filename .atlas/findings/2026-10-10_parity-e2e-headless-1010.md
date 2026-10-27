# PARITY-E2E-HEADLESS-1010: Unattended headless worker loop proven; recall_gate worker exemption landed

- id: PARITY-E2E-HEADLESS-1010
- status: verified
- verified_by: lead-01a122
- verified_at: 2026-10-10T07:32:48+00:00

## Evidence
- e2e-s13-probe (source-loaded worker, claude --bg --permission-mode dontAsk with allow rules): ran to completion headless with NO permission prompt, made Bash calls under allow rules, posted board row (.atlas/.run/board/e2e-s13-probe.jsonl seq 221). Root cause of prior silent fails (e2e-s10/s11 done-0-notes) found: recall_gate denied every main-thread call in bg worker sessions lacking claude-mem recall; fixed by WorkerRecallSkip (recall_gate.py skips arming for ATLAS_WORKER_NAME sessions via worker_inbox.is_worker_env, 10.4.1 analogy) — red-first, test_recall_gate 25 passed, completion_gate 325/13. Caveat recorded: mux _bg_brief path not re-verified post-recall-fix (e2e-s8 proven pre-fix; third pass suggested).

## Reproduction
claude --bg --name e2e-s13-probe --permission-mode dontAsk --settings (see e2e-mux.md) --plugin-dir plugins/atlas; check .atlas/.run/board/e2e-s13-probe.jsonl

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
