#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export CXXFLAGS="-I$(xcrun --show-sdk-path)/usr/include/c++/v1"

echo "[ambient] proactive context helper"
node .claude/plugins/minutes/hooks/test/proactive-context.test.mjs

echo "[ambient] recommendation layer"
node .claude/plugins/minutes/hooks/test/minutes-learn.test.mjs

echo "[ambient] core memo enrichment and context tests"
cargo test -p minutes-core derive_structured_tags_for_memo_includes_source_people_projects_and_guardrails
cargo test -p minutes-core frontmatter_serializes_tags_when_present
cargo test -p minutes-core build_related_context_collects_people_topics_meetings_and_commitments

echo "[ambient] full core suite"
cargo test -p minutes-core

echo "[ambient] all checks passed"
