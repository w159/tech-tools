# Event interview (only when discovery cannot name the events)

Required read when Phase 1 finds wired sources but no extractable event names. Runs in the main context (this skill can talk to the user; dispatched subagents never do). Ask one question at a time, using the host's blocking question tool when available, numbered options in chat otherwise. Never silently skip a question.

## Overall rules

1. **Push back, but don't spiral.** One pushback round per question. If the second answer is still unusable, capture it, flag `needs-review` in the config artifact, move on.
2. **Capture names verbatim.** Use the terms the user actually uses; the literal event string must be repeatable later.
3. **Never ask for credentials.** Tools and query shapes only. Keys live in the user's environment.
4. **Every proposed event faces five plain-English checks** - do not use the acronym with the user: *specific* (a named event, not a category - `message_sent` passes, "engagement" does not); *measurable* (point to the tool and query that returns a number); *actionable* (if it moved, the team knows what to do); *relevant* (ties to what the product is for); *timely* (reads cleanly in the pulse window). When an answer fails one, name it: "if that number swings, what do we do? Is there a tighter signal that would drive a decision?"

## Q1 - Primary engagement event

"When someone is using your product, what single event fires - the one that says a user is active right now?"

Engagement-vs-value test (apply silently): does the candidate fire when the user is *using* the product or has *gotten value*? Value is later; push it to Q2. Common slips: `agent_accepted_draft` (value) vs `agent_received_draft` (engagement); `ride_completed` (value) vs `ride_started` (engagement).

Anti-patterns and pushback:

- **Pageview / app open / login** -> "Those say someone showed up. What fires when they're actually doing the thing the product is for?"
- **Multiple candidates, no primary** -> "Pick the one closest to 'a user is active in the core product.' For async products that's usually contributing content over opening the app."
- **Too deep in the funnel** (`purchase_completed`) -> "That's a conversion event - we track that separately. What happens earlier, while they're using it?"
- **Vague** ("interaction") -> "Is there a specific event name in your tool? I want the literal name so this repeats."

## Q2 - Value-realization event

"What event fires when the user actually got what they came for?"

- **Same as primary, accidentally** -> "Some products have one event covering both - confirm, or is there a later signal that says 'this user got the thing'?"
- **Value is a feeling, not an event** -> "What proxy correlates? A completion event, time-to-first-X, next-day return, or a copy/share/export (took the output into their real work). Pick the closest."
- **Can't name one** -> "Then we treat engagement as the value proxy and note that in the config." Capture `same-as-primary` or `not-defined` with a note.

## Q3 - Completion / conversion events (optional, 0-3)

"Any conversion or completion events worth tracking - signups, upgrades, trial starts, purchases?"

- **Long list** -> "Pick the top 3 that move the business; the rest are ad-hoc queries."
- **Non-actionable** (`email_opens`, `logo_impressions`) -> "If that number swings, what do we do? If nothing, it's a vanity metric - what's a tighter signal further down the funnel?"

## Q4 - Source arbitration

If two discovered sources can answer the same signal (e.g. PostHog and a read-only DB replica both see search events): "Both can cover this - which is the source of truth? The pulse queries one per signal so numbers stay consistent." Record the canonical source in the config prose; the other stays available for ad-hoc work only.

If the user says a metric they care about is **not instrumented**: offer exactly two off-ramps - *defer* (add to `pending_metrics`; renders `no data` until wired) or *exclude* (add to `excluded_metrics`; omitted). Every named-but-uninstrumented metric lands in exactly one. Never silently skip.

## Q5 - Quality scoring (AI products only, opt-in)

"Can a session or conversation be rated for quality? If yes, I'll sample up to 10 per run and score 1-5 on a dimension you define."

- **Vague dimension** ("quality", "helpful") -> "On what axis specifically? A human reading a transcript should score it consistently."
- **Multiple dimensions** -> "Start with one - comparability across runs is the point. Which matters most now?"
- **Reviewability test** (silent): could two reviewers agree? If not, push back once: "What makes this a 5 instead of a 3? If you can say it in one sentence, the dimension is tight enough." Capture that sentence as `quality_scoring_note`; otherwise flag `needs-review`.

Then confirm the default lookback window (24h / 7d / 30d / 1h) and write the config artifact per `references/config.md`, show the resulting frontmatter to the user, and offer one round of edits before Phase 2.