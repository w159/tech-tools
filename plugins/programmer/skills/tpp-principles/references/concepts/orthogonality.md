---
title: Orthogonality
category: Principle
chapter: 2
topic: 10
source: 'Chapter 2, Topic 10 "Orthogonality"'
tips: [17]
aliases: [Decoupling, independence, cohesion (closely related terms)]
related: [dry-dont-repeat-yourself, etc-easier-to-change, reversibility, software-entropy, decoupling, inheritance-tax, temporal-coupling, shared-state, blackboards]
---

# Orthogonality

**In brief:** Designing components so that changing one has no effect on unrelated others, keeping them independent and decoupled.

**Category:** Principle
**Source:** Chapter 2, Topic 10 "Orthogonality"
**Also known as:** Decoupling, independence, cohesion (closely related terms)

## What it is
Orthogonality is borrowed from geometry: two lines are orthogonal if they meet at right angles, and in vector terms they are independent, so moving along one axis does not change your position on the other. In computing the term signifies independence or decoupling. Two or more things are orthogonal if changes in one do not affect any of the others.

In a well-designed system, the database code is orthogonal to the user interface: you can change the interface without touching the database, and swap databases without changing the interface. The book's counterexample is a helicopter, whose four controls each have secondary effects, so every input forces compensating changes on all the others. That is a nonorthogonal system, and it makes the pilot's workload phenomenal. When components are highly interdependent, there is no such thing as a local fix.

The goal is components that are self-contained: independent, with a single, well-defined purpose. This overlaps with what Yourdon and Constantine call cohesion. When components are isolated, you can change one without worrying about the rest, as long as you keep its external interfaces stable.

Orthogonality is closely related to DRY. With DRY you minimize duplication within a system; with orthogonality you minimize interdependency among the system's components. Used together they yield systems that are more flexible, more understandable, and easier to debug, test, and maintain.

## Why it matters
Orthogonal systems deliver two major benefits: increased productivity and reduced risk.

Productivity rises because changes are localized, so development and testing time drop, and small self-contained components are easier to build than one large block. Orthogonal components also promote reuse and combine cleanly: if one component does M things and another does N, an orthogonal combination does M x N things, but a nonorthogonal one does less because of overlap.

Risk falls because diseased sections of code are isolated and easy to slice out and replace, the system is less fragile, it is easier to test at the module level, and you are less tightly tied to any single vendor, product, or platform since third-party interfaces are confined to small parts of the system.

## In practice
- Design in modules, components, and layers. Each layer uses only the abstractions of the layers below it. Easy test: if you dramatically change the requirements behind one function, how many modules are affected? In an orthogonal system the answer should be one. Moving a GUI button should not touch the database schema.
- Do not rely on properties of things you cannot control, such as telephone numbers, postal codes, or government IDs used as identifiers, since they can change at any time.
- Keep third-party toolkits and libraries from imposing changes on your code; if a persistence scheme is transparent it is orthogonal, if it forces special access patterns it is not.
- When coding: keep code decoupled and write shy modules (see the Law of Demeter), avoid global data, be careful with singletons used as globals, and avoid similar functions that differ only in the middle (use the Strategy pattern). Refactor constantly.
- Orthogonal systems are easier to test at the unit level. If a unit test needs a large fraction of the rest of the system to build, that module is poorly decoupled. Use bug fixes to assess orthogonality: is the fix localized, or scattered?
- Even documentation can be orthogonal: separate content from presentation, for example with a markup system like Markdown.

## Related tips
- Tip 17: "Eliminate Effects Between Unrelated Things"

## See also
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [etc-easier-to-change](etc-easier-to-change.md)
- [reversibility](reversibility.md)
- [software-entropy](software-entropy.md)
- [decoupling](decoupling.md)
- [inheritance-tax](inheritance-tax.md)
- [temporal-coupling](temporal-coupling.md)
- [shared-state](shared-state.md)
- [blackboards](blackboards.md)
