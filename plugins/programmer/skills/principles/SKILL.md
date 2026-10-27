---
name: principles
description: This skill should be used when the user is designing a module, refactoring, debugging, naming, decoupling, handling errors or concurrency, choosing inheritance vs composition, securing code, or asks "is this DRY", "what does The Pragmatic Programmer / Clean Code / Clean Architecture say about X", or "which principle applies here". Surfaces 1-4 relevant principles with the book, tip or chapter, and a pointer tied to the user's code. Advisory only; for a scan of a codebase use the review skill.
argument-hint: "[topic or file]"
allowed-tools: Read, Grep, Glob, Bash
---

# Principles advisor

Surface the principle that applies to the work in progress, cite where it comes from, and get out of the way. One principle that lands beats ten listed.

## Procedure

1. Identify the active concern from the user's task, question, or diff.
2. If the concern is about specific Python code, run the scanner on just that file or directory first and use its hits as evidence:
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/principles" scan <path> --fail-on never`
   A hit is a fact about the code (rule, line, source book). Do not restate hits the user did not ask about.
3. Pick the principle:
   - Pragmatic Programmer topics: match the concern in `references/index.md` (keyword map), then read 1-4 files in `references/concepts/`.
   - A detected rule: read its row in `references/catalog.md` for the principle, sources and thresholds.
   - Other books: `references/books.md` maps each of the 30 books to its principles.
4. Answer with 1-4 principles, each as:
   - the principle in one line,
   - the source (book plus tip or chapter, exactly as in the concept frontmatter or catalog),
   - a concrete pointer tied to the user's code or decision, with `file:line` when there is one.
5. If the user is mid-decision, name the principle that breaks the tie and stop. Never paste concept files or lecture.

## Cross-references

Concept files list `related` concepts in their frontmatter. When one principle implies another (DRY -> orthogonality, decoupling -> law-of-demeter -> tell-dont-ask), name it in one phrase.

## Resources

- `references/catalog.md` - the 20 detected rules (generated from `scripts/principles/catalog.py`).
- `references/index.md` - keyword map and the 89 Pragmatic Programmer concepts by chapter.
- `references/concepts/<file>.md` - one file per concept, with tip numbers in frontmatter.
- `references/books.md` - the 30-book source map.
