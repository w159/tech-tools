---
title: Conway's Law
category: Principle
chapter: 8
topic: 47
source: "Chapter 8, Topic 47 \"Working Together\""
tips: []
related: [working-together]
---

# Conway's Law

**In brief:** The communication structures of an organization end up mirrored in the systems it designs.

**Category:** Principle
**Source:** Chapter 8, Topic 47 "Working Together"
**Also known as:** none

## What it is
In 1967 Melvin Conway introduced, in "How do Committees Invent?", the idea that became known as Conway's Law: organizations which design systems are constrained to produce designs that copy the communication structures of those organizations.

In other words, the social structures and communication pathways of a team and its organization are reflected in the application, website, or product it builds. The book cites first-hand examples: teams where no one talks to each other produce siloed, "stove-pipe" systems, and teams split into two produce a client/server or frontend/backend division.

Studies also support the reverse principle: you can deliberately structure your team the way you want your code to look. Geographically distributed teams, for instance, tend toward more modular, distributed software. Most importantly, teams that include users produce software reflecting that involvement, and teams that do not reflect that too.

## Why it matters
If your architecture will inevitably mirror your org chart, then team structure is a design decision. Ignore Conway's Law and you get accidental architecture: silos and arbitrary splits that match communication gaps rather than the problem. Use it deliberately and you can shape both team and code toward the structure you actually want, including building user involvement into the software by putting users on the team.

## In practice
- Expect the system to mirror your team's communication paths; check whether that is the shape you want.
- Structure the team to reflect the architecture you are aiming for.
- Include users on development teams so their involvement shows up in the software.

## Related tips
- none

## See also
- [working-together](working-together.md)
