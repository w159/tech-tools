---
name: evidence-gap-hunter
description: Find missing, expiring, or stale evidence documents in Vanta across one or more frameworks. Use when user asks "what evidence is missing", "what policies are expiring", "evidence gaps before audit", or for monthly evidence health checks.
---

# Evidence Gap Hunter (Vanta)

## Pipeline

1. `vanta_frameworks_list` — pick scope (user-named framework or "all active").
2. `vanta_documents_list` with `frameworkMatchesAny=[<framework_id>]` (paginated).
3. `vanta_documents_list` again with `statusMatchesAny=["MISSING","EXPIRING","NEEDS_REVIEW"]` for the same scope (the API may filter differently — fall back to client-side filtering if needed).
4. **In `ctx_execute`**:
   - Group documents by status: MISSING, EXPIRING (within 30d), STALE (>1y since last update), CURRENT.
   - For EXPIRING, compute days-until-expiry and sort ascending.
   - For MISSING, group by category (policy / training / attestation / vendor doc).

## Output

- **Summary table**: status → count per framework.
- **Top 20 expiring soonest** with days-left and owner.
- **All missing evidence** grouped by category, with the parent control name so the user can see *why* it matters.
- **Stale-but-current** appendix (>365d since update) — usually means re-attest needed.

## Rules

- NEVER imply something is fine just because status=CURRENT — flag stale-but-current as a soft warning.
- If `statusMatchesAny` returns 0 results, double-check with a fresh list (might be a filter-name mismatch in this workspace).
