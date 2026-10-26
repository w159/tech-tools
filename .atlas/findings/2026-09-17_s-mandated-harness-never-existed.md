# S-mandated-harness-never-existed: AGENTS.md's mandatory propagation checklist requires a boot-test harness that has never existed in the tree

- id: S-mandated-harness-never-existed
- status: verified
- verified_by: main-agent-direct-execution
- verified_at: 2026-09-17T16:20:00+00:00

## Evidence
- AGENTS.md:77 lists 'Test harness test-mcp-tools.mjs' as part of the product surface; :94 requires 'test-mcp-tools.mjs probes still target tools that exist'; :95 requires 'Boot test (node test-mcp-tools.mjs <svc>) passes without tool-count regression'.
- ls test-mcp-tools.mjs -> No such file or directory. The file is absent from the repo root and from every subdirectory.
- Consequence: every connector shipped with those checklist boxes satisfied by inspection rather than execution. docs/architecture/panos-connector-design.md:230-232 records the workaround ('That harness does not exist anywhere in this tree, so its job is done by tests/boot-probe.mjs') - the gap was known and documented per-connector instead of fixed once.
- This is the same class as S-panos-design-doc-asserted-unverified-state: a checklist box ticked by something other than the check it names.

## Reproduction
ls test-mcp-tools.mjs; grep -n test-mcp-tools AGENTS.md

## Proposed fix
Write the harness AGENTS.md already specifies: boot every shipped bundle over MCP stdio, assert a tool-count floor, and assert prose/annotation agreement. Being fleet-wide, it also catches the class of defect that per-connector probes miss.

## Doc refs
- AGENTS.md:77
- AGENTS.md:94
- AGENTS.md:95

## History
- no earlier verdicts
