---
name: mass-incident-response
description: Coordinate response to an incident affecting many NinjaOne devices — identify scope, run safe remediation (service restart, reboot) in waves with confirmation. Use when user says "everyone offline at site X", "service Y down everywhere", or after a Ninja alert storm.
---

# Mass Incident Response (NinjaOne)

**Destructive operations (reboot, service control). Require explicit user "go" for each wave.**

## Pipeline

### Phase 1 — Scope
- `ninjaone_alerts_list` filter active.
- Cluster alerts by message + org → identify outbreak.
- `ninjaone_devices_list` filter by impacted org/site.

### Phase 2 — Diagnose
- **Parallel** `ninjaone_devices_services` for top-10 affected — common service down?
- `ninjaone_devices_activities` last 1h for change correlation.

### Phase 3 — Remediate (per wave, confirm)
- Wave 1: top-5 highest-priority devices, smallest blast radius. Use safest verb first (service restart > reboot).
- Wait for re-check. Only proceed if wave 1 successful.
- Wave 2: next batch.

### Phase 4 — Acknowledge & document
- `ninjaone_alerts_reset` only after device confirmed healthy.
- If `msp-tool-bridge-ops` is installed, use `ninja-device-ticket-sync` to correlate against existing ConnectWise work and draft the best update.
- Otherwise, create CW ticket if `connectwise-psa-ops` available with full timeline.

## Rules

- Never reboot >10 devices in a single batch.
- Never reset alerts before remediation is confirmed.
