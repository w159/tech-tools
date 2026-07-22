---
title: Rubber Ducking
category: Practice
chapter: 3
topic: 20
source: "Chapter 3, Topic 20 \"Debugging\""
tips: []
aliases: [Rubber Duck Debugging]
related: [debugging, engineering-daybook, dead-programs-tell-no-lies]
---

# Rubber Ducking

**In brief:** Explain your problem out loud, step by step, to another person or an inanimate object, and the solution often reveals itself.

**Category:** Practice
**Source:** Chapter 3, Topic 20 "Debugging"
**Also known as:** Rubber Duck Debugging

## What it is
Rubber ducking is a simple, particularly useful technique for finding the cause of a problem: explain it to someone else. The listener looks over your shoulder at the screen and nods along like a rubber duck bobbing in a bathtub. They do not need to say a word. The act of explaining, step by step, what the code is supposed to do often causes the problem to leap off the screen and announce itself.

It works because verbalizing forces you to state explicitly the things you take for granted when reading the code silently. Having to say those assumptions out loud can suddenly hand you new insight. If no person is available, a rubber duck, a teddy bear, or a potted plant will do just as well.

The name comes from a footnote: while an undergraduate at Imperial College London, Dave worked with a research assistant, Greg Pugh, who for months carried a small yellow rubber duck and placed it on his terminal while coding.

## Why it matters
Many bugs survive because an unspoken, wrong assumption stays hidden while you read your own code. Rubber ducking cheaply surfaces those assumptions without needing a debugger, a meeting, or a second expert. It is one of the fastest ways to get unstuck.

## In practice
When you are stuck, grab a colleague (or a duck) and walk through the code line by line, saying what each part is supposed to do. Pay attention to the moment your spoken explanation diverges from what the code actually does; that gap is usually the bug. The engineering daybook offers a related effect: stopping to write something down switches your brain into explaining mode, so a daybook acts as a kind of rubber duck too.

## Related tips
- none

## See also
- [debugging](debugging.md)
- [engineering-daybook](engineering-daybook.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
