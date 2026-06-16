---
name: people-analytics
description: Analyze workforce data -- attrition, engagement, diversity, and productivity. Use when user asks for "attrition rate", "turnover analysis", "diversity metrics", "engagement data", "retention risk", or wants to understand workforce trends.
---

# People Analytics

Analyze workforce data to surface trends, risks, and opportunities.

## Key Metrics

### Retention
- Overall attrition rate (voluntary + involuntary)
- Regrettable attrition rate
- Average tenure
- Flight risk indicators

### Diversity
- Representation by level, team, and function
- Pipeline diversity (hiring funnel by demographic)
- Promotion rates by group
- Pay equity analysis

### Engagement
- Survey scores and trends
- eNPS (Employee Net Promoter Score)
- Participation rates
- Open-ended feedback themes

### Productivity
- Revenue per employee
- Span of control efficiency
- Time to productivity for new hires

## Approach

1. Understand what question the user is trying to answer.
2. Identify the right data (upload, paste, or pull from Paylocity via `/roster-snapshot`).
3. Analyze with appropriate statistical methods in `ctx_execute`.
4. Present findings with context and caveats.
5. Recommend specific actions based on data.
