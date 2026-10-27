# S-todo-board: Durable todo board + gate drain fallback + dashboard Work/Agents tabs ship in atlas 5.26.0

- id: S-todo-board
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-09T11:48:20+00:00

## Evidence
- plugins/atlas/hooks/todo_capture.py (PostToolUse TodoWrite mirror, ATLAS_TODO=off)
- plugins/atlas/scripts/atlas_todo.py (list/set/add/claim/complete/counts/carry CLI)
- plugins/atlas/hooks/completion_gate.py:539 (drain priority: transcript -> board -> LEDGER)
- plugins/atlas/scripts/atlas_dashboard.py (/api/todo /api/agents /api/memory, Work+Agents tabs)
- plugins/atlas/hooks/test_atlas_contract.py TodoBoardContract 6/6
- hooks discover: 683 tests OK (3 skipped), scripts discover: 641 tests OK

## Reproduction
cd plugins/atlas/hooks && python3 -m unittest discover -s . -p 'test_*.py' -> Ran 683 OK; cd plugins/atlas/scripts && python3 -m unittest discover -s . -p 'test_*.py' -> Ran 641 OK

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md 5.26.0; plugins/atlas/CHANGELOG.md 5.26.0; README.md hooks table + dashboard sections

## History
- no earlier verdicts
