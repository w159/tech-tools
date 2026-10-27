---
title: Transforming Programming
category: Mindset
chapter: 5
topic: 30
source: "Chapter 5, Topic 30 \"Transforming Programming\""
tips: [49, 50]
aliases: [Programming with pipelines, transformational programming]
related: [decoupling, law-of-demeter, reactive-programming, inheritance-tax, etc-easier-to-change, shell-games, resource-balancing, actor-model]
---

# Transforming Programming

**In brief:** Think of a program as a series of transformations that convert input into output, like a data pipeline, rather than as objects that hoard and mutate state.

**Category:** Mindset
**Source:** Chapter 5, Topic 30 "Transforming Programming"
**Also known as:** Programming with pipelines, transformational programming

## What it is
All programs transform data, converting an input into an output. Yet when we design we rarely think in transformations; we worry about classes, modules, data structures, algorithms, languages, and frameworks. The book argues this focus on code misses the point. When you get back to thinking of programs as transforming inputs into outputs, many details evaporate: the structure becomes clearer, error handling more consistent, and coupling drops way down.

The touchstone example is a Unix pipeline that lists the five longest files in a directory tree: find . -type f | xargs wc -l | sort -n | tail -5. Each stage is a transformation, and the data flows from one to the next: directory name to list of files to list with line counts to sorted list to the highest five. It is like an industrial assembly line: raw data in one end, finished information out the other.

To find transformations, start with the requirement and determine its overall input and output, which defines the top-level function. Then find the steps that lead from input to output, a top-down approach. Each step can itself break into smaller transformations, "all the way down," as in the anagram-finder example (subsets to signatures to dictionary matches to grouping by length), each stage implemented as a short pipeline.

Pipelines are expressed cleanly with a pipe operator (Elixir's |>, and similar in Elm, F#, Swift, Clojure, R, and others), which feeds the value on the left into the function on the right. The operator is more than syntactic sugar: it makes you think in terms of transforming data. Where a language lacks pipelines, you write the same transformations as a series of assignments; a little more tedious, but the philosophy is unchanged. Error handling fits the model by never passing raw values between transformations, but wrapping them in a type that also signals validity (Haskell's Maybe, the Option type in F# and Scala, or Elixir's {:ok, value} / {:error, reason} tuples), so an error short-circuits the rest of the pipeline.

## Why it matters
Object-oriented reflexes hide data inside objects that then chatter back and forth changing each other's state, which introduces a lot of coupling and is a big reason OO systems are hard to change. The transformational model turns that on its head: data becomes a flowing river, a peer to functionality, no longer tied to a particular group of functions. A function can be reused anywhere its parameters match another function's output, which greatly reduces coupling and, with a typed language, gives you compile-time warnings when you connect incompatible things. The result is cleaner code, shorter functions, and flatter designs.

## In practice
Define the program by its overall input and output, then decompose into a chain of transformations, recursing where a step is still complex. Use your language's pipe operator if it has one; otherwise chain assignments. For error handling, wrap values in an ok/error (or Maybe/Option) type and either check inside each transformation or provide a bind function (the book's and_then) that only runs the next step when the previous one succeeded. Do not hoard state inside objects; pass it along the pipeline.

## Related tips
- Tip 49: "Programming Is About Code, But Programs Are About Data"
- Tip 50: "Don't Hoard State; Pass It Around"

## See also
- [decoupling](decoupling.md)
- [law-of-demeter](law-of-demeter.md)
- [reactive-programming](reactive-programming.md)
- [inheritance-tax](inheritance-tax.md)
- [etc-easier-to-change](etc-easier-to-change.md)
- [shell-games](shell-games.md)
- [resource-balancing](resource-balancing.md)
- [actor-model](actor-model.md)

