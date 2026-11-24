# worktree-hygiene: reap auto-commits dirty workers, snapshot base for a dirty lead, reap-stale at boot; team t033ece merged and removed itself

- id: worktree-hygiene
- status: verified
- verified_by: lead
- verified_at: 2026-11-24T09:17:31+00:00

## Evidence
- .atlas/evidence/2026-11-24_worktree-hygiene-gate.txt
- plugins/atlas/scripts/test_atlas_mux_worktree_hygiene.py: 5 pass; autocommit off -> 2 fail; spawn snapshot off -> 1 fail

## Reproduction
.venv/bin/python -m pytest -q plugins/atlas/scripts/test_atlas_mux_worktree_hygiene.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-24T09:12:55+00:00 needs-evidence by atlas:verifier: worktree hygiene: code+tests pass in worker worktrees; final reap/gate state not yet observable
