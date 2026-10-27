---
title: Decoupling
category: Principle
chapter: 5
topic: 28
source: "Chapter 5, Topic 28 \"Decoupling\""
tips: [44, 47, 48]
aliases: [Loose coupling, keeping code shy]
related: [tell-dont-ask, law-of-demeter, transforming-programming, inheritance-tax, etc-easier-to-change, dry-dont-repeat-yourself, orthogonality, reversibility, juggling-the-real-world, configuration, temporal-coupling, shared-state, actor-model, blackboards]
---

# Decoupling

**In brief:** Keeping separate concepts separate so that a change in one piece of code does not force changes in many others.

**Category:** Principle
**Source:** Chapter 5, Topic 28 "Decoupling"
**Also known as:** Loose coupling, keeping code "shy"

## What it is
Coupling is any dependency that links two pieces of code so they must change together. The book calls coupling "the enemy of change" because it forces you either to track down every part that must change in parallel or to wonder why something broke when you changed "just one thing." Coupling is also transitive: if A is coupled to B and C, and those are coupled to more things, A is effectively coupled to all of them.

The bridge analogy captures the goal. When you build a bridge you couple the components so the structure stays rigid. Software you expect to change wants the opposite: flexible, where individual components can shift and their neighbors just accommodate. To be flexible, each component should be coupled to as few others as possible.

The topic covers three main sources of coupling: train wrecks (long chains of method calls that expose implementation), globalization (the dangers of global and static data), and inheritance (subclassing, covered on its own in Topic 31). These are examples, not an exhaustive list, since coupling appears any time two pieces of code share something.

Watch for the symptoms: wacky dependencies between unrelated modules, "simple" changes that ripple through unrelated code, developers afraid to change code because they cannot predict the blast radius, and meetings everyone must attend because no one knows who a change affects.

## Why it matters
Coupled code is hard to change. Alterations in one place cause secondary effects elsewhere, often in hard-to-find places that only surface a month later in production. Decoupled code is easier to change, and easier to reuse: clean interfaces let you extract a method or module without dragging everything else along.

## In practice
Keep code "shy": have it deal only with things it directly knows about. Apply the specific tactics from this topic: avoid train wrecks with Tell, Don't Ask and the one-dot guideline (see law-of-demeter), avoid global data, and wrap anything important enough to be global behind an API. Note that function pipelines (see transforming-programming) do introduce some coupling on data format, but the book finds that far less of a barrier to change than train-wreck coupling.

## Related tips
- Tip 44: "Decoupled Code Is Easier to Change"
- Tip 47: "Avoid Global Data"
- Tip 48: "If It's Important Enough to Be Global, Wrap It in an API"

## See also
- [tell-dont-ask](tell-dont-ask.md)
- [law-of-demeter](law-of-demeter.md)
- [transforming-programming](transforming-programming.md)
- [inheritance-tax](inheritance-tax.md)
- [etc-easier-to-change](etc-easier-to-change.md)
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [orthogonality](orthogonality.md)
- [reversibility](reversibility.md)
- [juggling-the-real-world](juggling-the-real-world.md)
- [configuration](configuration.md)
- [temporal-coupling](temporal-coupling.md)
- [shared-state](shared-state.md)
- [actor-model](actor-model.md)
- [blackboards](blackboards.md)

