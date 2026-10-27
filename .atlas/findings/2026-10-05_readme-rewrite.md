# readme-rewrite: Root README rewrite: images, counts, commands

- id: readme-rewrite
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-05T20:26:22+00:00

## Evidence
- 6 images exist, each referenced exactly once, no others. Counts from source: 47 SKILL.md, 12 agents, 25 non-test scripts, 12 .mcp.json servers, hooks.json 8 events/20 bindings/16 programs (15 hooks/*.py + scripts/atlas_doctor.py), FORWARDED_ENV=18. --help: atlas_mux spawn flags (--run --name --harness --agent --prompt-file --root --model --effort --thinking) all exist; atlas_doctor flags (--fix --hook --purge --mine --list-findings --set-status --baseline --remeasure) exist; atlas_todo note/notes with --owner --to --root work, claim/complete --id/--owner/--evidence parsed. Caveats: README tree line 'hooks/ 16 bound programs' is really 15 in hooks/ (+doctor in scripts/); atlas_todo.py has no --help (treats it as content).

## Reproduction
python3 /tmp/r.py; python3 /tmp/h.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
