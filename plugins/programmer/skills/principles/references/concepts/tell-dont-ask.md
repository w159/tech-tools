---
title: Tell, Don't Ask
category: Principle
chapter: 5
topic: 28
source: "Chapter 5, Topic 28 \"Decoupling\""
tips: [45]
aliases: [TDA]
related: [decoupling, law-of-demeter, etc-easier-to-change, dry-dont-repeat-yourself, orthogonality, reversibility, juggling-the-real-world, transforming-programming, inheritance-tax, configuration, temporal-coupling, shared-state, actor-model, blackboards]
---

# Tell, Don't Ask

**In brief:** Do not pull an object's internal state out, make a decision on it, and push a result back; instead tell the object what you want done and let it manage its own data.

**Category:** Principle
**Source:** Chapter 5, Topic 28 "Decoupling"
**Also known as:** TDA

## What it is
Tell, Don't Ask says you should not make decisions based on the internal state of an object and then update that object. Doing so destroys the benefits of encapsulation and spreads knowledge of the implementation throughout the code.

The book's example is a train wreck that queries a customer's orders, finds an order, gets its totals object, then reaches in and subtracts a discount and sets fields. The problem: the totals object should be responsible for managing totals, but as written it is just a container of fields anyone can query and update. If a new rule appears (no discount over 40 percent), there is no single place to enforce it, because any code anywhere could set those fields.

The fix is to delegate the behavior to the object that owns the data. Instead of fetching totals and mutating them, call totals.applyDiscount(discount). The same reasoning collapses the chain further: ask the customer for the order directly, then tell the order to apply the discount.

TDA is not a law of nature; it is a pattern that helps you recognize problems. The book stops short of hiding orders completely inside the customer object. Customers and orders are top-level, universal concepts in the application, so exposing an API to find an order is a pragmatic decision, not a violation.

## Why it matters
When objects expose their internals and callers make decisions on that state, business rules end up scattered and encapsulation is lost. Any maintainer who "didn't get the memo" can write code that bypasses a rule. Telling objects what to do keeps responsibility and its enforcement in one place, which reduces coupling and makes change safer.

## In practice
When you find yourself getting a value from an object, computing something, then setting a value back on it, move that logic into a method on the object. Ask whether the object is truly responsible for the data it holds. Do not apply TDA slavishly: exposing genuinely top-level domain objects (customers, orders) through an API is fine when those objects have an existence of their own. The authors discuss TDA further in their 2003 article "The Art of Enbugging."

## Related tips
- Tip 45: "Tell, Don't Ask"

## See also
- [decoupling](decoupling.md)
- [law-of-demeter](law-of-demeter.md)
- [etc-easier-to-change](etc-easier-to-change.md)
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [orthogonality](orthogonality.md)
- [reversibility](reversibility.md)
- [juggling-the-real-world](juggling-the-real-world.md)
- [transforming-programming](transforming-programming.md)
- [inheritance-tax](inheritance-tax.md)
- [configuration](configuration.md)
- [temporal-coupling](temporal-coupling.md)
- [shared-state](shared-state.md)
- [actor-model](actor-model.md)
- [blackboards](blackboards.md)

