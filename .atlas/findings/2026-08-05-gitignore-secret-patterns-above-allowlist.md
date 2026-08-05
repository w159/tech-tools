# Finding: `.gitignore` secret patterns placed above the allowlist were negated by every later `!` rule

Date: 2026-08-05
Area: `.gitignore` (repo root)
Status: resolved (pattern-coverage audit ongoing separately, see caveat below)

## Root cause (reusable rule)

In a deny-by-default, zero-trust `.gitignore` (`*` / `/**` deny-everything, then an
allowlist of `!path/**` re-inclusions), **git evaluates rules in file order and the
last matching rule wins**. A secret-pattern block (`*.key`, `*.pem`, `id_rsa`,
`credentials.json`, etc.) only holds if it is the *last* matching rule for any path
it should cover. Placing that block **above** the allowlist section means every
subsequent `!docs/<subdir>/**` or `!.atlas/<subdir>/**` line re-admits the secret
pattern underneath it -- the deny is overridden the moment a broader `!` rule for
that folder appears later in the file.

General form of the bug: `deny(secret)` before `allow(folder)` in a last-rule-wins
ignore file is not a "deny with an allowlist carve-out" -- it is "allow, full stop."
Secret re-exclusions must be placed **after** every allowlist rule, not near the
other deny rules at the top for tidiness.

## This instance

`.gitignore`'s Section 3 (secret patterns, then at lines ~66-91) sat above Section 4
(allowlist, `!docs/`, `!.atlas/`, and their per-subdir entries). Verified with
`git check-ignore` before the fix -- all of the following were trackable despite the
Section 3 patterns supposedly covering them:
`docs/decisions/secret.key`, `docs/decisions/foo.pem`, `docs/decisions/id_rsa`,
`docs/decisions/credentials.json`, `docs/audits/secret.key`, `docs/specs/id_rsa`.
Only `.env` variants were safe, because they alone already had a dedicated
post-allowlist `**/.env` re-exclusion block.

This was **pre-existing**, not introduced by any single session's docs edit. It
affected `docs/audits/` and `docs/specs/` identically to `docs/decisions/` --
whichever folder a session happened to add a file under would have inherited the
same exposure. The exposure window is therefore as old as the allowlist-section
ordering itself, not just the most recent session that noticed it.

## Fix

Added a "Global secret re-exclusion (MUST stay after the allowlist)" block at
`.gitignore:341-371`, immediately before the `plugins/atlas/.env` re-exclusion,
mirroring the existing `**/.env` pattern for the rest of the secret set: `**/*.key`,
`**/*.pem`, `**/*.p12`, `**/*.pfx`, `**/*.crt`, `**/*.cer`, `**/*.der`, `**/*.asc`,
`**/*.gpg`, `**/id_rsa`, `**/id_ed25519`, `**/*_rsa`, `**/*_ed25519`,
`**/credentials.json`, `**/secrets.json`, `**/secrets.yaml`,
`**/service-account*.json`, `**/firebase-adminsdk*.json`, `**/.netrc`, `**/.npmrc`,
`**/.pypirc`, `**/*.tfstate`, `**/*.tfstate.*`.

## Evidence

Before fix: 6 probe paths above all showed as addable via `git check-ignore` /
addability check.

After fix: all 8 probe paths -- `docs/decisions/{secret.key,foo.pem,id_rsa,
credentials.json}`, `docs/audits/secret.key`, `docs/specs/id_rsa`,
`plugins/atlas/private.pem`, `.atlas/findings/id_rsa` -- now IGNORED. Real tracked
docs (`docs/CHANGELOG.md`, the new ADR, `.atlas/findings/INDEX.md`) remained
trackable. `git ls-files | wc -l` -> 1650, no already-tracked file matches the new
patterns (no accidental un-tracking of legitimate files).

## Caveat -- do not over-claim

Pattern-coverage completeness (e.g. `*.jks`, `*.keystore`, `*.p8`, `id_ecdsa`,
`.git-credentials`, `secrets.yml` vs `secrets.yaml`) was being audited separately by
an adversarial verifier at the time this finding was written. This finding resolves
the **ordering defect** (deny-before-allow negated by last-rule-wins) with the
pattern set that existed at fix time. It does not claim the pattern list itself is
exhaustive -- see the verifier's follow-up for any additional secret shapes it
finds; those would be a new, separate finding, not a reopening of this one.

## References

- `.gitignore:341-371` (fix)
- `docs/CHANGELOG.md` 2026-08-05 entry, "SECURITY" subsection
