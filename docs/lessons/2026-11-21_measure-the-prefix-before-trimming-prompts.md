# Measure the prefix before trimming prompts
Date: 2026-11-21
Area: atlas agents, context footprint

## What happened
An atlas subagent started at about 72,000 input tokens before it read a file. The fixed prefix (system prompt, tool schemas, CLAUDE.md chain) was two thirds of the average turn.

## Why it happened
Inherited MCP tool names and one 37 KB `Artifact` tool schema outweighed every prompt atlas wrote. Shortening agent prompts would have saved little.

## What to do next time
1. Measure the first-turn input tokens of the agent before editing any prompt.
2. Withhold whole tools with `disallowedTools` (shipped: `Artifact` and the 12 armada servers, all `plugins/atlas/agents/*.md`).
3. Re-check the number after the change.

## What to avoid
A `tools:` allowlist: rejected because 45 days of calls showed a real tail of MCP use that an allowlist would break.

Details and probe results: `docs/audits/2026-11-21_atlas-context-footprint-audit.md`.
