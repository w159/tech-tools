---
name: compensation-benchmarking
description: Benchmark compensation against market data. Use when user asks "what should we pay", "comp benchmark", "market rate for", "salary range for", or "is this offer competitive".
---

# Compensation Benchmarking

Benchmark compensation against market data for hiring, retention, and equity planning.

## Framework

### Components of Total Compensation
- **Base salary**: cash compensation
- **Equity**: RSUs, stock options, or other equity
- **Bonus**: annual target bonus, signing bonus
- **Benefits**: health, retirement, perks

### Key Variables
- **Role**: function and specialization
- **Level**: IC levels, management levels
- **Location**: geographic pay adjustments
- **Company stage**: startup vs. growth vs. public
- **Industry**: tech vs. finance vs. healthcare

## Data Sources

If Paylocity is available, pull current pay data via `/paylocity-pay-rate-audit` for the internal anchor. For external benchmarks, use web research, public salary data, and user-provided context. Always note data freshness and source limitations.

## Output

Provide percentile bands (25th, 50th, 75th, 90th) for base, equity, and total comp. Include location adjustments and company-stage context.
