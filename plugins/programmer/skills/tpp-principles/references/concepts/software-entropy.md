---
title: Software Entropy
category: Principle
chapter: 1
topic: 3
source: "Chapter 1, Topic 3 \"Software Entropy\""
tips: [5]
aliases: [Software Rot, Technical Debt]
related: [broken-windows, boiled-frog, orthogonality, refactoring, naming-things]
---

# Software Entropy

**In brief:** The tendency of software to drift toward disorder and rot over time, driven more by team psychology and neglect than by any single technical cause.

**Category:** Principle
**Source:** Chapter 1, Topic 3 "Software Entropy"
**Also known as:** Software Rot, Technical Debt (a more optimistic name for the same decay)

## What it is
Entropy is a term from physics for the amount of disorder in a system, and the laws of thermodynamics say that entropy in the universe tends toward a maximum. Software is immune from almost all physical laws, but this increase in disorder hits it hard. When disorder increases in software, the authors call it "software rot." Some people prefer the term "technical debt," with the implied promise that they will pay it back someday. They probably won't. Whatever the name, both debt and rot can spread uncontrollably.

Many factors contribute to software rot, but the most important one seems to be the psychology, or culture, at work on a project. Even a team of one has a delicate project psychology. Some projects decay despite the best plans and best people, while others fight nature's tendency toward disorder and come out well despite enormous difficulties. The difference is largely about whether the team keeps caring.

The mechanism the book uses to explain this is the Broken Window Theory, which is important enough to have its own entry.

## Why it matters
Rot compounds. A clean, functional system can deteriorate quickly once decay sets in, and neglect accelerates the process faster than any other factor. Because the root cause is psychological, entropy is contagious: hopelessness spreads among team members and creates a vicious spiral where people conclude that nothing can be fixed and nobody cares.

The optimistic reframe as "technical debt" is a trap. The implied intent to repay is rarely acted on, so naming the rot more politely does not stop it from spreading.

## In practice
- Treat the culture of care on a project as a first-class concern, not an afterthought.
- Watch for the early signs of decay and act on them before they compound (see the Broken Windows entry for the concrete tactic).
- Do not let entropy win: if you find yourself surrounded by broken glass, either clean it up or move to another neighborhood.

## Related tips
- Tip 5: "Don't Live with Broken Windows"

## See also
- [broken-windows](broken-windows.md)
- [boiled-frog](boiled-frog.md)
- [orthogonality](orthogonality.md)
- [refactoring](refactoring.md)
- [naming-things](naming-things.md)

