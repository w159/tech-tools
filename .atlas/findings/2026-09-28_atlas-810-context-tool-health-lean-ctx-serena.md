# atlas-810-context-tool-health-lean-ctx-serena: scripts/atlas_db.py context_tool_health()'s IN-list extended to include lean-ctx and serena, previously invisible to this telemetry

- id: atlas-810-context-tool-health-lean-ctx-serena
- status: verified
- verified_by: VerifyAtlas810
- verified_at: 2026-09-28T13:23:10+00:00

## Evidence
- scripts/atlas_db.py:1279-1280: "WHERE kind='mcp' AND server IN ('context-mode','claude-mem','ponytail','lean-ctx','serena') " -- lean-ctx and serena present
- `python3 -m pytest scripts/test_atlas_db.py -q` -> 77 passed
- verified against live ~/.atlas/atlas.db: re-ran context_tool_health(conn) directly, returned lean-ctx: calls=3333, errors=113, sessions=136; serena: calls=99, errors=14, sessions=26 -- matching docs/CHANGELOG.md entry exactly
- independently re-queried by fresh verifier dispatch (VerifyAtlas810 claims 3 and 6): CONFIRMED, every number matched exactly including total distinct sessions=1718

## Reproduction
cd plugins/atlas && python3 -m pytest scripts/test_atlas_db.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
