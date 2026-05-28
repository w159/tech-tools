---
name: ticket-triage
description: Cluster, prioritize, and route open ConnectWise tickets with assignment recommendations. Use when user asks "triage the queue", "what tickets need attention", "morning ticket review".
---

# Ticket Triage (ConnectWise)

## Pipeline

1. `cw_search_tickets` filter: `status != Closed`, sort by lastUpdated desc, limit=200.
2. **Enrichment in parallel** (concurrency 6):
   - For each unique companyId: `cw_get_company`.
   - For each unique memberId on `owner`: `cw_get_member`.
3. **Cluster in `ctx_execute`** (JS):
   - Group by company + summary-similarity (token Jaccard) — surfaces "same issue, many users".
   - Detect duplicate tickets across the queue.
4. **Prioritize**:
   - score = SLA proximity (×3) + severity (×2) + cluster_size (×1) + customer tier (×2)
5. **Assignment hints**:
   - For each cluster, suggest owner based on prior resolutions (search `cw_search_tickets` closed, same subject pattern, group by owner with highest close count).
6. **Output**:
   - Top 10 clusters with: ticket IDs, suggested owner, suggested action, SLA timer.
   - Standalone urgent tickets.
   - "Old & stuck" tail (no update >14d).
   - For device-centric tickets, flag whether `cw-ticket-device-troubleshoot` from `msp-tool-bridge-ops` should be the next handoff.

## Performance

- Single fetch for tickets, parallel enrichment, all aggregation in code. Never iterate ticket-by-ticket in conversation.
