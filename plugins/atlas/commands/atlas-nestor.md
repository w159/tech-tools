---
description: "Dispatch the atlas-nestor skill: interactive skill-stacking that composes and runs the best ordered combination of skills installed this session."
argument-hint: "[optional: rough goal]"
---

# /atlas-nestor

Invoke the `atlas-nestor` skill now via the Skill tool and follow it exactly.

Pass along the user's rough goal if one was given:

> $ARGUMENTS

The skill will elicit what is missing with AskUserQuestion (one round), inventory the
skills actually available in this session, propose an ordered stack for confirmation,
and execute it stage by stage with atlas verification riding along.
