# Loop library - INDEX

The catalog the `atlas-chronos` skill reads first. Match a task to a loop by its `when-to-use`, then open that one file for full steps and a ready-to-paste template. Do not preload the loop files; this table is enough to choose.

Cadence legend: **interval** (timer-driven `/loop`), **self-paced** (`/loop` with model self-pacing), **fan-out** (parallel subagents + adversarial verify Workflow).

| id | category | cadence | when-to-use | file |
|---|---|---|---|---|
| loop-until-dry | discovery | self-paced | Keep probing/searching until a sweep returns nothing new - exhaust a search space or drain a finding queue. | loops/loop-until-dry.md |
| fan-out-adversarial-verify | review | fan-out | Review a change set or artifact in parallel, then have a separate agent try to refute each finding before you trust it. | loops/fan-out-adversarial-verify.md |
| red-green-tdd | build | self-paced | Implement a feature or fix test-first: write a failing test, make it pass, refactor, repeat per requirement. | loops/red-green-tdd.md |
| doc-reconcile | docs | self-paced | Bring ROADMAP/CHANGELOG/docs back in sync with the code after changes landed - reconcile drift item by item. | loops/doc-reconcile.md |
| incident-triage | ops | interval | Poll a live incident or alert source on a timer, re-triage as state changes, until the incident is resolved. | loops/incident-triage.md |
| dependency-bump-sweep | maintenance | fan-out | Bump many dependencies, building and testing each in isolation so one bad upgrade does not mask the rest. | loops/dependency-bump-sweep.md |
| flaky-test-hunt | testing | interval | Re-run a suspect test many times to surface intermittent failures and capture the conditions that trip it. | loops/flaky-test-hunt.md |
| migration-pipeline | data | self-paced | Run a multi-step data or schema migration stage by stage, verifying each stage before advancing. | loops/migration-pipeline.md |
| perf-profile-iterate | performance | self-paced | Profile, fix the top hotspot, re-profile, and repeat until a latency or throughput target is met. | loops/perf-profile-iterate.md |
| security-finding-verify | security | fan-out | Triage a batch of scanner findings in parallel and prove each one true-positive or false-positive with evidence. | loops/security-finding-verify.md |
| build-fix-loop | build | interval | Watch a flaky or failing build, diagnose each failure as it appears, and re-run until the build is green. | loops/build-fix-loop.md |
| code-review-iterate | review | self-paced | Drive a PR through review rounds - address feedback, re-request review, repeat until approved and merged. | loops/code-review-iterate.md |
