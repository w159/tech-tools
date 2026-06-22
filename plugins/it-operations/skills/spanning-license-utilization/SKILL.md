---
name: spanning-license-utilization
description: Audit Kaseya Spanning Backup seat utilization  -  find unused seats consumed by stale/offboarded users, predict when the org will run out, and produce a reclamation list. Use when user asks "how many seats are we using", "free up Spanning seats", or before a license renewal.
---

# License Utilization Audit (Kaseya Spanning Backup)

Find waste in your Spanning seat count and produce a reclamation list ranked by confidence.

## When to invoke

- License renewal coming up.
- User asks about seat usage, capacity, or how to free seats.
- After an offboarding sweep - verify Spanning seats were released.

## Pipeline

1. **Baseline**: `spanning_license_get` - purchased, consumed, % utilization.
2. **Enumerate**: `spanning_users_list_all(maxItems=5000)` - every user the token can see.
3. **Sample backup recency** in parallel batches of 4: for each user, pick the largest protected service (mail for M365, drive for GWS) via `spanning_services_list` and call `spanning_backups_list(limit=1)`. The `createdAt` / `completedAt` of that latest backup is the user's "last successful protection" timestamp.
4. **Categorize**:
   - **STALE_RECLAIMABLE**: last backup > 30 days ago AND no audit activity referencing the user in last 30 days. High confidence the seat can be freed.
   - **STALE_REVIEW**: last backup 14-30 days ago. Possibly on leave; recommend manual review.
   - **HEALTHY**: backed up within last 14 days.
   - **PROTECTED_BUT_EMPTY**: user exists but services list is empty - provisioning bug or never-onboarded account.
5. **Forecast** burn rate from `spanning_audit_list(from = now - 90d)` "user added" events. Extrapolate days until consumed seats > purchased.

## Output

- One-line summary: `X / Y seats consumed (Z% util). ~N days to exhaustion at current rate.`
- Reclamation table (only STALE_RECLAIMABLE + PROTECTED_BUT_EMPTY):

```
| userId | category | last backup | recommended action |
|--------|----------|-------------|--------------------|
```
