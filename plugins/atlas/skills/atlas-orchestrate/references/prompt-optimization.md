# Prompt Optimization

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
  The user can set `ATLAS_OPTIMIZE=always` to optimize every prompt.
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
  subagent spends before it starts. Hand it `serena`/LSP entry points and let it pull what it
  needs.
- **Cut everything the agent can derive itself.** Its prompt is its entire system prompt; trim
  to GOAL - CONTEXT it can't derive - TOOLS - SUCCESS CRITERIA - OUT OF SCOPE - REPORT shape.
- **One job per agent.** Unscoped "fix everything" prompts produce wandering, expensive runs.
- **State the model and tool directives** (per the tier table and `capability-routing.md`) so
  the agent doesn't waste a turn deciding how to work.
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

---

## 4. Writing prompts for chat interfaces (user-facing rewriting)

The sections above cover the orchestrator's own automation. This section covers the
**prompt-optimizer** discipline: turning a rough user idea into a finished, copy-pasteable
prompt for any chat LLM. Use when the user asks to "rewrite this prompt", "make this a
better prompt", "optimize this prompt", or when they paste a draft and want improvements.

### Two hard rules

**Rule 1 -- No placeholders. Ever.**
Never produce a prompt containing `[paste X here]`, `{topic}`, `<your_input_here>`, or any
fill-in variable. The output must be pasteable as-is. If you catch yourself typing square
brackets around a noun, stop -- that is a placeholder.

**Rule 2 -- Ship a finished prompt no matter what.**

- **Case A -- user gave real content** (a draft, code, a document, specific numbers): bake
  that content directly into the optimized prompt. The whole thing goes in the code block.
- **Case B -- user described a class of task** ("I want a prompt to triage my emails"):
  write a complete self-contained instruction that either (a) tells the LLM to ask the user
  for the specific inputs it needs, or (b) ends so the user naturally provides input in the
  next turn. No brackets, no fill-in-the-blank.

### What to output

A single fenced code block containing the optimized prompt. No preamble. No trailing
explanation. End the prompt with a closing reasoning instruction:

```
Think before answering (maximum reasoning)
```

or for general-purpose models:

```
Take time to think through this carefully before responding.
```

### Rewrite workflow

Work through these before writing the prompt:
1. Identify the goal: what must the output be? (document, decision, code, list, analysis)
2. Identify audience and use: who reads it, what will they do with it?
3. Case A or Case B: did the user provide the actual content or just describe a task?
4. Spot the gaps: audience, format, length, constraints, examples, edge cases.
5. Handle gaps: make the best defensible assumption for non-essential details; for
   essential user-specific inputs, instruct the LLM to ask (Case B).
6. Pick structure: single paragraph for simple tasks; XML tags when sections multiply.
7. Write the prompt. Apply the principles below.
8. End with the closing reasoning line.
9. Scan for brackets: kill any `[`, `{`, or `<...your...>`-style placeholder.

### Core principles

- **Be clear and direct.** State the task explicitly. Specify output format and hard
  constraints upfront. "Go beyond the basics for a fully-featured implementation" lands
  better than a vague brief.
- **Explain the why.** "Avoid ellipses, because the output will be read aloud by TTS" is
  followed more faithfully than "Never use ellipses."
- **Positive framing.** "Write in flowing prose paragraphs" beats "don't use bullet points."
- **Match prompt style to desired output style.** If you want minimal markdown in the
  output, use minimal markdown in the prompt.
- **XML tags when sections multiply.** `<instructions>`, `<context>`, `<examples>`,
  `<input>`. Skip it for simple one-shot prompts.
- **Role when it sharpens behavior.** A one-line role assignment tightens tone. Don't force
  one onto every prompt.
- **Examples for format or tone.** 2-4 examples in `<example>` tags beat description for
  steering format. Skip when examples would over-constrain.
- **Long inputs on top, question on the bottom.** Up to ~30% quality lift for long-context
  tasks from this ordering.
- **Trigger deeper reasoning deliberately.** The closing line does this -- do not add
  competing thinking instructions earlier.
- **Self-check for high-stakes outputs.** "Before you finish, re-read your answer and check
  it against the criteria above" catches errors reliably.

### Why these principles work

Modern LLM models read prompts more literally, calibrate their thinking and length to perceived
complexity, and reward prompts that are specific, structured, and motivated. Each rule has a
reason. Treat the reasons as the point -- apply them with judgment, not mechanically.

### Domain-specific moves

Apply only when relevant to the task type.

**Frontend / design.** LLM models may have ingrained stylistic defaults. Either (a) specify a
concrete alternative palette, type system, and structure in detail, or (b) instruct the model to
propose 3-4 distinct visual directions before building so the user picks one. Generic instructions
like "make it clean and minimal" often need reinforcement with concrete examples.

**Code review.** Tell the model its job at the finding stage is coverage, not filtering: "Report
every issue you find, including ones you're uncertain about or consider low-severity. Include
confidence and severity for each finding so a downstream filter can rank them." Avoid "only flag
important issues" -- LLM models over-filter without explicit permission.

**Research / analysis.** Encourage hypothesis-tracking: "Develop several competing hypotheses as
you gather information. Track confidence levels in your notes. Self-critique your approach
periodically." Produces more rigorous synthesis than a flat "research X" prompt.

