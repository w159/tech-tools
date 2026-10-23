# programmer (Claude Code plugin in the tech-tools marketplace)

A code reviewer, codebase auditor and coding-time advisor based on The Pragmatic Programmer (20th Anniversary Edition). The book's principles and tips become checks you can run against a real codebase.

This plugin ships as part of the [tech-tools marketplace](https://github.com/w159/tech-tools) (owner w159), alongside the `atlas` and `armada` plugins. Skills are namespaced `tpp-*` (The Pragmatic Programmer).

## What's included

| Component | Count | Purpose |
|---|---|---|
| Skills | 4 | `code-review` (user-run 6-lens, multi-agent review), `code-principles` (auto-fires while you work to surface relevant book principles), `tpp-audit` (Pragmatic Programmer audit), and `tpp-principles` (Pragmatic Programmer principles advisor) |
| Agents | 7 | `code-review-architecture`, `code-review-correctness`, `code-review-craft`, `code-review-security`, `code-review-data`, `code-review-process`, `tpp-auditor` |
| Hooks | 0 | none registered; the nudge script is kept on disk, unwired (see "The nudge hook (disabled)" below) |
| References | 95 | 89 concept files (`skills/tpp-principles/references/concepts/*.md`) plus 6 rubric, book-map, index, and dimension files |

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

Install from the tech-tools marketplace, then enable the `programmer` plugin.

If you are developing this plugin in place, you can also point Claude Code at the plugin dir directly:

```bash
claude --plugin-dir <path-to-clone>/plugins/programmer
```

## Usage

### Run a code review

```text
/programmer:code-review ./my-project
/programmer:code-review . --scope diff
/programmer:code-review ./repo --scope all --report ./review.md
```

The skill dispatches 6 reviewer agents in parallel. Each agent scans for concrete evidence signals defined in `skills/code-review/references/rubric.md` and returns a JSON findings array. The skill synthesizes a ranked report (blockers first, then majors, minors, notes) with `file:line` citations, the source book, and an actionable fix. It writes the report to `.code-review-report.md` (or the `--report` path) and prints a summary table plus the top 10 findings.

### Principles from the book corpus (`code-principles`)

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

### Pragmatic Programmer principles (`tpp-principles`)

The `tpp-principles` skill auto-fires when you are designing, debugging, refactoring, testing, naming, handling concurrency or errors, securing code, estimating, or asking what the book says about a situation. It surfaces 1-4 relevant principles, each with the book tip number, a concrete in-practice pointer tied to your situation, and a citation to the concept file. It is advisory and terse by design.

You can also invoke it directly:

```text
What does The Pragmatic Programmer say about inheritance vs composition?
Is this DRY?
```

### The nudge hook (disabled)

The `UserPromptSubmit` command hook has been disabled: `hooks/hooks.json` now registers no hooks. The implementation (`hooks/tpp_nudge.py`) is preserved on disk, unwired, in case the nudge is wanted again. It matches prompts against a deterministic domain keyword map and injects a single one-line pointer to the most relevant concept; it never lectures, never outputs more than one line, and can never block a prompt (it always exits 0).

To re-enable: add a `UserPromptSubmit` entry back to `hooks/hooks.json` calling `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/tpp_nudge.py"`, then restart Claude Code. Until then no hook runs.

## Book corpus

The `code-review` and `code-principles` skills use a curated list of software engineering books as their principle map (`skills/code-review/references/books.md`). The corpus is not a replacement for the books. It is an operational index: each review finding cites a book and a lens so you can trace the recommendation back to the source.

## License

Plugin code is MIT (`LICENSE` in this directory). The concept files are the author's own summaries of The Pragmatic Programmer, included as citation; `LICENSE` has the exact notice. Other plugins in this marketplace (atlas, armada) are Apache-2.0.

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
  hooks/
    hooks.json
    tpp_nudge.py
    test_tpp_nudge.py
  README.md
```