# tripwire-agent-id: Tripwire treats hooks with agent_id as subagent calls (implementer writes no longer denied)

- id: tripwire-agent-id
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-12T16:13:53+00:00

## Evidence
- plugins/atlas/hooks/test_dispatch_tripwire.py::SubagentDenyTierSkipTest.test_edit_from_subagent_carrying_agent_id_and_parent_transcript_is_not_denied

## Reproduction
cd plugins/atlas/hooks && python3 -m unittest test_dispatch_tripwire test_delegation_prewarn test_worker_exemption test_worker_inbox

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
