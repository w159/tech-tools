---
description: 'Build an evidence-based competitive brief for a competitor or feature area, blending web research with traffic data and internal notes'
argument-hint: "<competitor or feature area to analyze>"
allowed-tools: Read, Write, WebSearch, WebFetch
---

# /competitive-brief

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Create a competitive analysis brief for one or more competitors or a feature area. Run the `competitive-brief` skill.

## Usage

```
/competitive-brief $ARGUMENTS
```

## How It Works

1. Scope from `$ARGUMENTS`: which competitor(s) or feature area, the focus (product, pricing, GTM, positioning), and the decision it informs. Ask only what is missing.
2. Research the public surface via WebSearch and WebFetch: product and pricing pages, recent launches, changelogs, reviews (G2, Capterra), and press.
3. Search for publicly available traffic and engagement signals via WebSearch (analyst reports, press coverage, App Store/Play Store rankings, LinkedIn headcount trends) to quantify competitor momentum and market position.
4. Ask the user for any internal competitive docs, win/loss notes, or deal feedback they can provide; incorporate them alongside the web research.
5. Run the `competitive-brief` skill to assemble the brief: overview, feature comparison matrix, positioning, strengths/weaknesses, and opportunities.

## Output

A competitive brief with a feature comparison matrix, honest strengths/weaknesses, positioning analysis, and where to differentiate vs. reach parity.

## Rules

- Read-only. Pull and synthesize; do not write to any connector.
- Cite sources for every factual claim (URL, review platform, or internal doc). Mark anything inferred as an inference, not a fact.
- Be evidence-based and fair: do not inflate competitor weaknesses or dismiss their strengths. Flag stale data with its date.
