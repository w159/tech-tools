# First-run setup

Loaded by `atlas-sweep` when `feedback_sources` is unset or empty in
`.atlas/sweep.yaml`, or when a `setup`/`reconfigure` argument is present.
This phase is **interactive only**: a `mode:non-interactive` run with no
config reports `first run requires interactive setup` and stops. Do not
infer sources, actions, or approvals without asking.

The interview writes ONE file: `.atlas/sweep.yaml` at the project root's
`.atlas/` directory (durable, committable operational config per the docs
SSOT — no secrets belong in it). State always lives at the fixed path
`.atlas/.run/sweep-state.json`; there is no state-location question.

## Interaction method

Use the host's blocking question tool already in the current tool list
(match by capability, not name). If none exists, the run behaves as
non-interactive — stop and tell the user to run setup interactively. Ask one
question at a time. Every question with a default states the default; the
user accepts or overrides, you never pick silently.

## 1. Sources (repeatable loop)

Opening framing: "Let's wire up the feedback sources this sweep watches. One
at a time; add as many as you want."

For each source:

1. **Type.** `github-issues` is the only connected type in this harness.
   Anything else the user names (Slack, email, Discord, ...) is captured
   verbatim as its type and runs **manual-input-only** until a connector
   exists — say so plainly, do not promise integration.
2. **Identity.** For github-issues: the repo as `owner/repo`. For
   manual-input-only types: a free-form target describing where feedback
   arrives (kept for context; nothing fetches from it).
3. **Source id.** A short, lowercase, hyphenated stable handle (e.g.
   `gh-issues`, `slack-alpha`), unique within `feedback_sources`. Suggest
   one derived from the type; let the user override.

After sections 2-3 are captured for this source, ask: "Add another source?"
Loop until done. At least one source is required.

## 2. Ack actions + standing approval (per source)

Two source-side actions plus the approval that governs them:

- **Ack action** (marks an item seen): GitHub -> a label, default
  `feedback:ack`. Manual-input-only types -> none; skip and say so.
- **Close-out action** (marks an item resolved): GitHub -> a label, default
  `feedback:resolved`. Manual types -> none.
- **Standing approval, verbatim:**

  > "Do you approve the sweep applying these labels — `<ack>` and
  > `<closeout>` on `<source id>` — on **every future run without asking
  > again**? Yes authorizes these two label writes only. No keeps this
  > source read-only: items are ingested and triaged but the source is
  > never touched, and items land as `ack_deferred` for you to action
  > manually."

  Record the literal answer as `approved: true|false`. A "no" is not a
  failure; it is a supported, normal configuration.

- **Closing or replying is never covered by approval.** State it when
  capturing approval: closing an issue or commenting requires explicit
  per-item confirmation every time, approval or not.

## 3. Sensitive flag (per source)

Ask: "Should item content from `<source id>` be withheld from state files
and the triage doc? Say yes if the source can carry PII, customer data, or
recordings you do not want written to any file. When yes, the sweep drops
item body and quote at write time; only titles, urls, ids, and status
persist. Default is no." Record `sensitive: true|false`.

## 4. Ack cap

Ask: "What is the most acknowledgments the sweep may perform on one source
in a single run before it pauses? This circuit-breaks a runaway sweep
spamming your tracker. Interactive runs pause and ask; non-interactive runs
defer the rest. Default is 25." Record `sweep_ack_cap`.

## 5. Lease TTL

Not asked. Write `sweep_lease_ttl_minutes: 60` as a tunable the user can
edit later; mention it exists.

## 6. Write config

Merge the captured settings into `.atlas/sweep.yaml` (create `.atlas/` if
absent). If the file already exists, preserve every unrelated key. Shape:

```yaml
# atlas-sweep configuration
feedback_sources:
  - type: github-issues
    id: gh-issues
    target: owner/repo
    ack_action: "feedback:ack"
    closeout_action: "feedback:resolved"
    approved: true
    sensitive: false
sweep_ack_cap: 25
sweep_lease_ttl_minutes: 60
```

Show the user the resulting file content and offer **one round of edits**.

## 7. Schedule offer

Ask whether the sweep should run on demand (fully functional) or on a
recurring schedule. Never schedule inline: hand off to the harness's
scheduling primitive (e.g. the `atlas-loop` skill's interval loops, cron, or
GitHub Actions) and note that a scheduled invocation must include
`mode:non-interactive`. Declining leaves on-demand use fully working.

**End:** tell the user setup is complete and print the rendered invocation
(`/atlas-sweep`) for the first run.

## Reconfigure

A later `setup`/`reconfigure` run loads this file, walks sections 1-5 with
current values shown as defaults, and merges the result — never deleting
sources wholesale without the user naming them.
