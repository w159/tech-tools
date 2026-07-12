# Triage Rubric: Priority SLA Expectations and Response Templates

Reference detail for the ticket-triage skill. The SKILL.md body carries
the category taxonomy, priority summary, and routing rules. This file
holds the SLA expectations per priority level and the auto-response
templates per category.

## Priority SLA Expectations

### P1 - Critical
Criteria: production system down, data loss or corruption, security
breach, all or most users affected.

- The customer cannot use the product at all
- Data is being lost, corrupted, or exposed
- A security incident is in progress
- The issue is worsening or expanding in scope

SLA expectation: respond within 1 hour. Continuous work until resolved
or mitigated. Updates every 1-2 hours.

### P2 - High
Criteria: major feature broken, significant workflow blocked, many
users affected, no workaround.

- A core workflow is broken but the product is partially usable
- Multiple users are affected or a key account is impacted
- The issue is blocking time-sensitive work
- No reasonable workaround exists

SLA expectation: respond within 4 hours. Active investigation same day.
Updates every 4 hours.

### P3 - Medium
Criteria: feature partially broken, workaround available, single user
or small team affected.

- A feature isn't working correctly but a workaround exists
- The issue is inconvenient but not blocking critical work
- A single user or small team is affected
- The customer is not escalating urgently

SLA expectation: respond within 1 business day. Resolution or update
within 3 business days.

### P4 - Low
Criteria: minor inconvenience, cosmetic issue, general question, feature
request.

- Cosmetic or UI issues that don't affect functionality
- Feature requests and enhancement ideas
- General questions or how-to inquiries
- Issues with simple, documented solutions

SLA expectation: respond within 2 business days. Resolution at normal
pace.

## Auto-Response Templates by Category

### Bug - Initial Response
```
Thank you for reporting this. I can see how [specific impact]
would be disruptive for your work.

I've logged this as a [priority] issue and our team is
investigating. [If workaround exists: "In the meantime, you
can [workaround]."]

I'll update you within [SLA timeframe] with what we find.
```

### How-to - Initial Response
```
Great question! [Direct answer or link to documentation]

[If more complex: "Let me walk you through the steps:"]
[Steps or guidance]

Let me know if that helps, or if you have any follow-up
questions.
```

### Feature Request - Initial Response
```
Thank you for this suggestion - I can see why [capability]
would be valuable for your workflow.

I've documented this and shared it with our product team.
While I can't commit to a specific timeline, your feedback
directly informs our roadmap priorities.

[If alternative exists: "In the meantime, you might find
[alternative] helpful for achieving something similar."]
```

### Billing - Initial Response
```
I understand billing issues need prompt attention. Let me
look into this for you.

[If straightforward: resolution details]
[If complex: "I'm reviewing your account now and will have
an answer for you within [timeframe]."]
```

### Security - Initial Response
```
Thank you for flagging this - we take security concerns
seriously and are reviewing this immediately.

I've escalated this to our security team for investigation.
We'll follow up with you within [timeframe] with our findings.

[If action is needed: "In the meantime, we recommend
[protective action]."]
```