---
title: Estimating
category: Practice
chapter: 2
topic: 15
source: 'Chapter 2, Topic 15 "Estimating"'
tips: [23, 24]
aliases: [Estimation, project scheduling, PERT, iterative scheduling]
related: [tracer-bullets, prototypes, communicate, algorithm-speed]
---

# Estimating

**In brief:** Produce estimates by building a model, choosing units that convey the accuracy you intend, and refining the schedule as the work reveals reality.

**Category:** Practice
**Source:** Chapter 2, Topic 15 "Estimating"
**Also known as:** Estimation, project scheduling, PERT, iterative scheduling

## What it is
Estimating is the skill of working out how long things will take or how big things are, even when the question seems to be missing information. By developing an intuitive feel for the magnitudes of things, you gain an apparent magical ability to judge feasibility, such as knowing whether "we'll send the backup over the network to S3" is practical, or which subsystems need optimizing.

A key insight is that the units you quote signal how accurate you are being. "About 130 working days" implies precision people will hold you to, while "about six months" tells them to expect anything between five and seven months, even though both describe the same duration. The book recommends scaling time estimates by duration: quote 1 to 15 days in days, 3 to 6 weeks in weeks, 8 to 20 weeks in months, and for 20-plus weeks, think hard before giving an estimate at all. Choose the units of any answer to reflect the accuracy you intend to convey.

Estimates come from models of the problem. Before building one, use the basic trick that always gives good answers: ask someone who has already done it. You will rarely find an exact match, but others' experience is surprisingly transferable.

## Why it matters
We all work with limited time and resources, and you survive better, and keep bosses and clients happier, if you can work out how long things will take. Producing an estimate also deepens your understanding of the world your programs inhabit. When an estimate turns out wrong, investigating why (wrong parameters, wrong model) makes the next estimate better. The single most valuable thing to say when asked for an estimate on the spot is "I'll get back to you," because slowing the process down and going through the steps beats a coffee-machine guess that comes back to haunt you.

## In practice
The book's model-based estimating process:

1. Understand what is being asked: gauge the required accuracy and the scope of the domain. The scope you choose often forms part of the answer ("assuming no traffic accidents and gas in the car, 20 minutes").
2. Build a rough, bare-bones mental model of the system. Building the model often reveals underlying patterns and may let you reframe the original question. Trading model simplicity for accuracy is inevitable and beneficial; experience tells you when to stop refining.
3. Break the model into components and work out the mathematical rules for how they interact, identifying each component's parameters.
4. Give each parameter a value, concentrating on the parameters with the most impact (those multiplied or divided matter more than those merely added). Have a justifiable way to calculate the critical ones, often by measuring an existing or similar system.
5. Calculate the answers. Run multiple calculations, varying critical parameters (a spreadsheet helps), and couch the answer in terms of those parameters. If an answer seems strange and the arithmetic is right, your model or understanding is probably wrong, which is valuable information.
6. Keep track of your estimating prowess: record estimates and subestimates, compare against reality, and find out why when you are wrong.

For project schedules, the book presents two techniques:

- Painting the Missile (PERT, Program Evaluation Review Technique): every task gets an optimistic, most likely, and pessimistic estimate, arranged into a dependency network, with simple statistics spreading the uncertainty to give likely best and worst times. This avoids padding numbers out of unsureness. The authors are not big fans, because people build wall-sized charts and wrongly believe a formula makes the estimate accurate.
- Eating the Elephant (iterative/incremental estimating): often the only way to schedule a project is to gain experience on that same project. Practice incremental development, repeating thin slices (check requirements, analyze and prioritize risk, design/implement/integrate, validate with users). After each iteration, refine your guess about how many iterations remain and what fits in each. Confidence in the schedule grows with each cycle.

This iterative approach may not please management, who typically want one hard number before the project starts. Help them understand that the team, their productivity, and the environment determine the schedule, and that refining it each iteration gives them the most accurate estimates you can.

## Related tips
- Tip 23: "Estimate to Avoid Surprises"
- Tip 24: "Iterate the Schedule with the Code"

## See also
- [tracer-bullets](tracer-bullets.md)
- [prototypes](prototypes.md)
- [communicate](communicate.md)
- [algorithm-speed](algorithm-speed.md)
