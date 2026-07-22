---
title: Good-Enough Software
category: Principle
chapter: 1
topic: 5
source: "Chapter 1, Topic 5 \"Good-Enough Software\""
tips: [8]
aliases: [Make Quality a Requirements Issue, Know When to Stop]
related: [broken-windows, knowledge-portfolio, requirements-pit, solving-impossible-puzzles]
---

# Good-Enough Software

**In brief:** Deliberately write software that is good enough for your users, its maintainers, and your own peace of mind, and let users help decide when that point is reached.

**Category:** Principle
**Source:** Chapter 1, Topic 5 "Good-Enough Software"
**Also known as:** Make Quality a Requirements Issue, Know When to Stop

## What it is
The real world will not let us produce much that is truly perfect, least of all bug-free software. Time, technology, and temperament all conspire against us. Rather than treat that as frustrating, you can discipline yourself to write software that is good enough: good enough for your users, for future maintainers, and for your own peace of mind. The authors credit Ed Yourdon's IEEE Software article "When good-enough software is best." The payoff is that you become more productive, your users are happier, and the programs are often better for their shorter incubation.

This carries a firm qualification. "Good enough" does not mean sloppy or poorly produced. All systems must meet their users' requirements and satisfy basic performance, privacy, and security standards. The argument is only that users should get a say in deciding when what you have produced is good enough for their needs.

The scope and quality of the system should therefore be discussed as part of that system's requirements, not decided unilaterally by the developer polishing in isolation.

## Why it matters
Quality that is not negotiated with users is quality guessed at. Surprisingly, many users would rather use software with some rough edges today than wait a year for a bells-and-whistles version, and what they need a year from now may be different anyway. Great software today is often preferable to the fantasy of perfect software tomorrow, and shipping early gives you feedback that leads to a better eventual solution.

Both extremes are unprofessional: ignoring real delivery, cash-flow, and marketing constraints just to add features or polish the code one more time, and equally, promising impossible timescales or cutting basic engineering corners to hit a deadline. The point is a conscious trade-off, not panic and not perfectionism.

## In practice
- Ask users not just what they want, but how good they want it to be. Involve them in the trade-off.
- Recognize when stringent requirements apply. Pacemakers, autopilots, and widely disseminated low-level libraries leave fewer options; a brand-new product has different constraints.
- Know when to stop. Like a painter who ruins the work by adding layer upon layer, do not spoil a good program by overembellishment and overrefinement. Let your code stand on its own for a while.
- Accept that it could never be perfect, and move on.

## Related tips
- Tip 8: "Make Quality a Requirements Issue"

## See also
- [broken-windows](broken-windows.md)
- [knowledge-portfolio](knowledge-portfolio.md)
- [requirements-pit](requirements-pit.md)
- [solving-impossible-puzzles](solving-impossible-puzzles.md)

