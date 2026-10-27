---
title: Debugging
category: Practice
chapter: 3
topic: 20
source: "Chapter 3, Topic 20 \"Debugging\""
tips: [29, 30, 31, 32, 33, 34]
related: [fix-the-problem-not-the-blame, rubber-ducking, binary-chop, select-isnt-broken, dont-assume-prove-it, failing-test-before-fixing-code, dead-programs-tell-no-lies]
---

# Debugging

**In brief:** Treat debugging as ordinary problem solving: stay calm, gather accurate data, reproduce the fault, and chase the root cause rather than the symptom.

**Category:** Practice
**Source:** Chapter 3, Topic 20 "Debugging"
**Also known as:** none

## What it is
No one writes perfect software, so debugging will take up a major part of your day. The book frames it first as a psychological problem. Debugging is emotionally charged; developers meet it with denial, finger pointing, lame excuses, or apathy. The cure is to embrace debugging as just problem solving and attack it as a puzzle.

That starts with mindset. Turn off the ego defenses, tune out deadline pressure, and above all do not panic (Tip 30). If your first reaction to a bug is "that's impossible," you are plainly wrong, because it clearly can happen and has. Beware myopia: resist fixing only the symptom you can see, since the real fault may be several steps removed. Always hunt the root cause, not this one appearance of it.

Gathering data honestly matters. Bug reporting is not exact, coincidences mislead, and reports filtered through a third party lose detail, so you may need to watch the user reproduce the bug. The book's brush-stroke story makes the point: a tester crashed the app painting upper-right to lower-left, while the programmer had only ever painted lower-left to upper-right, so his artificial test never exposed the fault. You must brutally test both boundary conditions and realistic end-user patterns.

## Why it matters
A calm, systematic approach finds elusive bugs faster and prevents you from wasting neurons on "that can't happen" or hours chasing coincidences. Skipping the mindset work leads to blame culture, symptom patches that leave the true fault in place, and bugs that reappear because you never learned why the failure escaped earlier.

## In practice
- Start clean: debug only code that builds without warnings, with compiler warning levels set high, so the computer finds the easy problems and you concentrate on the hard ones.
- Reproduce it, ideally with a single command, and capture it as a failing test before you fix the code (see [failing-test-before-fixing-code](failing-test-before-fixing-code.md)).
- Read the error message (Tip 32). Many developers see a red exception and tab straight to the code without reading what it said.
- For a bad result, use a debugger with your failing test, and first confirm you are actually seeing the wrong value; know how to move up and down the call stack. Keep pen and paper to jot where a clue-chase started so a dead end does not cost you your place.
- Use the [binary-chop](binary-chop.md) to isolate a bad stack frame, a bad input value, or the release that introduced a regression.
- Use logging and tracing to watch state over time, especially in concurrent, real-time, or event-based systems; keep trace messages in a consistent, parseable format.
- Explain the bug out loud (see [rubber-ducking](rubber-ducking.md)).
- Assume your own code is at fault before blaming the OS, compiler, or a third party (see [select-isnt-broken](select-isnt-broken.md)), and when a surprise bug appears, prove your assumptions rather than trusting code you "know" works (see [dont-assume-prove-it](dont-assume-prove-it.md)).

After a fix, ask why it was not caught earlier, amend the tests, add better parameter checking, hunt the same bug elsewhere in the code, and if it stemmed from a wrong assumption, discuss it with the whole team, since if one person misunderstood, many may have.

## Related tips
- Tip 29: "Fix the Problem, Not the Blame"
- Tip 30: "Don't Panic"
- Tip 31: "Failing Test Before Fixing Code"
- Tip 32: "Read the Damn Error Message"
- Tip 33: "select" Isn't Broken
- Tip 34: "Don't Assume It - Prove It"

## See also
- [fix-the-problem-not-the-blame](fix-the-problem-not-the-blame.md)
- [rubber-ducking](rubber-ducking.md)
- [binary-chop](binary-chop.md)
- [select-isnt-broken](select-isnt-broken.md)
- [dont-assume-prove-it](dont-assume-prove-it.md)
- [failing-test-before-fixing-code](failing-test-before-fixing-code.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
