---
title: Test-Driven Development
category: Practice
chapter: 7
topic: 41
source: "Chapter 7, Topic 41 \"Test to Code\""
tips: [68]
aliases: ["TDD", "test-first development"]
related: [test-to-code, property-based-testing, dont-outrun-your-headlights, pragmatic-starter-kit]
---

# Test-Driven Development

**In brief:** Writing tests up front and coding in a very short cycle of test, minimal code, refactor, so you always have tests and are always thinking about them.

**Category:** Practice
**Source:** Chapter 7, Topic 41 "Test to Code"
**Also known as:** TDD, test-first development

## What it is
Given all the benefits of thinking about tests up front, TDD says to write them up front too. The basic cycle:

1. Decide on a small piece of functionality to add.
2. Write a test that will pass once that functionality is implemented.
3. Run all tests and verify the only failure is the one you just wrote.
4. Write the smallest amount of code needed to pass the test, and verify all tests run cleanly.
5. Refactor: improve the test or the function, and make sure the tests still pass.

The cycle should be very short, a matter of minutes, so you are constantly writing tests and getting them to work.

## Why it matters
TDD is a major benefit for people just starting out with testing: follow the workflow and you guarantee you always have tests and are always thinking about them. But people can become slaves to TDD, and the book flags the failure modes. They spend inordinate time chasing 100% coverage, write redundant tests (a failing test that only references a class name becomes useless once the next test references it), and let designs grow bottom-up.

The deeper risk is losing sight of the destination. It is easy to be seduced by the green "tests passed" message and endlessly polish the easy problems while ignoring the real reason you are coding. The book contrasts Ron Jeffries getting sidetracked polishing a Sudoku board representation and abandoning the project, with Peter Norvig starting from how the problem is traditionally solved (constraint propagation) and refining the algorithm. Tests can drive development, but as with every drive, without a destination you can end up going in circles.

## In practice
By all means practice TDD, but stop every now and then to look at the big picture and make sure the code is getting you closer to a real solution. The book's overriding guidance is to build software incrementally in small pieces of end-to-end functionality, learning about the problem as you go and involving the customer at each step, rather than pure top-down or bottom-up design. Know where you are going.

## Related tips
- Tip 68: "Build End-to-End, Not Top-Down or Bottom Up"

## See also
- [test-to-code](test-to-code.md)
- [property-based-testing](property-based-testing.md)
- [dont-outrun-your-headlights](dont-outrun-your-headlights.md)
- [pragmatic-starter-kit](pragmatic-starter-kit.md)

