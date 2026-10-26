# V-panos-claim8-credential-hygiene: CLAIM 8 PASS on secret material, with one documented exception: no 8-or-more-character run of the key exists anywhere outside the gitignored .env, but its 6-character vendor prefix is written into one TRACKED file

- id: V-panos-claim8-credential-hygiene
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:49:57+00:00

## Evidence
- plugins/atlas/.env is gitignored at .gitignore:327 (git check-ignore -v agrees), untracked (git ls-files --error-unmatch fails), mode -rw------- (600), and not staged (git diff --cached --name-only does not list it).
- Scanned all 1967 tracked files plus the whole working tree (excluding .git, node_modules, and .env) for the key and its 6/8/12-character prefixes: full key 0 hits, 12-char 0 hits, 8-char 0 hits. git diff plus git diff --cached: full/12/8 all absent.
- EXCEPTION: the 6-character prefix has 1 tracked hit (.atlas/.run/findings.json:1192) and 3 untracked hits (.atlas/evidence/2026-09-17-panos-live-validation.md:86, mcp_servers/panos-mcp/tests/boot-probe.mjs:88 and :116 where it opens the synthetic FAKE_KEY, mcp_servers/panos-mcp/src/server.ts:104) plus the two dist copies. Every occurrence is prose or a comment illustrating the old leak. That 6-char run is the fixed vendor prefix shared by every PAN-OS API key, so it carries no entropy about this credential - but it is literally part of this key, so the claim as worded is not absolutely true.

## Reproduction
git check-ignore -v plugins/atlas/.env; git ls-files -z | scan each file for KEY, KEY[:12], KEY[:8], KEY[:6] in memory and print only paths and counts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
