# Glossary

Canonical terms for the atlas plugin. One meaning per term; use the term, not a synonym.

- **Hook fault**: a record that a hook crashed or timed out. The doctor counts hook faults over the last 24 hours and reports the plugin as unhealthy above a threshold.
- **Friction row**: a per-session note that a hook skipped work it would normally do. A friction row is not a fault and is never counted by the doctor.
- **Quiet reason**: a skip reason, such as a missing formatter or a parse error, that produces a friction row and no fault.
- **Selffix branch**: a branch in its own worktree, created by an atlas run to fix one todo, pending merge into main.
- **omp bridge**: the check that the omp install of atlas matches the plugin version the doctor is running from.
- **Boot window**: the time session boot allows the dashboard ensure call before it gives up.
- **Singleton lock**: the per-port lock that lets only one session start or health-check the dashboard at a time.
- **Stale asset**: an installed plugin copy that is not the registered version. The doctor quarantines stale assets.
