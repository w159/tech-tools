---
title: Pricing Follow-up — Reversing the Monthly Billing Experiment
type: meeting
date: 2026-03-25T10:00:00
duration: 34m
attendees: [Mat S., Alex K., Jordan M.]
people: [mat, alex, jordan]
tags: [pricing, gtm, experiment, decision-reversal]
decisions:
  - text: Revert to annual-only billing across all segments. Monthly billing experiment did not generate enough signups to justify the payback hit.
    topic: pricing
    authority: high
    supersedes: "2026-02-28 decision to launch monthly billing"
action_items:
  - assignee: jordan
    task: Pull monthly billing from the landing page
    due: 2026-03-27
    status: open
  - assignee: alex
    task: Disable the monthly Stripe price, keep it archived
    due: 2026-03-27
    status: open
  - assignee: jordan
    task: Email the four monthly customers with migration-back-to-annual options
    due: 2026-04-01
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

- Four total monthly signups in three weeks, below the twelve-signup bar set at launch.
- Payback math got worse, not better: actual monthly churn tracking at 6.4% versus the 4% assumption.
- Decision: revert to annual-only. This explicitly supersedes the 2026-02-28 monthly billing decision.
- The four existing monthly customers get a soft migration path, not a forced flip.

## Transcript

[SPEAKER_2 0:00] We have four monthly signups in three weeks. The threshold we set was twelve by end of March. We're not going to hit it.

[SPEAKER_1 0:14] Churn on the four we did get is tracking worse than the annual baseline. Two of four canceled before month two.

[SPEAKER_0 0:28] That's a 50% churn signal from a tiny sample. I don't want to overfit, but combined with the signup miss, the experiment is a no.

[SPEAKER_2 0:43] Agreed. Pull it.

[SPEAKER_0 0:47] To be clear on the record: we are reversing the 2026-02-28 decision to launch monthly billing. Going annual-only effective immediately.

[SPEAKER_1 1:01] Don't force-migrate the four monthly customers. Offer them annual at a one-time discount, or let them ride monthly until renewal.

[SPEAKER_2 1:15] I'll draft the email. Out by April 1.
