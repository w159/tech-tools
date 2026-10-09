# Doctor Checks Matrix

What atlas-setup checks, what each check proves, and what a FAIL means. The
doctor script (`scripts/atlas_doctor.py` in the plugin root) prints one
PASS/FAIL line per check and exits 0 (healthy) or 1 (problems found). This
reference documents the checks so the operator can interpret the output
without running the script.

## The eight checks

| Check | What it proves | FAIL means |
|---|---|---|
| registered | atlas is present in `~/.claude/plugins/installed_plugins.json` | atlas was never installed, or the install record was deleted. |
| marketplace-source | `known_marketplaces.json` tracks the repo named in the plugin's own manifest (the canonical source), not a fork | the marketplace entry points at a stale fork that will roll the installed plugin back on every update. |
| clone-remote | the marketplace git clone's origin matches the canonical repo | the local marketplace clone has drifted to a different remote; updates pull from the wrong source. |
| version-sync | installed version equals what the marketplace currently offers | the installed plugin is behind the marketplace's current version; a stale marketplace entry is suppressing the upgrade. |
| rollback | installed version is not below the highest version ever seen (state in `~/.atlas/doctor-state.json`) | a rollback has occurred; the running version is lower than the high-water mark. |
| install-path | the cache copy exists, matches the registered version, and is not marked `.orphaned_at` for garbage collection | the cache copy is missing, mismatched, or orphaned; the plugin may fail to load on next session. |
| hooks-wired | every hook file referenced by `hooks.json` exists in the installed copy | a hook file is missing; hooks (including the SessionStart warn-only check and the read-only guard) will not fire. |
| assets | `agents/` and `skills/` are populated in the installed copy | the agents or skills directories are empty; subagents will not dispatch and skills will not load. |

## Additional surface checks

Beyond the eight scripted checks, two things are worth tracking:

- **Frontmatter validity** - no script currently checks that every
  installed skill's `SKILL.md` has the required frontmatter fields
  (`name`, `description`) and no unknown fields. Malformed frontmatter
  can silently disable a skill; treat this as a manual review item.
- **Skill/agent count vs manifest** - handled separately by
  `plugin-health.py` (see below), not by atlas_doctor.py itself. It
  compares the plugin manifest's declared skill/agent counts against
  the number of `SKILL.md` files and agent files actually found. A
  mismatch means an asset was added to the manifest but not shipped,
  or vice versa.
- **`docs/` tree** - if the org config references `docs/` for
  standards or templates, those paths must exist. Missing docs break the
  branding and policy loading flows.
- **Session-augmentation trio + code-nav pair presence** - the doctor's
  eight checks are install-integrity only; the MCP tooling has its own check
  surface, with the same rigor per tool: `hooks/session_boot.py` prints a
  "Setup gap: ... absent" line at boot for claude-mem, context-mode, and
  ponytail (`detect_dep`/`has_cmd`); serena is verified via
  `tool_routing.scan_stack` (`.serena/project.yml` present with a
  `languages:` key) plus a boot-time self-heal; lean-ctx is verified via
  `lean-ctx doctor` listing the project root under its effective roots
  (documented in `references/install.md` Stage 1). These are session-boot and
  setup-skill checks, not doctor checks - they do not affect the doctor's
  exit code, and a low session cache-hit ratio is surfaced by the doctor's
  `--mine` path instead (finding `cache_hit_ratio_low`).

## The SessionStart warn-only check

The same checks run automatically at SessionStart in warn-only mode. A
warn-only run prints FAILs to the session header but does not attempt repair
and does not block the session. The purpose is to announce a rollback or a
broken install at the top of the session instead of letting it silently
degrade atlas.

## Manual skill

The atlas plugin has exactly two manual skills, `atlas` and `atlas-setup`
(both `disable-model-invocation: true`, `user-invocable: true`). Neither
auto-triggers from a description match; the user must invoke them
explicitly. Doctor (`atlas_doctor.py`) is not a skill itself - it is the
script that atlas-setup's repair mode invokes (`--fix`), plus a separate
SessionStart hook invocation (warn-only). This is intentional: a broken
install that auto-triggered repair on every session would amplify the
problem. The user runs atlas-setup's repair mode when something is wrong.

## plugin-health.py

`skills/atlas-setup/scripts/plugin-health.py` is a deterministic, read-only check that counts
the skills and agents in the installed copy and compares against the
manifest's declared counts. It exits 0 if the counts match and 1 if they
differ. It does not repair anything; it only reports. Use it as a quick
sanity check between full doctor runs.