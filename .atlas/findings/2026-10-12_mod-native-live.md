# mod-native-live: Live 2.1.296: native sidebar takes keyboard focus (ctrl+x tab), Tab walks rows, Enter expands, Input sends a note to the lead board

- id: mod-native-live
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-12T16:28:35+00:00

## Evidence
- .atlas/evidence/mod-native-sidebar-2026-10-12/live-gates-and-input.txt; .atlas/evidence/mod-native-sidebar-2026-10-12/board-note.jsonl

## Reproduction
tmux new-session -d -x 200 -y 60 "claude --plugin-dir plugins/atlas"; ctrl+x tab; Tab x N; type; Enter; grep the text in .atlas/.run/board/human.jsonl

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
