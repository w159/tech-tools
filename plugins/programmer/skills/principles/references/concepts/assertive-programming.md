---
title: Assertive Programming
category: Practice
chapter: 4
topic: 25
source: "Chapter 4, Topic 25 \"Assertive Programming\""
tips: [36, 39]
related: [crash-early, dead-programs-tell-no-lies, design-by-contract, property-based-testing, stay-safe-out-there]
---

# Assertive Programming

**In brief:** Use assertions to actively verify things you believe can never happen, so that a violated assumption fails loudly instead of corrupting your program silently.

**Category:** Practice
**Source:** Chapter 4, Topic 25 "Assertive Programming"
**Also known as:** none

## What it is
Programmers learn early to tell themselves comforting lies: "This application will never be used abroad, so why internationalize it," "count can't be negative," "Logging can't fail." Assertive Programming is the discipline of refusing that self-deception. Whenever you catch yourself thinking "but of course that could never happen," you add code to check it.

The easiest way to do that is with assertions. Most languages provide some form of assert that checks a Boolean condition. If a parameter or result should never be null, check for it explicitly. Assertions are also useful for checking an algorithm's operation, for example verifying that the output of a sort routine is actually in order.

Assertions are not a substitute for real error handling. They check for things that should never happen, whereas error handling deals with conditions that can happen and must be managed. Do not assert on user input or other expected failure modes; handle those properly.

Assertions must also be free of side effects, or the very code you added to detect errors will create new ones. The book's example is an assertion that calls an iterator's nextElement() method, which advances the iterator and causes a loop to process only half its collection. That is a kind of Heisenbug: debugging that changes the behavior of the system being debugged. Write assertions that only observe state, never mutate it.

## Why it matters
Testing alone is not enough for two reasons the optimists forget. First, in a complex program you will exercise only a minuscule fraction of the permutations your code faces in the wild. Second, your program runs in a dangerous world: in production a rat can gnaw through a cable, a user can exhaust memory, log files can fill the storage partition. Your first line of defense is checking for every possible error; assertions are your second line, catching the ones you missed.

The book is emphatic about leaving assertions on. Turning off assertions when you deliver to production is like crossing a high wire without a net because you once made it across in practice: there is dramatic value, but it is hard to get life insurance. A former neighbor's startup left well-crafted assertions enabled in production, reporting the pertinent failure data through a clean UI. That feedback from real users under real conditions let them fix obscure, hard-to-reproduce bugs, produced remarkably stable software, and the company was soon acquired for hundreds of millions of dollars.

## In practice
Add an assertion wherever you assume the impossible: null checks on values that should never be null, sanity checks on algorithm outputs, invariants you rely on. Keep assertion conditions side-effect free. Do not use assertions in place of error handling.

On performance: assertions do add overhead, but treat turning them all off as a last resort. If you truly have a performance problem, turn off only the specific assertions that hurt, such as an extra full pass over data in a hot sort, and leave the rest in place. When an assertion fails, most implementations terminate the process, but yours does not have to. If you need to free resources, catch the assertion's exception or trap the exit and run your own handler, and make sure the dying code does not depend on the very information whose corruption triggered the failure. Note that in C and C++ assertions are usually macros, and in Java assertions are disabled by default, so invoke the VM with the enableassertions flag and leave them enabled.

## Related tips
- Tip 39: "Use Assertions to Prevent the Impossible"
- Tip 36: "You Can't Write Perfect Software" (this is Chapter 4's opening tip, not Topic 25's own; it states the premise that Assertive Programming, along with the rest of the chapter, acts on)

## See also
- [crash-early](crash-early.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
- [design-by-contract](design-by-contract.md)
- [property-based-testing](property-based-testing.md)
- [stay-safe-out-there](stay-safe-out-there.md)
