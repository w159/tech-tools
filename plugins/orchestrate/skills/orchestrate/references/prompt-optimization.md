# Prompt Optimization

A sharp prompt is the cheapest lever in the whole run. A vague one makes every downstream
subagent guess, wander, and burn tokens. The orchestrator optimizes prompts at two levels:
the **user's prompt coming in**, and **every subagent prompt going out**.

## 1. The user's prompt — automatic, via the shipped hook

This skill ships a `UserPromptSubmit` hook (`hooks/prompt_optimizer.py`) that automates the
manual loop of "run my request through `ollama run prompt-optimizer:latest` first, then paste
the result." It pipes the raw prompt through a local optimizer model and injects the rewritten
spec into context as a system reminder. See `references/hooks-automation.md` to install and
configure it.

Key behaviors (so you interpret its output correctly when it fires):
- It is **trigger-gated** by default — only prompts the user opts in (prefix `opt:`, `optimize:`,
  or `++`) are optimized; the optimizer is slow, so untriggered prompts pass through instantly.
  The user can set `ORCHESTRATE_OPTIMIZE=always` to optimize every prompt.
- It **augments, never replaces**. You receive the original prompt PLUS an `OPTIMIZED SPEC`
  block. Treat the optimized spec as the working task definition, but where it conflicts with
  the user's evident intent, the **user's original wins** — the optimizer can over-reach.
- It **never blocks**: if the optimizer is down or slow, the prompt goes through unchanged.

When you see an injected `OPTIMIZED SPEC`, fold it into your Orient/Plan step as the task
brief — it typically already contains a discovery list, gates, a subagent plan, and acceptance
criteria you can route directly.

## 2. Subagent prompts — your job, every dispatch

You optimize outbound prompts yourself, by construction. A good subagent prompt is a tight
contract, not a paragraph of hope. The mechanics live in `references/subagent-kit.md`; the
*optimization* discipline is:

- **Specify the deliverable and the evidence**, not the vibe. "Return a findings entry with
  `file:line` + the failing test output" beats "look into the bug."
- **Pass paths and symbol names, never file bodies.** Every byte you paste is context the
  subagent spends before it starts. Hand it `serena`/LSP entry points and let it pull what it
  needs.
- **Cut everything the agent can derive itself.** Its prompt is its entire system prompt; trim
  to GOAL · CONTEXT it can't derive · TOOLS · SUCCESS CRITERIA · OUT OF SCOPE · REPORT shape.
- **One job per agent.** Unscoped "fix everything" prompts produce wandering, expensive runs.
- **State the model and tool directives** (per the tier table and `capability-routing.md`) so
  the agent doesn't waste a turn deciding how to work.

For a genuinely ambiguous, high-stakes outbound prompt you can round-trip it through the same
local optimizer the hook uses — call it directly and fold the result into your dispatch spec:

```
ollama run prompt-optimizer:latest "draft the subagent spec for <job>"
# or the clean HTTP path the hook prefers:
#   POST http://127.0.0.1:11434/api/generate  {"model":"prompt-optimizer:latest","prompt":"…","stream":false}
```

Reserve this for prompts worth the latency (a whole audit's framing, a tricky migration spec).
For routine dispatches, the `subagent-kit.md` template is already the optimized shape.

## 3. When NOT to optimize

- Trivial or already-precise prompts — optimization adds latency and can bloat a clear ask.
- Slash commands — they expand into their own prompts downstream (the hook skips them).
- Anything where the user's exact wording is the point (a literal string, a quote, a name).
