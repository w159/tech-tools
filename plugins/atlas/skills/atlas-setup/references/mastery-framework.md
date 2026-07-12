# Skills Mastery Framework

The standard every atlas skill follows. This is the Claude Code Skills
Mastery Framework: progressive disclosure, strict frontmatter, and
deterministic operations. Every atlas skill is built against this
standard so the harness can load, route, and invoke them predictably.

## Progressive disclosure (three levels)

A skill is not one file. It is three layers, loaded in order of need.

### L1 - metadata (always loaded, ~100 tokens per skill)

The harness loads every installed skill's frontmatter at session start so
it can route. This budget is tiny on purpose: the whole atlas fleet (183
skills) costs roughly 18k tokens just to have available. Keep `name` and
`description` short and trigger-rich.

L1 contains exactly:
- `name` - the skill's directory name and invocation key
- `description` - what the skill does and when to use it (the only signal
  the model uses to decide whether to auto-trigger)

That is it. Nothing else is loaded for routing. If a skill needs a field
to be visible at L1, that field must be baked into `description`.

### L2 - SKILL.md body (loaded on trigger, <5k tokens)

When a skill is triggered, the harness loads the SKILL.md body. This is
the operating manual the model follows. The hard limit is 500 lines (a
proxy for the 5k-token budget). Anything longer must be pushed to L3.

L2 must contain:
- What the skill does, in enough detail to act on
- The first move (the literal first step)
- References to L3 files for detail it cannot fit

L2 must NOT contain:
- Full reference tables that belong in L3
- Long examples or templates (those live in templates/)
- Prose that repeats what `description` already said

### L3 - bundled files (loaded on demand, no budget)

Files in `references/`, `scripts/`, and `templates/` are loaded only when
L2 explicitly directs the model to read them. There is no token budget at
L3 because nothing is loaded until it is named. This is where the bulk of
the knowledge lives.

Rules for L3:
- References are ONE level deep. A reference file must not require another
  reference to be understood. No reference chains.
- A reference file should stay under 400 lines.
- Scripts are deterministic operations, not prose. They run under a stock
  Python 3 interpreter with no external deps.
- templates/ holds generated artifacts and seed files.

## Frontmatter fields

Every atlas skill declares its contract in YAML frontmatter. Use each
field for its designed purpose only.

### Required on every skill

| Field | Purpose |
|---|---|
| `name` | The skill's directory name and slash-command key. Must match the directory. |
| `description` | What the skill does and when to use it, third-person. This is the ONLY signal the model uses to auto-trigger. Keep it under 1024 chars. Lead with the key use case. |

### Trigger control

| Field | Purpose |
|---|---|
| `when_to_use` | A short phrase restating the trigger conditions. Reinforces `description` for the routing engine. |
| `disable-model-invocation` | `true` means the model CANNOT auto-trigger this skill. The user must invoke it explicitly. Use for manual-only skills. |
| `user-invocable` | `true` means the user can invoke this skill as a slash command. Default is true; set to `false` only for skills that must only be called by other skills, never directly. |

### Argument surface

| Field | Purpose |
|---|---|
| `argument-hint` | A short string shown in the UI hint when the user types the command. Example: `[--fix to auto-repair] [plugin name, default atlas]`. |
| `arguments` | A structured argument schema (JSON schema) for typed arguments. Use only when the skill takes complex args; omit for no-arg or free-text skills. |

### Tool pre-approval

| Field | Purpose |
|---|---|
| `allowed-tools` | A comma-separated list of tools the skill may use without prompting the user for permission. Pre-approve only the safe, scoped tools the skill actually needs. Example: `Read, Glob, Grep, Bash(scaffold_docs.py:*)`. |

### Isolation and delegation

| Field | Purpose |
|---|---|
| `paths` | Restricts the skill's file access to specific paths. Use when a skill should only read or write inside a specific subtree. |
| `context:fork` | `true` runs the skill in a forked context so its tool output does not pollute the parent context. Use for skills that do heavy exploration. |
| `agent` | Delegates the skill body to a named subagent instead of running inline. Use when the skill is a thin wrapper around a subagent. |

## What is NOT a field: `triggers:`

`triggers:` is NOT a real Claude Code frontmatter field. It does nothing.
The harness ignores it. Do not use it. Auto-trigger behavior comes ONLY
from the combination of `description` and `when_to_use`. If you want a
skill to auto-trigger on a phrase, put that phrase in `description`.

This is a common mistake: a skill author adds a `triggers:` list, assumes
it works, and the skill never auto-triggers because the harness never
read the field. The fix is always to move the trigger language into
`description`.

## SKILL.md limits

- Hard limit: 500 lines.
- Token budget: <5k tokens for the body.
- If you cannot fit the operating manual in 500 lines, the detail belongs
  in a reference file (L3), not in SKILL.md.
- One blank line after frontmatter. No decorative banners.

## Deterministic operations: scripts/

Anything that can be computed deterministically (scaffolding, validation,
file generation, diff checks) is a script, not prose. Scripts live in
`scripts/` and are invoked with `${CLAUDE_SKILL_DIR}` so they run
correctly regardless of the current working directory:

    python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <root>

Rules for scripts:
- Stdlib only. No external deps. A skill must run under a stock
  interpreter.
- Idempotent. Running twice must not duplicate or corrupt state.
- Fail loud. A script that cannot do its job prints the reason and exits
  non-zero. No silent partial success.
- Comment the why, not the what.

## Generated artifacts: templates/

Files the skill creates at runtime (scaffolds, seed files, skeletons) live
in `templates/` and are copied, not generated inline. This keeps the
artifact versioned in the repo and reviewable.

## The mastery checklist

Before declaring an atlas skill done, verify:

1. Frontmatter has `name` and `description` only among required fields.
2. `description` leads with the key use case and stays under 1024 chars.
3. No `triggers:` field anywhere in the frontmatter.
4. SKILL.md body is under 500 lines.
5. Every reference file is one level deep (no reference chains).
6. Every deterministic operation is a script in `scripts/`.
7. Every generated artifact has a seed in `templates/`.
8. `allowed-tools` pre-approves only the tools the skill actually needs.
9. Manual skills set `disable-model-invocation: true`.
10. The skill does one thing. If it does two, split it.