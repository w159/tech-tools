---
description: 'Turn raw interviews, surveys, support tickets, and call notes into ranked themes and roadmap recommendations'
argument-hint: "<research topic or question, plus where the inputs live>"
allowed-tools: Read, Write, mcp__plugin_product-management_notion__notion-search, mcp__plugin_product-management_notion__notion-fetch, mcp__plugin_product-management_intercom__*, mcp__plugin_product-management_fireflies__fireflies_search, mcp__plugin_product-management_fireflies__fireflies_get_transcript, mcp__plugin_product-management_fireflies__fireflies_get_summary
---

# /synthesize-research

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Synthesize user research from multiple sources into structured insights. Run the `synthesize-research` skill.

## Usage

```
/synthesize-research $ARGUMENTS
```

## How It Works

1. From `$ARGUMENTS`, identify the research question and where inputs live. Accept pasted text and uploaded files alongside connectors.
2. Pull qualitative inputs: research docs and interview notes from `notion`, customer feedback and support themes from `intercom`, and interview recordings from `fireflies` (`fireflies_search` then `fireflies_get_transcript` / `fireflies_get_summary`).
3. Extract observations, verbatim quotes, behaviors, and pain points per source.
4. Run the `synthesize-research` skill to apply thematic analysis: group into themes, count frequency across participants, and rank by frequency and impact.
5. Map findings into a frequency/impact priority matrix and tie each to a recommendation.

## Output

A synthesis with 5-8 key findings, supporting quotes, a frequency/impact priority matrix, and prioritized roadmap recommendations.

## Rules

- Read-only. Pull source material; do not write to any connector.
- Quote verbatim and attribute by source or segment. Never fabricate a quote, a participant, or a count.
- Separate what users said from what they did. Note contradictions and surprises rather than smoothing them over.
