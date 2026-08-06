# Subagents never called serena, lean-ctx, context-mode, or claude-mem

Date: 2026-08-06
Status: verified
Shipped: atlas 5.7.0, commit `2b51ca2`
Verification: deterministic contract test (no verifier subagent dispatched; a test expresses the check)

## The defect

Every atlas agent body named its tools in prose: "use `serena`", "route noisy
output through `context-mode`". Those are **deferred MCP tools**. Their schemas
are not in a subagent's tool list until it calls `ToolSearch`, so an agent
looking for a tool literally named `serena` finds none, falls back to `Grep` +
`Read`, and reports success. The instruction read as satisfied and was never
executed.

Three compounding facts:

1. `lean-ctx` appeared only in `explorer.md`; `claude-mem` appeared in no agent
   body at all, only in hooks and scripts.
2. `schema-inventory.md`, `rls-privilege-audit.md`, and
   `naming-glossary-audit.md` carried a `tools:` frontmatter allowlist
   (`Bash, Write` / `Read, Grep, Glob, Bash, Write`). A `tools:` allowlist
   excludes every `mcp__*` tool by construction, so MCP routing could not have
   worked in those three even with correct names.
3. `capability-routing.md` already carried a routing table naming serena and
   context-mode, and it changed nothing, because no rule required the
   orchestrator to put those names into a dispatch prompt. A reference the
   dispatch path does not read is not enforcement.

Separately, model and effort were untuned: `rls-privilege-audit` ran on opus,
`SKILL.md` routed `planner`, `completeness-critic`, and critical `verifier` work
to opus, and no agent declared `effort` at all.

## The fix

**Agents (all 12).** A tool-routing table ahead of each Method section: the
need, the exact callable name, and what it replaces. Names are real and
per-role: `ctx_compose`, `get_symbols_overview`, `find_symbol`,
`find_declaration`, `find_referencing_symbols`, `replace_symbol_body`,
`insert_after_symbol`, `get_diagnostics_for_file`, `ctx_callgraph`, `ctx_search`,
`ctx_batch_execute`, `ctx_execute`, `ctx_execute_file`, `ctx_fetch_and_index`,
`resolve-library-id` -> `query-docs`, claude-mem `search` -> `timeline` ->
`get_observations`. Each agent is told to `ToolSearch` for schemas first and to
search by keyword rather than hardcode a prefix, because server prefixes differ
per install (`mcp__serena__*` here, `mcp__plugin_context-mode_context-mode__*`
there). The three `tools:` allowlists are removed; `disallowedTools` already
carried the read-only guarantee.

**Tiers.** `effort` is a real plugin-agent frontmatter key. Confirmed against the
CLI's own validator strings in
`/Users/jerry/.local/share/claude/versions/2.1.223`: `" has invalid effort '"` /
`"'. Valid options: "` / `" or an integer"`, with the option set `low`,
`medium`, `high`, `xhigh`. There is **no** `thinking` frontmatter key, so effort
is the only reasoning-depth lever a subagent has. Every agent now declares one:
`low` for the nine roles that execute a spec the orchestrator already wrote,
`medium` for the three that render an independent verdict against evidence they
were not handed (`verifier`, `completeness-critic`, `rls-privilege-audit`).
Sonnet is the ceiling for every `atlas:*` companion.

**Enforcement moved into the prompt feed**, which is the part that actually runs
per dispatch: `subagent-kit.md`'s dispatch spec gains a required `TOOLS` block,
`prompt-optimization.md` makes naming exact tools a per-dispatch rule with the
failure mode stated, and `capability-routing.md` gains a Step 2b table of the
names to paste plus the claude-mem worker-runtime argument shapes.
`subagent-kit.md` also now warns that a fork inherits the parent's model and
effort, so an agent file's tiers do not apply to a forked dispatch.

## Evidence

```
$ python3 -m pytest plugins/atlas/hooks/test_atlas_contract.py -q
31 passed, 48 subtests passed in 2.03s
```

Negative control, proving the seven new `AgentTierContract` assertions are
load-bearing. Set `planner` to `model: opus` and strip its `effort` line:

```
$ python3 -m pytest test_atlas_contract.py -q -k AgentTierContract
E       + [] : effort tier drift: ['planner.md: None (want low)']
FAILED test_atlas_contract.py::AgentTierContract::test_every_agent_declares_a_valid_effort
FAILED test_atlas_contract.py::AgentTierContract::test_no_agent_exceeds_sonnet
FAILED test_atlas_contract.py::AgentTierContract::test_only_verdict_roles_get_medium_effort
3 failed, 4 passed, 24 deselected
```

Restored afterward.

## Open gap

Nothing enforces at runtime that a dispatched subagent actually *called* an MCP
tool. The contract test proves the instruction is present and the name is
callable, not that the model obeyed it. Per-dispatch tool-call telemetry already
lands in `~/.atlas/atlas.db`; measuring MCP-tool share per agent type from it,
and failing a threshold, is the follow-up. Recording it here rather than
deferring it silently.

## Reusable rule

A tool named in prose is not a tool the agent can call. Deferred MCP tools need
the exact name plus a `ToolSearch` instruction, and a `tools:` frontmatter
allowlist silently revokes every `mcp__*` tool. When a routing reference exists
and behavior does not change, the reference is not on the execution path: move
the rule into whatever the dispatch actually reads.
