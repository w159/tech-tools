# Atlas context footprint audit (2026-11-21)

Where the input tokens of atlas sessions go, measured on one machine over 14 days, and what atlas changed because of it.

## Sources

- `~/.atlas/atlas.db`: `messages`, `tool_calls`, `friction_events` (14 days to 2026-11-21).
- Claude Code 2.1.330 transcripts under `~/.claude/projects/`: the `usage` of each assistant row, and the `api-request-shape` and `api-request-blob` rows, which hold the system prompt, tool schemas and first message of each request.
- Two headless probes (`claude -p --model haiku --agents '{...}'`) in a scratch directory. Each probe dispatched three subagents whose definitions differ only in frontmatter, with the same one-line prompt.

## Findings

### 1. Most input tokens are the fixed prefix, not the work

| Measure (14 days) | Value |
|---|---|
| Assistant turns | 30,079 |
| Input tokens (fresh + cache read + cache write) | 4.77 billion |
| Average context per turn | about 159,000 tokens |
| Turns that ran under 50,000 tokens of context | 3.3% |
| Main session, first turn, before any work | 109,228 tokens |
| atlas subagent, first turn | 69,500 to 84,500 tokens by role |

A turn cannot be cheaper than its prefix. With a 109,000 token start, the prefix is roughly two thirds of the average turn.

### 2. What an atlas:explorer carries before it reads a file

First request of a haiku `atlas:explorer`, 71,748 tokens:

| Part | Bytes | Who controls it |
|---|---|---|
| Deferred tool names (1,196 names, 1,180 of them MCP) | 55,006 | the user's MCP servers and connectors; agent `disallowedTools` |
| CLAUDE.md chain (user, rules, project, AGENTS.md) | 40,727 | the user; agent `omitClaudeMd` |
| `Artifact` tool schema | 37,384 | agent `disallowedTools` |
| Other tool schemas (Bash, Read, Skill, ToolSearch, ...) | 11,755 | Claude Code |
| Skill listing | 9,089 | installed plugins |
| Other session-start hook text | 5,400 | other plugins |
| Agent system prompt | 4,426 | atlas |
| The dispatch prompt itself | 3,196 | the lead |

The brief the lead wrote is under 2% of what the subagent reads.

### 3. Probe results

Same prompt, haiku, first-turn tokens:

| Subagent definition | First-turn tokens |
|---|---|
| Baseline (`disallowedTools`: Agent, Task, Write, Edit, NotebookEdit) | 63,158 |
| Baseline plus the 12 armada servers (`mcp__plugin_armada_<name>`) | 54,674 |
| Baseline plus `mcp__claude_ai_*` | 63,158 (no effect: a partial server prefix does not match) |
| Baseline plus `mcp__*` | 17,338 |
| Baseline plus `omitClaudeMd: true` (15 KB chain in the scratch directory) | 57,509 |

So 1,248 inherited MCP tool names cost about 45,800 tokens on every subagent turn, and the 320 armada names cost 8,484 of them. `Artifact` is not offered in headless mode, so its 37 KB schema was measured from interactive transcripts and not probed.

### 4. What atlas agents use

Tool calls by `atlas:*` subagents over 45 days, 1,074 runs: lean-ctx 11,994, Bash 9,519, Edit 2,529, Read 2,368, playwright 1,513, context-mode 1,394. The tail is real: serena, context7, Microsoft Learn, Sentry and plaid all appear. `Artifact`: 0 calls. armada vendor servers: 1 call.

This is why atlas keeps the `disallowedTools` denylist and does not move to a `tools:` allowlist. An allowlist would have saved the most tokens and would have broken the tail.

### 5. Wasted turns are real but small

- 80 dispatch denials in 14 days, 41 of them `dispatch_denied:team`. The armed route nudge told the lead to make in-process dispatches the team gate then denied.
- 162 Stop-gate blocks, 52 of which ended in a loop-cap allow with the conditions still open.
- At about 159,000 tokens a turn that is roughly 21 million tokens, under 0.5% of the total. Worth fixing for the friction, not for the bill.

## Changes shipped from this audit

See the 17.35.0 entry in `plugins/atlas/CHANGELOG.md`:

- Every atlas agent withholds `Artifact` and the armada vendor servers; `explorer` also sets `omitClaudeMd`.
- `atlas_doctor` gains a `context-footprint` check that reports the first-turn tokens of this project's sessions and atlas subagents.
- The armed route nudge names `spawn-team` when the team gate will route.

## What only the user can change

901 of the 1,248 MCP tool names on this machine come from claude.ai connectors (Vercel alone is 252). Atlas cannot name them in a plugin agent file, because `disallowedTools` takes whole server names and the connector set differs per account. Disabling the connectors a project does not use (`/mcp`, recorded per project in `~/.claude.json` under `disabledMcpServers`) removes them from every session and every subagent of that project. On this machine that is about 33,000 tokens per turn. See `docs/lessons/2026-11-17_disabling-plugins-and-mcp-per-project.md`.

## Limits

- One machine, one account, Claude Code 2.1.330. Byte shares will differ elsewhere; the ranking of the parts is likely to hold wherever many MCP servers are connected.
- Tokens per byte differ by part (tool names cost more tokens per byte than prose), so the byte table in finding 2 understates the tool-name share. The probe numbers in finding 3 are token counts from the API.
- The effect of withholding `Artifact` in an interactive session is inferred from its schema size and from `disallowedTools` already removing Write and Edit from the same agents; it was not probed.
