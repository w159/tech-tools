---
title: Refactoring
category: Practice
chapter: 7
topic: 40
source: "Chapter 7, Topic 40 \"Refactoring\""
tips: [65]
aliases: ["restructuring"]
related: [naming-things, test-to-code, program-deliberately, software-entropy, dry-dont-repeat-yourself, tracer-bullets, dont-outrun-your-headlights, essence-of-agility]
---

# Refactoring

**In brief:** A disciplined technique for restructuring an existing body of code, altering its internal structure without changing its external behavior.

**Category:** Practice
**Source:** Chapter 7, Topic 40 "Refactoring"
**Also known as:** restructuring (refactoring is a disciplined subset of it)

## What it is
Code is not a static thing; it needs to evolve. The book rejects the building-construction metaphor (blueprints, foundation, tenants move in) in favor of gardening: you plant according to an initial plan, some things thrive and others become compost, you move, split, prune, weed, and fertilize, constantly monitoring the garden's health and adjusting.

Refactoring, as Martin Fowler defines it, is a disciplined technique for restructuring an existing body of code, altering its internal structure without changing its external behavior. The two critical parts of the definition: the activity is disciplined, not a free-for-all, and external behavior does not change, so this is not the time to add features. It is a day-to-day activity of low-risk small steps, more like weeding and raking than plowing under the whole garden.

## Why it matters
You refactor when you have learned something, when you understand the problem better than you did before. Triggers include duplication (a DRY violation), nonorthogonal design, outdated knowledge as requirements drift, changed usage, performance needs, and even the tests passing (a good moment to tidy what you just wrote).

Refactoring is really pain management. Time pressure is the usual excuse for skipping it, but that excuse does not hold up: fail to refactor now and the fix costs far more later, when there are more dependencies. Think of code that needs refactoring as a growth: remove it while small, or wait while it grows and spreads and the surgery becomes more expensive and dangerous. Collateral damage in code is just as deadly over time (Software Entropy); do not live with broken windows.

## In practice
Fowler's rules for refactoring without doing more harm than good:

1. Don't try to refactor and add functionality at the same time.
2. Make sure you have good tests before you begin, and run them as often as possible so you know quickly if you broke anything.
3. Take short, deliberate steps: move a field, split a method, rename a variable. Test after each step to avoid prolonged debugging.

Good automated unit tests are the key to refactoring safely; they guarantee external behavior has not changed. Automatic refactoring in modern IDEs can rename variables and methods and split routines while propagating changes. If you must change external behavior or interfaces, it can help to deliberately break the build so old clients fail to compile and you know what needs updating. Do not attempt a full week-long rewrite under the banner of refactoring; if that level of disruption is needed, schedule it and warn affected users.

## Related tips
- Tip 65: "Refactor Early, Refactor Often"

## See also
- [naming-things](naming-things.md)
- [test-to-code](test-to-code.md)
- [program-deliberately](program-deliberately.md)
- [software-entropy](software-entropy.md)
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [tracer-bullets](tracer-bullets.md)
- [dont-outrun-your-headlights](dont-outrun-your-headlights.md)
- [essence-of-agility](essence-of-agility.md)

