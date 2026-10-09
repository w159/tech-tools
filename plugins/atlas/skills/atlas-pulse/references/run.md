# Running the pulse

Required read before dispatching any source query. Covers dispatch order, cost guards, evidence capture, and report assembly.

## Dispatch order

**Parallel batch** (independent tools, one message, per `subagent-kit.md` parallelism rules - each query dispatch gets the full GOAL/DELIVERABLE/SUCCESS CRITERIA/OUT OF SCOPE/STOP CONDITIONS shape):

- **Analytics query** - primary event count, value-event count, per-completion-event counts, and the ratios between them, over the window.
- **Tracing query** - error counts grouped by category/signature, latency distribution, and the same window from the prior equal-length period for comparison.

**Serial, after the parallel batch:**

- **Payments query**, only if a payments source is configured - new customers, churn, revenue delta. One call.
- **Read-only database queries**, only if `db_access` names a verified read-only connection. One at a time. Tight, indexed, scoped queries; never full-table scans on large tables. A query that looks expensive is skipped and the report says `DB query skipped (estimated cost too high)` - estimating a number instead is forbidden.

## How each source is actually queried

Pick the best read-only path that exists **in this session**, in this order:

1. The provider's **MCP connector**, if one is connected (check the live tool list, not memory). Read-only operations only; a connector tool offering write modes is not used.
2. The provider's **documented HTTP API** via the session's fetch/browser capability, with credentials from the user's own environment (env vars, stored CLI auth). Read-only endpoints only.
3. The provider's **CLI**, if the user's environment already has it installed and authenticated.

Never hardcode a dependency on one specific external binary or vendor CLI - a missing one degrades gracefully to the next path. A source with no working path this run renders `no access this run` in the report. It is never estimated, interpolated, or carried forward from a previous pulse.

All credentials handling: read what the environment already exposes; never print, store, or transmit a secret value; never ask the user to paste a key into chat. If no credential for a configured source is reachable, that source is `no access this run` and the user is told which credential to expose next run.

## Time window arithmetic

`window = [now - lookback - 15m, now - 15m]` (trailing buffer for ingestion lag). Prior-window comparisons use the equal-length window immediately preceding it. Local timezone of the project applies to all rendering; store UTC in evidence.

## Evidence capture (at the moment of query)

Every raw query and its raw response go to `.atlas/evidence/<YYYY-MM-DD>-product-pulse/` as the query runs: one file per source, e.g. `analytics-raw.md`, `tracing-raw.md`, `payments-raw.md`, each headed with the exact query issued, the window, and the verbatim response. Summaries in evidence files must contain no PII (raw provider payloads stay out of evidence too - capture the counts/aggregates the API returned, not user records). The Phase 3 verifier traces every report figure to these files; a figure with no evidence file is removed.

## Quality sampling (only when config opts in)

Sample up to 10 sessions/conversations from the window; score each 1-5 on `quality_dimension` with `quality_scoring_note` as the rubric. Discipline: default 4-5 for normal sessions; reserve 1-3 for a clear failure mode (wrong answer, user stuck, error surfaced). If every sample scores 3 the bar is too strict; if all 5, too loose - say so in the report. Render as a count distribution ("8x 5, 1x 4, 1x 2") plus an anonymized one-line note per sub-4 session. No message content, no user identifiers.

## Assemble the report

Read `references/report-template.md` and fill it from query results. Four sections in order: Headlines (2-3 lines), Usage, System performance, Followups (1-5 things worth investigating, each a concrete next action, not a vague area). Keep 30-40 lines total. A thin source or an empty window leaves a thin section - pad nothing, never invent a number to fill a slot, and label every figure with its source (`posthog`, `sentry`, `stripe`, `no access this run`).

## Write, verify, surface

1. Write `docs/pulses/<YYYY-MM-DD>-product-pulse.md` (create `docs/pulses/` if absent).
2. Phase 3 verification per SKILL.md - verifier traces figures to evidence, stamps `.atlas/.run/findings.json`.
3. Surface Headlines + top Followup + full path in chat.

## Why this shape

The founder posture and single-page constraint are deliberate: dashboards with 40 metrics produce attention sprawl; one page with four sections forces noticing what matters. The dated records under `docs/pulses/` are working memory, not a data warehouse - grepable, diffable, disposable.