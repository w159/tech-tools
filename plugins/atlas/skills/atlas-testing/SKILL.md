---
name: atlas-testing
description: "Plans, generates, and runs tests in any language: detects the stack and existing tests, maps gaps across every testing type (unit through mutation, fuzz, load, security, accessibility), recommends the highest-value next test, writes it, runs it, and reports evidence. Use when adding tests, choosing a test strategy, or finding what testing is missing."
when_to_use: "write tests, add tests, test strategy, what tests am I missing, test gaps, mutation testing, property-based, fuzz, load test, coverage, flaky tests, contract test, e2e test, benchmark"
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: "[path or module] [gaps|plan|write|run|mutate]"
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` (plugin root `references/`, not this skill's `references/`) and apply it before proceeding.

# atlas-testing

Plan, generate, and run tests for a target path or module in any language. Detect the
stack and existing tests, map gaps across every testing type, recommend the highest-value
next test, write it, run it, and report evidence.

**Depth lives in references/. Read the file the phase table names before each phase; do
not substitute remembered tool names for them.**

| Phase | Read | Owns |
|---|---|---|
| 1. Detect + inventory | `references/taxonomy.md` | canonical type ids, layers view, synonym resolution; what the stack already has |
| 2. Gap analysis + recommend | `references/selection-and-gaps.md` | risk signals, gap complement matrix, scoring, reading testscope gaps, anti-recommendations |
| 3. Generate + run + evidence | `references/workflow.md` | authoring rules, seeded-fault proof, run cadence (PR subset vs nightly), flake triage, evidence report format |

## Arguments

`$ARGUMENTS` is `[path or module] [mode]`. Missing path means the repo root. Mode (first
token of `gaps` / `plan` / `write` / `run` / `mutate`; anything else is treated as part of
the path):

| Mode | Behavior |
|---|---|
| `gaps` (default) | Detect stack, inventory existing tests, run `testscope gaps`, present the ranked gap table (priority, reason, closing reference). No authoring. |
| `plan` | Recommend a test strategy for the path/module: risk signals give type ids with must/should/could priorities and a run order. No authoring. |
| `write` | Author tests for the target with the chosen type ids per `references/workflow.md`, run them, prove sensitivity: seeded fault fails, revert passes. |
| `run` | Detect and run the existing suites using `testscope commands` output; report evidence per suite. On `[]` with test files present, say no runner was detected and use only a stdlib runner the language reference names (Python: `python3 -m unittest discover -s <dir> -p 'test_*.py'`). |
| `mutate` | Mutation pass: pick the mutation runner the language file names, run it, report killed/survived counts and surviving-mutant locations. |

`testscope` scans only under `--root`; pass the smallest directory that holds both the code and its tests. Triage large `mutmut results` output by grouping survivors per function (`mutmut results | sort | uniq -c | sort -rn | head`) and report the top functions, not the full list.

## Script: testscope

Stdlib-only, python3.9+, read-only on the target repo. Run via bash:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/atlas-testing/scripts/testscope.py" <detect|gaps|commands> [--root PATH] [--format json|md]
```

(Unit tests for it: `scripts/test_testscope.py`.)

- `detect` returns `{languages: {name: {files}}, frameworks, test_tools: [{tool, type_ids, evidence}], ci: [paths]}`.
- `gaps` returns per detected area: `{area, type_id, status: present|missing|n/a, priority: must|should|could, reason, reference}`.
- `commands` returns `[{tool, type_id, command, note?}]`, exact run commands for the
  detected tools. `note` marks tools that run inside another suite (for example
  axe-core inside vitest); never add flags the note does not name.

Never invent tool names the script did not detect. If `detect` reports nothing for an
area, say so and stop that branch instead of guessing.

## Mandatory reads

Read `references/taxonomy.md`, `references/selection-and-gaps.md`, and
`references/workflow.md` before phase 1, 2, and 3 respectively. Then read the file each
row names, only when its trigger applies:

| Trigger | Read |
|---|---|
| Functional or system types: static-lint, type-check, unit, integration, component, api, contract, e2e, smoke, regression, acceptance-bdd, snapshot-approval, characterization, exploratory | `references/types-functional.md` |
| Coverage, flakiness, test impact analysis, test smells | `references/types-test-quality.md` |
| Mutation work in any mode | `references/types-mutation.md` |
| Property-based, fuzz, metamorphic, combinatorial, differential, model-based | `references/types-input-generation.md` |
| Benchmark, load, chaos, accessibility, visual-regression, cross-browser, i18n, usability | `references/types-nonfunctional.md` |
| SAST, SCA, secrets, DAST, IaC policy, container scan, authz, supply chain | `references/types-security.md` |
| Data quality, DB migration, SQL, RLS | `references/data-sql-databases.md` |
| CI pipeline validation, IaC, containers | `references/infra-iac-containers-ci.md` |
| Docs examples, notebooks, link check, web assets | `references/docs-notebooks-web-assets.md` |
| Detected language (read the one named): Python `references/lang-python.md`, TS/JS `references/lang-typescript-javascript.md`, PHP `references/lang-php.md`, Swift `references/lang-swift.md`, C#/.NET `references/lang-dotnet.md`, PowerShell `references/lang-powershell.md`, Bash/sh `references/lang-shell.md`, Go `references/lang-go.md`, Rust `references/lang-rust.md`, Java/Kotlin `references/lang-jvm.md`, C/C++ `references/lang-c-cpp.md`, Ruby `references/lang-ruby.md` | the language file |

## Routing

- Building or testing an iOS app on a simulator belongs to `atlas-test-xcode`
  (xcodebuild/simctl), not this skill.
- Browser UX walkthroughs and persona swarms belong to `atlas-ux-test`.

## Delegating authoring

When authoring exceeds inline scope (multi-file suite, sweep across modules), dispatch a
`test-engineer` subagent (`plugins/atlas/agents/test-engineer.md`) with the target path,
the chosen type ids, the exact reference files it must read, and the evidence directory.
Verify its claimed runs yourself (rerun the commands, check exit codes) before accepting
them; an unverified claim is not a result.

## Evidence rules

Every claim carries its exact command, its real exit code, and the decisive output lines.

- New test: run it green, seed a fault (mutate an operator, invert a condition, remove a
  call), show it fails naming the behavior, revert, show it green again. Failing-before /
  passing-after. A test that cannot fail on a seeded fault is not an acceptable deliverable.
- Mutation: killed and survived counts, surviving mutant locations, and whether each
  survivor warrants a new test.
- Runs: suite totals (passed/failed/skipped), quarantine state, rerun counts for flakes.
  Never report "should pass" in place of an actual run.
- Evidence lands under `.atlas/evidence/<YYYY-MM-DD>-<slug>/` as it is captured, and the
  report uses the fixed block in `references/workflow.md`.

## Hard rules

- Exit status is the verdict. A missing pasted status is a failed run, not a formatting nit.
- Never weaken an assertion or delete a test to make a suite pass. Surface it as a smell
  (`references/types-test-quality.md`) instead of applying it.
- Do not author or mutate surfaces another skill owns (see Routing).
- Regulated context (client data, financial calculations): gaps in authz, data exposure,
  audit logging, encryption-at-rest config, and calculation correctness are never
  downgraded below `must` priority (`references/selection-and-gaps.md`).
- Read-only on the target repo except new or changed test files and fixtures.

## Output

Report with the fixed evidence block from `references/workflow.md` (all fields, even when
zero or none), point at the evidence directory, and close with the single highest-priority
next-test recommendation (type id, area, why) in every mode, including `run` and `mutate`.