# omp-plugin-root: ensureClaudePluginRoot replaces stale CLAUDE_PLUGIN_ROOT, keeps valid

- id: omp-plugin-root
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-05T20:26:22+00:00

## Evidence
- plugins/atlas/omp/index.ts diff: pre-existing value kept only if <value>/scripts/atlas_todo.py isFile(), else falls through to replace; cd plugins/atlas/omp && bun test -> 252 pass 0 fail. Caveat: behavior confirmed from diff + suite, no separate live stale-root run.

## Reproduction
cd plugins/atlas/omp && bun test

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
