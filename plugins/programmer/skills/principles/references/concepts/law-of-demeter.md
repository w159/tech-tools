---
title: Law of Demeter
category: Guideline
chapter: 5
topic: 28
source: "Chapter 5, Topic 28 \"Decoupling\""
tips: [46]
aliases: [LoD, the one dot rule, The Jolly Good Idea of Demeter]
related: [decoupling, tell-dont-ask, transforming-programming, etc-easier-to-change, dry-dont-repeat-yourself, orthogonality, reversibility, juggling-the-real-world, inheritance-tax, configuration, temporal-coupling, shared-state, actor-model, blackboards]
---

# Law of Demeter

**In brief:** A decoupling guideline that a method should talk only to its immediate neighbors, which the book simplifies into "don't chain method calls" to avoid train wrecks.

**Category:** Guideline
**Source:** Chapter 5, Topic 28 "Decoupling"
**Also known as:** LoD, the "one dot" rule, "The Jolly Good Idea of Demeter"

## What it is
The Law of Demeter is a set of guidelines written in the late 1980s by Ian Holland to help developers on the Demeter Project keep functions cleaner and decoupled. The classic LoD says a method defined in a class C should only call: other instance methods in C, its own parameters, methods on objects it creates (on the stack or heap), and global variables.

In the 20 years since the first edition, the authors cooled on the original phrasing. They no longer like the "global variable" clause, and they found the full rule hard to apply in practice: it is "a little like having to parse a legal document whenever you call a method." The underlying principle is still sound, so they restate it more simply.

The simpler form is the one-dot rule: try not to have more than one "." when you access something. This targets "train wrecks," long chains like customer.orders.find(order_id).getTotals() that force top-level code to know many layers of implementation, all of which then cannot change. The rule also covers chains split across intermediate variables, which are the same coupling in disguise.

There is a big exception: the rule does not apply when the things you chain are really unlikely to change. Anything in your own application should be considered likely to change, and third-party libraries volatile, but the language's own standard libraries are usually stable enough to chain freely. Pipelines (see transforming-programming) are also not train wrecks, because they pass data along without relying on hidden implementation details.

## Why it matters
Every extra dot in a chain is another piece of implicit knowledge the caller depends on, and another thing that can never change without breaking that caller. Cutting the chain reduces coupling and shrinks the blast radius of future changes.

## In practice
Keep accesses to a single dot where you can. Recognize that hiding a chain behind intermediate variables does not help; it is the same coupling. Use judgment on the exception: chaining stable standard-library calls (the book's Ruby people.sort_by{...}.first(10).map{...}) is fine. Reach for Tell, Don't Ask to collapse chains onto the object that owns the data.

## Related tips
- Tip 46: "Don't Chain Method Calls"

## See also
- [decoupling](decoupling.md)
- [tell-dont-ask](tell-dont-ask.md)
- [transforming-programming](transforming-programming.md)
- [etc-easier-to-change](etc-easier-to-change.md)
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [orthogonality](orthogonality.md)
- [reversibility](reversibility.md)
- [juggling-the-real-world](juggling-the-real-world.md)
- [inheritance-tax](inheritance-tax.md)
- [configuration](configuration.md)
- [temporal-coupling](temporal-coupling.md)
- [shared-state](shared-state.md)
- [actor-model](actor-model.md)
- [blackboards](blackboards.md)

