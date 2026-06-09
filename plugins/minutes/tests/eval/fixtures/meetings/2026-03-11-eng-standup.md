---
title: Eng Standup — SSO and Team Billing Work
type: meeting
date: 2026-03-11T09:30:00
duration: 22m
attendees: [Mat S., Alex K., Sam W.]
people: [mat, alex, sam]
tags: [engineering, sso, standup]
decisions:
  - text: Alex owns SSO nested-groups support, targeting ship by 2026-03-25
    topic: sso
    authority: high
action_items:
  - assignee: alex
    task: Ship SSO nested-groups support
    due: 2026-03-25
    status: open
  - assignee: sam
    task: Finish team-billing invoice UI designs
    due: 2026-03-18
    status: open
  - assignee: alex
    task: Code review the Stripe monthly-billing PR
    due: 2026-03-12
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
    name: sam
    confidence: high
    source: manual
---

## Summary

- Alex took SSO nested-groups. Target ship: March 25. Blocks the Northwind commitment by one week of cushion.
- Sam designing team-billing invoice UI, due March 18.
- Stripe monthly-billing PR in review; Alex to merge by end of day March 12.

## Transcript

[SPEAKER_0 0:00] Quick one. I need status on SSO nested groups. Northwind call last week, I committed to March 31.

[SPEAKER_1 0:11] I can take it. Priced at about a week of work if the underlying auth lib plays nice. Target March 25, gives a week of slack.

[SPEAKER_0 0:24] Good. Sam, team billing UI?

[SPEAKER_2 0:29] Invoice screens wireframed. Reviewing with Priya tomorrow. Final designs March 18.

[SPEAKER_0 0:41] And the Stripe monthly PR Jordan needs?

[SPEAKER_1 0:48] I'll review today and merge tomorrow. Should unblock Jordan's landing page work.
