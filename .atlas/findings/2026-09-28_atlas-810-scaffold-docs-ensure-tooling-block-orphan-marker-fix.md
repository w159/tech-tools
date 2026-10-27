# atlas-810-scaffold-docs-ensure-tooling-block-orphan-marker-fix: skills/atlas-setup/scripts/scaffold_docs.py: new ensure_tooling_block() inserts/replaces/safely-skips a marker-delimited routing block in AGENTS.md/CLAUDE.md; a real data-loss bug (orphan START marker causing content deletion) was found mid-session and fixed with a strict 'exactly one well-formed pair, else skip untouched' contract

- id: atlas-810-scaffold-docs-ensure-tooling-block-orphan-marker-fix
- status: verified
- verified_by: VerifyAtlas810
- verified_at: 2026-09-28T13:23:10+00:00

## Evidence
- skills/atlas-setup/scripts/scaffold_docs.py:315-359 ensure_tooling_block read in full: 0-start/0-end -> insert (append); 1-start/1-end -> replace span in place (or 'END before START' -> SKIP); anything else (n_start!=1 or n_end!=1, including the 2-START/1-END orphan case) -> explicit SKIP with the file left untouched
- `python3 -m pytest skills/atlas-setup/scripts/test_scaffold_docs.py -q` -> 20 passed
- independent orphan-marker repro by fresh verifier dispatch in a throwaway tempdir: file with a lone `<!-- atlas-tooling -->` inside a doc-example paragraph followed later by a real closed `<!-- atlas-tooling -->`...`<!-- /atlas-tooling -->` pair (2 START / 1 END) -- result: 'SKIP tooling block: AGENTS.md has 2 START/1 END markers', file left byte-for-byte unchanged (VerifyAtlas810 claim 5: CONFIRMED)

## Reproduction
cd plugins/atlas && python3 -m pytest skills/atlas-setup/scripts/test_scaffold_docs.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
