---
title: Don't Assume It - Prove It
category: Mindset
chapter: 3
topic: 20
source: "Chapter 3, Topic 20 \"Debugging\""
tips: [34]
aliases: [Don't Assume It Prove It, The Element of Surprise]
related: [debugging, select-isnt-broken, failing-test-before-fixing-code, dead-programs-tell-no-lies]
---

# Don't Assume It - Prove It

**In brief:** When a surprising bug touches code you trust, do not gloss over that code; prove it works in this exact context, with this data and these boundary conditions.

**Category:** Mindset
**Source:** Chapter 3, Topic 20 "Debugging"
**Also known as:** Don't Assume It Prove It, The Element of Surprise

## What it is
When a bug surprises you, maybe you catch yourself muttering "that's impossible," you must reevaluate the truths you hold dear. That discount algorithm you knew was bulletproof: did you test all its boundary conditions? That code you have relied on for years: it could not still have a bug, could it? Of course it can.

The book states the mechanism plainly: the amount of surprise you feel when something goes wrong is proportional to the amount of trust and faith you had in the code being run. So when a surprising failure hits, accept that one or more of your assumptions is wrong. Do not gloss over a routine involved in the bug just because you "know" it works. Prove it, in this context, with this data, with these boundary conditions.

## Why it matters
Trusted code is exactly where bugs hide, because trust is what stops you from checking. Skipping "obvious" code wastes time looking everywhere else, and leaving the wrong assumption unexamined lets the same failure recur. Proving instead of assuming both finds the current bug and hardens the system against its relatives.

## In practice
Beyond fixing the surprise bug, the book prescribes follow-through:

- Determine why the failure was not caught earlier, and amend the unit or other tests so they would have caught it.
- If bad data propagated through several levels before exploding, add better parameter checking in those routines to isolate it earlier (related to crashing early and assertions).
- Look for the same bug elsewhere in the code and fix those spots now.
- Make sure that if it happens again, you will know.
- If the fix took a long time, ask why, and consider better testing hooks or a log-file analyzer for next time.
- If the bug came from someone's wrong assumption, discuss it with the whole team, since if one person misunderstands, many probably do.

## Related tips
- Tip 34: "Don't Assume It - Prove It"

## See also
- [debugging](debugging.md)
- [select-isnt-broken](select-isnt-broken.md)
- [failing-test-before-fixing-code](failing-test-before-fixing-code.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
