---
title: DRY (Don't Repeat Yourself)
category: Principle
chapter: 2
topic: 9
source: 'Chapter 2, Topic 9 "DRY - The Evils of Duplication"'
tips: [15, 16]
aliases: [DRY principle, Don't Repeat Yourself]
related: [orthogonality, etc-easier-to-change, reversibility, decoupling, configuration, programming-by-coincidence, refactoring]
---

# DRY (Don't Repeat Yourself)

**In brief:** Every piece of knowledge must have a single, unambiguous, authoritative representation within a system.

**Category:** Principle
**Source:** Chapter 2, Topic 9 "DRY - The Evils of Duplication"
**Also known as:** DRY principle, Don't Repeat Yourself

## What it is
DRY says that each piece of knowledge in a system should live in exactly one place. When the same knowledge is expressed in two or more places and one copy changes, you have to remember to change the others, and it is only a matter of time before you forget and the system contradicts itself.

The authors stress that the first edition of the book explained this poorly, and many readers reduced DRY to "don't copy and paste lines of source." That is a tiny and trivial part of it. DRY is about duplication of knowledge and of intent, expressing the same thing in two places, possibly in two totally different ways (code and documentation, a database schema and the struct that mirrors it, and so on). The acid test: when one facet of the system has to change, do you find yourself changing it in multiple places and in multiple formats? If so, your system is not DRY.

Crucially, not all code duplication is knowledge duplication. Two validation functions with identical bodies (age must be a positive integer, quantity must be a positive integer) are not a DRY violation. The code is the same but the knowledge differs; they validate two separate things that happen to share rules today. That is coincidence, not duplication, and coupling them would be a mistake.

The book walks through the main places duplication shows up:

- Duplication in code: the print_balance example repeats negative-number handling and field widths across printf calls; extracting format_amount and report_line removes the duplication step by step. One subtlety survives as an implicit DRY violation: the number of hyphens in the separator line is related to the width of the amount field, but it isn't an exact match, since it's currently one character shorter, so any trailing minus signs extend beyond the column. This is the customer's intent, and it's a different intent from the actual formatting of amounts, so the book leaves it as an unresolved violation.
- Duplication in documentation: the myth that you should comment every function states the intent twice, once in the comment and once in the code, and given time they will get out of step. Such comments usually just compensate for bad naming and layout; a well-named function with clear code is DRY on its own.
- DRY violations in data: storing a line's length alongside its start and end points duplicates knowledge, since length is derivable from the points. Make it a calculated field instead. If you later cache it for performance, localize the violation inside the class so it is never exposed to the outside world.
- Representational duplication: your code must share knowledge of an interface with every external API, service, or data source it talks to; change one end and the other breaks. This is inevitable but can be mitigated: specify internal APIs in a neutral format with tools that generate docs, mocks, tests, and clients; use formal public specs such as OpenAPI; generate data containers from introspected schemas; or store external data in a key/value structure backed by a simple table-driven validation suite.
- Interdeveloper duplication: multiple people on a team, or across teams, implement the same thing independently. This is perhaps the hardest to detect and handle, and it can go unnoticed for years. The book cites a U.S. state whose Y2K audit found more than 10,000 programs each containing a different version of Social Security Number validation.

## Why it matters
Knowledge is not stable. Requirements shift after a client meeting, a government changes a regulation, a chosen algorithm turns out not to work. Because of this, programmers are constantly in maintenance mode, not just after release. Duplicated knowledge multiplies the cost of every such change and invites contradictions, which is a maintenance nightmare that starts before the application even ships. The authors call DRY one of the most important tools in the Pragmatic Programmer's toolbox, and it recurs throughout the book far beyond coding.

## In practice
- Make knowledge derivable rather than stored: compute a line's length from its endpoints instead of caching it. If you must cache for performance, localize the impact so only the class's own methods keep it consistent, and never expose the violation to the outside world.
- Use accessor functions to read and write object attributes (Meyer's Uniform Access principle), so callers cannot tell whether a value is stored or computed and you keep freedom to change later.
- Do not comment what the code already says; fix bad names and layout instead, so intent lives in one place.
- For interdeveloper duplication, build a tight-knit team with frequent communication: daily standups, shared channels, a project librarian to facilitate knowledge exchange, a central place for utility code, and regular reading of each other's source during code reviews.
- Make reuse easy. If reuse is harder than rewriting, people will rewrite and knowledge will duplicate.

## Related tips
- Tip 15: "DRY - Don't Repeat Yourself"
- Tip 16: "Make It Easy to Reuse"

## See also
- [orthogonality](orthogonality.md)
- [etc-easier-to-change](etc-easier-to-change.md)
- [reversibility](reversibility.md)
- [decoupling](decoupling.md)
- [configuration](configuration.md)
- [programming-by-coincidence](programming-by-coincidence.md)
- [refactoring](refactoring.md)
