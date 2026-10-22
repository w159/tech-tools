# T9-release receipt
changed_files: plugins/atlas/.claude-plugin/plugin.json; .claude-plugin/marketplace.json; plugins/atlas/CHANGELOG.md; plugins/atlas/README.md
evidence_strategy: proof-first
branch: worker/cc15-t9
red (plugin.json only bumped): FAILED (failures=2, skipped=4); AssertionError: (14, 0, 0) not greater than or equal to (15, 0, 0); AssertionError: Lists differ: ['14.0.0'] != ['15.0.0']
green (all four files): Ran 111 tests, OK (skipped=4)
banned-character scan: python regex over the four files, no hits (grep -P is unsupported on macOS grep)
commit: b838a0d7 on worker/cc15-t9 (4 files, 32 insertions, 4 deletions)
