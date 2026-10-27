---
title: Programming by Coincidence
category: Anti-pattern
chapter: 7
topic: 38
source: "Chapter 7, Topic 38 \"Programming by Coincidence\""
tips: [62]
aliases: ["relying on luck", "accidental success", "cargo cult code"]
related: [program-deliberately, stay-safe-out-there, test-to-code, stone-soup, boiled-frog, dry-dont-repeat-yourself, design-by-contract, shared-state]
---

# Programming by Coincidence

**In brief:** Relying on code that seems to work without understanding why, so that it succeeds by luck rather than by design.

**Category:** Anti-pattern
**Source:** Chapter 7, Topic 38 "Programming by Coincidence"
**Also known as:** relying on luck, accidental success, cargo cult code

## What it is
Like the soldier in an old war movie who crosses a field with no mine explosions and concludes it is safe, only to be blown up, developers work in minefields. Fred types some code, it seems to work, he types more, it seems to work, and weeks later it suddenly breaks and he cannot fix it. He cannot fix it because he never knew why it worked in the first place. The limited "testing" that made it look correct was just a coincidence.

The book names several traps. Accidents of implementation: relying on undocumented error or boundary conditions, or calling routines in the wrong order (the paint/invalidate/repaint pile-up), so the code breaks when the library is fixed or the environment changes. Close enough isn't: patching an off-by-one with scattered +1 and -1 statements instead of fixing the underlying model (the whole time-zone project was eventually scrapped). Phantom patterns: seeing causes where there is only coincidence, like intermittent log errors or tests that pass on your machine but not the server.

Accidents of context are the same trap at a wider scope: relying on a GUI being present, English-speaking users, a writable current directory, certain environment variables, or network speed that is not guaranteed. Copying the first answer from the net without checking your context matches is building cargo cult code, imitating form without content.

## Why it matters
Code that works by coincidence may not really be working, may break on the next library release, on different hardware, or under different context. Extra spurious calls make code slower and add risk of new bugs. Finding an answer that happens to fit is not the same as the right answer, and false confidence charges you ahead into oblivion.

## In practice
For code others call, use good modularization, hide implementation behind small well-documented interfaces, and specify a contract (see Design by Contract). For routines you call, rely only on documented behavior; if you cannot, document your assumption well. Assumptions that are not based on well-established facts are the bane of all projects, so surface and test them. Do not assume it, prove it. When something seems to work but you do not know why, make sure it is not just a coincidence.

## Related tips
- Tip 62: "Don't Program by Coincidence"

## See also
- [program-deliberately](program-deliberately.md)
- [stay-safe-out-there](stay-safe-out-there.md)
- [test-to-code](test-to-code.md)
- [stone-soup](stone-soup.md)
- [boiled-frog](boiled-frog.md)
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [design-by-contract](design-by-contract.md)
- [shared-state](shared-state.md)

