# ATLAS-process-npm-install-clobbers-node-modules-symlink: npm install replaces the repo's tracked node_modules symlink with a real directory; move the fresh tree into node_modules.nosync.noindex and relink

- id: ATLAS-process-npm-install-clobbers-node-modules-symlink
- status: verified
- verified_by: symlink restored; npm test and npm run build both pass through it
- verified_at: 2026-08-18T15:38:13+00:00

## Evidence
- mcp_node/node-ninjaone/node_modules

## Reproduction
git ls-files -s mcp_node/node-ninjaone/node_modules -> mode 120000 (symlink); npm install turns it into a directory

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
