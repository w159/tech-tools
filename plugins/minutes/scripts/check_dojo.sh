#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[dojo] validate packs"
node scripts/validate_skill_pack.mjs \
  .claude/plugins/minutes/packs/founder-weekly.json \
  .claude/plugins/minutes/packs/relationship-intel.json

echo "[dojo] check generated skill metadata"
node scripts/generate_skill_metadata.mjs --check

echo "[dojo] exercise recommender"
node scripts/recommend_skill_packs.mjs --role founder --context meeting-soon >/tmp/minutes-dojo-founder.json
node scripts/recommend_skill_packs.mjs --role customer-facing --context theme-search >/tmp/minutes-dojo-relationship.json

echo "[dojo] build public dojo surface"
npm --prefix site run build

echo "[dojo] all checks passed"
