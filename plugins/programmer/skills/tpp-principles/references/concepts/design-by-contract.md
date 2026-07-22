---
title: Design by Contract
category: Practice
chapter: 4
topic: 23
source: "Chapter 4, Topic 23 \"Design by Contract\""
tips: [36, 37]
aliases: [DBC]
related: [crash-early, assertive-programming, dead-programs-tell-no-lies, resource-balancing, programming-by-coincidence, property-based-testing, stay-safe-out-there, requirements-pit]
---

# Design by Contract

**In brief:** A technique for documenting and enforcing the rights and responsibilities of software modules so that each routine does no more and no less than it claims to do.

**Category:** Practice
**Source:** Chapter 4, Topic 23 "Design by Contract"
**Also known as:** DBC

## What it is
Design by Contract (DBC) comes from Bertrand Meyer's work on the Eiffel language. It treats the relationship between a routine and its caller like a legal contract: each side has rights and responsibilities, and there is an agreed remedy if either side fails to hold up its end. A correct program, in this view, is one that does no more and no less than it claims to do, and DBC is the practice of documenting and verifying that claim.

Every function or method carries three kinds of clauses. Preconditions are what must be true before the routine is called: the routine's demands on the world, and its right to refuse to run if they are not met. Postconditions are what the routine guarantees will be true when it finishes: its promise about the state of the world on exit. Class invariants (really just invariants about state) are conditions the routine promises will always hold from the perspective of a caller; they can be false while the routine is mid-execution, but must be restored by the time control returns.

The book gives a Clojure example of a bank deposit function with two preconditions (the amount is greater than zero, and the account is open and valid) and a postcondition (the returned transaction can be found among the account's transactions). If a bug passes a negative amount, the precondition fails and a runtime exception fires. Crucially, a contract violation is a bug, not a normal event. That is why preconditions should never be used for things like user-input validation: bad user input is expected, so it is the caller's job to filter it before the contract is invoked.

The guiding maxim is "be strict in what you will accept before you begin, and promise as little as possible in return." The book calls this "lazy" code (a companion to the "shy" code idea from orthogonality). If your contract accepts anything and promises the world, you have committed yourself to writing a great deal of code.

## Why it matters
DBC forces you to think before you write. Simply enumerating the input domain, the boundary conditions, and what the routine does and does not promise to deliver is a large leap forward in writing better software, and you get that benefit even in languages with no automatic contract checking, by recording contracts as comments or unit tests.

It is also more efficient and DRY-er than pure defensive programming, where every routine re-validates data in case no one else did. With contracts, responsibility is assigned once and clearly. DBC complements testing rather than replacing it: TDD can tempt you to concentrate on the happy path, while contracts guard against the real world of bad data, bad actors, bad versions, and bad specifications. When you have a mechanism to check preconditions, postconditions, and invariants, you can crash early and report far more accurate information about what went wrong.

Ignoring contracts means responsibilities are vague, callers and callees each assume the other checked, and violations slip through as silently corrupted state instead of loud, early failures.

## In practice
State the contract before writing the routine: the input domain and range, the boundary conditions, and what the routine promises (and does not promise) to deliver. Put the precondition responsibility on the caller. When the language supports DBC natively (Clojure pre/post conditions, Eiffel), let the compiler or runtime enforce it. Where it does not, emulate it partly with assertions, but know the limits: assertions typically do not propagate down inheritance hierarchies, may be globally disabled, and cannot capture "old" values from method entry the way Eiffel's old expression can.

For requirements that are truly inviolate laws rather than changeable policy, express them as semantic invariants, a kind of philosophical contract, and make them a well-known, clearly stated part of the documentation everyone sees. Do not confuse a fixed law with a policy that a new management regime might change.

## Related tips
- Tip 37: "Design with Contracts"
- Tip 36: "You Can't Write Perfect Software" (this is Chapter 4's opening tip, not Topic 23's own; the chapter introduces Design by Contract as the first of the defenses it motivates)

## See also
- [crash-early](crash-early.md)
- [assertive-programming](assertive-programming.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
- [resource-balancing](resource-balancing.md)
- [programming-by-coincidence](programming-by-coincidence.md)
- [property-based-testing](property-based-testing.md)
- [stay-safe-out-there](stay-safe-out-there.md)
- [requirements-pit](requirements-pit.md)
