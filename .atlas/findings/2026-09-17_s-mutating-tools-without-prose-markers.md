# S-mutating-tools-without-prose-markers: 67 tools are annotated state-changing but carry no DESTRUCTIVE:/VISIBLE-TO-OTHERS: prose marker, the inverse of the annotation defect

- id: S-mutating-tools-without-prose-markers
- status: verified
- verified_by: main-agent-direct-execution
- verified_at: 2026-09-17T17:05:00+00:00

## Evidence
- Measured across the full 523-tool surface: cipp 12 marked vs 15 annotated-mutating (3 unmarked), connectwise 0 vs 12 (12), ninjaone 9 vs 14 (5), falcon 0 vs 45 (45), panos 32 vs 34 (2 deliberate).
- AGENTS.md:114 requires destructive or externally-visible actions to carry the prefix. The annotation is the machine signal a client gates on; the prefix is what a human reviewer and the model choosing a tool actually read. Fixing only the annotation half leaves the prose half wrong.
- The agreement check in test-mcp-tools.mjs cannot catch this: it verifies marked-implies-mutating, not mutating-implies-marked. A connector marking nothing passes vacuously - which is exactly how connectwise and falcon read as 'ok (agreement check vacuous here)'.
- panos's 2 are deliberate and documented: panos_op (arbitrary passthrough; not every op command mutates) and panos_keygen (credential-issuing class).
- falcon's 45 are vendored CrowdStrike Python source; patching vendor code is out of scope and recorded here as an upstream finding.

## Reproduction
node test-mcp-tools.mjs   # compare the marked-mutating and annotated-mutating columns

## Proposed fix
Prefix the 20 tools in connectors this repo owns, judged per handler rather than per name - an inaccurate DESTRUCTIVE: trains readers to ignore it. Raise falcon's 45 upstream. Consider whether the gate should warn (not fail) on mutating-without-marker, since the vacuous-pass blind spot is structural.

## Doc refs
- AGENTS.md:114
- docs/standards/connector-safety-signals.md

## History
- no earlier verdicts
