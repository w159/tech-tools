# mod-sidebar-polish-live: Post-polish live sidebar: counts agree, names under waypoints, team filtered, gates collapsed with open count, advisor section, fits one screen, 0 refusals

- id: mod-sidebar-polish-live
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-12T16:32:00+00:00

## Evidence
- .atlas/evidence/mod-native-sidebar-2026-10-12/live-after-polish.txt

## Reproduction
tmux new-session -d -x 200 -y 60 "claude --plugin-dir plugins/atlas --debug-file /tmp/d.log"; capture-pane; grep -c refused /tmp/d.log

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
