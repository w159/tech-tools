---
title: Principle of Least Privilege
category: Principle
chapter: 7
topic: 43
source: "Chapter 7, Topic 43 \"Stay Safe Out There\""
tips: [72]
aliases: ["least privilege"]
related: [stay-safe-out-there, attack-surface, design-by-contract, dead-programs-tell-no-lies, assertive-programming, programming-by-coincidence, requirements-pit]
---

# Principle of Least Privilege

**In brief:** Use the least amount of privilege for the shortest time you can get away with, reducing the scope of attack vectors both by time and by privilege level.

**Category:** Principle
**Source:** Chapter 7, Topic 43 "Stay Safe Out There"
**Also known as:** least privilege

## What it is
A key security principle: use the least amount of privilege for the shortest time you can. Do not automatically grab the highest permission level such as root or Administrator. If a high level is genuinely needed, take it, do the minimum amount of work, and relinquish the permission quickly to reduce risk.

The principle dates to the early 1970s. As Jerome Saltzer wrote in the Communications of the ACM in 1974: "Every program and every privileged user of the system should operate using the least amount of privilege necessary to complete the job." The book gives the classic example of the Unix login program, which starts with root privileges and drops to the authenticated user's level as soon as it finishes authenticating.

## Why it matters
This follows the same idea as minimizing attack surface: it reduces the scope of attack vectors, both by time and by privilege level. The less privilege held, and the shorter the time it is held, the less an attacker can do if that path is compromised. In this case, less is indeed more.

## In practice
The principle is not limited to operating-system privilege levels. Look at how your own application handles access. Is it a blunt tool with only "administrator" vs. "user"? If so, consider something more finely grained, partitioning sensitive resources into different categories and granting individual users permission only for the categories they need.

## Related tips
- Tip 72: "Keep It Simple and Minimize Attack Surfaces"

## See also
- [stay-safe-out-there](stay-safe-out-there.md)
- [attack-surface](attack-surface.md)
- [design-by-contract](design-by-contract.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
- [assertive-programming](assertive-programming.md)
- [programming-by-coincidence](programming-by-coincidence.md)
- [requirements-pit](requirements-pit.md)

