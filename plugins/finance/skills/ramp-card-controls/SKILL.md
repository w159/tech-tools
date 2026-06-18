---
name: ramp-card-controls
description: Review the Ramp card inventory and spend limits, and (only on explicit confirmation) lock or unlock cards and change transaction limits. Use when user asks to "review Ramp cards", "audit card limits", "lock a card", or "raise a spend limit".
---

# Ramp Card Controls

**Important**: This skill assists with card-program review but does not provide financial, legal, or tax advice. Locking a card or changing a limit is an operational control change that should be made by an authorized administrator.

Review the Ramp card inventory and limits, identify cards that are over-provisioned, dormant, or out of policy, and (only on explicit confirmation) apply control changes. Lock/unlock and limit changes are DESTRUCTIVE actions and are confirmation-gated.

## Pipeline

1. **List the cards** with `ramp_list_cards` to build the inventory: cardholder, status, card type, and current limit.
2. **Load limits** with `load_limits` to get the full limit and spend-allocation picture, including which cards share or roll up to a program limit.
3. **Assess** each card: dormant (no recent spend), over-provisioned (limit far above actual use), missing an owner, or limit out of policy.
4. **Recommend, then gate the action.** Present the proposed control changes (lock, unlock, limit change). Take no mutating action until the administrator explicitly confirms each one.
5. **DESTRUCTIVE: apply a lock or unlock** with `ramp_lock_or_unlock_card` only for cards the administrator has explicitly confirmed, one at a time.
6. **DESTRUCTIVE: change a transaction limit** with `ramp_update_transaction_amount_limit`, or **DESTRUCTIVE: raise a limit** with `ramp_limit_increase`, only for cards the administrator has explicitly confirmed, with the exact new figure stated back before the call.

## Output

A card inventory table:

| Card | Cardholder | Status | Current Limit | Recent Spend | Assessment | Proposed Change |
|------|-----------|--------|---------------|--------------|------------|-----------------|

Plus a clearly separated "Pending your confirmation" section listing every card awaiting a lock, unlock, or limit change, with the exact action and figure for each.

## Rules and Guardrails

- DESTRUCTIVE: `ramp_lock_or_unlock_card`, `ramp_update_transaction_amount_limit`, and `ramp_limit_increase` change live card behavior. Never auto-fire them. Require explicit, per-card confirmation that names the card and the exact change (lock, unlock, or the precise new limit) before calling.
- Default to read-only. `ramp_list_cards` and `load_limits` run freely; the mutating tools do not.
- Locking a card can decline an in-flight purchase. Confirm the cardholder and business impact before locking, and prefer a limit reduction over a lock where that meets the goal.
- Do not fabricate limit policy. State assumptions and ask for the firm's card-limit policy if unknown.
- Surface tool errors plainly (HTTP status, message, remediation hint); never silently swallow a failed lock or limit change, and report back the post-change state.

## Compliance Note

This is an SEC-registered investment adviser environment (Investment Advisers Act, Reg S-P, GLBA, FTC Safeguards Rule). Do not enter client nonpublic personal information into prompts or change notes. Treat any card-control report or change rationale that could reach an examiner as a draft pending CCO or Compliance review. Control changes and their rationale may be firm records subject to the retention schedule, so preserve them accordingly.
