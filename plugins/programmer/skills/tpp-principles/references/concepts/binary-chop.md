---
title: Binary Chop
category: Practice
chapter: 3
topic: 20
source: "Chapter 3, Topic 20 \"Debugging\""
tips: []
aliases: [Binary Search, Divide and Conquer]
related: [debugging, version-control, dead-programs-tell-no-lies]
---

# Binary Chop

**In brief:** Locate a bug by repeatedly halving the search space (stack frames, input data, or releases) instead of examining every candidate in turn.

**Category:** Practice
**Source:** Chapter 3, Topic 20 "Debugging"
**Also known as:** Binary Search, Divide and Conquer

## What it is
Every CS undergraduate has coded a binary chop, also called a binary search. Searching a sorted array for a value, you could look at each entry in turn and average roughly half the array before finding it or proving it absent. Divide and conquer is faster: check the middle value, and if it is not the target, the comparison tells you which half to keep. Repeat in that subarray. A linear search is O(n); a binary chop is O(log n), so it is dramatically faster on any decent-sized problem.

The debugging insight is that the same halving applies far beyond arrays. Whenever you can split the space where a bug might live and test which half still shows the fault, you converge in a logarithmic number of steps.

## Why it matters
It turns hopeless-looking searches into a handful of checks. A stack trace with 64 frames yields an answer in at most six attempts. Compared with reading every stack frame, every input row, or every release one by one, the binary chop saves enormous time.

## In practice
The book gives three debugging applications:

- Massive stack trace: pick a frame in the middle and see whether the error is manifest there. If it is, focus on earlier frames; if not, the later frames. Chop again.
- Input-sensitive crash: get the offending dataset, confirm it still crashes locally, then split the data and feed each half through the app. Keep dividing until you have a minimal set of values that exhibit the problem.
- Regression across releases: write a test that fails on the current release, then pick a release halfway back to the last known good version, run the test, and narrow from there. Good version control makes this possible, and many VCS tools automate it by picking releases for you based on the test result.

## Related tips
- none

## See also
- [debugging](debugging.md)
- [version-control](version-control.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
