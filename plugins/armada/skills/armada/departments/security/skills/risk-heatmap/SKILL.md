---
name: risk-heatmap
description: Build a current user risk heatmap across groups with 90-day trend deltas from KnowBe4. Use when user asks for "risk overview", "who's risky", "risk trending", or before QBRs.
when_to_use: "risk overview, who's risky, risk trending, QBR preparation"
allowed-tools: Read, Glob, Grep, Bash, mcp__knowbe4__*, mcp__plugin_context-mode_context-mode__ctx_execute
---

# Risk Heatmap (KnowBe4)

## Pipeline

1. `knowbe4_reporting_risk_overview` -- account-level baseline.
2. `knowbe4_groups_list` then **parallel** `knowbe4_groups_risk_score_history` (concurrency 6).
3. **Top-risk drilldown**: `knowbe4_users_list` filter group, parallel `knowbe4_users_risk_score_history` for top-50 by risk score.
4. **In `ctx_execute`**:
   - Compute 30/60/90d deltas per user and group.
   - Identify "trending worse" (delta > +5) and "trending better" (delta < -5).
5. **Output**:
   - Heatmap grid (group x risk bucket).
   - Top 10 newly-risky users.
   - Top 10 most-improved (for QBR storytelling).

## Performance

- All history calls must run concurrently. Aggregation strictly in code.
