---
name: approval-queue-triage
description: Triage pending ThreatLocker approval requests with file-history, computer, and org context -- includes a recommended approve/deny verdict. Use when user asks "any pending approvals", "triage the approval queue", or for daily zero-trust review.
---

# Approval Queue Triage (ThreatLocker)

## Pipeline

1. `threatlocker_approvals_pending_count` -- quick gate. If zero, return early.
2. `threatlocker_approvals_list` status=pending.
3. **Parallel enrichment per approval** (concurrency 6):
   - `threatlocker_approvals_get_permit_application`
   - `threatlocker_audit_file_history` for the file hash
   - `threatlocker_computers_get` for the requesting endpoint
4. **In `ctx_execute`**:
   - Verdict heuristic:
     - **Approve candidate**: signed publisher, seen on 5+ peer endpoints over 30d, no prior deny outcomes.
     - **Deny candidate**: unsigned + first-seen <7d + only seen on requester + temp/download path.
     - **Manual**: anything else.
   - Group near-duplicates (same hash / same publisher).
5. **Output**:
   - Suggested approvals with single-line rationale.
   - Suggested denials with risk indicators.
   - Manual queue with full context bundle.

## Rules

- NEVER auto-approve. Output verdicts only. For each approve verdict,
  wait for explicit per-request user confirmation before calling
  `threatlocker_approvals_approve` (DESTRUCTIVE: creates a permanent
  allow policy). Deny verdicts cannot be executed via API -- direct
  the user to the ThreatLocker Portal UI for those.
- Always include the audit/file-history evidence summary inline.
