# programmer (Claude Code plugin in the atlas marketplace)

Turns The Pragmatic Programmer (20th Anniversary Edition) into an active codebase auditor and coding-time advisor. The book's principles, tips, practices, and lessons become things you can run against a real codebase, not just quotes on a page.

This plugin ships as part of the [atlas marketplace](https://github.com/w159/atlas) (owner w159), alongside the `atlas` and `armada` plugins. Skills are namespaced `tpp-*` (The Pragmatic Programmer).

## What's included

| Component | Count | Purpose |
|---|---|---|
| Skills | 2 | `tpp-audit` (user-run review of a codebase) and `tpp-principles` (auto-fires while you work to surface relevant lessons) |
| Agents | 1 | `tpp-auditor` - per-dimension auditor dispatched by the audit skill |
| Hooks | 1 | `UserPromptSubmit` prompt hook that nudges the single most relevant principle based on prompt keywords |
| References | 89 | the book's concept glossary, repackaged as `references/concepts/*.md` for citation |

## The 10 audit dimensions

| # | Dimension | Book chapter |
|---|---|---|
| 1 | A Pragmatic Philosophy | Ch 1 |
| 2 | A Pragmatic Approach | Ch 2 |
| 3 | The Basic Tools | Ch 3 |
| 4 | Pragmatic Paranoia | Ch 4 |
| 5 | Bend, or Break | Ch 5 |
| 6 | Concurrency | Ch 6 |
| 7 | While You Are Coding | Ch 7 |
| 8 | Before the Project | Ch 8 |
| 9 | Pragmatic Projects | Ch 9 |
| 10 | A Pragmatic Philosophy of Ethics | Postface |

## Install

Install from the atlas marketplace, then enable the `programmer` plugin. Restart Claude Code after install so the hook loads.

If you are developing this plugin in place, you can also point Claude Code at the plugin dir directly:

```bash
cc --plugin-dir /Users/jerry/MEGA/Projects/Agentic/atlas/plugins/programmer
```

## Usage

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

## Source

The concept content under `skills/tpp-principles/references/concepts/` is sourced from the book extraction in the original standalone repo's `docs/glossary/`. Each concept file carries YAML frontmatter (title, category, chapter, topic, source, tips, aliases, related) and a body of What it is / Why it matters / In practice / Related tips / See also.

## Layout

```
plugins/programmer/
  .claude-plugin/plugin.json
  skills/
    tpp-audit/
      SKILL.md
      references/dimensions.md
    tpp-principles/
      SKILL.md
      references/index.md
      references/concepts/*.md   (89 files)
  agents/tpp-auditor.md
  hooks/hooks.json
  README.md
```