---
title: Actor Model
category: Pattern
chapter: 6
topic: 35
source: "Chapter 6, Topic 35 \"Actors and Processes\""
tips: [59]
aliases: [actors and processes]
related: [shared-state, blackboards, temporal-coupling, decoupling, transforming-programming]
---

# Actor Model

**In brief:** The actor model runs concurrency as independent processors that share no data and communicate only by passing messages.

**Category:** Pattern
**Source:** Chapter 6, Topic 35 "Actors and Processes"
**Also known as:** actors and processes

## What it is
An actor is an independent virtual processor with its own local, private state. Each actor has a mailbox. When a message arrives and the actor is idle, it wakes, processes that one message to completion, then handles the next message or goes back to sleep if the mailbox is empty. While processing a message, an actor can create other actors, send messages to actors it knows about, and compute a new state to use when the next message arrives.

A process is a more general-purpose virtual processor, usually provided by the operating system. When you constrain a process by convention to behave like an actor, it counts as one for this discussion.

The model has strict properties. Nothing is in overall control; no scheduler orchestrates the flow. The only state lives in messages and in each actor's local state, and neither is accessible from outside. All messages are one way, with no built-in reply: to get a response you include your own mailbox address in the message and the actor eventually sends a reply message back. Each actor processes one message at a time, to completion. As a result actors run concurrently, asynchronously, and share nothing.

## Why it matters
Because actors share no memory, you never have to synchronize access to shared state, which removes an entire class of concurrency bugs. There is no explicit concurrency code to write and no end-to-end "do this, then do that" orchestration to code; the actors work out the flow themselves from the messages they exchange.

The model is also indifferent to the underlying architecture. The same actor code runs unchanged on a single processor, on multiple cores, or across multiple networked machines. If you have enough physical processors you can put one actor on each; if you have one, a runtime handles context switching.

## In practice
Model each participant as an actor with a set of message handlers, one per message type it understands, and give each actor its initial state when you start it. The book implements the diner this way with three actors (customer, waiter, pie case) using JavaScript and the Nact library. The customer, told it is hungry, messages the waiter; the waiter messages the pie case; the pie case either sends a slice to the customer and tells the waiter to bill it, or reports that none is left. The output order varies from run to run because the actors run concurrently.

Erlang is a landmark actor implementation. It calls actors processes, but they are lightweight (millions per machine), isolated, and communicate by messages. Erlang adds a supervision system that manages process lifetimes and restarts failed processes, plus hot-code loading to replace code in a running system, and it powers some of the world's most reliable software (often citing nine nines availability). Erlang and Elixir are not unique; actor libraries exist for most languages, so consider them for your concurrent code.

## Related tips
- Tip 59: "Use Actors For Concurrency Without Shared State"

## See also
- [shared-state](shared-state.md)
- [blackboards](blackboards.md)
- [temporal-coupling](temporal-coupling.md)
- [decoupling](decoupling.md)
- [transforming-programming](transforming-programming.md)

