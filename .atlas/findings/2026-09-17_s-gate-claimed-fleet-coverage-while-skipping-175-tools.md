# S-gate-claimed-fleet-coverage-while-skipping-175-tools: The new connector gate reported PASS over 348 tools while 175 never reached a check: blumira gated behind navigate, falcon skipped as Python

- id: S-gate-claimed-fleet-coverage-while-skipping-175-tools
- status: verified
- verified_by: main-agent-direct-execution
- verified_at: 2026-09-17T17:05:00+00:00

## Evidence
- blumira listed 2 tools (status + navigate) because its other 30 register only after a blumira_navigate domain step; the gate scored it GATED and passed. Real surface: 32 tools, 6 mutating, across 5 domains (findings, agents, users, msp, resolutions).
- falcon was skipped outright as 'Python connector - ships no server.mjs bundle'. It is the largest connector in the repo: 145 tools, 45 annotated mutating, including host containment, IOC creation and RTR command execution. It is now spawned the way the plugin actually launches it and checked like the rest.
- Fleet coverage 348 -> 523 tools, 11 -> 12 connectors, 0 gated, 0 skipped. Verified: node test-mcp-tools.mjs -> PASS, 12/12 fully enumerated.
- Walking navigate across the other connectors confirmed their surfaces were already complete and the harness now states that per connector, so a reader cannot mistake 'navigate exists' for 'tools were hidden'.
- Self-referential lesson: the gate was written to catch partial verification and shipped partially verifying. Its saving grace was reporting the gaps honestly (GATED / SKIP) instead of silently averaging them away.

## Reproduction
node test-mcp-tools.mjs

## Proposed fix
none recorded

## Doc refs
- test-mcp-tools.mjs
- docs/standards/connector-safety-signals.md

## History
- no earlier verdicts
