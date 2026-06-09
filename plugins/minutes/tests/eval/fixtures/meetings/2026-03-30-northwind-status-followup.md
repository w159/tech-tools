---
title: Northwind Follow-up — SSO Status
type: meeting
date: 2026-03-30T16:00:00
duration: 18m
attendees: [Mat S., Riley B.]
people: [mat, riley]
tags: [customer, northwind, sso, status-update]
decisions:
  - text: Ship remaining SSO nested-groups fix by 2026-04-03, three days late
    topic: sso
    authority: high
action_items:
  - assignee: alex
    task: Ship remaining SSO nested-groups fix
    due: 2026-04-03
    status: open
  - assignee: mat
    task: Confirm delivery with Riley by EOD 2026-04-03
    due: 2026-04-03
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

- Mat called per the 2026-03-04 commitment. SSO did not ship on 2026-03-25 as internally targeted.
- Delivered status honestly: 80% done, shipping April 3 (three days past the originally promised March 31).
- Riley is annoyed but not churning. Accepts the new date. Flags a separate concern about reporting exports.

## Transcript

[SPEAKER_0 0:00] I said I'd call regardless of whether it shipped. It hasn't shipped.

[SPEAKER_1 0:08] Go on.

[SPEAKER_0 0:10] We're at 80%. Nested groups work in dev, we hit an edge case with role mapping on Wednesday. Alex has a fix in review. Shipping April 3.

[SPEAKER_1 0:26] Three days late.

[SPEAKER_0 0:29] Yes.

[SPEAKER_1 0:31] Don't make it six. We have a board meeting April 8 and I need to show adoption numbers.

[SPEAKER_0 0:42] You'll have it April 3. I'll confirm with you directly.

[SPEAKER_1 0:48] One other thing. Your reporting exports are useless. CSV only, no date range, everything or nothing.

[SPEAKER_0 0:58] Noted. That's not on this quarter's roadmap but I'll flag it internally.
