---
title: Pricing Strategy — Monthly Billing Test
type: meeting
date: 2026-02-28T10:00:00
duration: 48m
attendees: [Mat S., Alex K., Jordan M.]
people: [mat, alex, jordan]
tags: [pricing, gtm, experiment]
decisions:
  - text: Launch monthly billing alongside annual, starting with the next three consultant signups
    topic: pricing
    authority: high
action_items:
  - assignee: jordan
    task: Draft monthly billing landing copy
    due: 2026-03-07
    status: open
  - assignee: alex
    task: Wire monthly price into Stripe
    due: 2026-03-10
    status: open
  - assignee: mat
    task: Review payback modeling after three months of data
    due: 2026-05-31
    status: open
speaker_map:
  - speaker_label: SPEAKER_0
    name: mat
    confidence: high
    source: manual
  - speaker_label: SPEAKER_1
    name: alex
    confidence: high
    source: manual
  - speaker_label: SPEAKER_2
    name: jordan
    confidence: high
    source: manual
---

## Summary

- Pain: annual billing is blocking consultant-segment signups. Seven prospects this month said annual is a dealbreaker.
- Decision: run a monthly billing experiment against the consultant segment. Keep annual as the default for enterprise.
- Risk: payback math is worse on monthly. Need three months of data before calling it.

## Transcript

[SPEAKER_0 0:00] Let's talk pricing. We've had seven consultants this month push back on annual. That's not a rounding error.

[SPEAKER_2 0:14] Eight, actually. Two came in yesterday.

[SPEAKER_0 0:22] Right. So we either bleed this segment, or we test monthly.

[SPEAKER_1 0:31] Monthly kills payback. On current CAC we break even at month eleven on annual. Monthly pushes that to fourteen, maybe fifteen.

[SPEAKER_2 0:47] We don't know until we run it. The churn assumption is a guess.

[SPEAKER_0 1:02] Let's run it narrow. Next three consultant signups get monthly. Annual stays the default for enterprise. We reassess at the end of Q2.

[SPEAKER_1 1:20] Fine with me if we gate the experiment to consultants specifically. I don't want SMB self-serve seeing monthly yet.

[SPEAKER_2 1:33] Agreed. I'll write the landing page copy this week.
