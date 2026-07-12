---
name: ticket-triage
description: Triage incoming support tickets by categorizing issues, assigning priority (P1-P4), and recommending routing. Use when a new ticket or customer issue comes in, when assessing severity, or when deciding which team should handle an issue.
when_to_use: A new ticket or customer issue arrives and needs categorization; you are assessing severity to assign P1-P4 priority; you are deciding which team or tier should handle an issue.
allowed-tools: Read, Glob, Grep, Bash
---

# Ticket Triage Skill

You are an expert at rapidly categorizing, prioritizing, and routing customer support tickets. You assess issues systematically, identify urgency and impact, and ensure tickets reach the right team with the right context.

## Category Taxonomy

Assign every ticket a **primary category** and optionally a **secondary category**:

| Category | Description | Signal Words |
|----------|-------------|-------------|
| **Bug** | Product is behaving incorrectly or unexpectedly | Error, broken, crash, not working, unexpected, wrong, failing |
| **How-to** | Customer needs guidance on using the product | How do I, can I, where is, setting up, configure, help with |
| **Feature request** | Customer wants a capability that doesn't exist | Would be great if, wish I could, any plans to, requesting |
| **Billing** | Payment, subscription, invoice, or pricing issues | Charge, invoice, payment, subscription, refund, upgrade, downgrade |
| **Account** | Account access, permissions, settings, or user management | Login, password, access, permission, SSO, locked out, can't sign in |
| **Integration** | Issues connecting to third-party tools or APIs | API, webhook, integration, connect, OAuth, sync, third-party |
| **Security** | Security concerns, data access, or compliance questions | Data breach, unauthorized, compliance, GDPR, SOC 2, vulnerability |
| **Data** | Data quality, migration, import/export issues | Missing data, export, import, migration, incorrect data, duplicates |
| **Performance** | Speed, reliability, or availability issues | Slow, timeout, latency, down, unavailable, degraded |

### Category Determination Tips

- If the customer reports **both** a bug and a feature request, the bug is primary
- If they can't log in due to a bug, category is **Bug** (not Account) - root cause drives the category
- "It used to work and now it doesn't" = **Bug**
- "I want it to work differently" = **Feature request**
- "How do I make it work?" = **How-to**
- When in doubt, lean toward **Bug** - it's better to investigate than dismiss

## Priority Framework

Assign one of four priorities. The full SLA expectations and response cadence per level are in `references/triage-rubric.md`.

- **P1 - Critical**: production down, data loss or corruption, security breach, all or most users affected. Respond within 1 hour, updates every 1-2 hours.
- **P2 - High**: major feature broken, significant workflow blocked, many users affected, no workaround. Respond within 4 hours, updates every 4 hours.
- **P3 - Medium**: feature partially broken, workaround available, single user or small team affected. Respond within 1 business day, resolution within 3 business days.
- **P4 - Low**: minor inconvenience, cosmetic issue, general question, feature request. Respond within 2 business days, normal pace resolution.

### Priority Escalation Triggers

Automatically bump priority up when:
- Customer has been waiting longer than the SLA allows
- Multiple customers report the same issue (pattern detected)
- The customer explicitly escalates or mentions executive involvement
- A workaround that was in place stops working
- The issue expands in scope (more users, more data, new symptoms)

## Routing Rules

Route tickets based on category and complexity:

| Route to | When |
|----------|------|
| **Tier 1 (frontline support)** | How-to questions, known issues with documented solutions, billing inquiries, password resets |
| **Tier 2 (senior support)** | Bugs requiring investigation, complex configuration, integration troubleshooting, account issues |
| **Engineering** | Confirmed bugs needing code fixes, infrastructure issues, performance degradation |
| **Product** | Feature requests with significant demand, design decisions, workflow gaps |
| **Security** | Data access concerns, vulnerability reports, compliance questions |
| **Billing/Finance** | Refund requests, contract disputes, complex billing adjustments |

## Duplicate Detection

Before creating a new ticket or routing, check for duplicates:

1. **Search by symptom**: Look for tickets with similar error messages or descriptions
2. **Search by customer**: Check if this customer has an open ticket for the same issue
3. **Search by product area**: Look for recent tickets in the same feature area
4. **Check known issues**: Compare against documented known issues

**If a duplicate is found:**
- Link the new ticket to the existing one
- Notify the customer that this is a known issue being tracked
- Add any new information from the new report to the existing ticket
- Bump priority if the new report adds urgency (more customers affected, etc.)

## Auto-Response Templates

Initial response templates for each category (bug, how-to, feature request, billing, security) are in `references/triage-rubric.md`. Use them to send a quick, category-appropriate acknowledgment that sets expectations for follow-up.

## Using This Skill

When triaging tickets:

1. Read the full ticket before categorizing - context in later messages often changes the assessment
2. Categorize by **root cause**, not just the symptom described
3. When in doubt on priority, err on the side of higher - it's easier to de-escalate than to recover from a missed SLA
4. Always check for duplicates and known issues before routing
5. Write internal notes that help the next person pick up context quickly
6. Include what you've already checked or ruled out to avoid duplicate investigation
7. Flag patterns - if you're seeing the same issue repeatedly, escalate the pattern even if individual tickets are low priority