---
name: ninja-device-ticket-sync
description: Start from a NinjaOne alert or device and correlate it to the right ConnectWise ticket, then draft the escalation/update. Use when RMM finds a problem first and you need to anchor work inside the PSA queue.
---

# NinjaOne Device/Alert → ConnectWise Ticket Sync

Use this bridge skill when the workflow starts in NinjaOne and must be reflected cleanly in ConnectWise.

## Inputs

- NinjaOne device name, alert UID, or a short natural-language description of the affected asset.
- Optional client/company hint.

## Pipeline

### Phase 1 — Resolve the NinjaOne entity
1. If the input looks like an alert/incident, start with `ninjaone_alerts_list` and isolate the alert.
2. If the input looks like a device, use:
   - `ninjaone_devices_list`
   - `ninjaone_devices_get`
3. If needed, enrich with:
   - `ninjaone_devices_alerts`
   - `ninjaone_devices_activities`
   - `ninjaone_devices_services`
4. Capture organization, location, hostname, user, severity, and symptom keywords.

### Phase 2 — Find the right ConnectWise company and ticket
1. `cw_search_companies` using the NinjaOne organization/client clues.
2. `cw_search_tickets` scoped to that company and recent/open statuses.
3. In `ctx_execute`, rank tickets by:
   - same hostname / asset reference
   - same symptom keywords
   - same requester or site
   - recency / open status
4. If no solid match exists, prepare a new-ticket draft instead of forcing a weak correlation.

### Phase 3 — Produce the PSA handoff
Output:
- **Best matching ConnectWise ticket** (or “no credible match”).
- **Evidence bundle** from NinjaOne: alert text, last contact, recent changes, failing services.
- **Recommended ConnectWise action**:
  - add note to existing ticket,
  - reopen/update a stale ticket, or
  - create a new ticket.
- **Customer-safe summary** that an engineer can paste into ConnectWise.

If the user explicitly approves the change, then use one of:
- `cw_add_ticket_note`
- `cw_update_ticket`
- `cw_create_ticket`

## Rules

- Never create duplicate ConnectWise tickets without checking open and recently closed work first.
- Never auto-post or auto-create in ConnectWise; always show the draft and wait for approval.
- When multiple tickets are plausible, present the top candidates with confidence scores instead of guessing.
- If a remediation action in NinjaOne is proposed, separate it from the ConnectWise documentation step and require explicit approval first.
