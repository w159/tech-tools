---
title: Temporal Coupling
category: Anti-pattern
chapter: 6
topic: 33
source: "Chapter 6, Topic 33 \"Breaking Temporal Coupling\""
tips: [56]
aliases: [coupling in time, time-based dependency]
related: [activity-diagram, shared-state, actor-model, blackboards, orthogonality, resource-balancing, decoupling]
---

# Temporal Coupling

**In brief:** Temporal coupling is when your code imposes a sequence or timing on things that the problem itself does not actually require.

**Category:** Anti-pattern
**Source:** Chapter 6, Topic 33 "Breaking Temporal Coupling"
**Also known as:** coupling in time, time-based dependency

## What it is
Developers usually talk about coupling as dependencies between chunks of code. Temporal coupling is a second, quieter form: coupling in time. It shows up whenever your design demands that things happen in a particular order, or that only one thing happen at a time, when nothing about the actual problem requires that constraint. The book's shorthand is "tick must happen before tock."

Two aspects of time matter here: concurrency (things happening at the same time) and ordering (the relative position of things in time). Most people design linearly because that is how they think: do this, then always do that. That habit bakes in constraints like "method A must always be called before method B," "only one report can run at a time," or "you must wait for the screen to redraw before the button click is received."

The fix starts with analysis. Model the workflow, usually with an activity diagram, to find what genuinely must happen in strict order versus what only happens in order out of habit. Everything that does not need to be sequential becomes a candidate for concurrency.

## Why it matters
Linear designs are neither flexible nor realistic. The real world is asynchronous: users interact, data is fetched, and external services are called all at the same time. Code that forces this into a strict serial line feels sluggish and wastes the hardware it runs on.

Breaking temporal coupling gains flexibility across workflow analysis, architecture, design, and deployment. The payoff is systems that are easier to reason about and that can respond faster and more reliably, because slow work (a database query, a remote call, waiting for input) no longer stalls everything behind it.

## In practice
Look for activities that take time but not your code's time: querying a database, calling an external service, waiting for user input. These stalls are the opportunities. While one is pending, do something more productive than idling the CPU.

The book's robotic pina colada maker lists twelve steps serially, but a bartender who ran them one at a time in order would be fired. An activity diagram reveals the real dependencies: several top-level tasks can start concurrently up front, and during the one-minute liquefy step the bartender can fetch glasses and umbrellas. Identifying these opportunities is the easy part. Deciding which are worth exploiting, and implementing them safely without shared-state bugs, is the hard part covered by the rest of the chapter.

## Related tips
- Tip 56: "Analyze Workflow to Improve Concurrency"

## See also
- [activity-diagram](activity-diagram.md)
- [shared-state](shared-state.md)
- [actor-model](actor-model.md)
- [blackboards](blackboards.md)
- [orthogonality](orthogonality.md)
- [resource-balancing](resource-balancing.md)
- [decoupling](decoupling.md)

