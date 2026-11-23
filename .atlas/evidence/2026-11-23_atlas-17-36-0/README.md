# Evidence: atlas 17.36.0 (2026-11-23)

## 17.35.0 measured live (four atlas:explorer runs on the updated plugin)

| First request | Before (14-day average) | After |
|---|---|---|
| Input tokens | about 75,800 | 33,014 / 33,059 / 33,111 / 33,111 |
| Tool schema bytes | 49,139 | 11,739 |
| `Artifact` tool | present | absent |
| CLAUDE.md chain | loaded | not loaded |
| armada tool names | 322 | 0 |

The measuring session offered 682 MCP names against 1,196 in the earlier sample, so part of the drop is not the release. `atlas_doctor` now prints: atlas subagent median 33111 tokens (was 75599).

## Checks on the release tree

```
cd plugins/atlas/hooks && python3 -m unittest test_dispatch_tripwire test_prompt_optimizer   Ran 552 tests, OK (routing corpus 85/87)
cd plugins/atlas/hooks && python3 -m unittest test_atlas_contract                            Ran 132 tests, OK (skipped=3)
cd plugins/atlas/scripts && python3 -m unittest test_atlas_mux test_atlas_team               Ran 252 tests, OK
cd plugins/atlas/scripts && python3 -m unittest test_atlas_doctor test_fix_settings_options  Ran 232 tests, OK
cd plugins/atlas && bun test                                                                 6355 pass, 31 skip, 0 fail
fallow audit                                                                                 No issues in 24 changed files
python3 scripts/check_versions.py                                                            version check: ok
```

pytest is not importable on this machine, so the suites ran under unittest; CI runs them under pytest.

## Inline-op gate, replayed on history

`_is_integration_call` applied to every main-thread Bash command in 45 days of Claude Code transcripts (1,127 sessions): 2,315 of 18,356 calls (12.6%) are integration commands. Of 163 inline-op denials, 8 refused an integration command directly.

## Team flow, real tmux run in a scratch repository (team tb61399, implement/medium)

- `spawn-team` returned at once: "2/2 spawned", "verifier-5e60 starts after the others exit (launched by wait)".
- `wait` launched the verifier one second after the second implementer's report; its verdict was verified (branch one adds a.txt, branch two adds b.txt).
- Both branches were then squash-merged into main by hand and `reap` was run: "already on base (no merge commit): implementer-21ba, implementer-859f", "worktrees removed", commit count 3 before and 3 after, 0 commits titled "(atlas reap)", only `main` left.

## Stop-gate loop cap (not changed)

45 days of `gate_block` rows: cured streak lengths 1: 260, 2: 31, 3: 11, 4+: 5; futile streaks 28. A cap of 2 would have cut 16 later-cured streaks short.

## Not measured

- The token effect of the shorter CLAUDE.md (13,425 to 6,459 bytes): a headless probe in a scratch folder returned 96,530 tokens for both versions, so it did not load the project files.
- The decision-model routing path: the configured Ollama model `tev1:4b` answers "does not support chat", so `route_choice` never returns an answer on this machine.
