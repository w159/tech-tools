---
title: Ruthless and Continuous Testing
category: Practice
chapter: 9
topic: 51
source: "Chapter 9, Topic 51 \"Pragmatic Starter Kit\""
tips: [90, 91, 92, 93, 94]
aliases: [ruthless testing, continuous testing, find bugs once]
related: [pragmatic-starter-kit, full-automation, reversibility, tracer-bullets, shell-games, version-control, test-to-code, pragmatic-teams, coconuts-dont-cut-it]
---

# Ruthless and Continuous Testing

**In brief:** Test early, often, and automatically across every level, deliberately hunting your own bugs now and trapping each one with a new test so it can never recur.

**Category:** Practice
**Source:** Chapter 9, Topic 51 "Pragmatic Starter Kit"
**Also known as:** ruthless testing, continuous testing, find bugs once

## What it is
Many developers test gently, subconsciously avoiding the weak spots where they know the code will break. Pragmatic Programmers are the opposite: driven to find their own bugs now so they do not endure the shame of others finding them later. Finding bugs is like fishing with nets, small fine nets (unit tests) for the minnows and big coarse nets (integration tests) for the killer sharks, patching any holes the fish slip through. Testing starts as soon as there is code, because tiny minnows become man-eating sharks fast and a shark is much harder to catch.

The automatic build runs all available tests and should test for real, with a test environment that matches production closely, since any gap is where bugs breed. The build may cover several major types: unit testing (exercising a single module, the foundation of the rest), integration testing (showing subsystems honor their contracts, often the single largest source of bugs), validation and verification (confirming the software answers the question the users actually need, not just what they said), and performance or stress testing under real-world load. A good project may have more test code than production code, and that effort is cheaper in the long run.

You also have to test the tests, because we cannot write perfect test software any more than perfect software. Treat the suite as a security system and try to break in: after writing a test for a bug, cause the bug deliberately and confirm the test complains. Use saboteurs, introduce bugs on purpose on a separate branch, or use something like Netflix's Chaos Monkey to kill services and test resilience. Thoroughness is measured by state coverage, not code coverage: executing a line does not exercise all the states a program can reach, and property-based testing helps generate those unexpected states.

The single most important concept in testing is also the most neglected: when a bug slips through the net, add a new test to trap it next time. Once a human tester finds a bug, that should be the last time a human finds it, because the automated tests are modified to check for it from then on, every time, no exceptions, no matter how trivial or how much the developer protests. It will happen again, and time is better spent writing new code than chasing bugs the tests could have caught.

## Why it matters
Ruthless testing lets you approach zero defects and gives real confidence that a piece of code is done, because passing the tests is the signal. Testing early keeps small defects from compounding into expensive ones. Testing the tests prevents a false sense of security from a suite that never actually fires. Measuring state coverage instead of code coverage guards against the illusion that a fully executed line is a fully exercised one. And finding bugs once stops the team from paying repeatedly for defects that automation could have caught, freeing time for new work.

## In practice
Write many unit tests and add integration, validation and verification, and performance tests as the project needs them. Run every test automatically in the build, in an environment that mirrors production. Prove your tests work by deliberately introducing the bugs they should catch, using saboteurs, a bug branch, or a chaos tool. Do not chase 100 percent code coverage; think about program states and use property-based testing to generate them. Whenever a bug escapes, write the test that catches it before you fix it, so no human ever has to find that bug again.

## Related tips
- Tip 90: "Test Early, Test Often, Test Automatically"
- Tip 91: "Coding Ain't Done 'Til All the Tests Run"
- Tip 92: "Use Saboteurs to Test Your Testing"
- Tip 93: "Test State Coverage, Not Code Coverage"
- Tip 94: "Find Bugs Once"

## See also
- [pragmatic-starter-kit](pragmatic-starter-kit.md)
- [full-automation](full-automation.md)
- [reversibility](reversibility.md)
- [tracer-bullets](tracer-bullets.md)
- [shell-games](shell-games.md)
- [version-control](version-control.md)
- [test-to-code](test-to-code.md)
- [pragmatic-teams](pragmatic-teams.md)
- [coconuts-dont-cut-it](coconuts-dont-cut-it.md)

