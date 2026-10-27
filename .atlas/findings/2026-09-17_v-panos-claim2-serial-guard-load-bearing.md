# V-panos-claim2-serial-guard-load-bearing: CLAIM 2 PASS: live panos_version returns serial as the STRING 023009014025, and the regression guards genuinely fail when the parser fix is reverted

- id: V-panos-claim2-serial-guard-load-bearing
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:49:08+00:00

## Evidence
- Live PA-460: panos_version -> {"sw-version":"11.1.13-h6","multi-vsys":"off","model":"PA-460","serial":"023009014025"} - quoted string, leading zero intact
- Reverted parseTagValue/parseAttributeValue to true in a /tmp scratch copy (repo untouched; mcp_node/node-panos/src/xml.ts:15-16 still 'false' after the run): vitest -> 5 failed | 4 passed (9). The three new guards all failed: 'preserves a leading-zero serial as a string' (tests/client.test.ts:93), 'keeps digit-only version and family values as strings' (:103, expected "0" received 0), 'reads the error code attribute as a string' (:111, expected code "403" received 403). Two pre-existing tests also failed. Guards are load-bearing, not tautological.

## Reproduction
D=/var/folders/t4/3yydl26s5mqb99t84qw3_wrm0000gn/T/tmp.RPGXDG3RGc; cp -R mcp_node/node-panos/{src,tests,package.json,tsconfig.json,vitest.config.ts} /; ln -s /Users/jerry/MEGA/Projects/Agentic/tech-tools/mcp_node/node-panos/node_modules /node_modules; sed -i '' 's/parseTagValue: false/parseTagValue: true/; s/parseAttributeValue: false/parseAttributeValue: true/' /src/xml.ts; (cd  && npx vitest run)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
