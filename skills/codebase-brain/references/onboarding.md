# Onboarding a codebase → knowledge files

Goal: produce committed `.agents/knowledge/` files so the next agent understands the repo
without re-deriving it, can answer "how does X work?", and can push back on changes that
fight the architecture. **Scan first, read source only to fill gaps. Cite file:line.**

## Procedure

1. **Read intent.** Skim `README`, any PRD/design docs, `package.json`/`pyproject.toml`/etc.
   Note what the project is *for* before how it's built.
2. **Map the structure cheaply.** Use the `codebase-explorer` agent or `smart-explore` /
   tree-sitter — don't read every file. Find entry points, the main layers/features, the
   build/test commands.
3. **Fill each knowledge file below.** Only create the ones the repo warrants. Every
   non-obvious claim gets a `path/to/file.ext:line` anchor so it's checkable.
4. **Verify.** Re-read your files against the code. Delete anything you couldn't ground.
   List remaining open questions in `concerns.md` rather than guessing.

## What each file must contain

| File | Answers | Must include |
|------|---------|--------------|
| `invariants.md` | What must NOT break? | Load-bearing rules, "intentionally weird because Y", contracts other code depends on, footguns. **This is the safety file** — it's what lets an agent warn before going the wrong way. Each item: the rule + *why* + where enforced. |
| `architecture.md` | What's the shape? | Layer/feature decomposition, the main data-flow trace (request → … → response), key modules and their responsibilities, design patterns in use. |
| `structure.md` | Where do things live? | Directory map with the purpose of each top-level dir, entry points, monorepo vs single, generated vs source. |
| `conventions.md` | How is code written here? | Naming, error handling, logging, the "follow the pattern in `src/...`" references, formatting/lint setup. |
| `stack.md` | What is it built on? | Languages + versions, frameworks, runtime, datastore, package manager, key deps. |
| `integrations.md` | What does it talk to? | External APIs, auth providers, webhooks, queues, third-party services, env vars / secrets shape (names, never values). |
| `testing.md` | How is it verified? | Test runner + exact command to run them, where tests live, mocking approach, coverage bar, how CI gates. |
| `concerns.md` | What's fragile / unknown? | Known issues, TODOs, deprecated patterns, scaling/security notes, open questions you couldn't resolve. |

## Make the repo legible (context-engineering)

While onboarding, prefer fixes that help every future agent:
- A short purpose comment at the top of a complex module describing the flow.
- Reference patterns by example ("new endpoints follow `src/api/users.ts`") rather than prose.
- Keep `AGENTS.md` at root pointing to `.agents/` (template in `../templates/AGENTS.md.tmpl`).

## Output contract

- `AGENTS.md` at repo root (or a `## Codebase Brain` section appended to an existing one).
- The `.agents/knowledge/*.md` you could ground, each with file:line citations.
- `.agents/memory/MEMORY.md` seeded (even if empty) so the loader has an index to grow.
- All committed — the brain is worthless if it doesn't travel with the repo.
