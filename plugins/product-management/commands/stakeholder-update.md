---
description: 'Draft an audience-tailored stakeholder update (weekly, monthly, launch, or escalation) grounded in live project, chat, and meeting context'
argument-hint: "<update type and audience, e.g. weekly exec update>"
allowed-tools: Read, Write, mcp__plugin_product-management_notion__notion-search, mcp__plugin_product-management_notion__notion-fetch, mcp__plugin_product-management_linear__*, mcp__plugin_product-management_slack__*, mcp__plugin_product-management_fireflies__fireflies_search, mcp__plugin_product-management_fireflies__fireflies_get_summary
---

# /stakeholder-update

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Draft a stakeholder update tailored to audience and cadence. Run the `stakeholder-update` skill.

## Usage

```
/stakeholder-update $ARGUMENTS
```

## How It Works

1. Parse `$ARGUMENTS` for update type (weekly, monthly, launch, ad-hoc escalation) and audience (exec, engineering, cross-functional, customer, board). Ask one question only if either is missing.
2. Pull progress from the project tracker (`linear` issues and project status) for items completed, in flight, at risk, or blocked since the last update.
3. Pull supporting context: recent decisions and blockers from `slack` (`slack` search), and meeting outcomes from `fireflies` (`fireflies_search` then `fireflies_get_summary`).
4. Search `notion` for prior updates and decision docs to keep framing and metrics consistent.
5. Run the `stakeholder-update` skill to format for the target audience (length and detail per the skill templates).

## Output

A ready-to-send update sized to the audience: TL;DR, status color, progress tied to goals, risks with mitigation, asks, and next milestones.

## Rules

- Read-only by default. Pull context; do not post anywhere.
- VISIBLE-TO-OTHERS: if the user asks to post to Slack or publish to Notion, restate the exact channel/page and full text, then require explicit confirmation before any write.
- Ground every claim in a real tracker item, message, or meeting. Do not invent status, metrics, or dates. If context is thin, say so and ask the user to fill the gap.
