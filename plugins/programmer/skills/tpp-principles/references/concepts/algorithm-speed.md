---
title: Algorithm Speed
category: Practice
chapter: 7
topic: 39
source: "Chapter 7, Topic 39 \"Algorithm Speed\""
tips: [63, 64]
aliases: ["estimating algorithms", "algorithmic complexity estimation"]
related: [big-o-notation, estimating]
---

# Algorithm Speed

**In brief:** Estimating the resources (time, memory, processor) an algorithm uses as its input grows, and testing those estimates against reality.

**Category:** Practice
**Source:** Chapter 7, Topic 39 "Algorithm Speed"
**Also known as:** estimating algorithms, algorithmic complexity estimation

## What it is
Beyond estimating how long a project takes, Pragmatic Programmers estimate the resources their algorithms use almost daily. Most nontrivial algorithms handle variable-sized input, and the size of that input affects running time or memory. If the relationship were always linear this would not matter, but most significant algorithms are not linear: some are sublinear (binary search does not look at every candidate), and some are far worse (an algorithm that takes a minute for ten items may take a lifetime for 100).

Whenever you write loops or recursive calls, subconsciously check runtime and memory requirements. This is usually a quick sanity check that what you are doing is sensible; occasionally you do a more detailed analysis with Big-O notation.

You can estimate the order of many algorithms with common sense: a simple loop is O(n); a nested loop is O(m x n); halving the set each time is logarithmic O(log n); divide-and-conquer like quicksort averages O(n log n); anything examining permutations tends toward combinatoric (factorial) time.

## Why it matters
Given two ways to do something, estimation tells you which to pick and which parts need optimizing. Code that looks fine at 1,000 records may bog down the fastest processor at 1,000,000, or start to thrash as the system runs out of memory. You need to know how large your values can get: if they are bounded you know the runtime, and if they depend on external factors you should stop and consider the effect of large values before shipping.

## In practice
- Estimate the order of your algorithms; if something is O(n squared), look for a divide-and-conquer approach to bring it toward O(n log n).
- If unsure, run the code varying the input size and plot the results. Three or four points reveal the shape of the curve.
- Test your estimates: the only timing that counts is your code running in production with real data. Use profilers to count how often steps execute and plot against input size.
- Be pragmatic: the fastest algorithm is not always best. For small input sets a simple insertion sort beats quicksort and is easier to write. Watch out for high setup costs that dwarf small runs.
- Beware premature optimization: confirm an algorithm really is a bottleneck before investing time improving it.

## Related tips
- Tip 63: "Estimate the Order of Your Algorithms"
- Tip 64: "Test Your Estimates"

## See also
- [big-o-notation](big-o-notation.md)
- [estimating](estimating.md)

