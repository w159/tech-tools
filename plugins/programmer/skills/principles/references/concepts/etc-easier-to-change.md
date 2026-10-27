---
title: ETC (Easier to Change)
category: Principle
chapter: 2
topic: 8
source: 'Chapter 2, Topic 8 "The Essence of Good Design"'
tips: [14]
aliases: [ETC principle, The Essence of Good Design, Easier to Change]
related: [dry-dont-repeat-yourself, orthogonality, reversibility, domain-languages, decoupling, transforming-programming, inheritance-tax]
---

# ETC (Easier to Change)

**In brief:** The single design value that says good design is whatever makes the resulting software easier to change later.

**Category:** Principle
**Source:** Chapter 2, Topic 8 "The Essence of Good Design"
**Also known as:** ETC principle, The Essence of Good Design, Easier to Change

## What it is
ETC stands for "Easier to Change." The book's claim is that a thing is well designed if it adapts to the people who use it, and for code that means it must adapt by changing. So every good design decision is one that leaves the system easier to change than it was before.

The authors argue that every other design principle you have heard of is a special case of ETC. Decoupling is good because isolating concerns makes each concern easier to change. The single responsibility principle helps because a change in requirements maps to a change in just one module. Good naming matters because you have to read code to change it, and clear names make it readable. In each case the underlying payoff is the same: easier to change.

ETC is presented as a value, not a rule. Values sit just behind conscious thought and help you choose between paths when you are deciding "should I do this or that?" It nudges you rather than dictating a fixed procedure.

There is an implicit premise: that a person can tell which of several paths will be easier to change in the future. Often common sense gets you there. When you genuinely cannot tell, fall back on the ultimate easy-to-change move: make what you write replaceable, so this chunk of code will not become a roadblock no matter what the future brings.

## Why it matters
Change is constant. Requirements shift, your understanding evolves, environments move. Code that is easy to change absorbs all of that cheaply. Code that is hard to change turns every new requirement into a fight and eventually into a rewrite.

Treating ETC as the root value gives you one consistent yardstick for the dozens of smaller principles and patterns you meet. Instead of memorizing rules, you ask one question and the rules fall out of it.

## In practice
Give ETC some conscious reinforcement at first. For a week or so, deliberately ask yourself "did the thing I just did make the overall system easier or harder to change?" Do it when you save a file, when you write a test, and when you fix a bug. Some editors can pop up an "ETC?" reminder on save as a cue.

When you cannot predict the shape of a future change, make the code replaceable, which is really just keeping it decoupled and cohesive. You can also treat uncertain choices as a way to build instincts: note the situation in an engineering day book, record the options and your guesses, leave a tag in the source, and review your guess later when the code actually has to change.

## Related tips
- Tip 14: "Good Design Is Easier to Change Than Bad Design"

## See also
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [orthogonality](orthogonality.md)
- [reversibility](reversibility.md)
- [domain-languages](domain-languages.md)
- [decoupling](decoupling.md)
- [transforming-programming](transforming-programming.md)
- [inheritance-tax](inheritance-tax.md)
