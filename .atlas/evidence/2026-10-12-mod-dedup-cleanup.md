# Evidence: atlas 11.0.4 mod cleanup (cpWidth/Mood dedup, dead exports)

Surface: `claude plugin test plugins/atlas` (repo root), run by lead after all edits.

    421 pass
    169 fail
    Ran 590 tests across 199 files.

The 169 failures are `plugins/atlas/colony/**` / `omp/**` files importing `bun:test`
(documented in plugins/atlas/mod/TESTING.md); same count as before the edits.

Hooks: `cd plugins/atlas/hooks && python3 -m pytest -q` -> 1424 passed, 3 skipped (before lint fix);
`pytest test_dispatch_tripwire.py -q` -> 239 passed (after).

fallow audit: dead_code_introduced 0 (was 7); verdict still fail on 63 complexity + 2 duplication groups
(inherited from 11.0.x mod work; baseline decision pending with user).

Not verified: live Ghostty/mod surface; SpriteReadable cell-aspect rendering (t2b156948).
