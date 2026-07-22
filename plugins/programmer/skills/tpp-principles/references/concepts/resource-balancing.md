---
title: Resource Balancing
category: Practice
chapter: 4
topic: 26
source: "Chapter 4, Topic 26 \"How to Balance Resources\""
tips: [40, 41]
aliases: [How to Balance Resources, Finish What You Start]
related: [design-by-contract, dead-programs-tell-no-lies, transforming-programming, temporal-coupling]
---

# Resource Balancing

**In brief:** Whoever allocates a resource should be responsible for deallocating it, keeping every acquire paired with its matching release in the same place.

**Category:** Practice
**Source:** Chapter 4, Topic 26 "How to Balance Resources"
**Also known as:** How to Balance Resources, Finish What You Start

## What it is
We all manage resources whenever we code: memory, transactions, threads, network connections, files, timers, windows, anything with limited availability. Usage almost always follows the same pattern: allocate the resource, use it, then deallocate it. Resource balancing is the discipline of keeping that pattern visible and symmetric so that for every allocation there is an obvious corresponding deallocation.

The central rule is that the function or object that allocates a resource should be responsible for deallocating it. The book's counterexample is a Ruby program where read_customer opens a file and stashes the handle in a shared instance variable, and a separate write_customer later uses that variable to close it. The open and close live in different routines coupled through a hidden shared variable. A maintenance programmer adding a "skip update if the balance is negative" rule accidentally leaves the file open on one path, then patches it by adding a stray close, coupling a third routine to the same variable and making the file's open/closed state impossible to track. This is not balanced.

The fix passes the file as a parameter and puts open and close in the same routine, so it is apparent that every open has a corresponding close and the ugly shared variable disappears. Better still, many modern languages let you scope a resource's lifetime to an enclosing block (Ruby's File.open with a do...end block, for instance), so the resource is released automatically when the block ends. In object-oriented languages you can encapsulate a resource in a class whose constructor acquires it and whose destructor releases it when the object goes out of scope, which is especially valuable where exceptions can otherwise interfere with deallocation.

## Why it matters
Balanced resources prevent leaks and the tangled, fragile code that grows around shared handles. When allocation and deallocation drift into different routines coupled by shared state, every change risks orphaning a resource or double-freeing it, and keeping track of what is open when becomes messy fast. Beyond memory and files, unbalanced resources show up as log files that never rotate, debug files that pile up, and database records that never expire. For anything you create that consumes a finite resource, you must decide how to balance it.

Ordering matters too. Deallocate resources in the opposite order to that in which you allocated them, so you do not orphan a resource that another still references. And when allocating the same set of resources in different places, always allocate them in the same order, which reduces the chance of deadlock: if process A holds resource1 and wants resource2 while process B holds resource2 and wants resource1, both wait forever.

## In practice
Make the allocator the deallocator. Prefer passing resources as parameters over stashing them in shared variables. Use block-scoped resource forms or constructor/destructor wrappers where the language offers them, so cleanup is automatic even when exceptions fire. In languages with exceptions you generally choose between using variable scope (a wrapping object reclaimed automatically) and a finally-style clause that guarantees cleanup.

For dynamic data structures where the simple pattern does not fit (a routine allocates memory and links it into a larger structure that outlives the routine), establish a semantic invariant that decides who owns the data. When a top-level structure is freed, pick one policy and apply it consistently: it recursively frees everything it contains, or it is freed while its substructures are deliberately orphaned, or it refuses to be freed while it still holds anything. In a procedural language like C, write a module per major structure that provides standard allocation and deallocation (and possibly debug printing, serialization, and traversal). Because Pragmatic Programmers trust no one, including themselves, build checks that resources really are freed: wrap each resource type, track allocations and deallocations, and verify state at a natural checkpoint such as the top of a long-running program's main request loop.

## Related tips
- Tip 40: "Finish What You Start"
- Tip 41: "Act Locally"

## See also
- [design-by-contract](design-by-contract.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
- [transforming-programming](transforming-programming.md)
- [temporal-coupling](temporal-coupling.md)
