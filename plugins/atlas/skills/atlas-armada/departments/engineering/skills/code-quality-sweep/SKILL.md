---
name: code-quality-sweep
description: Run a fallow static analysis pass on a JavaScript or TypeScript repo and synthesize a prioritized, ranked code-quality report covering changed-code risk, complexity hotspots, and architecture boundary violations. Use when the user asks "run a code quality sweep", "analyze code quality with fallow", or "what is risky in this changed code". Read-only and advisory.
when_to_use: "When sweeping changed or full-tree code for complexity hotspots, boundary violations, duplication, and circular dependencies, or ranking findings for the code-review and tech-debt skills"
allowed-tools: Read, Glob, Grep, Bash
---

# Code Quality Sweep

Drive the `fallow` skill over a JavaScript or TypeScript repo and turn its raw static-layer output into a single ranked findings list that the existing `code-review` and `tech-debt` skills can consume. This skill is read-only. It never edits, deletes, or commits.

## Pipeline

1. Confirm scope. Ask the user (or infer from the working directory) which repo or subtree to sweep, and whether to focus on the full tree or only changed code (diff against a base branch). Confirm the project is JavaScript or TypeScript, which is the surface fallow supports.
2. Invoke the fallow skill via the Skill tool as `fallow:fallow`. Request the free static layer: code quality, changed-code risk, complexity hotspots, architecture boundary violations, code duplication, and circular dependencies. Do not hardcode internal fallow command names; let the skill drive its own analysis.
3. Collect the static findings. If the repo has JavaScript or TypeScript runtime coverage available, also request fallow's hot-path review so high-traffic code is weighted higher in the ranking. If no runtime data exists, proceed with static findings only and say so.
4. Normalize each finding into a common record: category, file path, line or symbol, short description, and a severity signal from fallow.
5. Rank the findings. Sort by a priority score that combines severity, blast radius (changed code and hot paths rank above cold or untouched code), and fix difficulty. Surface boundary violations and high-complexity hotspots in changed code at the top.
6. Produce the report (see Output). Offer to hand the ranked list to the `code-review` skill for line-level review or the `tech-debt` skill for backlog scoring.

## Output

A prioritized findings list, highest priority first. For each finding include:

- Rank and priority rationale (why it scored where it did).
- Category (changed-code risk, complexity hotspot, boundary violation, duplication, circular dependency).
- Location: file path plus line or symbol.
- Evidence from fallow (the metric or pattern that triggered it).
- Suggested next step, and which downstream skill (`code-review` or `tech-debt`) should pick it up.

Close with a one-paragraph summary: total findings by category, the top three to address first, and whether runtime coverage informed the ranking.

## Rules and Guardrails

- Read-only and advisory. This skill never edits files, never deletes, never commits, and never runs build or install commands.
- Ground every finding in fallow output. Do not invent metrics, file paths, or severities that fallow did not report.
- If fallow reports nothing for a category, say so explicitly rather than padding the list.
- If the target is not JavaScript or TypeScript, stop and tell the user fallow does not cover it; do not fabricate a sweep.
- Keep the report actionable: every finding names a location and a next step.
