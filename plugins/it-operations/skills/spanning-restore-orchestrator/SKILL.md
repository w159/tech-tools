---
name: spanning-restore-orchestrator
description: Orchestrate a Kaseya Spanning Backup restore end-to-end — pick the right backup point, queue the restore, poll until terminal status, and report actionable outcome. Use when user asks to "restore <user>'s <service>", recover deleted items, or roll back a mailbox/drive.
---

# Restore Orchestrator (Kaseya Spanning Backup)

End-to-end restore workflow that minimizes operator round-trips and stays inside Spanning's 100-req/min budget.

## When to invoke

- User asks to restore a user's mailbox/drive/calendar/contacts.
- Recovery after accidental deletion or ransomware.
- Operator pre-stages a restore from a known backup point.

## Inputs to gather (elicit only if missing)

- `userId` (resolve from email via `spanning_users_list` if user gave an address).
- `service` (e.g. `mail`, `drive`, `calendar`, `contacts`) - confirm against `spanning_services_list` for that user.
- Target restore point: either explicit `backupId`, or a date - find via `spanning_backups_list` (limit=30) and pick the closest successful backup <= requested date.
- Optional `destination` (default = same user) - ALWAYS confirm if non-default.
- Optional `itemIds` (partial restore) or `extra` payload (service-specific).

## Pipeline

1. **Resolve identity**: if input was an email, look up `userId` from `spanning_users_list` (filter client-side by `email`/`upn`).
2. **Confirm protected service**: `spanning_services_list(userId)` - fail fast if the service isn't protected.
3. **Pick backup point**: `spanning_backups_list(userId, service, limit=30)` and find the closest successful record <= target date. If user named a `backupId`, validate it exists.
4. **Confirm with operator** before queueing (especially if destination != source).
5. **Queue restore**: `spanning_restores_queue(userId, service, backupId, destination?, itemIds?)` -> returns `restoreId`.
6. **Wait for terminal status**: `spanning_restores_wait_for(restoreId, intervalMs=30000, timeoutMs=600000)`.
7. **Report outcome**:
   - `completed` -> confirm and list any per-item stats from the response.
   - `failed` -> surface the `error` field, pull the matching `spanning_audit_list(from=...)` entry, and suggest the next operator action.
   - `cancelled` -> confirm and ask whether to re-queue.

## Guardrails

- VISIBLE-TO-OTHERS / DESTRUCTIVE: a restore writes data back into a user's live mailbox or drive. Never queue a restore without operator confirmation when `destination` differs from source.
- Spanning permits only one in-flight restore per (userId, service) - if you get a 409, surface it and ask whether to wait for the current one to finish first (`spanning_restores_wait_for`).
- Don't reduce `intervalMs` below 5000 - Spanning's 100 req/min budget is shared across the whole tenant.
