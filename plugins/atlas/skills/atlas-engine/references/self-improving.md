# Self-Improving Agent Memory

Sourced from the self-improving skill (v1.2.16). Self-reflection, self-criticism, and
self-organizing memory. The agent evaluates its own work, catches mistakes, and improves
permanently across sessions.

## When to Load This Reference

- A command, tool, API, or operation fails and the failure pattern should be remembered.
- The user corrects the agent or rejects its work.
- The agent realizes its knowledge is outdated or incorrect.
- The agent discovers a better approach worth persisting.
- The user explicitly installs or references the self-improving skill.

## Architecture

Memory lives in `~/self-improving/` with a tiered structure. If that directory does not
exist, run the setup workflow first.

```
~/self-improving/
  memory.md           HOT: <=100 lines, always loaded
  index.md            Topic index with line counts
  heartbeat-state.md  Last run, reviewed change, action notes
  projects/           Per-project learnings
  domains/            Domain-specific (code, writing, comms)
  archive/            COLD: decayed patterns
  corrections.md      Last 50 corrections log
```

## Tiered Storage

| Tier | Location | Size Limit | Behavior |
|---|---|---|---|
| HOT | memory.md | <=100 lines | Always loaded |
| WARM | projects/, domains/ | <=200 lines each | Load on context match |
| COLD | archive/ | Unlimited | Load on explicit query |

Promotion/demotion:
- Pattern used 3x in 7 days -> promote to HOT
- Pattern unused 30 days -> demote to WARM
- Pattern unused 90 days -> archive to COLD
- Never delete without asking

## Learning Signals

Log automatically when these patterns occur:

**Corrections** (add to `corrections.md`, evaluate for `memory.md`):
- "No, that's not right..." / "Actually, it should be..." / "You're wrong about..."
- "I prefer X, not Y" / "Remember that I always..." / "Stop doing X"

**Preference signals** (add to `memory.md` if explicit):
- "I like when you..." / "Always do X for me" / "My style is..."

**Pattern candidates** (track, promote after 3x):
- Same instruction repeated 3+ times
- Workflow that works well repeatedly
- User praises specific approach

**Ignore** (do not log):
- One-time instructions ("do X now")
- Context-specific ("in this file...")
- Hypotheticals ("what if...")

## Self-Reflection Workflow

After completing significant work:
1. Did it meet expectations? Compare outcome vs. intent.
2. What could be better? Identify improvements for next time.
3. Is this a pattern? If yes, log to `corrections.md`.

Log format:
```
CONTEXT: [type of task]
REFLECTION: [what I noticed]
LESSON: [what to do differently]
```

Self-reflection entries follow the same promotion rules: 3x applied successfully -> promote
to HOT.

## Memory Namespace Rules

- Project patterns stay in `projects/{name}.md`
- Global preferences in HOT tier (memory.md)
- Domain patterns (code, writing) in `domains/`
- Cross-namespace inheritance: global -> domain -> project
- Most specific wins (project > domain > global)

## Transparency

Every action drawn from memory must cite its source:
"Using X (from projects/foo.md:12)"

## Common Traps

| Trap | Why It Fails | Better Move |
|---|---|---|
| Learning from silence | Creates false rules | Wait for explicit correction or repeated evidence |
| Promoting too fast | Pollutes HOT memory | Keep new lessons tentative until repeated |
| Reading every namespace | Wastes context | Load only HOT plus the smallest matching files |
| Compaction by deletion | Loses trust and history | Merge, summarize, or demote instead |

## Scope Boundaries

This skill ONLY:
- Learns from user corrections and self-reflection
- Stores preferences in local files (`~/self-improving/`)
- Reads its own memory files on activation

This skill NEVER:
- Accesses calendar, email, or contacts
- Makes network requests
- Reads files outside `~/self-improving/`
- Infers preferences from silence or observation
- Modifies its own SKILL.md
