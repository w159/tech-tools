---
name: network-triage
description: Auto-triage Auvik network alerts by correlating alerts → impacted devices → topology neighbors → recent config changes. Use when user asks "what's wrong with the network", "triage alerts", or reports a network outage.
---

# Network Triage (Auvik)

Composite workflow that turns raw Auvik alerts into root-cause hypotheses in one pass.

## When to invoke

- User reports degraded/down network, "investigate alerts", "why is X slow/offline".
- Periodic NOC sweep (combine with `/loop`).
- Before opening a CW ticket — produce the evidence pack first.

## Pipeline (run in parallel where possible)

1. **Snapshot fan-out** — call simultaneously:
   - `auvik_alerts_list` with `filter_status=created`, `filter_severity=warning`, `pageSize=100`
   - `auvik_status` (server/API health)
   - `auvik_tenants_list` (only if multi-tenant gateway)
2. **For each alert** in parallel batches of 5:
   - `auvik_devices_get` on `entityId` to enrich (model, vendor, role, last_seen)
   - `auvik_interfaces_list` with `filter_parentDevice=<deviceId>` to flag down/error interfaces
   - `auvik_statistics_device` with `statId=cpuUtilization` (device health)
   - `auvik_statistics_device` with `statId=memoryUtilization` (memory pressure)
3. **Topology blast radius** — for each impacted device:
   - `auvik_networks_list` with `filter_deviceId=<deviceId>` to find related networks
   - List sibling devices on the same network; mark which are also alerting
4. **Change correlation** — call `auvik_configurations_list` with `filter_deviceId=<deviceId>` and `pageSize=10`; sort and diff by `attributes.backupTime`.
5. **Synthesize**: rank alerts by (severity × impacted_device_count × dependent_service_count). Output ranked incident list with: root-cause hypothesis, evidence, recommended next action.

## Output shape

```
Tier 1 (act now):
  - [device] [alert] — hypothesis — evidence — action
Tier 2 (watch):
  ...
Noise (ack/suppress):
  ...
```

## Performance rules

- Always issue device enrichment in parallel via a single agent message containing many tool calls.
- Cap to top 25 open alerts per pass; if more, sort by `severity` then `firstSeen` desc and warn user.
- Use `ctx_execute` (javascript) to aggregate/sort large responses — never dump raw JSON into context.

## Don'ts

- Don't acknowledge or close alerts without explicit user approval (write operation).
- Don't query a tenant the user didn't authorize in gateway mode.
