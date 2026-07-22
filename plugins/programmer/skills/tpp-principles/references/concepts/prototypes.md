---
title: Prototypes and Post-it Notes
category: Practice
chapter: 2
topic: 13
source: 'Chapter 2, Topic 13 "Prototypes and Post-it Notes"'
tips: [21]
aliases: [Prototyping, disposable code, throwaway code]
related: [tracer-bullets, domain-languages, etc-easier-to-change, shell-games, dont-outrun-your-headlights, listen-to-your-lizard-brain, requirements-pit, delight-your-users]
---

# Prototypes and Post-it Notes

**In brief:** Build cheap, disposable models to explore risky or uncertain aspects of a system; the value is the lessons learned, not the code produced.

**Category:** Practice
**Source:** Chapter 2, Topic 13 "Prototypes and Post-it Notes"
**Also known as:** Prototyping, disposable code, throwaway code

## What it is
Many industries build prototypes to try out specific ideas because prototyping is far cheaper than full-scale production. Car makers build different prototypes to test aerodynamics, styling, or structure, using clay models, balsa wood, or computer simulation. Software prototypes serve the same purpose: analyze and expose risk, and offer chances for correction at greatly reduced cost, each one targeting one or more specific aspects of a project.

Prototypes do not have to be code. Post-it notes are great for prototyping dynamic things like workflow and application logic. A user interface can be prototyped as a whiteboard drawing, a nonfunctional mock-up in a paint program, or an interface builder.

Because a prototype answers only a few questions, it is much cheaper and faster than production code. You deliberately ignore details that are unimportant to you right now, even though they may be very important to the user later. Prototype a UI and you can get away with incorrect results or data; investigate performance and you can get away with a poor UI or none at all.

If you find you cannot give up the details, ask whether you are really building a prototype at all. In that case a tracer bullet style of development is probably more appropriate.

## Why it matters
Properly used, prototypes save huge amounts of time, money, and pain by identifying and correcting potential problem spots early in the development cycle, when fixing mistakes is cheap and easy. The point is learning: the value lies not in the code produced but in the lessons learned.

The main risk is that a prototype can be deceptively attractive to people who do not know it is just a prototype. It is easy to be misled by the apparent completeness of a demo, and sponsors or management may insist on deploying the prototype or its progeny if you have not set expectations. You can build a great prototype car out of balsa wood and duct tape, but you would not drive it in rush-hour traffic. If there is a strong chance the purpose of prototype code will be misinterpreted in your culture, use the tracer bullet approach instead.

## In practice
Prototype anything that carries risk: architecture, new functionality in an existing system, structure or contents of external data, third-party tools or components, performance issues, and user interface design.

When building a prototype, you can ignore:
- Correctness: use dummy data where appropriate.
- Completeness: it may function in a very limited sense, perhaps with one preselected input and one menu item.
- Robustness: error checking is likely incomplete or missing, and the prototype may crash if you stray from the predefined path.
- Style: little in the way of comments or documentation.

Use a high-level scripting language (such as Python or Ruby) that gets out of your way, and use UI tools that let you focus on appearance and interactions. Scripting languages also work as glue to combine low-level pieces into new configurations quickly.

For prototyping architecture, none of the modules need to be functional, and you may not need to code at all (whiteboard, Post-it notes, or index cards work). Look at whether major responsibilities and collaborations are well defined, whether coupling is minimized, whether you can spot sources of duplication, whether interface definitions are acceptable, and whether every module has an access path to the data it needs when it needs it. That last question tends to produce the most surprises and the most valuable results.

Before any code-based prototyping, make sure everyone understands you are writing disposable, incomplete code that cannot be completed.

## Related tips
- Tip 21: "Prototype to Learn"

## See also
- [tracer-bullets](tracer-bullets.md)
- [domain-languages](domain-languages.md)
- [etc-easier-to-change](etc-easier-to-change.md)
- [shell-games](shell-games.md)
- [dont-outrun-your-headlights](dont-outrun-your-headlights.md)
- [listen-to-your-lizard-brain](listen-to-your-lizard-brain.md)
- [requirements-pit](requirements-pit.md)
- [delight-your-users](delight-your-users.md)
