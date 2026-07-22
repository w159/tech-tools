---
name: tpp-principles
description: This skill should be used when the user is "designing a module", "deciding an architecture", "debugging a bug", "refactoring code", "writing tests", "naming things", "handling concurrency", "decoupling components", "choosing inheritance vs composition", "adding error handling", asks "what does The Pragmatic Programmer say about X", "is this DRY", "should I use inheritance or composition", "how should I structure this", or otherwise wants the relevant Pragmatic Programmer principles, tips, or practices surfaced for the work in progress. Surfaces 1-4 relevant principles with book tip numbers and citations to the concept files.
---

# Pragmatic Programmer Principles Advisor

Surface the book's relevant principles, tips, and practices at the moment they apply to the work in progress. Advisory, cited, terse. One principle that lands beats ten listed.

## When this applies

This skill fires when the user is doing something the book has guidance on: designing, structuring, decoupling, debugging, testing, naming, handling errors or concurrency, securing code, estimating, automating, working with requirements, or asking directly what the book says about a situation. It does not fire for unrelated tasks.

## Procedure

1. Identify the active concern from the user's task. Common concerns: design, debugging, testing, concurrency, security, error-handling, naming, decoupling, tooling/automation, requirements, estimation, duplication, refactoring, ethics.

2. Consult `references/index.md` and match the concern to the relevant concept file(s). The keyword-to-concept map in Part 1 of that file is the primary lookup. Default to the high-frequency set when the concern is generic "write/change code": `etc-easier-to-change.md`, `dry-dont-repeat-yourself.md`, `orthogonality.md`, `broken-windows.md`, `crash-early.md`, `design-by-contract.md`.

3. Read the matched concept file(s) from `references/concepts/`. Read only what is needed - usually 1-4 files. This file count maps directly to the 1-4 surfaced-principle cap stated in the description: one principle per file read.

4. Surface 1-4 principles (at most 4 in one turn unless the user explicitly asks for a survey), each in this shape:
   - One line: the principle.
   - Tip number (the book's numbered tip, from the concept's frontmatter `tips`).
   - A concrete "in practice" pointer tied to the user's actual situation, not a generic restatement.
   - A citation: `references/concepts/<file>.md`.

5. Distill. Do not paste whole concept files. Do not lecture. If the user is mid-decision, name the principle that breaks the tie and stop.

## Tone

Advisory, not preachy. State the principle, tie it to the user's code or decision, cite the source, and get out of the way. Never more than 4 principles in one turn unless the user explicitly asks for a survey. Prefer ETC, DRY, orthogonality, broken windows, crash-early, and design-by-contract as the defaults that apply most often.

## Cross-references

Each concept file lists `related` concepts in its frontmatter. When one principle clearly implicates another (DRY -> orthogonality, crash-early -> dead-programs-tell-no-lies, decoupling -> law-of-demeter -> tell-dont-ask), name the related concept in one phrase so the user can follow the thread.

## Resources

- `references/index.md` - keyword-to-concept trigger map and the full 89-concept index grouped by chapter.
- `references/concepts/<file>.md` - the book's actual text for each concept (What it is / Why it matters / In practice / Related tips / See also). Read these for depth, surface only the distillation.