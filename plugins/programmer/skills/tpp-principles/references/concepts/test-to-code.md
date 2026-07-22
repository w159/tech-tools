---
title: Test to Code
category: Practice
chapter: 7
topic: 41
source: "Chapter 7, Topic 41 \"Test to Code\""
tips: [66, 67, 68, 69, 70]
aliases: ["testing for feedback", "design to test", "testing against contract"]
related: [test-driven-development, property-based-testing, refactoring, dont-outrun-your-headlights, pragmatic-starter-kit]
---

# Test to Code

**In brief:** Testing is not about finding bugs but about getting feedback that guides your coding; the biggest benefits come from thinking about and writing the tests, not just running them.

**Category:** Practice
**Source:** Chapter 7, Topic 41 "Test to Code"
**Also known as:** testing for feedback, design to test, testing against contract

## What it is
Most developers, asked why they test, say "to make sure the code works." The book calls that wrong. The major benefits of testing happen when you think about and write the tests, not when you run them. A test is the first user of your code: writing one forces you to look at your code from the outside, as a client rather than the author.

The book walks through writing a database query. Just thinking about how to test it drives two design changes before a line of real code is written: passing in the database instance (reducing coupling instead of using a global) and parameterizing the field name (increasing flexibility). Before you can test something you have to understand it, and shining the light of a test on code makes its boundary conditions, error handling, and hidden complexity clearer.

Unit testing is the software equivalent of chip-level testing: exercising each module in isolation under controlled conditions. The book frames it as testing against contract, writing cases that ensure a unit honors its contract over a wide range of inputs and boundary conditions, which tells you both whether the code meets the contract and whether the contract means what you think. When a module depends on others, test the subcomponents fully first, then the module, so a failure points at the likely source.

## Why it matters
All software gets tested, if not by you then by your users, so you might as well plan on testing it thoroughly. A little forethought minimizes maintenance costs and help-desk calls. Testable code is also decoupled code: anything tightly coupled is hard to test because you must set up the whole environment first. The point is to avoid a "time bomb" that sits unnoticed and blows up later. Testing is part of programming; it is not left to another department. Testing, design, and coding, it is all programming.

## In practice
- Think about the tests up front, even if you write them during or after, because that thinking informs the design.
- Prefer Test First (including TDD) as it ensures testing happens; Test During is a fallback; Test Later really means Test Never.
- Fold ad hoc pokes (a console.log or REPL check) into the permanent unit test suite once a bug is found; if code broke once it will break again.
- Build a test window: since production brings out bugs and you have no test pins in software, provide views into internal state without a debugger, using consistently formatted log/trace files, a hot-key sequence or magic URL that opens a diagnostic window, or a feature switch to enable extra diagnostics.
- Maintain a culture of testing: all tests pass all the time; a spew of always-failing tests makes it easy to ignore all tests and the vicious spiral begins.
- Treat test code with the same care as production code; keep it decoupled and do not rely on unreliable things like widget positions, exact timestamps, or exact error wording, which produce fragile tests.

## Related tips
- Tip 66: "Testing Is Not About Finding Bugs"
- Tip 67: "A Test Is the First User of Your Code"
- Tip 68: "Build End-to-End, Not Top-Down or Bottom Up"
- Tip 69: "Design to Test"
- Tip 70: "Test Your Software, or Your Users Will"

## See also
- [test-driven-development](test-driven-development.md)
- [property-based-testing](property-based-testing.md)
- [refactoring](refactoring.md)
- [dont-outrun-your-headlights](dont-outrun-your-headlights.md)
- [pragmatic-starter-kit](pragmatic-starter-kit.md)

