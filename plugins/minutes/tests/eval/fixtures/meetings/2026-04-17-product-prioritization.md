---
title: Product Prioritization — Q2 Cut Lines
type: meeting
date: 2026-04-17T13:00:00
duration: 58m
attendees: [Mat S., Alex K., Sam W., Priya R., Jordan M.]
people: [mat, alex, sam, priya, jordan]
tags: [product, prioritization, q2, roadmap]
decisions:
  - text: Kill the advanced analytics feature. It was on the Q2 roadmap; it is no longer.
    topic: advanced-analytics
    authority: high
  - text: Keep team billing as the primary Q2 engineering investment
    topic: team-billing
    authority: high
  - text: Ship a scoped reporting-exports fix in Q2. Date-ranged CSV export, no dashboard, no visualizations.
    topic: reporting-exports
    authority: high
action_items:
  - assignee: sam
    task: Remove advanced analytics mockups from the product roadmap page
    due: 2026-04-18
    status: open
  - assignee: alex
    task: Ship scoped reporting-exports (date-ranged CSV) in 10 working days from 2026-04-20
    due: 2026-05-02
    status: open
  - assignee: mat
    task: Finalize Q2 OKR doc reflecting these decisions, send to Jamie
    due: 2026-04-18
    status: open
  - assignee: priya
    task: Tell Riley that scoped reporting exports ships by May 2
    due: 2026-04-18
    status: open
---

## Summary

- Advanced analytics was on the Q2 roadmap. Cut. Team agreed it was a nice-to-have that would not move retention or revenue this quarter.
- Team billing stays as the primary engineering investment. Ships April 15, already in flight.
- Reporting exports got a scoped green-light: date-ranged CSV, no dashboard, no charts. Bounded to two weeks of engineering. Addresses the Northwind pain point plus the two-to-three other customers Priya and Jordan believe will ask.
- Q2 OKR doc to be finalized and sent to Jamie tomorrow.

## Transcript

[SPEAKER_0 0:00] Three things on the table. Advanced analytics, team billing, reporting exports. Let's cut first.

[SPEAKER_1 0:08] Kill analytics. It was a roadmap item from Q4 that never had a customer pulling for it. Priya?

[SPEAKER_3 0:20] Zero at-risk accounts cite analytics. They cite onboarding, exports, and one billing weirdness. Kill analytics.

[SPEAKER_0 0:34] Killed. Sam, pull the mockups off the roadmap page.

[SPEAKER_2 0:39] Tomorrow.

[SPEAKER_0 0:42] Team billing. We're committed, April 15, on track per standup.

[SPEAKER_1 0:48] Confirmed.

[SPEAKER_0 0:51] Reporting exports. Scoped. I do not want a dashboard. I want date-ranged CSV. Is that doable in two weeks?

[SPEAKER_1 1:02] If it's literally date filter + CSV, two weeks. If anyone tries to sneak visualizations in, no.

[SPEAKER_0 1:14] Scope locked. Date range, CSV, no charts, no dashboard. Alex, ship by May 2. Priya, tell Riley.

[SPEAKER_3 1:26] Will do tomorrow.

[SPEAKER_0 1:30] OKR doc to Jamie tomorrow reflecting this.
