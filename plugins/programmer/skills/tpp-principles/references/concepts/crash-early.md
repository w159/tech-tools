---
title: Crash Early
category: Principle
chapter: 4
topic: 24
source: "Chapter 4, Topic 24 \"Dead Programs Tell No Lies\""
tips: [38]
aliases: [Fail fast]
related: [dead-programs-tell-no-lies, assertive-programming, design-by-contract, debugging, resource-balancing, stay-safe-out-there]
---

# Crash Early

**In brief:** Fail as soon as you detect something impossible, because crashing immediately at the point of trouble beats limping onward and doing greater damage later.

**Category:** Principle
**Source:** Chapter 4, Topic 24 "Dead Programs Tell No Lies"
**Also known as:** Fail fast

## What it is
Crash Early is the actionable rule inside "Dead Programs Tell No Lies." One benefit of detecting problems as soon as you can is that you can crash earlier, and crashing is often the best thing you can do. The moment your code discovers that something supposed to be impossible has actually happened, the program is no longer viable, so the sooner it stops, the less suspect work it performs.

The principle deliberately pushes against the instinct to keep a program alive at all costs. Keeping a broken program running is not resilience; it is a way to spread corruption. A program that dies at the first sign of the impossible reports a problem close to its cause, where it is cheapest to understand and fix.

Crashing early does not always mean an abrupt exit. In some environments you cannot simply kill a running program: you may have claimed resources that must be released, or you may need to write logs, close transactions, or notify other processes. The principle still holds. Do the necessary cleanup, then terminate, rather than pressing forward on state you can no longer trust.

## Why it matters
The cost of not crashing early is concrete: corrupted data written to an important database, or a physical device driven into a nonsensical and possibly dangerous state. Every instruction executed after the impossible is detected builds on a foundation you know to be broken.

Crashing early also makes bugs cheaper to find. A failure that fires at the boundary where the bad state was first detected carries accurate information about the problem. A failure allowed to propagate surfaces far downstream, disguised and detached from its root cause, costing far more time to trace back.

## In practice
Add checks for conditions you believe cannot happen, and when one trips, stop. Give every case or switch statement a default clause so an unexpected selector triggers a crash rather than silent fall-through. Combine crashing early with Design by Contract: when you have a mechanism to validate preconditions, postconditions, and invariants, you can crash early and report more accurate information about the failure. Where an outright exit is unsafe, trap the failure, release resources and tidy transactions, then terminate anyway.

## Related tips
- Tip 38: "Crash Early"

## See also
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
- [assertive-programming](assertive-programming.md)
- [design-by-contract](design-by-contract.md)
- [debugging](debugging.md)
- [resource-balancing](resource-balancing.md)
- [stay-safe-out-there](stay-safe-out-there.md)
