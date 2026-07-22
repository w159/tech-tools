---
title: Shared State Is Incorrect State
category: Principle
chapter: 6
topic: 34
source: "Chapter 6, Topic 34 \"Shared State Is Incorrect State\""
tips: [57, 58]
aliases: [shared mutable state problem]
related: [semaphore, actor-model, blackboards, temporal-coupling, orthogonality, decoupling, programming-by-coincidence]
---

# Shared State Is Incorrect State

**In brief:** Any time two or more chunks of code hold references to the same piece of mutable data, that shared state can become inconsistent and lead to wrong decisions.

**Category:** Principle
**Source:** Chapter 6, Topic 34 "Shared State Is Incorrect State"
**Also known as:** shared mutable state problem

## What it is
Shared state does not just mean global variables. It is any situation where two or more chunks of code hold references to the same piece of mutable data. The book's diner story makes it concrete: two servers each look in the display case, each sees one slice of pie, and each promises it to a different customer. One customer will be disappointed. Swap the display case for a joint bank account and you get the same bug with real money.

The root cause is that fetch-then-update is not atomic. When a waiter reads the pie count, they copy that value into their own memory to make a decision. If the count changes before they act, their copy is stale and their decision is now wrong. The problem is not that two processes write the same memory; it is that neither can guarantee its view of that memory is still consistent.

The trouble is not limited to shared memory. It appears anywhere your code shares a mutable resource: files, databases, external services, even the process's current working directory. If two instances of your code can touch a resource at the same time, you have a potential problem.

## Why it matters
The workarounds exist but are all error prone. Semaphores and other mutual exclusion only work if every single accessor honors the convention; one developer who forgets the lock puts you back in chaos. Transactional resource methods still need internal locking, and a lock that is not released on exception (say update_sales_data throws) hangs all future access forever.

Multiple-resource transactions get worse. Claiming pie, then failing to get ice cream, leaves you holding pie you cannot use and cannot return, and hidden from other customers. The exception-handling code needed to stay correct buries the business logic in housekeeping.

The concurrency bugs that result are often intermittent and location-random, which makes them expensive to track down. That is why the book's punchline is: managing shared-resource concurrency yourself is fraught, so prefer approaches that avoid shared state entirely.

## In practice
Make the fetch-and-act operation atomic. Centralize control by moving resource access into the resource itself, for example a single get_pie_if_available() call rather than separate check and take calls. Protect that method with a semaphore, and use a language-provided protect/ensure construct so the lock is always released even on exception.

For multiple resources, do not scatter the logic across each resource. Treat the composite ("apple pie a la mode") as its own resource, or build a generic menu-item mechanism that performs the resource dance across its components and either fully succeeds or fully fails.

Some languages help at the language level. Rust enforces data ownership so only one variable can hold a mutable reference at a time. Functional languages lean on immutability, though they still hit the wall when they must touch the real, mutable world. When random, hard-to-reproduce failures show up, suspect concurrency first.

## Related tips
- Tip 57: "Shared State Is Incorrect State"
- Tip 58: "Random Failures Are Often Concurrency Issues"

## See also
- [semaphore](semaphore.md)
- [actor-model](actor-model.md)
- [blackboards](blackboards.md)
- [temporal-coupling](temporal-coupling.md)
- [orthogonality](orthogonality.md)
- [decoupling](decoupling.md)
- [programming-by-coincidence](programming-by-coincidence.md)

