---
name: incident-response
description: Triage and manage production incidents from detection through resolution and postmortem. Use when the user says "we have an incident", "production is down", "something is broken", "there's an outage", or "SEV1", or describes a production issue needing immediate response.
when_to_use: "When a production issue needs immediate response, severity classification, status communication, mitigation, or a blameless postmortem"
allowed-tools: Read, Glob, Grep, Bash
---

# Incident Response

Guide incident response from detection through resolution and postmortem.

## Severity Classification

| Level | Criteria | Response Time |
|-------|----------|---------------|
| SEV1 | Service down, all users affected | Immediate, all-hands |
| SEV2 | Major feature degraded, many users affected | Within 15 min |
| SEV3 | Minor feature issue, some users affected | Within 1 hour |
| SEV4 | Cosmetic or low-impact issue | Next business day |

## Response Framework

1. **Triage**: Classify severity, identify scope, assign incident commander
2. **Communicate**: Status page, internal updates, customer comms if needed
3. **Mitigate**: Stop the bleeding first, root cause later
4. **Resolve**: Implement fix, verify, confirm resolution
5. **Postmortem**: Blameless review, 5 whys, action items

## Communication Templates

Provide clear, factual updates at regular cadence. Include: what's happening, who's affected, what we're doing, when the next update is.

## Postmortem Format

Blameless. Focus on systems and processes. Include timeline, root cause analysis (5 whys), what went well, what went poorly, and action items with owners and due dates.
