---
name: spanning-audit-forensics
description: Investigate Kaseya Spanning Backup activity — who restored what, when, and why; surface anomalous restore patterns and tie events to specific users/services. Use when user asks "who restored this", "audit Spanning activity", "investigate suspicious restore", or for compliance review.
---

# Audit Forensics (Kaseya Spanning Backup)

Reconstruct Spanning Backup activity for a window - incident, compliance, or capacity investigation.

## When to invoke

- Suspicious or unexpected restore reported.
- Compliance / audit requirement (SOC 2, HIPAA evidence collection).
- Postmortem after a data-loss event - confirm restores ran and succeeded.

## Pipeline

1. **Bound the window** - elicit `from`/`to` ISO 8601 dates. Default: last 7 days.
2. **Pull audit**: `spanning_audit_list_all(from, to, maxItems=5000)`.
3. **Classify entries** into:
   - `restore_queued`, `restore_completed`, `restore_failed`, `restore_cancelled`
   - `user_added`, `user_removed`, `seat_changed`
   - `admin_login`, `token_issued`, `token_revoked`
   - other
4. **Per-user heat map**: count events grouped by user, sorted by event count desc.
5. **Anomaly detection** - flag:
   - Restore bursts: >5 restores by the same admin within 1 hour.
   - Cross-user restores: restore where destination != source user (potential exfiltration).
   - Failed-restore clusters: >2 failures for the same user/service in the window.
   - Off-hours activity: events outside business hours (configurable; default 18:00-06:00 in operator's TZ).
6. **For each flagged event**, pull the corresponding restore via `spanning_restores_get(restoreId)` to confirm final state and surface any `error` field.

## Output

- Executive summary: total events, restores by status, admins involved, anomalies count.
- Anomaly table with `timestamp | event | actor | target | confidence | next step`.
- Per-user heat-map (top 20 by event count) for the operator to pivot on.
