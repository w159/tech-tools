# S-panos-live-key-prefix-literal-committed: The live appliance key's 6-character opening is hardcoded as a literal in a tracked findings entry, a source comment, and the boot probe FAKE_KEY - the same prefix-disclosure pattern the panos_status fix removed

- id: S-panos-live-key-prefix-literal-committed
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:50:25+00:00

## Evidence
- Substring scan (fragments never printed): the 6-character prefix of the live PANOS_API_KEY appears at .atlas/.run/findings.json:1192 (tracked), .atlas/evidence/2026-09-17-panos-live-validation.md:86, mcp_servers/panos-mcp/tests/boot-probe.mjs:88 (opening of FAKE_KEY) and :116, mcp_servers/panos-mcp/src/server.ts:104, plus the dist copies. No 8-character run appears anywhere.
- Mitigating: that 6-character run is the fixed vendor prefix common to every PAN-OS API key, so it discloses nothing specific to this credential, and the user is rotating the key regardless.

## Reproduction
Read PANOS_API_KEY in memory, substring-test each tracked and working-tree file for KEY.slice(0,6) and KEY.slice(0,8), print only paths

## Proposed fix
Replace the literal prefix in prose, comments, and FAKE_KEY with a neutral placeholder such as <redacted-prefix> or a synthetic string that is not a prefix of any real key, so no part of a live credential is committed.

## Doc refs
- none

## History
- no earlier verdicts