**Creative writing.** Specify voice, audience, length, constraints, and provide one or two example
sentences in the target voice. Generic "write a blog post" yields generic prose.

**Document creation (slides, reports).** Ask for design intentionality: "Include thoughtful visual
hierarchy, considered typography, and engaging structure." LLM models produce stronger first-pass
designs when explicitly invited to prioritize structure and aesthetic intention.

### Examples

These show the no-placeholder rule in action. None contain `[paste X here]` or any template
variable.

**Example 1 -- Case B, user described a task class (no content given)**

User: "I want a prompt to summarize my emails"

Output:
```
You are an executive assistant helping me triage email. I'm about to share a batch of emails
with you in my next message.

For each email, produce:
- **Sender + subject** in one line
- **Summary** -- 1-2 sentences, neutral tone, no fluff
- **Action required** -- one of: reply needed, FYI only, schedule, delegate, ignore
- **Priority** -- high / medium / low, based on sender importance and urgency cues

Group into three sections: high priority, medium priority, low priority. Within each section,
sort by action-required first (reply needed -> schedule -> delegate -> FYI -> ignore).

Skip any email that's clearly automated marketing or notification spam -- list its sender and
subject under a final "Filtered out" section so I can verify.

When you're ready, ask me to paste the emails.

Think before answering (take time to reason through this carefully).
```

The prompt ends by inviting the user to paste content in the next turn. No `[paste emails here]`
block. The user sends this as-is.

**Example 2 -- Case B, rough draft with no product details**

User: "can you fix this prompt: 'write a linkedin post about my new product launch, make it
engaging and not too salesy'"

Output:
```
You are writing a LinkedIn post for me announcing a product launch. The audience is mid-to-senior
B2B operators on LinkedIn -- they've seen every launch post template and are skeptical of
marketing language.

Before you draft, ask me for:
- The product's name
- What it does, in plain language
- Who it's for
- The 1-2 reasons I built it that aren't obvious from the description
- A link or destination for the call to action

Once I've answered, write one post that:
- Opens with a concrete hook in the first 2 lines (a tension, a number, or an unexpected
  observation -- not "I'm excited to announce").
- Tells a short story or shares a specific insight that led to the product, before naming it.
- Names what the product does in one plain sentence. No adjectives like "revolutionary",
  "game-changing", or "powerful".
- Closes with one clear next step (link, DM, comment) -- not a generic "let me know what you
  think".
- Sits between 150 and 220 words. Short paragraphs, one idea per line break. No emojis. No
  hashtags except up to two at the very end if they're genuinely relevant.

Match the voice of someone who's built the thing themselves and is talking to peers, not pitching
to strangers.

Think before answering (take time to reason through this carefully).
```

**Example 3 -- Case B, technical task with no code given**

User: "I need an LLM model to review my python code for bugs"

Output:
```
You're going to review Python code I share with you. Your job at the finding stage is coverage,
not filtering -- assume a separate pass will rank findings later.

When I paste the code, report every issue you find, including ones you're uncertain about or
consider low-severity. For each finding, include:
- **Location** -- file and line number(s)
- **Issue** -- what's wrong, in one sentence
- **Why it matters** -- the concrete failure mode (incorrect output, crash, security risk, etc.)
- **Confidence** -- high / medium / low
- **Severity** -- high / medium / low
- **Suggested fix** -- a minimal change that addresses the issue

Cover at minimum: logic errors, off-by-one and boundary issues, mutable default arguments,
exception handling gaps, race conditions, resource leaks, input validation at trust boundaries,
and any deviation from the code's apparent intent.

After listing findings, end with a single-paragraph overall assessment and the top 3
highest-severity issues to fix first.

Ask me to paste the code when you're ready.

Think before answering (take time to reason through this carefully).
```

**Example 4 -- Case A, real content provided**

User pastes a paragraph about two job offers with specific numbers and asks to rewrite it.

Bake all the numbers and constraints directly into the prompt. No `[insert offer details]` block.
Structure the data clearly (e.g., Offer A / Offer B sections), list the user's stated priorities
in order, then ask for analysis of total comp, priority scoring, non-obvious risks, and a direct
recommendation.

**Example 5 -- simple task**

User: "write me a haiku about coffee"

Output:
```
Write a haiku about coffee. Follow the traditional 5-7-5 syllable structure. Aim for a single
concrete image rather than a general statement -- something a reader could picture. Avoid cliches
like "morning steam" and "liquid gold".

Think before answering (take time to reason through this carefully).
```

Simple tasks don't get XML tags, a role, or sectioning. Apply structure proportional to the task.

### Edge cases

- User pastes a prompt and asks "is this good?" -- treat as a rewrite request; return the
  optimized version in a code block, no commentary.
- User gives a system/API-style prompt: strip API-only mechanics (effort levels, tool definitions),
  translate intent to a single user-message prompt for chat, add the closing line.
- User's input is already excellent: tighten where possible, add the closing line, return it.
- Non-English input: write the optimized prompt in the same language.
- Tempted to write a `<context>` or `<input>` block for the user to fill: don't. That is Rule 1.
  Either bake the actual content in (Case A) or tell the LLM to ask the user for it (Case B).
