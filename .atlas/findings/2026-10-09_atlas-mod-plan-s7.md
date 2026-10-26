# atlas-mod-plan-s7: Atlas mod plan section 7 managed-policy fact-check

- id: atlas-mod-plan-s7
- status: rejected
- verified_by: verifier-mod-plan-s7
- verified_at: 2026-10-09T21:05:58+00:00

## Evidence
- Doc claims mostly confirmed (/tmp/mods-admin.md:58-63,149-150,211-221,233-239,268,291,304; mods-ref.md:305-313; settings-reference.md:4019-4030). WRONG: (1) plan L314-315 kill closes 'the agent's workspace' - atlas_mux.py:854-857 kill takes only --run; atlas_herdr.py:731-738 close_run closes the whole run workspace (every pane), tmux path kill-session (atlas_mux.py:789); exit 137 is a fallback written only for workers that posted no exit within 2s and have a channel (atlas_mux.py:734-754). (2) plan L313 steering via atlas_herdr.py argv: CLI exposes only status|ensure|reap|install-check|create-pane (atlas_herdr.py:1125-1137); send_prompt (L308) has no CLI. (3) plan L275-281: allowManagedHooksOnly blocks plugin hooks/hooks.json (42 atlas hook commands), agent-frontmatter hooks and non-managed statusLine unless managed enabledPlugins force-enables atlas@tech-tools (settings-reference.md:4024-4028), so 'existing hooks keep working' is false there; they are plugin hooks, not 'settings hooks'. MISSING: disableAllHooks (stops mod and all hooks), disableSideloadFlags (rejects --plugin-dir used by Stage 0 spike), guard option key cc-plugin-sec-default@builtin under pluginConfigs and fail-closed rule, deny rules do not govern a mod's own $.process/$.fs calls (admin.md:66), admin sample policy mod refuses user mods calling process.run, --safe-mode/worker-crash unloads. Confirmed: atlas_herdr.py status exists, read-only (L836-889), loopback-only HTTP (L99-106); marketplace lists atlas by ./plugins/atlas so condition 3 is satisfiable.

## Reproduction
sed -n 229-306 /tmp/mods-admin.md; sed -n 4019-4030 /tmp/settings-reference.md; sed -n 757-858 plugins/atlas/scripts/atlas_mux.py; sed -n 731-744,1125-1142 plugins/atlas/scripts/atlas_herdr.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
