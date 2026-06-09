# Committed memory format

Memory lives at `<repo>/.agents/memory/`, **committed** so it travels to everyone who
clones the repo. One durable fact per file; a one-line index in `MEMORY.md` that the
SessionStart hook loads automatically.

## What is worth remembering

Save a fact when it is **durable and non-obvious** — something the code/git history does
NOT already make plain, that the next agent would otherwise rediscover the hard way:

- a decision and *why* (why this lib, why this pattern, why we rejected the obvious approach)
- a gotcha / footgun (this looks wrong but is intentional because Y)
- a constraint not visible in code (an external contract, a deploy quirk, a data shape)
- a correction (we tried X, it broke Z — don't)

Do **not** save: what the code already shows, restating the README, one-off conversational
context, or anything that will be stale next week. If unsure, it's probably not memory —
it might be `knowledge/` (how the repo works) instead.

## File format

`.agents/memory/<short-kebab-slug>.md`:

```markdown
---
name: <short-kebab-slug>
description: <one-line summary — used to judge relevance on recall>
type: decision | gotcha | constraint | correction
date: <YYYY-MM-DD>            # absolute, never "last week"
---

<The fact, stated plainly. For decision/correction add:>
**Why:** <the reason it matters>
**How to apply:** <what the next agent should do with this>

<Link related facts with [[other-slug]] and cite code as path/to/file.ext:line.>
```

## The index

`MEMORY.md` is the loaded-every-session surface — keep it to **one line per fact**:

```markdown
# Memory

- [<slug>](<slug>.md) — <hook: the fact in a few words>
```

Rules:
- Add the pointer line the moment you create a fact file.
- Before adding, scan for an existing file that already covers it — **update that one**
  instead of duplicating.
- Delete facts that turn out wrong; a confidently-wrong memory is worse than none.
- A recalled fact reflects what was true when written — if it names a file/function/flag,
  verify it still exists before acting on it.

This mirrors the user-level `~/.claude/.../memory/MEMORY.md` convention, but per-repo and
committed — so it is shared knowledge, not one machine's private store.
