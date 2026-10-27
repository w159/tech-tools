---
title: Dead Programs Tell No Lies
category: Principle
chapter: 4
topic: 24
source: "Chapter 4, Topic 24 \"Dead Programs Tell No Lies\""
tips: [38]
related: [crash-early, assertive-programming, design-by-contract, debugging, resource-balancing, stay-safe-out-there]
---

# Dead Programs Tell No Lies

**In brief:** When your code discovers that something impossible has happened, stop trusting it and terminate, because a dead program does far less damage than a crippled one limping along on corrupted state.

**Category:** Principle
**Source:** Chapter 4, Topic 24 "Dead Programs Tell No Lies"
**Also known as:** none

## What it is
Often it is a library or framework routine, not your own code, that first notices something has gone wrong: a nil value passed in, an empty list, a missing hash key, a value that turned out to be a list instead of a hash, an uncaught network or filesystem error, or a case selector that is no longer the expected 1, 2, or 3. This is one reason every case or switch statement should have a default clause: you want to know when the impossible has happened.

It is easy to slip into the "it can't happen" mentality and skip the check that a file closed successfully or that a trace statement was written. Pragmatic Programmers do the opposite. They assume that if an error does occur, something very, very bad has happened, and they read the error message rather than swallow it.

The topic contrasts two error-handling styles. Catching every exception only to log a message and re-raise it clutters the application logic and couples your code to the full list of exceptions a called method might raise; add a new exception upstream and your handler is silently out of date. Letting exceptions propagate naturally keeps the application code readable and lets new exceptions flow through automatically.

The core rule stands regardless of language: once your code discovers that something supposed to be impossible just happened, the program is no longer viable. Anything it does from that point forward is suspect, so terminate it as soon as you can.

## Why it matters
The alternative to crashing is continuing, and continuing means writing corrupted data to a vital database or commanding the washing machine into its twentieth consecutive spin cycle. A program that keeps running on invalid state does real, compounding harm. A dead program cannot lie to you or to your data.

Catching problems as early as possible lets you crash earlier, which is usually the best thing you can do, because it is often at the boundary between your code and the libraries it uses that problems are first detected. Detecting late, or not at all, lets the damage spread far from its cause and makes the eventual failure much harder to diagnose.

## In practice
The Erlang and Elixir languages embrace this philosophy. Joe Armstrong, inventor of Erlang, is often quoted as saying "Defensive programming is a waste of time. Let it crash!" In those environments programs are designed to fail, but the failure is managed by a supervisor that knows how to clean up, restart, or otherwise handle the failed code. When a supervisor itself fails, its own supervisor handles that, producing supervisor trees that power high-availability, fault-tolerant systems.

In other environments it may be inappropriate to just exit: you may hold resources that must be released, need to write log messages, tidy up open transactions, or coordinate with other processes. Do that cleanup, but still terminate. Add a default clause to every case or switch. Prefer letting exceptions propagate over verbose catch-log-reraise chains.

## Related tips
- Tip 38: "Crash Early"

## See also
- [crash-early](crash-early.md)
- [assertive-programming](assertive-programming.md)
- [design-by-contract](design-by-contract.md)
- [debugging](debugging.md)
- [resource-balancing](resource-balancing.md)
- [stay-safe-out-there](stay-safe-out-there.md)
