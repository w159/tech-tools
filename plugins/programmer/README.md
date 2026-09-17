# programmer (Claude Code plugin in the tech-tools marketplace)

Turns The Pragmatic Programmer (20th Anniversary Edition) into an active codebase auditor and coding-time advisor. The book's principles, tips, practices, and lessons become things you can run against a real codebase, not just quotes on a page.

This plugin ships as part of the [tech-tools marketplace](https://github.com/w159/tech-tools) (owner w159), alongside the `atlas` and `armada` plugins. Skills are namespaced `tpp-*` (The Pragmatic Programmer).

## What's included

| Component | Count | Purpose |
|---|---|---|
| Skills | 4 | `code-review` (user-run 6-lens, multi-agent review), `code-principles` (auto-fires while you work to surface relevant book principles), `tpp-audit` (Pragmatic Programmer audit), and `tpp-principles` (Pragmatic Programmer principles advisor) |
| Agents | 7 | `code-review-architecture`, `code-review-correctness`, `code-review-craft`, `code-review-security`, `code-review-data`, `code-review-process`, `tpp-auditor` |
| Hooks | 1 | `UserPromptSubmit` prompt hook that nudges the single most relevant principle based on prompt keywords |
| References | 89 | the book's concept glossary, repackaged as `references/concepts/*.md` for citation |

## The 6 review lenses

| # | Lens | What it reviews |
|---|---|---|
| 1 | Architecture | Module boundaries, dependency direction, use-case isolation, service seams. |
| 2 | Correctness | Contracts, invariants, error handling, resource safety, concurrency, temporal ordering. |
| 3 | Craft | Naming, function size, duplication, comments, intent, maintainability. |
| 4 | Security | Attack surface, least privilege, trust boundaries, secrets, privacy. |
| 5 | Data | Data ownership, consistency, schema evolution, idempotency, observability. |
| 6 | Process | Traceability to user need, test quality, delivery safety, feedback loops. |

## Install

Install from the atlas marketplace, then enable the `programmer` plugin. Restart Claude Code after install so the hook loads.

If you are developing this plugin in place, you can also point Claude Code at the plugin dir directly:

```bash
cc --plugin-dir /Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/programmer
```

## Usage

### Run a book-derived code review

```text
/programmer:code-review ./my-project
/programmer:code-review . --scope diff
/programmer:code-review ./repo --scope all --report ./review.md
```

The skill dispatches 6 reviewer agents in parallel. Each agent scans for concrete evidence signals defined in `skills/code-review/references/rubric.md` and returns a JSON findings array. The skill synthesizes a ranked report (blockers first, then majors, minors, notes) with `file:line` citations, the source book, and an actionable fix. It writes the report to `.code-review-report.md` (or the `--report` path) and prints a summary table plus the top 10 findings.

### Principles while you work

```text
What book principle applies to this refactor?
Is this a bounded context?
```

The `code-principles` skill auto-fires while you work to surface 1-4 relevant book principles, each with a concrete pointer tied to your situation and a citation.

### Audit a codebase

```text
/programmer:tpp-audit ./my-project
/programmer:tpp-audit . --chapters 1,2,5,7
/programmer:tpp-audit ./repo --report ./audit.md
```

The skill dispatches one `tpp-auditor` per selected dimension in parallel. Each auditor scans for concrete, grep-able evidence signals (defined in `skills/tpp-audit/references/dimensions.md`) and returns a JSON findings array. The skill synthesizes a ranked report (missing first, then partial, then implemented) with file:line citations and the book tip numbers, writes it to `.tpp-audit-report.md` (or the `--report` path), and prints a summary table plus the top 10 gaps.

The audit reports only. It never modifies code. Re-run it after fixes to verify progress.

### Principles while you work

The `tpp-principles` skill auto-fires when you are designing, debugging, refactoring, testing, naming, handling concurrency or errors, securing code, estimating, or asking what the book says about a situation. It surfaces 1-4 relevant principles, each with the book tip number, a concrete in-practice pointer tied to your situation, and a citation to the concept file. It is advisory and terse by design.

You can also invoke it directly:

```text
What does The Pragmatic Programmer say about inheritance vs composition?
Is this DRY?
```

### The nudge hook

On every prompt submission, the `UserPromptSubmit` hook matches your prompt against a domain keyword map and injects a single one-line pointer to the most relevant concept (for example: `TPP relevant: dry-dont-repeat-yourself.md - single source for duplicated knowledge`). If no domain matches, it emits nothing. It never lectures and never outputs more than one line.

To disable the nudge hook: remove the `UserPromptSubmit` entry from `hooks/hooks.json`, or uninstall the plugin. Hook changes require a Claude Code restart to take effect.

## Book corpus

The `code-review` and `code-principles` skills use a curated 31-book corpus as their principle map. The corpus is not a replacement for the books. It is an operational index: each review finding cites a book and a lens so you can trace the recommendation back to the source.

## Source

The concept content under `skills/tpp-principles/references/concepts/` is sourced from the book extraction in the original standalone repo's `docs/glossary/`. Each concept file carries YAML frontmatter (title, category, chapter, topic, source, tips, aliases, related) and a body of What it is / Why it matters / In practice / Related tips / See also.

## Layout

```
plugins/programmer/
  .claude-plugin/plugin.json
  skills/
    code-review/
      SKILL.md
      references/books.md
      references/rubric.md
    code-principles/
      SKILL.md
      references/books.md
      references/rubric.md
    tpp-audit/
      SKILL.md
      references/dimensions.md
    tpp-principles/
      SKILL.md
      references/index.md
      references/concepts/*.md   (89 files)
  agents/
    code-review-architecture.md
    code-review-correctness.md
    code-review-craft.md
    code-review-security.md
    code-review-data.md
    code-review-process.md
    tpp-auditor.md
  hooks/hooks.json
  README.md
```