# Evidence: context-diet (2026-11-21, branch atlas/context-diet)

## Probes (claude -p --model haiku, scratch directory, same one-line prompt, first-turn input tokens)

| Subagent frontmatter | Tokens |
|---|---|
| baseline disallowedTools | 63,158 |
| plus 12 `mcp__plugin_armada_<name>` | 54,674 |
| plus `mcp__claude_ai_*` (partial prefix) | 63,158 |
| plus `mcp__*` | 17,338 |
| plus `omitClaudeMd: true` (15 KB chain) | 57,509 |

## Checks on the merged branch

```
cd plugins/atlas && bun test        6355 pass, 31 skip, 0 fail (6386 tests, 348 files)
fallow audit                        No issues in 36 changed files
python3 scripts/check_versions.py   version check: ok
python3 scripts/check_attribution.py origin/main..HEAD   no Claude attribution found
python3 plugins/atlas/scripts/atlas_doctor.py | grep context-footprint
  ! WARN context-footprint main session 109228 tokens (limit 70000), atlas subagent median 75599 tokens (limit 40000)
```

Python suite result: see python-suite.txt in this folder.

Not measured: the effect of withholding `Artifact` in an interactive session (headless mode does not offer the tool). It shows after the plugin is updated, in the `context-footprint` subagent median.

## Python suite (python3 -m unittest discover; pytest is not importable on this machine: /opt/homebrew/bin/pytest points at a removed python@3.12)

```
hooks    Ran 3575 tests  FAILED (failures=8, skipped=4)
scripts  Ran 5086 tests  FAILED (failures=8, errors=27, skipped=19)
```

- hooks: all 8 failures are in test_gate_rerun and read "no interpreter can import pytest".
- scripts: all 27 errors are loader errors "No module named 'pytest'"; the 8 failures are tests that shell out to pytest (test_atlas_crew, test_atlas_irc_speculate, test_ci_tiers, test_atlas_done_claim_positives) plus test_atlas_analytics_hot.FlushTest.
- Baseline: the same 16 failing tests fail identically (failures=8 and failures=8) in a worktree of 797821d2 plus only the hook-guard test change, so the branch adds none.
- Changed-area suites on the branch pass: test_atlas_contract, test_prompt_optimizer, test_dispatch_tripwire, test_atlas_doctor, test_atlas_hook_guard.
