# project-disable-list-2026-11-17: Project-only disable list: plugins 24 to 10, active MCP servers 66 to 26

- id: project-disable-list-2026-11-17
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T11:51:34+00:00

## Evidence
- init event: plugins 14 (10 user, 4 built-in), mcp_servers connected 24, disabled 14, failed 1, needs-auth 1

## Reproduction
claude -p 'Reply with the single word ok.' --model haiku --max-turns 1 --output-format stream-json --verbose (read the init event)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
