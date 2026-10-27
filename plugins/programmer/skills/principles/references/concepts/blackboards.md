---
title: Blackboards
category: Pattern
chapter: 6
topic: 36
source: "Chapter 6, Topic 36 \"Blackboards\""
tips: [60]
aliases: [blackboard system, laissez faire concurrency, "tuple space (standard CS term - Linda, JavaSpaces, T Spaces)"]
related: [actor-model, shared-state, temporal-coupling, decoupling, juggling-the-real-world]
---

# Blackboards

**In brief:** A blackboard is a shared space where independent agents post and read facts to coordinate a workflow, without any of them knowing about each other.

**Category:** Pattern
**Source:** Chapter 6, Topic 36 "Blackboards"
**Also known as:** blackboard system, laissez faire concurrency, tuple space (standard CS term - Linda, JavaSpaces, T Spaces)

## What it is
Picture detectives solving a murder. The chief inspector writes a question on a large blackboard, and over many shifts different detectives add facts, witness statements, and forensic evidence, and post connections they notice, until the case is closed. The key traits: no detective needs to know any other exists, they simply watch the board and add findings; they can have completely different skills and backgrounds; they come and go across shifts; and there is no restriction on what may be posted.

This is a form of laissez faire concurrency. The agents are independent processes or actors. Some post facts to the board, others take facts off, combine or process them, and post new information back. Gradually the board drives the group toward a conclusion, with no central controller sequencing the work.

The book describes such systems as a combination of an object store and a smart publish/subscribe broker. Early computer blackboards served large, complex AI problems like speech recognition and knowledge-based reasoning. One of the first was David Gelernter's Linda, which stored facts as typed tuples that applications could write and query by pattern matching. Later distributed versions such as JavaSpaces and T Spaces stored active Java objects and let you retrieve them by partial field matching, wildcards, or subtype (an Author template with lastName "Shakespeare" finds Bill the author, not Fred the gardener).

## Why it matters
Blackboards offer serious decoupling. Because agents do not reference each other and order of arrival does not matter, you can add, remove, or change agents without rewiring the whole system.

The book's mortgage/loan example shows the payoff. Application data arrives in any order (a credit check is slow, a name is instant), from different people in different time zones, some of it automatically and asynchronously, with dependencies (no car title search until you have proof of ownership) and feedback loops (a poor credit report triggers new required forms). A hard-coded workflow system for all this is complex and programmer intensive, and every regulation change forces a rewrite. A blackboard plus a rules engine is elegant: posting a fact triggers the appropriate rules, and rule output posts back to trigger yet more rules.

The cost is that these systems are harder to reason about because much of the action is indirect, and they are more troublesome to deploy and manage because there are more moving parts (partly offset by being able to update individual agents rather than the whole system).

## In practice
Post facts to a shared space and let a rules engine react to them rather than hard-wiring the control flow. Keep a central repository of message formats or APIs, ideally one that generates code and documentation. Invest in tooling to trace facts through the system: add a unique trace id when a business function starts and propagate it to every agent, so you can reconstruct the flow from logs.

Modern messaging systems such as Kafka and NATS can act like blackboards. They do more than move data from A to B: they offer persistence via an event log and retrieval by pattern matching, so you can use them as a blackboard, as a platform for actors, or both.

The book's exercise asks you to judge for yourself whether a blackboard-style system would be appropriate for image processing (parallel processes grabbing and processing chunks of an image), group calendaring across time zones and languages, and a network monitoring tool whose agents use gathered statistics and trouble reports to look for problems in the system.

## Related tips
- Tip 60: "Use Blackboards to Coordinate Workflow"

## See also
- [actor-model](actor-model.md)
- [shared-state](shared-state.md)
- [temporal-coupling](temporal-coupling.md)
- [decoupling](decoupling.md)
- [juggling-the-real-world](juggling-the-real-world.md)

