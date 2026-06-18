---
name: ramp-api-patterns
description: Reference for working with the Ramp tools: bulk load_* loaders vs targeted ramp_get_/ramp_search_ calls, pagination, tracking categories and GL coding, and the read-vs-write tool split with the compliance guardrail. Use when user asks "which Ramp tool should I use", "how do I page Ramp data", or "how is Ramp spend coded to the GL".
---

# Ramp API Patterns

**Important**: This is a reference skill, not financial, legal, or tax advice. Use it to choose the right Ramp tool and call it correctly.

Reference for how the Ramp toolset is organized: when to reach for a bulk loader versus a targeted lookup, how pagination and tracking categories work, and which tools are safe to fire versus which require confirmation.

## Bulk loaders vs targeted lookups

Two families of read tools exist. Pick by intent.

1. **Bulk `load_*` loaders** pull a whole population in one shot: `load_cards`, `load_users`, `load_vendors`, `load_limits`, `load_spend_export`, and `get_ramp_categories`. Use these to build a working set, an inventory, or an export, then filter locally. Prefer a loader when you need everything (every card, every vendor) rather than one record.
2. **Targeted `ramp_get_*` and `ramp_search_*` tools** fetch one record or a scoped query: `ramp_get_bill_details`, `ramp_get_reimbursements`, `ramp_get_full_transaction_metadata`, `ramp_search_bills`, `ramp_search_reimbursements`, `ramp_search_vendors`, `ramp_get_user_transactions`. Use these when you already have an id or a narrow filter (one vendor, one date range, one cardholder).

Rule of thumb: search or get to drill in; load to sweep. Do not loop a targeted `get` over hundreds of ids when a `load_*` loader returns the same population in one call.

## Pagination

- Targeted `search`/`list` tools page their results. Read the page-size and cursor or page-token fields in the tool response and continue until the cursor is empty; do not assume the first page is the whole result.
- Bulk `load_*` loaders return the full population; if a loader is truncated, page it the same way rather than re-calling with no offset.
- When you summarize counts or dollar totals, confirm you have walked every page first, or label the figure as partial.

## Tracking categories and GL coding

- `ramp_get_tracking_categories` (and the underlying category data from `get_ramp_categories`) define how spend is coded: GL account, department, location, and any custom tracking dimensions the firm has configured.
- A transaction is "missing coding" when a required tracking category is unset. `ramp_get_transaction_missing_items` surfaces these; resolve the category mapping before treating spend as ready to post.
- Use the tracking-category structure to group spend for reconciliation and for the close, matching Ramp dimensions to the firm's chart of accounts.

## Read vs write tool split

The toolset divides cleanly. Default to the read side.

**Read-only (safe to call freely):** `ramp_get_attention_feed`, `ramp_get_transaction_missing_items`, `ramp_get_user_transactions`, `ramp_get_full_transaction_metadata`, `ramp_list_cards`, `ramp_search_reimbursements`, `ramp_get_reimbursements`, `ramp_get_reimbursement_receipts`, `ramp_list_bills`, `ramp_search_bills`, `ramp_get_bill_details`, `ramp_search_vendors`, `ramp_list_vendor_agreements`, `ramp_get_vendor_agreement`, `ramp_get_ramp_business_account_balance`, `ramp_get_account_balance_history`, `ramp_get_tracking_categories`, `get_ramp_categories`, and every `load_*` loader.

**Mutating or visible-to-others (never auto-fire, confirmation-gated):**
- DESTRUCTIVE: `ramp_lock_or_unlock_card`, `ramp_update_transaction_amount_limit`, `ramp_limit_increase`, `ramp_edit_transaction`.
- VISIBLE-TO-OTHERS: `ramp_approve_or_reject_reimbursement`, `ramp_approve_or_reject_transaction`, `ramp_approve_or_reject_request`.

Before any tool in the second group, state the exact action and target back to the user and require explicit confirmation. The card and approval workflows live in `ramp-card-controls` and `ramp-reimbursement-review`, which already gate these calls.

## Output

When this skill is invoked, return the right tool choice for the user's goal, the call sequence (loader vs targeted, with pagination), and a clear note on whether the action is read-only or confirmation-gated.

## Rules and Guardrails

- Never auto-fire a mutating or visible-to-others tool from a reference question. Reference work is read-only by default.
- Do not invent field names, page sizes, or category structures. If a field is unknown, call the tool and read the actual response shape.
- Surface tool errors plainly (HTTP status, message, which credential or endpoint to check).

## Compliance Note

This is an SEC-registered investment adviser environment (Investment Advisers Act, Reg S-P, GLBA, FTC Safeguards Rule). Do not enter client nonpublic personal information into prompts. Treat any output that could reach a client or an examiner as a draft pending CCO or Compliance review. Exports and reference notes may be firm records subject to the retention schedule, so preserve them accordingly.
