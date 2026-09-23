# Report template

Fill from query results. Hard limits: 30-40 lines total, four sections, no PII, no thresholds or good/bad labels, every figure carries its source tag. Sections render only when they have data - a section with nothing to show is omitted or says `no data this window`, never padded.

```markdown
# Product Pulse - <product_name> - <YYYY-MM-DD>

Window: <start> - <end> (<lookback>, 15m trailing buffer applied) · Sources: <tags>

## Headlines

<2-3 lines a founder reads first: the one usage number, the one system number,
and anything anomalous. No adjectives doing measurement's job.>

## Usage

- Primary engagement (<primary_event>): <N> (<source tag>) - <delta vs prior window, if queried>
- Value realization (<value_event>): <N> (<source tag>) - <ratio to primary, e.g. 38%>
- Completions: <event>: <N> · <event>: <N> (<source tag>)
- Quality sample (if enabled): <count distribution + anonymized note>

## System performance

- Latency p50/p95/p99: <x> / <y> / <z> (<tracing tag>) - prior window: <x'/y'/z'>
- Top errors by count (<tracing tag>):
  1. <signature> - <N>x - one-line likely meaning
  2. ... (up to 5)

## Followups

1. <the single most worth-investigating thing, as a concrete next action>
2. <...up to 5, or fewer if fewer deserve it>
```

## Assembly rules

- Every `<N>` traces to a file in `.atlas/evidence/<YYYY-MM-DD>-product-pulse/`; the verifier removes what it cannot trace.
- A source with no working read-only access renders `no access this run` in its slot - never an estimate, never a carry-forward from an earlier pulse.
- A source configured but returning zero events in-window says `0 in window` - an honest zero is data.
- Deltas are computed, not eyeballed; if the prior window was not queried, say `no prior-window comparison this run` instead of inventing a trend.
- Followups name the action ("check why checkout_started fell 40% against completions - instrument the payment error branch") not the area ("payments seems off").
- Lines exceed the budget only by cutting; if Headlines and top errors already tell the whole story, the report may be shorter than 30 lines.