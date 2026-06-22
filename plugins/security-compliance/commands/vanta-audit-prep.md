---
description: "Audit-prep dossier for a specific Vanta framework. Usage: /vanta-audit-prep <framework-id-or-name>"
---

# Vanta Audit Prep

Argument: the framework the auditor is asking about (e.g. `soc2`, `iso27001`, `hipaa`).

Pipeline:

1. Invoke `framework-audit-readiness` for the framework.
2. Invoke `evidence-gap-hunter` scoped to the same framework.
3. Merge into one dossier:
   - Section A - Control readiness (pass rate, top at-risk controls).
   - Section B - Evidence health (missing/expiring docs).
   - Section C - Recommended pre-audit fix list (the union of "quick wins" from A and "expiring soonest" from B).

Output is a status report, not an action plan. Never auto-update evidence; only surface what's needed.
