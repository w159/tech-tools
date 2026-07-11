---
name: spanning-backup-health-sweep
description: Sweep Kaseya Spanning Backup for failed/missing daily backups, stale users (no successful backup in N days), and seat exhaustion across M365/GWS/Salesforce. Use when user asks "are backups healthy", "show me failed backups", "what's wrong with Spanning", or for a periodic NOC sweep.
---

# Backup Health Sweep (Kaseya Spanning Backup)

Composite workflow that turns Spanning Backup state into a ranked operator action list in one pass.

## When to invoke

- User asks about Spanning backup health, missing/failed backups, or seat exhaustion.
- Periodic sweep (combine with `/loop`).
- Before reporting protected-data coverage to a customer.

## Pipeline (parallelize where possible)

1. **Snapshot fan-out** - call simultaneously:
   - `spanning_license_get` - purchased vs. consumed seats.
   - `spanning_audit_list` with `from = now - 24h` - recent admin/restore activity.
   - `spanning_users_list` (limit=500) - first page is usually enough to sample on small/medium tenants. For >500-user tenants, fall back to `spanning_users_list_all` with `maxItems=2000` cap.
2. **For a sampled cross-section of users** (or all if small) in parallel batches of 4:
   - `spanning_services_list` - which services are protected.
   - For each protected service: `spanning_backups_list` (limit=7) - surface any service with <7 successful backup records in the last 7 days, or any backup whose status indicates failure.
3. **Rank issues** by:
   - **P1**: failed restores in last 24h (from audit), seat overflow (consumed > purchased).
   - **P2**: any user with a service missing >2 of last 7 days of backups.
   - **P3**: stale users (no successful backup in 14+ days) - possible offboarded accounts still consuming seats.
   - **P4**: seats above 80% utilization (warning).
4. **Synthesize**: output a ranked action list, each row carrying `userId`, `service`, observation, and recommended next step (re-run, investigate audit entry, free seat, etc.).

## Pacing

Spanning enforces 100 req/min per token. The sampled fan-out above stays well under that even on a 500-user tenant. If you need a full deep scan, prefer `*_list_all` tools with `maxItems` caps to avoid running the budget down.

## Output format

Markdown table, sorted by priority then by `userId`:

```
| P | userId | service | observation | next step |
|---|--------|---------|-------------|-----------|
| 1 | alice@ | mail    | restore failed 02:14Z | open audit entry abc123 |
```
