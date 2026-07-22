---
title: "\"select\" Isn't Broken"
category: Mindset
chapter: 3
topic: 20
source: "Chapter 3, Topic 20 \"Debugging\""
tips: [33]
aliases: [Think Horses Not Zebras, Process of Elimination]
related: [debugging, dont-assume-prove-it, fix-the-problem-not-the-blame, dead-programs-tell-no-lies]
---

# "select" Isn't Broken

**In brief:** Suspect your own code long before the OS, compiler, or a third-party library, because the common explanation is almost always the right one.

**Category:** Mindset
**Source:** Chapter 3, Topic 20 "Debugging"
**Also known as:** Think Horses Not Zebras, Process of Elimination

## What it is
The code you debug is usually a mix of your own application code, third-party products (databases, web frameworks, connectivity, algorithms), and the platform (OS, system libraries, compilers). A bug can exist in any of these, but that should not be your first thought. It is far more likely the fault is in the application code under development, and it is generally more profitable to assume your code is calling a library incorrectly than to assume the library is broken.

The name comes from a story. A senior engineer was convinced the Unix select system call was broken. No logic could change his mind, even though every other networking application on the box worked fine. He spent weeks writing workarounds that, oddly, never fixed the problem. When finally forced to read the documentation on select, he found his own error and corrected it in minutes. The phrase "select is broken" is now a gentle reminder for whenever someone starts blaming the system for a fault that is likely their own. If you see hoof prints, think horses, not zebras.

## Why it matters
Blaming the platform sends you down long, fruitless detours writing workarounds for bugs that are actually in your code. Even when the fault really does lie with a third party, you still have to eliminate your own code first before you can submit a credible bug report. Starting from the likely explanation gets you to the fix faster.

## In practice
When something breaks, eliminate your own code before accusing the OS, compiler, or a library. Read the documentation of the call you suspect. Keep in mind the related rule of change: if you "changed only one thing" and the system stopped working, that one thing is likely responsible, no matter how farfetched. Sometimes the changed thing is outside your control, such as a new OS, compiler, database, or third-party version. Upgrades can break workarounds you relied on or introduce new bugs, so retest under the new conditions and watch the schedule, perhaps waiting until after your next release before upgrading.

## Related tips
- Tip 33: "select" Isn't Broken

## See also
- [debugging](debugging.md)
- [dont-assume-prove-it](dont-assume-prove-it.md)
- [fix-the-problem-not-the-blame](fix-the-problem-not-the-blame.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
