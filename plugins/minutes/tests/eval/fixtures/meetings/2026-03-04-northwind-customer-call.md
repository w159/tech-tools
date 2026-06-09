---
title: Northwind Customer Call — Onboarding Friction
type: meeting
date: 2026-03-04T15:30:00
duration: 31m
attendees: [Mat S., Riley B.]
people: [mat, riley]
tags: [customer, northwind, onboarding, retention]
decisions:
  - text: Ship an onboarding fix for the SSO-first flow before end of Q1 (2026-03-31)
    topic: onboarding
    authority: high
action_items:
  - assignee: mat
    task: Fix SSO-first onboarding flow for Northwind-shaped accounts
    due: 2026-03-31
    status: open
    promised_to: riley
  - assignee: mat
    task: Follow up with Riley the week of March 30
    due: 2026-03-30
    status: open
speaker_map:
  - speaker_label: SPEAKER_0
    name: mat
    confidence: high
    source: manual
  - speaker_label: SPEAKER_1
    name: riley
    confidence: high
    source: manual
---

## Summary

- Riley (Northwind, Director of Ops) is frustrated: their team spent two weeks trying to onboard and hit SSO setup blockers.
- Riley said the word "churn" twice unprompted.
- Mat committed to an onboarding fix before end of Q1.

## Transcript

[SPEAKER_1 0:00] I'll be direct. We've had eighteen people try to log in this month and about half of them bounced at SSO. I can't keep selling this internally.

[SPEAKER_0 0:15] I hear that. What's the specific failure point?

[SPEAKER_1 0:22] Okta groups. Your product expects flat users. We have nested groups and it just dies.

[SPEAKER_0 0:34] That's fixable. We have two other customers with nested Okta groups on the roadmap, we just haven't shipped it.

[SPEAKER_1 0:46] When?

[SPEAKER_0 0:49] End of the quarter. March 31. That's a commitment from me personally.

[SPEAKER_1 1:02] If it slips, we're going to have a different conversation in Q2.

[SPEAKER_0 1:10] Understood. I'll follow up the week of March 30 regardless of whether we've shipped, with a clear status.
