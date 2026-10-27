---
title: Program Deliberately
category: Practice
chapter: 7
topic: 38
source: "Chapter 7, Topic 38 \"Programming by Coincidence\""
tips: [62]
aliases: ["deliberate programming", "programming with intent"]
related: [programming-by-coincidence, refactoring, stone-soup, boiled-frog, dry-dont-repeat-yourself, design-by-contract, shared-state, stay-safe-out-there]
---

# Program Deliberately

**In brief:** Always be aware of what you are doing and why, relying only on reliable things, so you create fewer errors and catch them earlier.

**Category:** Practice
**Source:** Chapter 7, Topic 38 "Programming by Coincidence"
**Also known as:** deliberate programming, programming with intent

## What it is
Program deliberately is the positive counterpart to programming by coincidence. Instead of letting things slowly get out of hand (like Fred, or the frog in slowly warming water), you stay in conscious control of what your code does and why it does it. The goal is to spend less time churning out code, catch and fix errors as early in the development cycle as possible, and create fewer errors to begin with.

## Why it matters
If you are not sure why something works, you will not know why it fails. Building an application you do not fully grasp, or using a technology you do not understand, means you will be bitten by coincidences. Deliberate programming keeps you off that path and keeps assumptions from silently conflicting between developers.

## In practice
The book gives a concrete checklist:

- Always be aware of what you are doing.
- Can you explain the code, in detail, to a more junior programmer? If not, you may be relying on coincidences.
- Don't code in the dark. If you are not sure why it works, you won't know why it fails.
- Proceed from a plan, whether in your head, on a napkin, or on a whiteboard.
- Rely only on reliable things. Don't depend on assumptions; if you can't tell whether something is reliable, assume the worst.
- Document your assumptions (Design by Contract helps clarify and communicate them).
- Don't just test your code, test your assumptions too. Write an assertion to test each assumption (see Assertive Programming). Don't guess, actually try it.
- Prioritize your effort. Spend time on the hard, important parts; brilliant bells and whistles are irrelevant if the fundamentals are wrong.
- Don't be a slave to history. Don't let existing code dictate future code; all code can be replaced, so be ready to refactor.

## Related tips
- Tip 62: "Don't Program by Coincidence"

## See also
- [programming-by-coincidence](programming-by-coincidence.md)
- [refactoring](refactoring.md)
- [stone-soup](stone-soup.md)
- [boiled-frog](boiled-frog.md)
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [design-by-contract](design-by-contract.md)
- [shared-state](shared-state.md)
- [stay-safe-out-there](stay-safe-out-there.md)

