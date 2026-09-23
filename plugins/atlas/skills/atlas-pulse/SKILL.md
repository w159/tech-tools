---
name: atlas-pulse
description: 'Generates a time-windowed product pulse report (usage, performance, errors, followups) from the telemetry the project ACTUALLY has wired. Discovers real analytics/tracing/payments sources first (PostHog, Mixpanel, Amplitude, Segment, Sentry, Datadog, New Relic, Honeycomb, Stripe - via atlas:explorer dependency/env-var/event-name greps, never assumed config), asks the user to name primary/value/completion events only when genuinely undiscoverable, then queries each source read-only and writes a dated single-page report to docs/pulses/. Hard rule: a project with zero telemetry wiring gets a plain "you have no telemetry" statement and a stop - never fabricated numbers. Use when asked for a product pulse, product health report, usage/performance/error snapshot over a time window, or recurring product telemetry review.'
when_to_use: generate a time-windowed product telemetry pulse report from real analytics/tracing/payments data
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '[lookback window, e.g. 24h, 7d, 30d; default 24h]'
---



# atlas-pulse

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Queries the product's real telemetry sources for a time window and produces a compact, single-page report: usage, system performance, errors, followups. Saved as a dated record under `docs/pulses/`; headlines surfaced in chat. Past pulses browse as a dated, diffable timeline.

**Done:** a 30-40 line report exists at `docs/pulses/<YYYY-MM-DD>-product-pulse.md`, every figure in it traces to captured query output under `.atlas/evidence/`, the verification verdict is stamped in `.atlas/.run/findings.json`, and the headlines are in chat.

## Hard rules (non-negotiable)

1. **Zero telemetry = plain statement, hard stop.** If discovery (Phase 1) finds no analytics, tracing, or payments wiring of any kind, say so plainly in one short message - "this project has no telemetry sources wired; a pulse would be fabricated numbers, so I stopped" - name what WOULD qualify (an SDK dependency, an env var, a track() call), and stop. No report file. No interview. No estimates or "approximate" numbers. Ever.
2. **Read-only, everywhere.** The skill never mutates the product, its database, or any external system. Every source query is read-only; a tool offering write modes is not used; a database source must be a verified read-only connection - refuse read-write credentials under any framing. The skill's only writes are the config artifact (Phase 1), the report file, and evidence files.
3. **No PII in saved reports or evidence summaries.** No user emails, account IDs, message content, or request bodies in anything written to disk.
4. **Read it like a founder.** No hardcoded thresholds, no default good/bad labels, no alerting. Present the numbers; let the reader judge. If a section is thin, leave it thin - never pad to fill the template.
5. **Single page.** Target 30-40 lines. If the report is getting long, cut.
6. **Not a shipping log or dashboard replacement.** Shipped work lives in `docs/CHANGELOG.md` and git history; deep investigation uses the normal tools. The pulse consolidates one page per window.

## Lookback window

The window is the skill argument (`24h`, `7d`, `30d`, `1h`), or the `lookback_default` from the config artifact, or the hard default `24h`, in that order. Unparseable argument: ask the user once to clarify. Apply a **15-minute trailing buffer** to the upper bound - ingestion lag under-reports the freshest events. For `24h`, query `[now - 24h - 15m, now - 15m]`.

## Phases

### Phase 0 - Route by config state

Read `.atlas/memory/product-pulse-config.md` in the target project if it exists (schema: `references/config.md`). If it defines sources and events, skip straight to Phase 2 with those values. If it is absent or names sources that no longer exist in the repo, run Phase 1. Parse the lookback argument now.

### Phase 1 - Discover real telemetry (never assume config)

Dispatch **one** `atlas:explorer` (read-only) per the dispatch shape in `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`. Its discovery patterns, provider lists, and report schema are in `references/discovery.md` - read that file first and paste its checklist into the dispatch CONTEXT. The explorer greps dependency manifests, SDK imports, env vars, and `track()`/`capture()` callsites; it does NOT trust a config file's claims without a matching wiring signal in the repo.

- **Zero sources found** -> HARD STOP per hard rule 1. State it plainly and end.
- **Sources found, event names extractable** -> derive primary/value/completion candidates from actual `track()` callsites and confirm them with the user in one message before querying.
- **Sources found, events genuinely undiscoverable** (SDK wired, no named events visible) -> run the interview in `references/interview.md` (at most one pushback round per question), then persist the answers to `.atlas/memory/product-pulse-config.md` per `references/config.md`. Never invent an event name that no callsite or user statement supports.

### Phase 2 - Run the pulse

Read `references/run.md` before dispatching any query - required. It defines the parallel/serial dispatch order, the read-only database rule, cost guards, the 15-minute buffer arithmetic, quality sampling discipline, evidence capture to `.atlas/evidence/<YYYY-MM-DD>-product-pulse/`, and report assembly from `references/report-template.md`. Sources are queried through whatever read-only path actually exists - the provider's MCP connector if one is connected in this session, otherwise its documented API with credentials from the user's own environment - never by hardcoding a dependency on a specific external CLI binary. A source with no working read-only access this run is reported as `no access this run`, not estimated.

Write the report to `docs/pulses/<YYYY-MM-DD>-product-pulse.md` (create the directory if absent; date-first naming is lint-enforced).

### Phase 3 - Independent verification

Dispatch `atlas:verifier` in a fresh context (never fork): it re-opens the evidence directory and confirms every figure in the report matches captured raw query output, that no PII leaked into the file, and that no number lacks a source. A figure it cannot trace is removed from the report, not footnoted. On PASS, stamp the verdict per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/verification-and-grounding.md`:

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" --id pulse-<YYYY-MM-DD> \
  --status verified --title "product pulse <YYYY-MM-DD> (<lookback>)" \
  --evidence docs/pulses/<YYYY-MM-DD>-product-pulse.md \
  --evidence .atlas/evidence/<YYYY-MM-DD>-product-pulse/ --category pulse
```

into `.atlas/.run/findings.json` (finding shape: the pulse run, its report path, its evidence dir, verifier verdict).

### Phase 4 - Surface and cadence

Put the Headlines section and the top Followup in chat, plus the report path. Mention recurring runs exactly once: cadence belongs to the user via the `atlas-loop` skill or the host's own scheduling primitive - never schedule automatically, never on any confirmation other than an explicit user instruction to set a schedule up.

## Reference map

| File | Read when |
|---|---|
| `references/discovery.md` | Phase 1 - before composing the explorer dispatch |
| `references/config.md` | Phase 0/1 - config artifact schema and unset semantics |
| `references/interview.md` | Phase 1 - only when events are genuinely undiscoverable |
| `references/run.md` | Phase 2 - before dispatching any source query |
| `references/report-template.md` | Phase 2 - report assembly |