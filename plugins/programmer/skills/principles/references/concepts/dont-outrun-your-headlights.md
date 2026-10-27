---
title: Don't Outrun Your Headlights
category: Principle
chapter: 4
topic: 27
source: "Chapter 4, Topic 27 \"Don't Outrun Your Headlights\""
tips: [42, 43]
related: [design-by-contract, tracer-bullets, prototypes, refactoring, test-to-code, essence-of-agility, coconuts-dont-cut-it]
---

# Don't Outrun Your Headlights

**In brief:** Take small, deliberate steps guided by real feedback, and never commit to a step so large that it depends on fortune telling.

**Category:** Principle
**Source:** Chapter 4, Topic 27 "Don't Outrun Your Headlights"
**Also known as:** none

## What it is
The title comes from a driving image: a car speeding down a dark, rainy mountain road crashes because the driver could not stop or steer within the range the headlights actually lit. Headlights have a limited throw distance and only shine straight ahead, missing curves and dips. Per the book, low-beam headlights light about 160 feet, but stopping distance is 189 feet at 40mph and 464 feet at 70mph, so it is easy to outrun your headlights.

In software development our headlights are similarly limited. We cannot see far into the future, and the further off-axis we look, the darker it gets. So Pragmatic Programmers hold a firm rule: always take small, deliberate steps, checking for feedback and adjusting before proceeding. The rate at which you get feedback is your speed limit. You never take on a step or a task that is too big.

Feedback is anything that independently confirms or disproves your action: a REPL result, a passing unit test, a user demo, a conversation about features and usability. A task is too big when it requires fortune telling. Just as headlights have limited throw, you can only see one or two steps ahead, maybe a few hours or days, before educated guessing turns into wild speculation.

## Why it matters
The more you have to predict what the future will look like, the more risk you take on that you will simply be wrong. Design for future maintenance, yes, but only as far ahead as you can actually see. Effort poured into designing for an uncertain future is often wasted when that future arrives looking nothing like the guess.

The book grounds this in Nassim Nicholas Taleb's The Black Swan: the significant events in history come from high-profile, hard-to-predict, rare outliers beyond normal expectations, and our own cognitive biases blind us to changes creeping up at the edges of our work. Its own cautionary tale is the fierce debate around the first edition over whether Motif or OpenLook would win the desktop GUI wars. It was the wrong question: neither won, and the browser-centric web quickly dominated. Betting big on a predicted future is how you crash through the guardrail.

## In practice
Take small steps and wait for feedback before the next one; let the rate of feedback set your pace. Watch for the moment you slip into fortune telling, which happens when you must estimate completion dates months in the future, plan a design for future maintenance or extendability, guess users' future needs, or guess future tech availability. Rather than designing for an uncertain future, design your code to be replaceable: make it easy to throw out and swap for something better suited. Replaceable code also improves cohesion, coupling, and DRY, producing a better design overall.

## Related tips
- Tip 42: "Take Small Steps - Always"
- Tip 43: "Avoid Fortune-Telling"

## See also
- [design-by-contract](design-by-contract.md)
- [tracer-bullets](tracer-bullets.md)
- [prototypes](prototypes.md)
- [refactoring](refactoring.md)
- [test-to-code](test-to-code.md)
- [essence-of-agility](essence-of-agility.md)
- [coconuts-dont-cut-it](coconuts-dont-cut-it.md)
