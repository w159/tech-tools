---
title: Reactive Programming
category: Pattern
chapter: 5
topic: 29
source: "Chapter 5, Topic 29 \"Juggling the Real World\""
tips: []
aliases: [Reactive programming and streams, RxJS/ReactiveX style]
related: [juggling-the-real-world, publish-subscribe, transforming-programming, decoupling, blackboards]
---

# Reactive Programming

**In brief:** Code where values automatically update in response to changes in the values they depend on, using event streams that can be manipulated like ordinary data collections.

**Category:** Pattern
**Source:** Chapter 5, Topic 29 "Juggling the Real World"
**Also known as:** Reactive programming and streams, RxJS/ReactiveX style

## What it is
If you have used a spreadsheet, you already know reactive programming. When a cell contains a formula that refers to a second cell, updating that second cell causes the first to update too. Values react as the values they use change. Many frameworks help with this kind of data-level reactivity; in the browser, React and Vue.js were current favorites when the book was written.

Events can trigger reactions in code, but plumbing them in is not always easy. That is where streams come in. Streams let you treat events as if they were a collection of data, like a list of events that gets longer as new events arrive. The payoff is that you can treat a stream like any other collection: manipulate, combine, filter, and do all the usual data operations. You can even combine event streams with regular collections.

Streams can be asynchronous, so your code responds to events as they arrive. The de facto baseline for reactive event handling is defined at reactivex.io, a language-agnostic set of principles with common implementations; the book uses the RxJS library for JavaScript. Its examples zip a list of animal names against a 500ms interval timer (a result emits only when both streams have data), and fetch three users in parallel where each request is its own stream.

Because streams unify synchronous and asynchronous processing behind one common API, you no longer have to think about time as something you manage explicitly. A static list of inputs can be swapped for a live observable (for example, user IDs generated as people log in) without changing the surrounding logic.

## Why it matters
Streams of events are asynchronous collections, and that is a powerful abstraction. It lets you respond to combinations of events over time, run event sources in parallel, and treat live and static data the same way, all without hand-managing timing and concurrency. This goes beyond the plain message passing of the observer pattern and pubsub.

## In practice
Model event sources as observables and compose them with stream operators (zip, merge, map, filter, and so on) instead of writing bespoke timing and coordination code. Use an established library that follows the ReactiveX principles rather than inventing your own. Swap a static input stream for a live one when you want the same pipeline to react to real-time events.

## Related tips
- (No numbered tips are attached to this topic.)

## See also
- [juggling-the-real-world](juggling-the-real-world.md)
- [publish-subscribe](publish-subscribe.md)
- [transforming-programming](transforming-programming.md)
- [decoupling](decoupling.md)
- [blackboards](blackboards.md)

