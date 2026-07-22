---
title: Observer Pattern
category: Pattern
chapter: 5
topic: 29
source: "Chapter 5, Topic 29 \"Juggling the Real World\""
tips: []
aliases: [Observer/observable, callbacks]
related: [juggling-the-real-world, publish-subscribe, decoupling, blackboards]
---

# Observer Pattern

**In brief:** An event source (the observable) keeps a list of interested clients (observers) and calls each one back when an event occurs.

**Category:** Pattern
**Source:** Chapter 5, Topic 29 "Juggling the Real World"
**Also known as:** Observer/observable, callbacks

## What it is
In the observer pattern there is a source of events, called the observable, and a list of clients, the observers, who are interested in those events. An observer registers its interest with the observable, typically by passing a reference to a function to be called. When the event occurs, the observable iterates down its list of observers and calls each registered function, passing the event as a parameter.

There is not much code involved. The book's Ruby example is a Terminator module that keeps a list of callbacks; register pushes a function onto the list, and exit calls each one before terminating. The authors point to this as a good example of when not to use a library: you push a function reference onto a list and call the functions when the event fires.

The pattern has been used for decades and served well, especially in user interface systems where callbacks tell the application that some interaction has occurred.

But it has a problem. Because each observer has to register with the observable, it introduces coupling. And because callbacks are typically handled inline by the observable, synchronously, it can create performance bottlenecks. Both problems are solved by the next strategy, Publish/Subscribe.

## Why it matters
The observer pattern is a lightweight, dependency-free way to notify interested parties when something happens, which is why it is everywhere in UI code. Its limits (registration coupling and synchronous, inline callbacks) matter once you scale up or need asynchrony, and they are exactly what pubsub is designed to remove.

## In practice
Keep a list of callbacks on the observable, let observers register their functions, and invoke them when the event fires. Do not reach for a library for something this small. When the direct coupling between observers and observable becomes a burden, or synchronous callbacks become a bottleneck, move to Publish/Subscribe.

## Related tips
- (No numbered tips are attached to this topic.)

## See also
- [juggling-the-real-world](juggling-the-real-world.md)
- [publish-subscribe](publish-subscribe.md)
- [decoupling](decoupling.md)
- [blackboards](blackboards.md)

