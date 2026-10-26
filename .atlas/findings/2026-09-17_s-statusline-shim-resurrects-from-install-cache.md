# S-statusline-shim-resurrects-from-install-cache: Deleting ~/.atlas/atlas_statusline.py does not stick: the installed atlas 6.3.0 recreates it on every SessionStart until the user reinstalls

- id: S-statusline-shim-resurrects-from-install-cache
- status: verified
- verified_by: main-agent-direct-execution
- verified_at: 2026-09-17T15:16:00+00:00

## Evidence
- Shim deleted, then observed present again with mtime 2026-09-17T11:15:42 - after the deletion.
- Source of the rewrite: ~/.claude/plugins/cache/tech-tools/atlas/6.3.0/hooks/session_boot.py still contains _sync_statusline_shim (grep -rl confirmed; 6.0.1 __pycache__ copies also present).
- Not fixable from this repo by design: AGENTS.md forbids creating/modifying/deleting anything under ~/.claude/plugins/cache/** or marketplaces/**. Consumer installs refresh by shipping this repo, not by hot-patching the cache.
- Impact is inert, not broken: ~/.claude/settings.json no longer references the shim (grep -c = 0), so a recreated file is dead weight that renders nothing.

## Reproduction
rm ~/.atlas/atlas_statusline.py; start a new Claude Code session in a project with atlas installed; stat ~/.atlas/atlas_statusline.py

## Proposed fix
User reinstalls/updates atlas from the marketplace at >=6.4.0, whose session_boot.py no longer syncs the shim; the stray file can then be deleted permanently.

## Doc refs
- AGENTS.md:39

## History
- no earlier verdicts
