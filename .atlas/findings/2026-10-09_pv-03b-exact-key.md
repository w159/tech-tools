# PV-03b-exact-key: Follow-up: only exact atlas@<marketplace> key read (marketplace.json name tech-tools, else literal default); real settings has atlas@tech-tools

- id: PV-03b-exact-key
- status: verified
- verified_by: ParityVerifier
- verified_at: 2026-10-09T18:01:01+00:00

## Evidence
- secret_check: SEKRET_WRONGKEY_* and SEKRET_PREFIX_* never set; tests test_other_atlas_entry_is_ignored/test_exact_key_used_among_others

## Reproduction
bash /tmp/pv/secret_check.sh

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
