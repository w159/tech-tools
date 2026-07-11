---
id: incident-triage
name: Incident triage
category: ops
cadence: interval
inputs:
  - source: where incident state lives (an alert feed, a status endpoint, a log query, a dashboard)
  - poll_interval: how often to re-check (e.g. 60s for an active page, 5m for a watch)
  - triage_rules: how to classify and what action each class triggers
  - resolved_definition: the condition that means the incident is over
---

# incident-triage

Poll a live incident source on a timer and re-triage as the situation changes. Interval cadence because incident state evolves on the clock, not on your pace - you want a fresh read every `poll_interval` until it clears. Each tick: pull current state, classify it, take or recommend the class action, and decide whether it is resolved.

## Steps

1. **Read state.** Pull current incident state from `source`. Route large output through `context-mode`.
2. **Classify.** Apply `triage_rules` to rank severity and assign a class (e.g. investigating / mitigating / monitoring / resolved).
3. **Act or recommend.** Each class maps to an action. Read-only sources just report; an action that writes or pages others gates for approval first (mark it VISIBLE-TO-OTHERS).
4. **Log the tick.** Record the timestamp, the class, what changed since last tick, and the action taken.
5. **Next tick.** The interval timer re-runs the body until `resolved_definition` holds, then stops. Before declaring the incident resolved, confirm `resolved_definition` with an independent read of `source` in a fresh context (dispatch `atlas:verifier`) per atlas-metis law 5, rather than the polling agent self-attesting that state cleared.

## Stop condition

State matches `resolved_definition` (alert cleared, error rate back to baseline, incident closed), or an operator stops the loop.

## Template (interval /loop)

```
/loop <poll_interval> Read current incident state from <source>, classify it with <triage_rules>, log the timestamp + class + what changed since the last tick + recommended action. Mutating or paging actions stop for approval first. When state matches <resolved_definition>, report resolution and stop.
```

Pick `poll_interval` from incident tempo: tight (30-60s) while active, looser (5-15m) while monitoring. Mutating remediations gate before firing.
