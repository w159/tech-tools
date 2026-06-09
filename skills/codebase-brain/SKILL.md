---
name: codebase-brain
description: Give any codebase a committed, agent-agnostic "brain" — knowledge of how it works, memory that persists across sessions, and a self-validation gate. Use when onboarding/priming a codebase, when starting work in an unfamiliar repo, when asked how a codebase works or to explain it to a newcomer, when you learn something worth remembering, or before claiming work is done. Works across Claude Code, Codex, and Copilot because it anchors on AGENTS.md + a committed .agents/ directory.
---

# Codebase Brain

Coding agents forget everything between sessions, claim work is done without checking,
and rediscover the same architecture every time. This skill fixes that by giving a repo
a **committed brain** that travels with the code — so the next agent (or the next
engineer's agent) inherits what was learned, and so an agent can warn *before* it breaks
something or goes the wrong direction.

Everything is plain files anchored on **`AGENTS.md`** (read by Claude, Codex, and Copilot
alike) plus a committed **`.agents/`** directory. No database, no per-agent lock-in.

## The brain layout (in the TARGET repo, committed)

```
<repo>/
  AGENTS.md                      # entry point: what this is + pointer to .agents/
  .agents/
    knowledge/
      invariants.md              # "DO NOT break X" — load-bearing rules, gotchas, "intentionally weird because Y"
      architecture.md            # the shape: layers/features, data flow, key modules
      structure.md               # layout, entry points, where things live
      conventions.md             # naming, error handling, patterns to follow ("follow src/api/users.ts")
      stack.md                   # languages, frameworks, runtime, datastore
      integrations.md            # external services, auth, webhooks
      testing.md                 # how to run tests, where they live, coverage bar
      concerns.md                # known issues, TODOs, scaling/security notes
    memory/
      MEMORY.md                  # ONE-LINE-PER-FACT index (loaded at session start)
      <slug>.md                  # one durable fact per file (decision / gotcha / why)
```

Not every file is required — create what the repo warrants. `invariants.md` and
`memory/MEMORY.md` are the highest-value two and are injected at session start by the hook.

## Three things this skill does

### 1. Onboard a codebase (knowledge)
When asked to prime/onboard a repo, or when you've explored enough to know how it works,
write the `knowledge/` files. → **references/onboarding.md** for the procedure and what
each file must contain. The point: the *next* agent reads these first and can answer
"how does X work?" and push back on changes that fight the architecture.

### 2. Remember across sessions (memory)
When you make a non-obvious decision, hit a gotcha, or learn *why* something is the way it
is — record it as one fact. → **references/memory-format.md** for the exact format. The
SessionStart hook surfaces the `MEMORY.md` index automatically next time. Memory is
**committed**, so it is shared, not trapped in one machine's local MCP store.

### 3. Validate before claiming done (self-check)
Before you say "fixed / done / it works," show evidence. → **references/self-validation.md**
for the gate. The Stop hook enforces the floor: a bare completion claim with no command
output, test result, or file:line gets bounced once with a checklist.

## Automation (hooks)

Two stdlib hooks make 1–3 automatic. They are **fail-safe** (never block work, silent on
un-onboarded repos) and installed via a gated, idempotent, backup-first installer —
identical contract to the orchestrate skill.

| id   | event        | script             | does |
|------|--------------|--------------------|------|
| load | SessionStart | `hooks/load_brain.py`   | injects `invariants.md` + the `MEMORY.md` index + knowledge file list, from `./.agents/` |
| gate | Stop         | `hooks/validate_gate.py`| blocks an unverified completion claim once, asks for evidence |

Install (gated — show the user the dry-run first):
```
python3 skills/codebase-brain/scripts/install_hooks.py            # dry-run plan
python3 skills/codebase-brain/scripts/install_hooks.py --apply    # install both (backs up settings first)
python3 skills/codebase-brain/scripts/install_hooks.py --list     # coverage
```
Env switches: `CODEBASE_BRAIN_LOAD=off` disables the loader, `CODEBASE_BRAIN_GATE=off`
disables the gate.

## Cross-agent portability

The skill is registered in `registry/active.json`, so `scripts/agent_assets.py --build
--install` propagates it to `~/.claude`, `~/.codex`, and `~/.copilot`. The brain it writes
is just `AGENTS.md` + `.agents/` — already the shared contract all three agents read. Clone
the repo on any machine with any of the three agents and the brain is there.
