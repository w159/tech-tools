---
title: Broken Windows
category: Practice
chapter: 1
topic: 3
source: "Chapter 1, Topic 3 \"Software Entropy\""
tips: [5]
aliases: [Broken Window Theory, "Don't Live with Broken Windows", No Broken Windows]
related: [software-entropy, good-enough-software, orthogonality, refactoring, naming-things]
---

# Broken Windows

**In brief:** Don't leave bad designs, wrong decisions, or poor code unrepaired, because one visible sign of neglect invites more and starts a system's decline.

**Category:** Practice
**Source:** Chapter 1, Topic 3 "Software Entropy"
**Also known as:** Broken Window Theory, Don't Live with Broken Windows, No Broken Windows

## What it is
In inner cities, some buildings stay beautiful and clean while others become rotting hulks. Researchers into crime and urban decay found a trigger: a single broken window. One broken window, left unrepaired for any length of time, instills in a building's inhabitants a sense of abandonment, a sense that the powers that be do not care. So another window gets broken. People start littering. Graffiti appears. Serious structural damage begins, and the sense of abandonment becomes reality.

The authors map this directly onto software. A broken window is a bad design, a wrong decision, or a piece of poor code. Leave it in place and it signals that nobody cares, which makes the next mess easier to justify: "All the rest of this code is crap, I'll just follow suit." In the original abandoned-car experiment, a car sat untouched for a week, but once a single window was broken it was stripped and flipped within hours.

The opposite also holds. On a project where the code is pristine, cleanly written and elegant, people take extra care not to be the first to make a mess, just like firefighters who rolled out a mat to protect a rich man's carpet even while his house was on fire.

## Why it matters
Neglect accelerates software rot faster than any other single factor. Because hopelessness is contagious, one unrepaired defect can shift a whole team's mindset from "we keep this clean" to "it's already a mess, why bother." Catching the first broken window is the cheapest possible intervention; letting it sit is how clean, functional systems deteriorate.

## In practice
- Fix each broken window as soon as it is discovered.
- If there is not enough time to fix it properly, board it up: comment out the offending code, display a "Not Implemented" message, or substitute dummy data. Take some visible action to prevent further damage and show you are on top of the situation.
- Do not cause collateral damage just because there is a crisis. Even under a deadline, do not be the one who inflicts additional damage. One broken window is one too many.
- Just tell yourself, "No broken windows."

## Related tips
- Tip 5: "Don't Live with Broken Windows"

## See also
- [software-entropy](software-entropy.md)
- [good-enough-software](good-enough-software.md)
- [orthogonality](orthogonality.md)
- [refactoring](refactoring.md)
- [naming-things](naming-things.md)

