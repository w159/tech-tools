---
name: vendor-risk-rollup
description: Roll up third-party vendor risk in Vanta — status breakdown, stale reviews, highest-risk vendors. Use when user asks "vendor risk summary", "what vendors need review", "third-party risk rollup", or for quarterly vendor-management reports.
---

# Vendor Risk Rollup (Vanta)

## Pipeline

1. `vanta_vendors_list` — full inventory (paginate until `hasNextPage=false`).
2. **In `ctx_execute`**:
   - Bucket by `status` (e.g. IN_REVIEW, APPROVED, REJECTED, PENDING).
   - Bucket by inherent-risk tier if present on the vendor object.
   - Identify vendors whose last review is >365d old → STALE.
   - Identify vendors flagged HIGH or CRITICAL risk that are still APPROVED → escalation list.

## Output

- **Headline numbers**: total vendors, % approved, % in review, % high-risk.
- **Top 10 highest-risk approved vendors** with last-review date.
- **Stale reviews list** (>365d) sorted by review age desc.
- **Pending queue** that's been pending >30d (vendor onboarding stuck).

## Rules

- Treat absence of `lastReviewedAt` as STALE, not as missing-data.
- If the workspace has >2000 vendors, summarize counts and offer to drill into one tier on request.
