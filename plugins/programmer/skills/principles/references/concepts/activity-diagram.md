---
title: Activity Diagram
category: Practice
chapter: 6
topic: 33
source: "Chapter 6, Topic 33 \"Breaking Temporal Coupling\""
tips: [56]
aliases: [UML activity diagram, workflow diagram]
related: [temporal-coupling, orthogonality, resource-balancing, decoupling, blackboards]
---

# Activity Diagram

**In brief:** An activity diagram is a notation that captures a workflow so you can see which actions must happen in order and which can happen in parallel.

**Category:** Practice
**Source:** Chapter 6, Topic 33 "Breaking Temporal Coupling"
**Also known as:** UML activity diagram, workflow diagram

## What it is
An activity diagram is a way to model and analyze application workflows during design. Its purpose is to find out what can happen at the same time and what must happen in a strict order.

The notation is small. Actions are drawn as rounded boxes. An arrow leaving an action leads either to another action, which can start once the first completes, or to a thick line called a synchronization bar. Once all the actions leading into a synchronization bar are complete, you can proceed along any arrow leaving the bar. An action with no arrows leading into it can be started at any time.

The diagram shows potential concurrency, not required concurrency. It maps where parallelism is possible, but says nothing about whether exploiting it is worthwhile.

## Why it matters
Drawing the workflow can be eye-opening, because it reveals where dependencies really exist rather than where habit assumed they were. In the book's pina colada example, the diagram shows that several tasks can run concurrently up front and others can run in parallel later, even though the recipe was written as a strict numbered list.

Seeing the true dependency structure is the first step to maximizing parallelism: you cannot exploit concurrency you have not identified.

## In practice
Capture the workflow as actions and synchronization bars, then look for activities that could be performed in parallel but currently are not. Use the diagram to separate genuine ordering constraints from accidental ones.

Then apply judgment. The diagram might show five tasks that could start at once, but a bartender does not have five hands, so not every possible parallel path is worth taking. The design decision is to find activities that take real-world time (a one-minute liquefy, a database query, a remote call) and use that idle window to do other useful work.

## Related tips
- Tip 56: "Analyze Workflow to Improve Concurrency"

## See also
- [temporal-coupling](temporal-coupling.md)
- [orthogonality](orthogonality.md)
- [resource-balancing](resource-balancing.md)
- [decoupling](decoupling.md)
- [blackboards](blackboards.md)

