---
title: Publish/Subscribe
category: Pattern
chapter: 5
topic: 29
source: "Chapter 5, Topic 29 \"Juggling the Real World\""
tips: []
aliases: [Pubsub]
related: [juggling-the-real-world, observer-pattern, reactive-programming, decoupling, blackboards]
---

# Publish/Subscribe

**In brief:** Publishers and subscribers communicate through named channels managed by separate infrastructure, generalizing the observer pattern to remove coupling and support asynchrony.

**Category:** Pattern
**Source:** Chapter 5, Topic 29 "Juggling the Real World"
**Also known as:** Pubsub

## What it is
Publish/Subscribe generalizes the observer pattern while solving its coupling and performance problems. Instead of observers registering directly with an observable, you have publishers and subscribers connected through channels. Every channel has a name; subscribers register interest in one or more named channels, and publishers write events to them.

The channels are implemented in a separate body of code: sometimes a library, sometimes a process, sometimes a distributed infrastructure. All that implementation detail is hidden from your code. Unlike the observer pattern, communication between publisher and subscriber happens outside your code and is potentially asynchronous.

You could build a basic pubsub system yourself, but you probably do not want to. Most cloud providers offer pubsub services that connect applications around the world, and every popular language has at least one pubsub library.

Compared to the observer pattern, pubsub is a good example of reducing coupling by abstracting up through a shared interface, the channel. It is still fundamentally a message-passing system, so responding to combinations of events needs more (see reactive-programming).

## Why it matters
Pubsub is good technology for decoupling the handling of asynchronous events. Code can be added and replaced, potentially while the application is running, without altering existing code. The downside is visibility: in a system that leans heavily on pubsub, you cannot look at a publisher and immediately see which subscribers are involved with a particular message.

## In practice
Model event flows as named channels. Have publishers write to channels and subscribers register interest in the channels they care about, and let a library, process, or cloud service carry the messages. Prefer an existing pubsub offering over rolling your own. Be aware of the traceability cost, and reach for reactive streams when you need to combine or time-correlate events rather than just pass messages.

## Related tips
- (No numbered tips are attached to this topic.)

## See also
- [juggling-the-real-world](juggling-the-real-world.md)
- [observer-pattern](observer-pattern.md)
- [reactive-programming](reactive-programming.md)
- [decoupling](decoupling.md)
- [blackboards](blackboards.md)

