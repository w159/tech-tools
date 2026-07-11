---
name: atlas-doctor
description: 'Repair the atlas plugin install: marketplace, rollbacks, hooks/agents/skills, auto-fix. Run when atlas stops launching subagents or acts like an older version.'
when_to_use: the task involves doctor
disable-model-invocation: true
argument-hint: '[--fix to auto-repair] [plugin name, default atlas]'
---



# `atlas-doctor`

Atlas can be silently broken from the outside: a marketplace entry that points
at a stale fork with autoUpdate on will roll the installed plugin back to an
old version on every update, and the subagent engine, hooks, and skills vanish
without any error. This command detects that class of failure and repairs it.

## Run the diagnosis

```!
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" ${ARGUMENTS}
```

## Interpret the output

The script prints one PASS/FAIL line per check and exits 0 (healthy) or 1
(problems found):

| Check | What it proves |
|---|---|
| registered | atlas is present in installed_plugins.json |
| marketplace-source | known_marketplaces.json tracks the repo named in the plugin's own manifest (the canonical source), not a fork |
| clone-remote | the marketplace git clone's origin matches the canonical repo |
| version-sync | installed version equals what the marketplace currently offers |
| rollback | installed version is not below the highest version ever seen (state in ~/.atlas/doctor-state.json) |
| install-path | the cache copy exists, matches the registered version, and is not marked .orphaned_at for garbage collection |
| hooks-wired | every hook file referenced by hooks.json exists in the installed copy |
| assets | `agents/` and `skills/` are populated in the installed copy |

## If problems are found

1. Report each FAIL line to the user verbatim with a one-sentence explanation.
2. If the user passed `--fix`, the script already attempted repair and re-ran
   the checks (its second block of output is the VERIFY pass). Otherwise ask
   whether to run it again with `--fix`.
3. `--fix` repoints the marketplace source and clone remote to the canonical
   repo, resets the clone, re-registers the marketplace's current version in
   installed_plugins.json (staging the cache copy if needed), and clears any
   .orphaned_at markers.
4. After a successful fix, tell the user to run `/reload-plugins` (or restart
   the session) - the running session keeps the old plugin loaded until then.
5. If FAILs persist after `--fix`, show the exact failing lines and stop; do
   not hand-edit plugin manager state beyond what the script does.

The same checks also run automatically at SessionStart in warn-only mode, so a
future rollback announces itself at the top of the session instead of
silently degrading atlas.
