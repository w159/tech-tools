---
title: Eng Standup — SSO Shipped, Team Billing Next
type: meeting
date: 2026-04-07T09:30:00
duration: 24m
attendees: [Mat S., Alex K., Sam W.]
people: [mat, alex, sam]
tags: [engineering, sso, team-billing, standup]
decisions:
  - text: Team billing is the next ship target, due 2026-04-15
    topic: team-billing
    authority: high
action_items:
  - assignee: alex
    task: Team billing backend (multi-seat Stripe subscriptions)
    due: 2026-04-15
    status: open
  - assignee: sam
    task: Team billing invoice UI, handed off to Alex by 2026-04-10
    due: 2026-04-10
    status: open
  - assignee: mat
    task: Draft reporting-exports scoping doc, take to product prioritization 2026-04-17
    due: 2026-04-16
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

- SSO nested-groups shipped 2026-04-03. Riley (Northwind) confirmed receipt. That commitment is closed.
- Team billing is the next focus. Target April 15.
- Mat to scope reporting exports as a candidate for the April 17 product prioritization session.

## Transcript

[SPEAKER_1 0:00] SSO is out. Shipped Friday. Riley confirmed Monday.

[SPEAKER_0 0:08] Good. That was a three-week arc and it landed three days late versus Riley's expectations, but we got there.

[SPEAKER_1 0:19] Next up, team billing. Need the invoice UI from Sam by Thursday. I can wire it through the Stripe sub-tier work by Tuesday the 15th.

[SPEAKER_2 0:32] Invoice UI is done. I'll hand it off Thursday.

[SPEAKER_0 0:38] Riley also raised reporting exports. Not on the roadmap. I want to scope it as an option for the prioritization meeting on the 17th.

[SPEAKER_1 0:52] Scope it small. If we're not willing to take three weeks on it, I don't want it on the board.
