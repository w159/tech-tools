---
title: Finite State Machine
category: Pattern
chapter: 5
topic: 29
source: "Chapter 5, Topic 29 \"Juggling the Real World\""
tips: []
aliases: [FSM, state machine]
related: [juggling-the-real-world, observer-pattern, reactive-programming, decoupling, blackboards]
---

# Finite State Machine

**In brief:** A simple specification of how to handle events: a set of states, a current state, and rules that say which new state each event moves you to.

**Category:** Pattern
**Source:** Chapter 5, Topic 29 "Juggling the Real World"
**Also known as:** FSM, state machine

## What it is
A finite state machine is basically just a specification of how to handle events. It consists of a set of states, one of which is the current state. For each state you list the events that are significant to it, and for each of those events you define the new current state. One of the authors reports writing an FSM roughly every week, often just a couple of lines of code that untangle a lot of potential mess.

The book pushes back on the belief that state machines are hard, hardware-only, or require a special library. None of that is true. The neat property is that an FSM can be expressed purely as data: a transition table where rows are states and columns are events, and each cell holds the next state. The code that drives it just indexes the table by current state and event, falling back to an error state when no transition matches.

A pure FSM is an event-stream parser whose only output is the final state (the book's example parses header, data, and trailer messages from a websocket). You can beef it up by adding actions triggered on transitions. In that variant, each table entry becomes a pair of next state and an action name, and the driver runs the selected action before looping. The string-extractor example uses this to pull quoted strings while honoring backslash escapes, and adds a default transition taken when no specific event matches.

State transitions do not all have to happen at once. A multi-step signup flow (enter details, validate email, agree to warnings) is a sequence of transitions. Keeping the state in external storage and using it to drive a machine is a good way to handle these workflow requirements.

## Why it matters
State machines are underused. They turn tangled, ad hoc event handling into a small, data-driven specification that is easy to read, change, and reason about. Because the logic lives in a table, adding a state or event is a data change, not a rewrite. The book encourages looking for opportunities to apply them, while noting they do not solve every event problem.

## In practice
Draw the states and the events significant to each, then encode the transitions as a table (a map of state to a map of event to next state). Loop over incoming events, look up the next state, and default to an error state on no match. Add actions by making each table entry a next-state-plus-action pair and running the action inside the loop. For long-running workflows, persist the current state externally. You can also generalize the machine into its own class initialized with a transition table and an initial state.

## Related tips
- (No numbered tips are attached to this topic.)

## See also
- [juggling-the-real-world](juggling-the-real-world.md)
- [observer-pattern](observer-pattern.md)
- [reactive-programming](reactive-programming.md)
- [decoupling](decoupling.md)
- [blackboards](blackboards.md)

