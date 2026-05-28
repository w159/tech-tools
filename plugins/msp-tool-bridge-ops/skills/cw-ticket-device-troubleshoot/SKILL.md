---
name: cw-ticket-device-troubleshoot
description: Start from a ConnectWise ticket and pivot into NinjaOne to diagnose the underlying device issue. Use when a ticket mentions a workstation/server problem, offline device, patch failure, or recurring endpoint alert.
---

# ConnectWise Ticket → NinjaOne Device Troubleshoot

Use this bridge skill when the workflow starts in PSA but the real evidence lives in RMM.

## Inputs

- ConnectWise ticket ID (preferred), or a very specific ticket number/subject.
- Optional device clues already known: hostname, user, site, serial number.

## Pipeline

### Phase 1 — Pull ticket context from ConnectWise
1. `cw_get_ticket` for the target ticket.
2. `cw_get_ticket_notes` to gather prior troubleshooting and customer-reported symptoms.
3. If the ticket has company/contact/configuration references, enrich in parallel:
   - `cw_get_company`
   - `cw_get_contact`
   - `cw_get_configuration`
4. In `ctx_execute`, normalize all device identifiers found in the ticket body/notes/configuration:
   - hostname / partial hostname
   - logged-in user
   - serial / asset tag
   - site / location
   - symptom keywords (offline, disk, Windows Update, AV, printer, VPN)

### Phase 2 — Resolve the ConnectWise customer to NinjaOne
1. `ninjaone_organizations_list` and fuzzy-match the CW company name/domain.
2. For the best candidate org, search for the device using the strongest identifiers first:
   - `ninjaone_organizations_devices`
   - `ninjaone_devices_list` if broader matching is needed
3. If multiple matches exist, rank by hostname similarity, last contact recency, and org/site match.

### Phase 3 — Pull NinjaOne evidence in parallel
For the top 1-3 candidate devices, run in parallel:
- `ninjaone_devices_get`
- `ninjaone_devices_alerts`
- `ninjaone_devices_services`
- `ninjaone_devices_activities`

Synthesize into:
- current device state (online/offline, OS, last contact, assigned user)
- active alerts and recent alert history
- failing or stopped services
- recent changes that likely explain the symptom

### Phase 4 — Return an operator-ready answer
Output:
1. **Best device match** with confidence and why it matched the CW ticket.
2. **Likely root cause** backed by 3-5 concrete NinjaOne findings.
3. **Recommended next action** ordered from safest to most disruptive.
4. **ConnectWise update draft** summarizing what was found, what should be tried next, and what evidence supports it.

If the user explicitly approves posting back to ConnectWise, then use:
- `cw_add_ticket_note` to append the update, or
- `cw_update_ticket` to adjust status/owner/summary if requested.

## Rules

- Never perform destructive NinjaOne actions automatically. Reboots or service restarts require explicit user approval and a narrow device scope.
- Never post a ConnectWise note automatically; draft first, then wait for approval.
- If no device match is reliable, say so and return the exact identifiers the operator should confirm next.
- Prefer evidence from ticket notes + recent device activity over guesswork.
