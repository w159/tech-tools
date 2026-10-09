# Announcement Channels - Shapes and Grounding Rules

Per-channel drafting shapes for `atlas-promote`. Ported from the CE promote skill's
direct-drafting path; the external copy-tool path was deliberately not ported (atlas
never hardcodes an external-CLI dependency, and direct drafting fully covers the job).

## Grounding rules (apply before any channel)

1. **Every claim traces to evidence** - the merged PR, the diff, the plan artifact at
   `docs/plans/<task-slug>.md`, the lesson at `docs/lessons/<YYYY-MM-DD>-<slug>.md`, or
   the newest `docs/CHANGELOG.md` entry. If a sentence cannot be traced, delete it.
2. **Shipped means shipped.** In-progress, planned, or partially verified work is never
   announced as done. A plan with unverified stages is not announcement material.
3. **Outcome, not implementation.** Name what a user can now do, not the classes,
   endpoints, or migrations that made it possible. "You can now export any report to
   CSV in one click", not "Added a CsvSerializer and an export endpoint."
4. **No marketing fluff.** Banned: hype adjectives ("revolutionary", "seamless",
   "blazing fast" unless benchmarked in the evidence), exclamation marks, invented
   superlatives, roadmap promises. The strongest plain sentence wins.
5. **One idea per piece.** A multi-beat change becomes separate drafts or a thread, not
   one crowded paragraph.

## Default channels

### Release note

One short paragraph (or 2-3 bullets for multi-part changes), audience: end users.
Declarative, complete sentences, no internal jargon. Name the capability, who benefits,
and the one-line why. Close with where to find it (docs path or feature name) if the
evidence names one.

### Slack-style update

2-4 short lines, conversational but factual. Line 1 = the news in plain words; line 2 =
what it means for the reader; optional line 3 = where to look. No hashtags. Reads like a
colleague posted it, not a press release. Match the audience implied by the request: an
engineering channel may name the module; a general channel may not.

### Changelog entry

One declarative line per change, matching the docs-SSOT CHANGELOG template exactly
(`### Added` / `### Fixed` / `### Changed` under a `## YYYY-MM-DD` heading, newest
first, with evidence/finding paths in parentheses where the run produced them). Plain,
not promotional. This is the only channel with a fixed format - the SSOT template wins.

## Optional channels (draft only when the user names them)

- **X post** - value in the first line; ~1-3 tight lines. Thread only when there's more
  than one beat worth its own line. Hashtags 0-2, only where the channel expects them.
- **LinkedIn** - a short paragraph: human angle (why it matters), then the what.
  Warmer than X.
- **Email** - benefit-stating subject + 2-4 sentence body + one CTA.
- **Blog intro** - one opening paragraph framing the problem and the new capability;
  leave the deep-dive to the author.
- **Demo script** - 3-6 spoken beats: hook, problem, action, payoff.

One strong draft per channel by default; produce more only when asked ("3 tweet
options"), capped at ~3.

## Presentation

Every draft is presented in chat as a labeled, copy-pasteable block:

```
### Slack update
<the copy>
```

Posting, publishing, scheduling, committing, and PR-opening are always human actions.
The skill's output ends at the blocks.
