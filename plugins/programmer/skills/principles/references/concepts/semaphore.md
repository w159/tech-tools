---
title: Semaphore and Mutual Exclusion
category: Practice
chapter: 6
topic: 34
source: "Chapter 6, Topic 34 \"Shared State Is Incorrect State\""
tips: [57]
aliases: [mutex, mutual exclusion, monitor, lock, the P and V operations]
related: [shared-state, actor-model, orthogonality, decoupling, programming-by-coincidence]
---

# Semaphore and Mutual Exclusion

**In brief:** A semaphore is a token that only one party can hold at a time, used to control exclusive access to a shared resource.

**Category:** Practice
**Source:** Chapter 6, Topic 34 "Shared State Is Incorrect State"
**Also known as:** mutex, mutual exclusion, monitor, lock, the P and V operations

## What it is
A semaphore is simply a thing that only one person can own at a time. You create one and use it to guard access to some other resource, with the convention that anyone who wants to touch the resource must first be holding the semaphore. The book's physical image is a plastic Leprechaun sitting on the pie case: a waiter must be holding it to sell a pie and returns it when the order is done.

Classically the operation to grab the semaphore was called P and the operation to release it was called V. Today the same idea goes by lock/unlock, claim/release, and similar names. When one party holds the semaphore, any other party that tries to acquire it is suspended until it is released.

Most languages ship library support for exclusive access under names like mutex (mutual exclusion), monitor, or semaphore. These are library constructs, not language guarantees. A few languages build the concept in: Rust enforces data ownership so only one variable can hold a mutable reference at a time.

## Why it matters
Mutual exclusion makes a fetch-and-update sequence atomic, which is exactly what shared-state bugs need. But it carries real hazards.

First, it is convention-based. It only works because everyone who accesses the resource agrees to use the semaphore. One developer who writes code that skips the lock reintroduces the original race.

Second, it is easy to leave a lock held. If code between lock and unlock throws an exception, the semaphore is never released and every future access hangs indefinitely. This is common enough that many languages provide a protect or ensure wrapper to guarantee release.

## In practice
Do not leave the locking convention in the hands of every caller. Centralize control by moving resource access into the resource itself, then guard that method internally.

Always release the lock on every exit path. Use try/ensure or a language-provided protect block rather than a bare lock/unlock pair, so an exception cannot strand the semaphore.

Be careful with multiple resources, where naive locking leads to holding one resource while failing to get another. The book's broader recommendation is that doing this yourself is painful; where you can, avoid shared state entirely with actors or blackboards instead.

## Related tips
- Tip 57: "Shared State Is Incorrect State"

## See also
- [shared-state](shared-state.md)
- [actor-model](actor-model.md)
- [orthogonality](orthogonality.md)
- [decoupling](decoupling.md)
- [programming-by-coincidence](programming-by-coincidence.md)

