# Sweep state schema (v1)

Canonical contract for `.atlas/.run/sweep-state.json`, enforced by
`plugins/atlas/scripts/sweep_state.py` — the **only** writer of the file.
Every peer (source connectors, cluster analysis, the orchestrator) reads via
`read` and changes state exclusively through the engine's subcommands, so the
rules below hold in one place. Never hand-edit the file; the engine refuses
to write over a file it cannot fully parse, so a hand-mangled state is a
manual-recovery incident, not a silent clobber.

## Top-level shape

```json
{
  "schema_version": 1,
  "lease": {
    "writer": "sweep-cron-2026-07-02",
    "timestamp": "2026-07-02T12:00:00+00:00",
    "ttl_minutes": 60
  },
  "sources": {
    "gh-issues": { "cursor": "2026-07-01T09:00:00Z", "sensitive": false }
  },
  "items": {
    "gh-issues:owner/repo#1234": {
      "source": "gh-issues",
      "id": "owner/repo#1234",
      "status": "acknowledged"
    }
  },
  "last_run": {
    "timestamp": "2026-07-02T12:05:00+00:00",
    "outcome": "completed",
    "writer": "sweep-cron-2026-07-02",
    "counts": { "ingested": 5, "closed": 1 }
  }
}
```

| key | meaning |
| --- | --- |
| `schema_version` | Contract version, currently `1`. A file that parses but lacks it is CORRUPT — the engine refuses to write over it. |
| `lease` | Single-writer mutex (below). Absent when no writer holds it. |
| `sources` | Per-source resume cursor + optional flags, keyed by the source's config id. |
| `items` | Per-item lifecycle record, keyed `<source-id>:<item-id>` so a source-native id (an issue number, a message ts) never collides across sources. |
| `last_run` | Most recent sweep's outcome bookkeeping. |

## Compatibility rule

Additive-safe: unknown top-level keys, unknown fields on items or sources,
and unknown `status` values are preserved on every write-back, never
dropped. The status enum below is documentation, not a whitelist.

## Status enum

| status | meaning |
| --- | --- |
| `ingested` | Captured from a source; not yet triaged. |
| `ack_deferred` | Receipt noted, but the source-side ack (or triage) was deferred — unapproved source, no write path, failed ack, or breaker trip. |
| `acknowledged` | Acked at source and accepted into the pipeline. |
| `needs_analysis` | Content present, awaiting analysis. |
| `manual_stuck` | Blocked after repeated failed attempts; needs a human. Listed out of the routine nag. |
| `analyzed` | Cluster/category recorded on the item. |
| `in_plan` | Folded into the rolling triage doc as proposed work. |
| `fix_pending` | A fix is underway or awaiting merge verification. Also the downgrade target for an under-evidenced `closed`. |
| `closed` | Resolved and verified. REQUIRES all three evidence fields. |
| `source_gone` | The originating item no longer exists at the source. |

## Closed-item evidence rule

`closed` is a claim that work shipped and was verified, so state holds it to
proof: a closed item must carry truthy `fix_ref`, `verified_merge_sha`, and
`verified_at`. `validate` (lease-agnostic, run at sweep start) downgrades any
closed item missing one back to `fix_pending` and returns the downgraded ids.

## Lease (single-writer mutex)

- `lease-acquire` is re-entrant for the same writer (re-stamps); returns
  `LOCKED` against a *live* other-writer lease, `STALE-RECLAIMED` (with
  `previous_writer` / `previous_timestamp`) past the TTL. TTL reclaim is what
  recovers a crashed writer without manual cleanup.
- Every mutating call (`upsert-item`, `cursor-advance`) re-checks ownership:
  a non-holder gets `LEASE-LOST` with no write. Success re-stamps the lease
  timestamp so a long sweep keeps it alive.
- `lease-release` clears only the caller's own lease; releasing another
  writer's is `LEASE-LOST`.
- Staleness is asserted only when provable: an unparseable lease timestamp is
  live and never stomped.
- **Scope:** the state file is under gitignored `.atlas/.run/`, so the lease
  serializes overlapping sweeps *per checkout* (cron + manual in one tree).
  It is not a cross-machine mutex.

## run-record

`--outcome` is one of `completed | aborted-locked | partial | failed`;
`--timestamp` is caller-supplied (the engine never invents it); `--counts` is
a free-form JSON tally object. run-record and validate are intentionally
**lease-agnostic** — an `aborted-locked` run must be able to record that fact
while the holder is mid-sweep — and are kept safe by the OS advisory lock.

## File lock vs lease

The lease decides *which writer is running the sweep*. The flock on
`<state>.lock` decides *which process is writing the file right now*: every
subcommand holds it across its whole load-modify-write, so concurrent
invocations serialize regardless of lease ownership. The `.lock` file is
ephemeral and never committed.

## Sensitive semantics

The primary flag is per-item: the orchestrator includes `"sensitive": true`
in every `upsert-item` for a source whose config entry is sensitive. On any
upsert where the item or its source entry is sensitive, the engine drops
`body` and `quote` before writing; titles, urls, ids, and statuses are
retained. Redaction happens at write time — flipping a source to sensitive
protects only items written after; re-ingest to redact prior items.

## Status words

Every subcommand prints one status word on line 1, optional JSON on line 2.
Operational conditions exit 0; only CLI misuse exits 2.

| word | when |
| --- | --- |
| `OK` | success |
| `NO-STATE` | `read` on a file that does not exist yet |
| `CORRUPT` | file exists but does not parse as this schema (refuses to write) |
| `LOCKED` | `lease-acquire` against a live other-writer lease |
| `STALE-RECLAIMED` | expired lease taken over (payload: previous writer/timestamp) |
| `LEASE-LOST` | mutating call by a non-holder; no write |
| `REFUSED` | `cursor-advance`: unknown `past-item` or a regressing cursor |
