# Evidence: 2026-11-18 atlas audit remediation (atlas 17.29.0)

Branch `claude/amazing-wozniak-1hrfkm`, tree at `6b9d922` plus the docs-status commit.
All commands run from `plugins/atlas` in this source tree on 2026-11-18.

| Check | Command | Result |
|---|---|---|
| hooks suite | `python3 -m unittest discover -s hooks -p 'test_*.py'` | Ran 3428 tests, OK (skipped=4) |
| scripts suite | `python3 -m unittest discover -s scripts -p 'test_*.py'` | Ran 4911 tests, OK (skipped=1) |
| mod + omp + rest | `bun test` | 6774 pass, 35 skip, 0 fail, 6809 tests, 342 files |
| live mod gate | `python3 scripts/atlas_mod_gate.py --live --require-live` | PASS (4 pass, 0 fail, 0 skip) |
| versions | `python3 scripts/check_versions.py` (repo root) | version check: ok |
| attribution | `python3 scripts/check_attribution.py origin/main..HEAD` (repo root) | no Claude attribution found |

Before the work the audit measured: hooks 3,302 run / 0 failures; scripts 4,834 run / 1 failure
(`test_tmp_hygiene`); mod 4,209 run / 0 failures.

Independent verification (fresh-context agents, read-only):
- wave 1: 2 verifiers + completeness critic (team td392ac)
- wave 2: 2 verifiers + completeness critic (team t2abe7f)
- waves 2b/2c: verifier, 12 items (7 verified, 3 needs-evidence, 2 rejected; the rejected and
  needs-evidence items were then fixed in `d03ac81`)
- mod reorganization and register.ts split: verifier in detached worktrees of `5915e79` and
  `d03ac81`: 0 test titles lost (4,311 to 4,329), moved sources identical apart from paths,
  seeded faults for the hex, uiFromEnv and phase-table guards each fail a named test.

Not verified here (needs a live interactive session or a browser): the header chip and M6
marks rendering in a real TUI, the Command Center iframe token prompt, the new CI jobs on
GitHub.

Per-finding status: `docs/audits/2026-11-18_atlas-contract-header-mod-audit.md` section 7.
