---
name: ramp-bill-vendor-reconciliation
description: Reconcile Ramp bills against vendors and vendor agreements, surfacing mismatches, duplicate bills, and unmatched or off-contract amounts. Use when user asks to "reconcile Ramp bills", "find duplicate vendor bills", or "check bills against vendor agreements".
---

# Ramp Bill and Vendor Reconciliation

**Important**: This skill assists with accounts-payable reconciliation but does not provide financial, legal, or tax advice. All reconciliation output should be reviewed by qualified finance staff before payment or posting.

Read-only reconciliation of Ramp bills against the vendor master and signed vendor agreements. Surfaces duplicate bills, bills with no matching vendor, and amounts that fall outside an agreement's pricing or term. No data is changed.

## Pipeline

1. **List the bills** with `ramp_list_bills` (or `ramp_search_bills` to scope by vendor, date, or status) to build the bill population for the period.
2. **Pull bill detail** with `ramp_get_bill_details` for each bill: vendor, amount, invoice number, due date, and line items.
3. **Resolve vendors** with `ramp_search_vendors` to match each bill to a vendor master record; flag any bill that cannot be matched.
4. **Pull agreements** with `ramp_list_vendor_agreements` and `ramp_get_vendor_agreement` to retrieve contracted rates, terms, and effective dates for matched vendors.
5. **Reconcile** each bill: match-to-vendor, match-to-agreement, amount vs. contracted rate, and duplicate detection (same vendor, amount, and invoice number, or near-identical bills within a short window).
6. **Surface mismatches** grouped by type: unmatched vendor, no agreement on file, amount over contract, and suspected duplicate.

## Output

A reconciliation table:

| Bill # | Vendor | Amount | Vendor Match | Agreement Match | Variance vs Contract | Flag |
|--------|--------|--------|--------------|-----------------|----------------------|------|

Plus a mismatch summary: count and dollar total of unmatched bills, suspected duplicates, and off-contract amounts, with the top items by dollar exposure called out.

## Rules and Guardrails

- Read-only skill. It calls only `ramp_list_bills`, `ramp_search_bills`, `ramp_get_bill_details`, `ramp_search_vendors`, `ramp_list_vendor_agreements`, and `ramp_get_vendor_agreement`. It never approves, edits, or pays a bill.
- A suspected duplicate is a flag for human review, not a conclusion. Present the evidence (matching fields) and let finance confirm before any payment is held or voided.
- Do not invent contracted rates or terms. If an agreement is not on file, mark it "no agreement on file", do not assume the bill is correct.
- Surface tool errors plainly (HTTP status, message, which credential or endpoint to check); never present a clean reconciliation if a bill or agreement call failed.

## Compliance Note

This is an SEC-registered investment adviser environment (Investment Advisers Act, Reg S-P, GLBA, FTC Safeguards Rule). Do not enter client nonpublic personal information into prompts or notes. Treat any reconciliation output that could reach a client or an examiner as a draft pending CCO or Compliance review. Reconciliations and supporting detail may be firm records subject to the retention schedule, so preserve them accordingly.
