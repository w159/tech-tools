---
title: Tracer Bullets
category: Practice
chapter: 2
topic: 12
source: 'Chapter 2, Topic 12 "Tracer Bullets"'
tips: [20]
aliases: [Tracer code, tracer bullet development]
related: [prototypes, etc-easier-to-change, estimating, dont-outrun-your-headlights, refactoring, pragmatic-teams, coconuts-dont-cut-it, pragmatic-starter-kit, delight-your-users]
---

# Tracer Bullets

**In brief:** Build a lean but complete end-to-end skeleton of the system first, then flesh it out, using it to get real feedback under actual conditions.

**Category:** Practice
**Source:** Chapter 2, Topic 12 "Tracer Bullets"
**Also known as:** Tracer code, tracer bullet development

## What it is
Tracer bullets are rounds loaded at intervals alongside regular ammunition; when fired, their phosphorus leaves a glowing trail from gun to target. If the tracers hit, so do the regular bullets, so soldiers use them to refine their aim with pragmatic, real-time feedback under actual conditions rather than calculating everything up front.

Tracer bullet development applies the same idea to software, especially when building something that has not been built before. You look for something that carries a requirement all the way to some aspect of the final system quickly, visibly, and repeatably. You identify the important requirements that define the system, and the areas of biggest doubt and risk, and you code those first, connecting every architectural layer with a thin working path.

The very first tracer bullet is often just: create the project, add a "hello world," and make sure it compiles and runs. Then you add the skeleton needed to exercise the areas of uncertainty. In the book's example of a five-layer system, a single simple feature is chosen to run diagonally through all five layers; only the shaded slice of each layer is built at first, and the rest is filled in later.

Tracer code is not disposable. You write it for keeps. It contains all the error checking, structuring, documentation, and self-checking that any production code has. It simply is not fully functional yet. Once you have an end-to-end connection among the components, you can see how close to the target you are and adjust, and adding functionality becomes easy. This is an incremental approach consistent with the idea that a project is never finished.

## Why it matters
When users have never seen a system like this and their requirements are vague, when you face unfamiliar algorithms and libraries, and when the environment will change before you are done, you are aiming at a target in the dark. The classic alternative is to specify the system to death, then do one big calculation up front and shoot and hope. Tracer code gives you immediate feedback against a moving goal instead.

The advantages: users see something working early and stay engaged and contribute; developers get an architectural structure to work in instead of a blank page; you gain an integration platform so you integrate continuously rather than attempting a big-bang integration; you always have something to demonstrate; and you get a better feel for progress because work advances use case by use case rather than as monolithic blocks reported "95% complete" week after week.

Tracer bullets do not always hit the target, and that is the point. You use the technique when you are not certain where you are going, so expect the first attempts to miss. Because the codebase is lean it has low inertia and is quick to change, so you gather feedback and produce a more accurate version cheaply.

## In practice
- Prioritize the important, risky, and uncertain requirements and code them first.
- Get a trivial feature running end-to-end through every major component (for example, a query that just lists all rows), proving the pieces can talk to each other.
- Grow the skeleton over time by augmenting each component in parallel and completing stubbed routines, while the framework stays intact.
- Distinguish it from prototyping: a prototype is disposable code written to explore one aspect and then thrown away; tracer code is lean but complete and forms part of the final system's skeleton. Think of prototyping as the reconnaissance done before a single tracer bullet is fired.

## Related tips
- Tip 20: "Use Tracer Bullets to Find the Target"

## See also
- [prototypes](prototypes.md)
- [etc-easier-to-change](etc-easier-to-change.md)
- [estimating](estimating.md)
- [dont-outrun-your-headlights](dont-outrun-your-headlights.md)
- [refactoring](refactoring.md)
- [pragmatic-teams](pragmatic-teams.md)
- [coconuts-dont-cut-it](coconuts-dont-cut-it.md)
- [pragmatic-starter-kit](pragmatic-starter-kit.md)
- [delight-your-users](delight-your-users.md)
