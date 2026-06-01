---
name: bandwidth-hog-hunt
description: Find top bandwidth consumers across all Auvik tenants in one pass, with per-interface attribution and time-window comparison. Use when user asks "who's using the bandwidth", "find top talkers", "slow internet at <site>".
---

# Bandwidth Hog Hunt (Auvik)

Hunts top bandwidth consumers globally or per-tenant, ranks by Δ vs. baseline, and attributes traffic to interfaces/devices.

## Pipeline

1. `auvik_tenants_list` → tenant set (or use the one the user named).
2. **Parallel fan-out per tenant**:
   - `auvik_statistics_interface` with `statId=bandwidth`, `interval=minute`, `fromTime=<now-1h>`, `thruTime=<now>`
   - `auvik_statistics_interface` with `statId=bandwidth`, `interval=minute`, `fromTime=<same-hour-last-week>`, `thruTime=<same-hour-last-week+1h>` (baseline)
3. **Aggregation in code** (`ctx_execute` JS):
   - Join current vs baseline by `interfaceId`.
   - Compute `delta_bps`, `pct_change`, `current_utilization_%`.
   - Filter: `current_utilization_% >= 70` OR `pct_change >= 2.0x`.
4. **Enrichment**: for top 10, fetch `auvik_interfaces_get` and `auvik_devices_get` for context (port description, device role, location).
5. **Output**: ranked table with site, device, interface, current Mbps, baseline Mbps, multiplier, suspected cause (uplink saturation vs. specific port).

## When to use

- After a "slow network" report.
- Weekly capacity-planning sweep.
- Pre-MBR (monthly business review) bandwidth chapter.

## Performance rules

- Always batch the per-tenant calls with concurrency. Single biggest perf win.
- Cap initial pull at 20 interfaces/tenant; deepen only on outliers.
