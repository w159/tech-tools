#!/bin/bash
# Run atlas_doctor --hook from a simulated claude.ai synced layout with no installed_plugins.json.
# usage: doctor_synced.sh <atlas_plugin_dir>
src=$1; t=$(mktemp -d); mkdir -p $t/home/.claude/plugins/synced/org_acct
cp -r "$src" $t/home/.claude/plugins/synced/org_acct/atlas
echo '{"name":"atlas"}' > $t/home/.claude/plugins/synced/org_acct/atlas.meta.json
root=$t/home/.claude/plugins/synced/org_acct/atlas
cd $t; echo '{"hook_event_name":"SessionStart","source":"startup"}' | env -u CLAUDE_CONFIG_DIR -u ATLAS_PLUGINS_DIR HOME=$t/home CLAUDE_PLUGIN_ROOT=$root python3 -S $root/scripts/atlas_doctor.py --hook; echo "rc=$?"
rm -rf $t
