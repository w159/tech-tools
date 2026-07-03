---
description: Interactive skill-stacking - asks what you want to accomplish, then composes and runs the best ordered combination of the skills installed this session.
argument-hint: "[optional: rough goal]"
---

# /atlas-stacks

Invoke the `atlas-stacks` skill now via the Skill tool and follow it exactly.

Pass along the user's rough goal if one was given:

> $ARGUMENTS

The skill will elicit what is missing with AskUserQuestion (one round), inventory the
skills actually available in this session, propose an ordered stack for confirmation,
and execute it stage by stage with atlas verification riding along.
