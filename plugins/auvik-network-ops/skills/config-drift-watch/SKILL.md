---
name: config-drift-watch
description: Detect unauthorized or unexpected device configuration changes across Auvik-monitored devices by diffing recent config snapshots. Use when user asks "what changed on the network", "audit config changes", or after a suspected incident.
---

# Config Drift Watch (Auvik)

## Pipeline

1. `auvik_devices_list` filtered to manageable types (routers, switches, firewalls).
2. **Parallel** `auvik_configurations_list` with `filter_deviceId=<deviceId>` and `pageSize=2` (most recent + previous snapshot).
3. **Diff in code** (`ctx_execute`):
   - For each device pair: compute structured diff (line-level + section-level).
   - Classify changes: ACL/policy, interface, routing, credentials, NTP/DNS.
   - Score risk: ACL/credential = high, cosmetic = low.
4. **Correlate** with change tickets in ConnectWise if `connectwise-psa-ops` plugin is present (search by date window). Flag unmatched changes.
5. **Output**: prioritized drift report — unauthorized first, then authorized, then noise.

## Don'ts

- Never automatically revert — emit recommended commands only.
- Skip devices where no prior snapshot exists; note them as "no baseline".
