---
name: audit-forensics
description: Forensic walk of ThreatLocker audit logs to investigate a specific file, computer, or time window -- surfaces blocked executions, lateral movement, and pivot points. Use when user asks "investigate this file/host", "what happened on X", or during IR.
---

# Audit Forensics (ThreatLocker)

## Pipeline

Inputs: one of file hash, file path, computer name, time window.

1. `threatlocker_audit_search` filtered to the input + time window.
2. **Pivot fan-out (parallel)**:
   - If file: `threatlocker_audit_file_history` (cross-org occurrence).
   - If computer: `threatlocker_computers_get_checkins`, `threatlocker_audit_search` action_type=blocked for the same host.
3. **In `ctx_execute`**:
   - Timeline reconstruction: sort events, mark first-seen, lateral movement (file appearing on additional hosts within the window).
   - Highlight blocks -> bypass attempts (multiple block events for same hash in short window).
4. **Output**:
   - Markdown timeline.
   - Hosts touched, users touched, hashes touched.
   - Recommended follow-ups (lock down, request more info, escalate).
