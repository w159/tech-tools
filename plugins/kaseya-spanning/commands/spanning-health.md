---
description: Run the Kaseya Spanning Backup health sweep — surface failed/missing backups, stale users, and seat exhaustion in under 60s.
---

Invoke the `backup-health-sweep` skill from the `kaseya-spanning` plugin. Parallelize: pull license + recent audit + a sampled cross-section of users' last-7-day backups, then rank issues by impact (failed restores > missing service-days > stale users > seat exhaustion). Output a ranked action list with affected users and recommended next step.
