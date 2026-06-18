---
description: Orchestrate a Spanning restore — pick the right backup, queue it, and wait for terminal status.
---

Invoke the `spanning-restore-orchestrator` skill from the `it-operations` plugin. If the user provided a userId+service+date, jump straight to backup selection; otherwise elicit the missing parameters one at a time. Always confirm the destination before queueing. Poll with `spanning_restores_wait_for` (30s interval) and report final status with operator-actionable summary if it ends in `failed`.
