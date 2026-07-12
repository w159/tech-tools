---
name: dead-code-cleanup
description: "Use fallow's cleanup layer to find unused files, exports, types, and dependencies plus cold-path deletion confidence from runtime coverage, then produce a safe, confirmation-gated deletion plan for a JavaScript or TypeScript repo. Use when the user asks \"find dead code\", \"clean up unused exports and dependencies\", or \"what is safe to delete\". DESTRUCTIVE: deletions are gated behind explicit confirmation; advisory by default."
when_to_use: "When finding unused files, exports, types, or dependencies, grading deletion confidence with runtime cold-path data, or building a confirmation-gated deletion plan"
allowed-tools: Read, Glob, Grep, Bash
---

# Dead Code Cleanup

Drive the `fallow` skill's cleanup layer to identify removable code and dependencies, grade each candidate by deletion confidence, and assemble a deletion plan. This skill is advisory by default. It proposes; it does not delete until the user confirms.

## Pipeline

1. Confirm scope. Identify the JavaScript or TypeScript repo or subtree and confirm fallow supports it. Ask whether the user wants a full-tree cleanup pass or a scoped one (a specific package or directory).
2. Invoke the fallow skill via the Skill tool as `fallow:fallow`. Request the cleanup layer: unused files, unused exports, unused types, and unused dependencies. Let fallow drive its own analysis; do not hardcode internal command names.
3. If JavaScript or TypeScript runtime coverage is available, request fallow's cold-path deletion-confidence signal. Code with no production execution over the captured window ranks as higher-confidence removal. State clearly when runtime data is absent, because static-only confidence is weaker.
4. Classify each candidate by deletion confidence:
   - High: unused by static analysis AND cold in runtime coverage, no dynamic-access patterns.
   - Medium: unused by static analysis, no runtime data to confirm.
   - Low: referenced via dynamic patterns (string keys, reflection, framework auto-wiring) or part of a public API surface; flag for manual review, do not auto-delete.
5. Build the deletion plan (see Output), grouped by confidence tier, with the exact files, exports, types, or dependency entries to remove.
6. STOP and present the plan. Do not delete anything yet. Ask the user to confirm which tiers or specific items to remove.
7. Only after explicit confirmation, perform the approved deletions. Re-run fallow (or the project's build and tests if the user authorizes it) to confirm nothing broke, and report what changed.

## Output

A deletion plan grouped by confidence tier (High, Medium, Low). For each candidate include:

- Kind: unused file, unused export, unused type, or unused dependency.
- Location: file path plus symbol or dependency name.
- Evidence: the static signal and, when present, the runtime cold-path signal from fallow.
- Confidence tier and the reason it landed there.
- Recommended action: delete, review first, or keep.

Close with a summary: counts per tier, an estimate of lines and dependencies removable at High confidence, and the explicit confirmation prompt before any deletion.

## Rules and Guardrails

- DESTRUCTIVE: deletions require explicit user confirmation. Never delete on the first pass. Present the plan, wait, then act only on confirmed items.
- Advisory by default. If the user only wants the plan, stop after Output and do not modify the tree.
- Never auto-delete Low-confidence candidates (dynamic access, public API, framework-wired). Always route them to manual review.
- Ground every candidate in fallow output. Do not invent unused symbols or dependencies.
- After any confirmed deletion, verify (re-run fallow or, with permission, the build and tests) and report results with evidence. Do not claim a clean removal without checking.
- If the target is not JavaScript or TypeScript, stop and tell the user fallow does not cover it.
