---
title: Failing Test Before Fixing Code
category: Practice
chapter: 3
topic: 20
source: "Chapter 3, Topic 20 \"Debugging\""
tips: [31]
aliases: [Reproduce Before Fixing]
related: [debugging, binary-chop, dont-assume-prove-it, dead-programs-tell-no-lies]
---

# Failing Test Before Fixing Code

**In brief:** Make a bug reproducible as a failing test before you try to fix it, because writing the test both confirms the fix and often reveals it.

**Category:** Practice
**Source:** Chapter 3, Topic 20 "Debugging"
**Also known as:** Reproduce Before Fixing

## What it is
The best way to start fixing a bug is to make it reproducible. If you cannot reproduce it, you can never know whether it is truly fixed. The book wants more than a bug reproducible by a long series of steps: it wants a bug reproducible with a single command, because a defect that takes 15 manual steps to reach is far harder to fix.

So the most important rule of debugging is to capture the failure as a test first, then fix the code. Forcing yourself to isolate the exact circumstances that display the bug often hands you insight into the fix itself. As the book puts it, the act of writing the test informs the solution.

## Why it matters
Without a reliable reproduction you chase ghosts, and you can waste hours tracking a bug only to find that this particular run of the code worked fine. A failing test gives you a fast, repeatable trigger, a definite signal for when the bug is gone, and a permanent guard against its return. The isolation work of writing the test frequently pays off by pointing straight at the cause.

## In practice
Before touching the fix, write a test that reliably triggers the bug, ideally reducible to one command. Use that test to drive a debugger for bad-result cases, and confirm in the debugger that you are actually seeing the wrong value before you dig deeper. Combine this with the binary chop to shrink a large input set or a range of releases down to the minimal case that fails. After the fix, keep the test so any recurrence is caught immediately.

## Related tips
- Tip 31: "Failing Test Before Fixing Code"

## See also
- [debugging](debugging.md)
- [binary-chop](binary-chop.md)
- [dont-assume-prove-it](dont-assume-prove-it.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
