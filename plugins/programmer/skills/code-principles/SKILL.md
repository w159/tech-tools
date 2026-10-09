---
name: code-principles
description: This skill should be used when the user asks for relevant book-derived principles while working on design, architecture, correctness, craft, security, data, process, testing, naming, error handling, concurrency, or requirements. Surfaces 1-4 relevant principles with source books and citations.
argument-hint: "[topic]"
allowed-tools: Read, Grep, Glob
---

# Code Principles Advisor

Surface the relevant software principles from a curated book corpus at the moment they apply to the work in progress. Advisory, cited, terse. One principle that lands beats ten listed.

## When this applies

This skill fires when the user is doing something the corpus has guidance on: designing, structuring, decoupling, debugging, testing, naming, handling errors or concurrency, securing code, data modeling, delivery, requirements, or asking directly what the corpus says about a situation. It does not fire for unrelated tasks.

## Procedure

1. Identify the active concern from the user's task or diff.
2. Consult `references/books.md` and match the concern to one of the 6 lenses: architecture, correctness, craft, security, data, process.
3. Read the matched lens section in `references/rubric.md` to ground the principle in evidence signals.
4. Surface 1-4 principles (at most 4 in one turn unless the user explicitly asks for a survey), each in this shape:
   - One line: the principle.
   - Source book.
   - A concrete "in practice" pointer tied to the user's actual situation.
   - A citation to the relevant book or lens.

5. Distill. Do not paste whole book sections. Do not lecture. If the user is mid-decision, name the principle that breaks the tie and stop.

## Tone

Advisory, not preachy. State the principle, tie it to the user's code or decision, cite the source, and get out of the way. Never more than 4 principles in one turn unless the user explicitly asks for a survey.

## Cross-references

When one principle clearly implicates another (for example, dependency direction -> bounded context -> data ownership), name the related principle in one phrase so the user can follow the thread.

## Resources

- `references/books.md` - the book map behind each review lens.
- `references/rubric.md` - evidence signals for each lens.
