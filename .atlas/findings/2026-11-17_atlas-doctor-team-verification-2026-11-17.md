# atlas-doctor-team-verification-2026-11-17: tmux team t892423 (2 verifiers, class=verify) independently reproduced all five guarantees of the pushed branch from a pristine git-archive of HEAD 73fdaa79: 1093 hooks tests + 90 scripts tests + 3279 unittest discover all green with zero failures; mux not denied for cheap read-only but still denied for cheap-writing and opus-read-only; STEPS still denies; block-loop cap still trips without progress and resets with it; upsert created_at unchanged on re-upsert and honours an explicit value; hostile judge body 402499 -> 24000 bytes and facet body 352858 -> 24000

- id: atlas-doctor-team-verification-2026-11-17
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T18:10:45+00:00

## Evidence
- team t892423; /tmp/vt_head archive of 73fdaa79; findings records .atlas/findings/2026-11-17_pushed-head-archive-tests-2026-11-17.md, 2026-11-17_pushed-head-guarantees-2026-11-17.md, 2026-11-17_pushed-branch-second-eyes-2026-11-17.md, 2026-11-17_pushed-branch-guarantees-second-eyes-2026-11-17.md

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/tech-tools && git archive HEAD | tar -x -C /tmp/vt_head && cd /tmp/vt_head && /Users/jerry/MEGA/Projects/Agentic/tech-tools/.venv/bin/python -m pytest plugins/atlas/hooks/test_dispatch_tripwire.py plugins/atlas/hooks/test_completion_gate.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
