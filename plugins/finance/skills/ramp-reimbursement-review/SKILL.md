---
name: ramp-reimbursement-review
description: Review pending Ramp reimbursements for policy compliance and missing receipts, flag exceptions, and (only on explicit confirmation) approve or reject them. Use when user asks to "review Ramp reimbursements", "check expense reports for receipts", or "approve a reimbursement".
---

# Ramp Reimbursement Review

**Important**: This skill assists with reimbursement review but does not provide financial, legal, or tax advice. Approval decisions are management actions that should be made by an authorized approver.

Review pending Ramp reimbursements against expense policy, flag exceptions (missing receipts, over-limit amounts, out-of-policy categories), and produce an approve/reject recommendation list. Approvals and rejections are VISIBLE-TO-OTHERS actions and are confirmation-gated.

## Pipeline

1. **List pending reimbursements** with `ramp_search_reimbursements` (and `ramp_get_reimbursements` for full detail on a specific reimbursement) to build the review queue.
2. **Check receipts** with `ramp_get_reimbursement_receipts` for each reimbursement to confirm a receipt is attached and legible for any amount that requires one.
3. **Evaluate policy** for each item: amount vs. per-expense limit, category allowed, business purpose present, receipt present where required, and duplicate or split-charge patterns.
4. **Flag exceptions** with the specific reason (no receipt, over limit, restricted category, missing business purpose) and a recommended disposition.
5. **Recommend, then gate the action.** Present the approve/reject recommendation list. Take no mutating action until the approver explicitly confirms each one.
6. **VISIBLE-TO-OTHERS: apply the decision** with `ramp_approve_or_reject_reimbursement` only for items the approver has explicitly confirmed, one at a time, never in bulk without per-item confirmation.

## Output

A review table:

| Reimbursement | Employee | Amount | Category | Receipt | Policy Result | Recommendation |
|---------------|----------|--------|----------|---------|---------------|----------------|

Plus an exceptions list (each with its reason) and a clearly separated "Pending your confirmation" section listing every reimbursement awaiting an approve or reject decision.

## Rules and Guardrails

- VISIBLE-TO-OTHERS: `ramp_approve_or_reject_reimbursement` posts a decision the employee and approval chain can see. Never auto-fire it. Require explicit, per-item confirmation that names the reimbursement and the decision (approve or reject) before calling it.
- Default to read-only. `ramp_search_reimbursements`, `ramp_get_reimbursements`, and `ramp_get_reimbursement_receipts` run freely; the approve/reject call does not.
- Never approve to clear a backlog. An item with a missing receipt or a policy exception gets flagged, not approved, unless the approver explicitly overrides with a documented reason.
- Do not fabricate policy limits or receipt thresholds. State assumptions and ask for the firm's figures if unknown.
- Surface tool errors plainly (HTTP status, message, remediation hint); never silently swallow a failed approval.

## Compliance Note

This is an SEC-registered investment adviser environment (Investment Advisers Act, Reg S-P, GLBA, FTC Safeguards Rule). Do not enter client nonpublic personal information into prompts, memos, or rejection reasons. Treat any review note or decision rationale that could reach an examiner as a draft pending CCO or Compliance review. Approval decisions and their rationale may be firm records subject to the retention schedule, so preserve them accordingly.
