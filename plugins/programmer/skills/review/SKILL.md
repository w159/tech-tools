---
name: review
description: This skill should be used when the user asks for a code review against software principles, a "principles review", "check this code for Clean Code / Pragmatic Programmer / SOLID violations", "find code that breaks core principles", a PR or diff review for design quality, or a Pragmatic Programmer audit. Runs the deterministic principles scanner, then a cited model judge for what code cannot decide, and writes a ranked report.
argument-hint: "[path] [--diff [REF]] [--rules A,B] [--no-judge] [--profile pragmatic] [--report <file>]"
allowed-tools: Read, Grep, Glob, Bash, Agent, Write
---

# Principles review

Two passes. The scanner is the source of truth for the 20 detected rules: same input, same output, every run. The judge adds what code cannot decide (naming, responsibilities, domain language, contracts, tests) and every judged finding must cite a line it read. The two are never mixed: each finding is labeled `detected` or `judged`.

## Arguments

- Bare path: target file or directory. Default: current working directory.
- `--diff [REF]`: only lines changed vs REF (default `HEAD`, includes untracked files). Requires git.
- `--rules A,B` / `--skip A,B`: restrict the scanner.
- `--no-judge`: scanner only. Use for CI-style checks or when the user asks for "just the rules".
- `--profile pragmatic`: the judge also reports on the 10 Pragmatic Programmer chapters using `references/pragmatic-profile.md` (practices present, partial, missing).
- `--report <file>`: report path. Default `.principles-report.md` in the current working directory.

## Procedure

1. Run the scanner and keep the JSON. Pass through `--diff`, `--rules`, `--skip` exactly as given:
   ```bash
   out="$(mktemp)" && python3 "${CLAUDE_PLUGIN_ROOT}/scripts/principles" scan <path> --format json --fail-on never -o "$out"; echo "exit=$? json=$out"
   ```
   Read the JSON file it names. Exit code 2 means a usage or git error: show stderr and stop. `errors` in the JSON lists files that did not parse; report them, do not guess at their content.
2. If `--no-judge`, skip to step 5.
3. Pick judge batches: the files with the most detected findings first, then the rest of the changed or target files, at most 8 files per batch and at most 4 batches. Dispatch `programmer:principles-judge` once per batch, all in one message so they run in parallel. Each prompt carries: the target root, the file list, the scanner findings for those files (from the JSON), and `profile: pragmatic` when requested.
4. Each judge returns a JSON object with `judged` and `disputed` arrays. Validate it: every judged finding has `rule`, `path`, `line`, `principle`, `source`, `evidence`, `fix`. Re-dispatch a batch once if it returns prose. Drop judged findings whose `evidence` is not the text of the cited line (open the file and check).
5. Write the report (template below) to the report path. Disputed scanner findings stay in the report under "Disputed", with the judge's reason; they are not deleted.
6. Print to the conversation: the counts table and the top 10 findings (errors first). Do not paste the full report.

## Report template

```markdown
# Principles review

Target: <path>  Scope: <all | diff vs REF>  Date: <date>
Scanner: <files scanned> files, <n> findings, <parse errors> parse errors
Judge: <batches> batches, <n> judged findings, <n> disputed

## Counts

| Rule | Title | Kind | Count |
|---|---|---|---|

## Findings (errors, then warnings, then notes)

### <rule> <title> - <severity> - detected|judged
`path:line` - <message>
Principle: <principle> (<source>)
Fix: <one concrete next step>

## Disputed detections

- `path:line` <rule>: <judge's reason>

## Parse errors
```

## Rules for the report

- Never report a detected rule that the scanner did not emit, and never change a detected finding's line or rule.
- The report states facts about the code. It does not modify code. Re-run after fixes to verify.
- For the full rule list, thresholds and sources, see `${CLAUDE_PLUGIN_ROOT}/skills/principles/references/catalog.md`.
- To make the scanner part of CI, give the user: `python3 <plugin>/scripts/principles scan . --format sarif -o principles.sarif` (exit 1 on errors; `--fail-on warning` for stricter gates; `--baseline` to adopt on a legacy repo).
