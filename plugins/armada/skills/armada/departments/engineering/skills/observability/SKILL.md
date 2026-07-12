---
name: observability
description: Instrument services and triage errors across the four telemetry pillars (logs, metrics, traces, errors). Use when the user says "why is this slow", "what's erroring", "set up alerting", "add tracing", "define an SLO", "triage this Sentry issue", or "we're getting paged for nothing", or needs logs, metrics, traces, or error monitoring.
when_to_use: "When instrumenting a service for logs, metrics, or traces, triaging an error stream, defining SLOs and alert thresholds, or running the Sentry triage checklist"
allowed-tools: Read, Glob, Grep, Bash
---

# Observability

Make systems explainable: instrument them, then triage what they report.

## The Four Telemetry Pillars

| Pillar | Answers | Use For |
|--------|---------|---------|
| Logs | What happened, in detail | Forensics, audit trail, debugging one request |
| Metrics | How much, how often, how fast | Trends, dashboards, alert thresholds |
| Traces | Where the time went across services | Latency breakdown, "why is this slow" |
| Errors | What broke, how often, for whom | Triage, regression detection, release health |

Logs and traces explain a single request. Metrics and errors explain the aggregate. Reach for the matching pillar before guessing.

## Structured Logging and Correlation

Emit JSON, not free text. Every log line carries a correlation ID (request or trace ID) so one request can be reconstructed across services. Propagate that ID through every hop and attach it to errors and spans. Redact secrets and PII at the logger, not at the call site. Log the why and the context, not a restatement of the line of code.

## Error Triage Workflow

Work the funnel in order. Do not jump to root cause before scoping impact.

1. **Group**: collapse duplicates into one issue by fingerprint, not raw count. One bug, one issue.
2. **Impact**: how many users, what rate, since when, which release. Impact ranks the queue, not noise.
3. **Root cause**: read the stack trace, the breadcrumbs, the correlation ID, the offending release diff.
4. **Owner**: assign to the team that owns the failing code path. An unowned error is an ignored error.

## SLO and Alert Hygiene

Alert on symptoms users feel (error rate, latency, availability), not on causes (CPU, memory, queue depth). Cause metrics belong on dashboards for diagnosis, not in the pager.

- Define SLOs from user-facing SLIs. Page on burn rate against the error budget, not on a fixed instantaneous threshold.
- Every alert is actionable and routes to an owner with a runbook link. If there is no action, it is a dashboard, not an alert.
- Delete or tune any alert that fires without anyone acting on it. Noisy thresholds train people to ignore the pager.
- Set severity by user impact, mapped to the same levels as incident response.

## Sentry Triage Checklist

1. Sort the issue stream by events and by users affected, not by recency alone.
2. Check first-seen and the regression flag against the latest release to spot a deploy-introduced break.
3. Open the top issue: read the stack trace, breadcrumbs, tags (release, environment, browser, server), and any linked trace.
4. Confirm it is real, not third-party or expected. Triage out the noise so the real signal stays visible.
5. Set a level, assign an owner, link the tracking ticket, and resolve in the next release so a regression reopens it.
6. Watch release health (crash-free sessions and users) after each deploy. A drop is a rollback signal.
