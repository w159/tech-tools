# Prompt Optimization

## Contents

- [1. The user's prompt - automatic, via the shipped hook](#1-the-users-prompt---automatic-via-the-shipped-hook)
- [2. Subagent prompts - your job, every dispatch](#2-subagent-prompts---your-job-every-dispatch)
- [3. When NOT to optimize](#3-when-not-to-optimize)
- [4. Writing prompts for chat interfaces (user-facing rewriting)](#4-writing-prompts-for-chat-interfaces-user-facing-rewriting)

A sharp prompt is the cheapest lever in the whole run. A vague one makes every downstream
subagent guess, wander, and burn tokens. The orchestrator optimizes prompts at two levels:
the **user's prompt coming in**, and **every subagent prompt going out**.

## 1. The user's prompt - automatic, via the shipped hook

This skill ships a `UserPromptSubmit` hook (`hooks/prompt_optimizer.py`) that automates the
manual loop of "run my request through `ollama run prompt-optimizer:latest` first, then paste
the result." It pipes the raw prompt through a local optimizer model and injects the rewritten
spec into context as a system reminder. See `references/hooks-automation.md` to install and
configure it.

Key behaviors (so you interpret its output correctly when it fires):
- It is **trigger-gated** by default - only prompts the user opts in (prefix `opt:`, `optimize:`,
  or `++`) are optimized; the optimizer is slow, so untriggered prompts pass through instantly.
  `ATLAS_OPTIMIZE=always` no longer auto-runs it; only a trigger prefix (or `ATLAS_OPTIMIZE_TRIGGER`)
  starts the optimizer. The atlas-prompt skill is separate: it rewrites in the session itself.
- It **augments, never replaces**. You receive the original prompt PLUS an `OPTIMIZED SPEC`
  block. Treat the optimized spec as the working task definition, but where it conflicts with
  the user's evident intent, the **user's original wins** - the optimizer can over-reach.
- It **never blocks**: if the optimizer is down or slow, the prompt goes through unchanged.

When you see an injected `OPTIMIZED SPEC`, fold it into your Orient/Plan step as the task
brief - it typically already contains a discovery list, gates, a subagent plan, and acceptance
criteria you can route directly.

## 2. Subagent prompts - your job, every dispatch

You optimize outbound prompts yourself, by construction. A good subagent prompt is a tight
contract, not a paragraph of hope. The mechanics live in `references/subagent-kit.md`; the
*optimization* discipline is:

- **Specify the deliverable and the evidence**, not the vibe. "Return a findings entry with
  `file:line` + the failing test output" beats "look into the bug."
- **Pass paths and symbol names, never file bodies.** Every byte you paste is context the
  subagent spends before it starts. Hand it lean-ctx/LSP entry points and let it pull what it
  needs.
- **Cut everything the agent can derive itself.** Its prompt is its entire system prompt; trim
  to GOAL - CONTEXT it can't derive - TOOLS - SUCCESS CRITERIA - OUT OF SCOPE - REPORT shape.
- **One job per agent.** Unscoped "fix everything" prompts produce wandering, expensive runs.
- **Name the exact tools, every dispatch.** A `TOOLS` block is required in the spec (shape in
  `subagent-kit.md`, name table in `capability-routing.md` Step 2b). Name real tools -
  `find_symbol`, `ctx_compose`, `ctx_batch_execute`, `query-docs` - and tell the agent to
  `ToolSearch` for their schemas first, because deferred MCP tools are not in its tool list until
  it does. "Use the right tools" and "use lean-ctx" both produce an agent that quietly falls back to
  `Read`/`Grep`; that is the failure this line exists to prevent.
- **State the model and effort deliberately** (per the tier tables in `SKILL.md`). Sonnet is the
  ceiling for `atlas:*` companions and effort is `low` for spec-executing roles - which is only
  affordable because the prompt carries the decomposition. A subagent that seems to need a bigger
  model is telling you the prompt is underspecified. Fix the prompt.
- **Specify the exact output format or schema** the subagent must return (field names, types,
  required keys). Consistent output shape across parallel dispatches is what makes synthesis
  reliable: without it each agent invents its own structure and the orchestrator has to
  reconcile them. See also: `references/multi-stage-planning.md` (phasing dispatch batches),
  `references/verification-and-grounding.md` (what "verified" means and the evidence bar).

For a genuinely ambiguous, high-stakes outbound prompt you can round-trip it through the same
local optimizer the hook uses - call it directly and fold the result into your dispatch spec:

```
ollama run prompt-optimizer:latest "draft the subagent spec for <job>"
# or the clean HTTP path the hook prefers:
#   POST http://127.0.0.1:11434/api/generate  {"model":"prompt-optimizer:latest","prompt":"...","stream":false}
```

Reserve this for prompts worth the latency (a whole audit's framing, a tricky migration spec).
For routine dispatches, the `subagent-kit.md` template is already the optimized shape.

## 3. When NOT to optimize

- Trivial or already-precise prompts - optimization adds latency and can bloat a clear ask.
- Slash commands - they expand into their own prompts downstream (the hook skips them).
- Anything where the user's exact wording is the point (a literal string, a quote, a name).

## 4. Writing prompts for chat interfaces (user-facing rewriting)

When the user asks to rewrite or improve a prompt, the `atlas-prompt` skill does it: it sizes the
rewrite to the job, keeps every goal and limit, and has an independent judge model confirm nothing was
dropped or added. Prompts for chat models follow `skills/atlas-prompt/references/chat-prompts.md`.
