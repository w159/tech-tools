---
name: framework-audit-readiness
description: Assess audit readiness for a specific Vanta framework (SOC 2, ISO 27001, HIPAA, etc.). Surfaces every failing test and the controls they map to. Use when user asks "are we audit ready for SOC 2", "what's failing in ISO 27001", or for pre-audit gap reviews.
---

# Framework Audit Readiness (Vanta)

## Pipeline

1. `vanta_frameworks_list` -- confirm the framework ID exists in this workspace.
2. `vanta_frameworks_get` for the chosen framework -- capture name + product family.
3. `vanta_frameworks_list_controls` (paginated) -- every control scoped to the framework.
4. `vanta_tests_list` with `frameworkFilter=<id>` and `statusFilter=NEEDS_ATTENTION` (paginated).
5. **In `ctx_execute`**:
   - Join failing tests to their parent controls.
   - Bucket by control category (access management, change management, vendor management, etc.).
   - Compute a coverage score: `passing_tests / total_tests` per control.

## Output

- **Header**: framework name, total controls, total tests, pass rate %.
- **Top 10 at-risk controls** (lowest pass rate first), each with: control name, failing tests inline, suggested owner if available.
- **Quick wins**: controls with exactly one failing test -- fix-first list.
- **Blocker controls**: controls with zero passing tests -- escalate.

## Rules

- Never auto-remediate. Output is a triage report, not actions.
- Always include the framework ID and a link-friendly slug in the header so the user can deep-link in the Vanta UI.
- If pagination yields >500 tests, sample the first 200 NEEDS_ATTENTION and note that more exist.
