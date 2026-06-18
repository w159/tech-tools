---
name: ramp-spend-triage
description: Pull the Ramp attention feed and transactions missing receipts or coding, rank by amount and policy risk, and produce a prioritized follow-up list. Use when user asks to "triage Ramp spend", "find transactions missing receipts", or "what needs my attention in Ramp".
---

# Ramp Spend Triage

**Important**: This skill assists with spend review workflows but does not provide financial, legal, or tax advice. All triage output should be reviewed by qualified finance staff before action.

Read-only triage of Ramp card spend. Surfaces items that need a follow-up (missing receipts, missing coding, unreviewed transactions), ranks them by dollar amount and policy risk, and hands back a clean follow-up list. No data is changed.

## Pipeline

1. **Pull the attention feed** with `ramp_get_attention_feed` to get items Ramp has already flagged for review (unreviewed transactions, exceptions, pending items).
2. **Find missing items** with `ramp_get_transaction_missing_items` to list transactions lacking a receipt, a memo, or required tracking-category coding.
3. **Enrich with context** using `ramp_get_user_transactions` (and `ramp_get_full_transaction_metadata` for any single transaction needing detail) to attach amount, merchant, cardholder, and date to each flagged item.
4. **Rank** the combined list by (a) absolute amount, descending, then (b) policy risk: missing receipt over a receipt threshold, missing GL coding, aged unreviewed items, and merchant categories that are restricted or unusual.
5. **Produce the follow-up list** grouped by cardholder, with the action each item needs and who owns it.

## Output

A prioritized follow-up table:

| Rank | Cardholder | Merchant | Amount | Date | Issue | Risk | Action Owner |
|------|-----------|----------|--------|------|-------|------|--------------|

Plus a short summary: total dollars flagged, count of missing receipts, count missing coding, and the top 5 items by amount. Keep it copy-ready for a finance review note.

## Rules and Guardrails

- Read-only skill. It calls only `ramp_get_attention_feed`, `ramp_get_transaction_missing_items`, `ramp_get_user_transactions`, and `ramp_get_full_transaction_metadata`. It never approves, edits, or locks anything.
- If any approve, edit, or lock action is implied by the request, stop and hand off to `ramp-reimbursement-review` or `ramp-card-controls`, which gate those mutating tools behind explicit confirmation.
- Do not invent amounts, dates, or policy thresholds. If a threshold is unknown, state the assumption and ask for the firm's policy figure.
- Surface tool errors plainly (HTTP status, message, which credential or endpoint to check); never present an empty list as "all clear" if a call failed.

## Compliance Note

This is an SEC-registered investment adviser environment (Investment Advisers Act, Reg S-P, GLBA, FTC Safeguards Rule). Do not enter client nonpublic personal information into prompts or notes. Treat any output that could reach a client or an examiner as a draft pending CCO or Compliance review. Triage notes and follow-up lists may be firm records subject to the retention schedule, so preserve them accordingly.
