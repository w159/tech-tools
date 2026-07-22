---
title: Property-Based Testing
category: Practice
chapter: 7
topic: 42
source: "Chapter 7, Topic 42 \"Property-Based Testing\""
tips: [71]
aliases: ["generative testing", "property tests"]
related: [test-to-code, test-driven-development, design-by-contract, assertive-programming, requirements-pit]
---

# Property-Based Testing

**In brief:** Having the computer generate wide-ranging random inputs and check that your code's contracts and invariants always hold, so it can find assumptions you did not know you were making.

**Category:** Practice
**Source:** Chapter 7, Topic 42 "Property-Based Testing"
**Also known as:** generative testing, property tests

## What it is
When you write both the code and its unit tests, an incorrect assumption can be baked into both: the code passes the tests because it does what you (wrongly) understood it should. Rather than splitting testing off to a different person (which loses the design feedback of thinking about tests yourself), the book favors having the computer, which does not share your preconceptions, do some testing for you.

Code has contracts (guarantees about outputs given valid inputs) and invariants (things that stay true as state passes through a function, such as a sorted list having the same length as the original). Lumped together these are called properties. Property-based testing states those properties as assertions, then lets a framework generate many varied inputs and check the assertions hold each time. The book's examples use Python with Hypothesis and pytest, where a decorator generates dozens or hundreds of random lists per test.

## Why it matters
It surprises you. In the warehouse example, a property test asserting that stock taken plus stock remaining equals the original stock level crashed, but the bug was not in stock adjustment at all: the in_stock function only checked for at least one item rather than enough to fill the order. That is the power and the frustration: you set up input rules and output assertions and let it rip, never quite knowing what will happen, but it can be tricky to pin down what failed.

Property-based tests also help your design. Like unit tests they make you think about your code, but in terms of invariants and contracts, what must not change and what must be true. This removes edge cases and highlights functions that leave data in an inconsistent state. The book considers property-based testing complementary to unit testing: different concerns, different benefits.

## In practice
- Work out the properties of the code you are testing: its contracts and invariants.
- Express them as assertions and let the framework generate the inputs (frameworks provide a minilanguage for describing and composing the data to generate).
- When a property test fails, note the parameters it used and turn them into a separate regular unit test. That test lets you focus on the problem without the framework's extra calls, and acts as a regression test since generated values are not guaranteed to recur.

## Related tips
- Tip 71: "Use Property-Based Tests to Validate Your Assumptions"

## See also
- [test-to-code](test-to-code.md)
- [test-driven-development](test-driven-development.md)
- [design-by-contract](design-by-contract.md)
- [assertive-programming](assertive-programming.md)
- [requirements-pit](requirements-pit.md)

