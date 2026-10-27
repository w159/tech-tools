---
title: Big-O Notation
category: Guideline
chapter: 7
topic: 39
source: "Chapter 7, Topic 39 \"Algorithm Speed\""
tips: [63]
aliases: ["order notation", "O() notation", "on the order of"]
related: [algorithm-speed, estimating]
---

# Big-O Notation

**In brief:** A mathematical way of writing approximations that puts an upper bound on how an algorithm's time or memory grows as its input grows.

**Category:** Guideline
**Source:** Chapter 7, Topic 39 "Algorithm Speed"
**Also known as:** order notation, O() notation, "on the order of"

## What it is
Big-O notation, written O(), is a way of dealing with approximations. When a sort routine sorts records in O(n squared) time, it means the worst-case time varies as the square of n: double the records and the time increases roughly fourfold. Read the O as meaning "on the order of."

The notation puts an upper bound on the value being measured. Because the highest-order term dominates as n grows, the convention is to drop all low-order terms and any constant multiplying factors. This is a feature, not a flaw: one algorithm may be 1,000 times faster than another and you would not know it from the notation. Big-O never gives actual numbers, it only tells you how values change as the input changes.

## Why it matters
It gives a shared, compact vocabulary for reasoning about scaling. If a routine takes one second for 100 records, Big-O tells you roughly what to expect at 1,000: O(1) stays one second, O(n) grows to ten seconds, O(n squared) balloons to 100 seconds, and an exponential O(2 to the n) algorithm would take a number of years better measured against the heat death of the universe. Things quickly start getting out of hand as you climb up these categories.

## In practice
Common categories you will meet:

- O(1): constant (array access, simple statements)
- O(log n): logarithmic (binary search); the log base does not matter
- O(n): linear (sequential search)
- O(n log n): worse than linear but not much (average quicksort, heapsort)
- O(n squared): square law (selection and insertion sorts)
- O(n cubed): cubic (multiplying two matrices)
- O(C to the n): exponential (traveling salesman, set partitioning)

The notation applies to any resource, not just time, so you can also use it to model memory consumption.

## Related tips
- Tip 63: "Estimate the Order of Your Algorithms"

## See also
- [algorithm-speed](algorithm-speed.md)
- [estimating](estimating.md)

