# Atlas turn scoring (TypeSafe)

Model-scored quality judgments of assistant replies, so recurring failures
become doctor findings that name the atlas surface to fix, and the existing
findings -> baseline -> remeasure loop proves whether the fix worked.

## What is scored

Each scored turn is one assistant reply (keyed by `session_id` + `message_uuid`).
Verdicts come from TypeSafe (`POST https://api.typesafe.ai/v1/systemone`, model
Jev) and land in the `turn_scores` table. "Hit" is the failure direction.

| Judgment | Type | Hit | Surface to fix |
|---|---|---|---|
| `literal_ask_delivered` | noul | low (<= 0.35) | style: Deliver the literal ask |
| `done_claim_unverified` | noul | high (>= 0.7) | style: Evidence on the user's surface; hook: hooks/completion_gate.py |
| `scope_drift` | noul | high | style: Scope is what was named |
| `ignored_standing_correction` | noul | high | style: Corrections stick |
| `buried_decision` | noul | high | style: Decisions stop the line |
| `next_turn_correction` | noul | high | outcome (only asked when a next user message exists) |
| `verbosity` | score, 4 levels 0 terse .. 3 far too long | top level | style: Length budget |

Deterministic metrics (no API call, `kind=metric`): `header_present` (1/0),
`banned_punct` (count of em/en dash, curly quotes, ellipsis glyph),
`reply_chars`. Style surfaces are sections of
`plugins/atlas/output-styles/atlas-orchestrator.md`.

## Data flow

```
SessionEnd -> detached scorer (turn_scoring.py) -> turn_scores
  -> atlas_doctor.py --mine (turn_quality miner) -> findings
  -> fix the named surface -> --baseline -> later --remeasure
```

Scoring never runs inside a Stop hook's latency budget; hooks fail open.

## The miner

`mine_turn_quality` (registered as `turn_quality`) works over the last
`RECENT_WINDOW_DAYS` (14):

- Per judgment, overall and per project, the hit rate. A finding is emitted
  when the rate exceeds the judgment threshold and at least `min_turns` (20)
  turns were scored in that scope. Fingerprint `turn_quality:<judgment>[:<project>]`.
- Evidence holds `rate`, `n`, and up to 3 example `(session_id, message_uuid)` pairs.
- Predictive value: P(`next_turn_correction` hit | judgment hit) vs P(... | not hit),
  written into each finding's detail and `evidence.predictive`. A judgment that
  does not predict user corrections is noise; lower its priority or reject it.
- Metric findings: `header_present` rate below 0.8 (surface
  `style: Status header / hooks/session_boot.py`) and `banned_punct` in more than
  10% of replies (surface `style: Characters`).
- `metric_value` is always a rate where lower is better (header uses the
  missing rate), so `--remeasure` re-runs the miner by name with no special casing.

### Tuning

Constants in `plugins/atlas/scripts/atlas_doctor.py`:
`TURN_QUALITY_DEFAULT_THRESHOLD` (0.25), `TURN_QUALITY_THRESHOLDS`
(per-judgment overrides, `{judgment: rate}`), `NOUL_HIGH` (0.7), `NOUL_LOW`
(0.35), `HEADER_RATE_MIN` (0.8), `BANNED_PUNCT_RATE_MAX` (0.10), and the
`min_turns` argument.

## Knobs

| Variable | Default | Meaning |
|---|---|---|
| `TYPESAFE_API_KEY` | unset | Read from the process environment only; never logged or stored |
| `ATLAS_TYPESAFE_SCORING` | on when key present | `off` disables scoring |
| `ATLAS_TYPESAFE_MODEL` | `jev-latest` | Model id |
| `ATLAS_TYPESAFE_MAX_CALLS` | 200 | Cap on requests per scoring pass |
| `ATLAS_TYPESAFE_URL` | `https://api.typesafe.ai` | API base |

`atlas_doctor.py` reports a WARN-level `typesafe-scoring` check (key present,
rows in the last 7 days, last scored time). It never counts as a failure.

## Cost and privacy

Billing is input tokens only, about $0.042 per million. All questions for one
reply share one call. Transcript excerpts (reply, request, and for
`next_turn_correction` the next user message) are sent to api.typesafe.ai after
the secret scrub used by ingest. Set `ATLAS_TYPESAFE_SCORING=off` to stop.

Compliance (GLBA, FTC Safeguards Rule, SEC Reg S-P): scoring is on by default
whenever `TYPESAFE_API_KEY` is set, by the owner's decision of 2026-09-29.
That makes api.typesafe.ai a third-party processor of session excerpts from
every scored project, including Henssler work (firewall, CrowdStrike,
Envestnet). Those excerpts can contain nonpublic personal information (NPI):
the scrub removes credential-shaped strings only, not client names, account
numbers, or report contents. Per TypeSafe's model docs, zero data retention
(ZDR) is offered only on enterprise plans and Jev is not trained on customer
requests; on other plans retention follows TypeSafe's standard terms. Before
relying on this for regulated work, record TypeSafe as a service provider in
the vendor-management program (data categories, retention, ZDR status) and
confirm its Reg S-P service-provider notification terms. To exclude a project,
set `ATLAS_TYPESAFE_SCORING=off` in that project's `.claude/settings.json`
`env`.

Scoring failures are recorded as a `scoring_error` row (message_uuid
`_session`) in `turn_scores`. `turn_scoring.py --status` and the doctor
`typesafe-scoring` WARN report the 7-day error count and the latest error.

omp sessions are scored after `session_ingest.py --backfill-agent omp`
(omp runs no Claude Code hooks, so this is a manual or scheduled step).

## Running it

```
python3 plugins/atlas/scripts/turn_scoring.py --recent-days 14
python3 plugins/atlas/scripts/atlas_doctor.py --mine
python3 plugins/atlas/scripts/atlas_doctor.py --list-findings --status open
```
