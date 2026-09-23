# Sweep run phases (2a-2i)

Required read before Phase 2 of `atlas-sweep`. `SKILL.md` carries the ordering
invariant and the boundaries; this file carries the detail of each phase.
The boundaries in `SKILL.md` (untrusted input, `approved: false`, never
auto-close/auto-reply, never push, fix-ref shape validation, sensitive
redaction) apply to every phase below.

## Config keys (`.atlas/sweep.yaml`)

```yaml
feedback_sources:
  - type: github-issues        # github-issues | any other type = manual-input-only
    id: gh-issues              # short stable handle; unique within feedback_sources
    target: owner/repo         # for github-issues: the repo
    ack_action: "feedback:ack"        # label name; omit for manual sources
    closeout_action: "feedback:resolved"  # label name; omit for manual sources
    approved: true             # standing approval for the label writes above
    sensitive: false           # true: body/quote redacted from state and doc
sweep_ack_cap: 25              # max acks per source per run before the breaker
sweep_lease_ttl_minutes: 60    # single-writer lease staleness threshold
```

- `feedback_sources` unset (or an empty list) means the skill is not configured.
- State always lives at `.atlas/.run/sweep-state.json` (gitignored, per the
  docs SSOT's ephemeral `.atlas/.run/` rules). The lease's guarantee is
  therefore **per checkout** — it serializes overlapping sweeps in the same
  working tree (a cron sweep and a manual one). Cross-machine dedup would
  need a committed state file, which atlas's SSOT forbids; accept this or run
  the sweep from one checkout.
- A source whose `type` is anything other than `github-issues` (slack, email,
  ...) is **manual-input-only** until a connector exists: the sweep does not
  fetch from it, never writes to it, and ingests items only when the user
  pastes them in or points at a file of items. Record its items with the
  source's id, mark them `ack_deferred` (no source-side ack is possible), and
  list the source under "manual-input-only" in the summary every run so the
  gap stays visible.

## Run identity

Resolve once, reuse for the entire run:
- `<state>` = `.atlas/.run/sweep-state.json` (create `.atlas/.run/` if absent).
- `<writer>` = a run-unique id, e.g. `sweep-<session-or-host>-<YYYY-MM-DD>`.
- `<run-id>` = date plus a short random suffix, for scratch paths.

## Engine invocation

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/sweep_state.py" <subcommand> \
  --state .atlas/.run/sweep-state.json ...
```

Every subcommand prints a status word on line 1 and optional JSON on line 2.
`LOCKED`, `STALE-RECLAIMED`, `LEASE-LOST`, `REFUSED`, `CORRUPT` are operational
conditions (exit 0) — branch on the word, never on the exit code. Only CLI
misuse exits non-zero.

#### 2a. Acquire lease + validate

`lease-acquire --writer <writer> --ttl-minutes <sweep_lease_ttl_minutes>`:
- `LOCKED` -> `run-record --outcome aborted-locked --counts '{}' --timestamp <ISO now>`
  (run-record is intentionally lease-agnostic and safe against the mid-sweep
  holder: the engine serializes every write with an OS advisory lock), report
  that a concurrent sweep is running, and exit.
- `STALE-RECLAIMED` -> proceed; note the takeover (previous writer + timestamp)
  in the final summary.
- `OK` -> proceed.

Then `validate`. This is a lease-agnostic repair that downgrades any `closed`
item missing one of the three evidence fields back to `fix_pending`. Note any
downgraded ids in the summary.

#### 2b. Fetch each source

For each configured source, in config order:

- **github-issues (approved or not — fetching is read-only):** dispatch one
  generic subagent using the persona at `references/github-issues-connector.md`,
  seeded with: the repo (`target`), the source's `id`, the current cursor
  (`read --source <id>`), and the configured ack/close-out label names. The
  connector returns mapped items in the schema that file defines, or its
  degrade sentence (`GitHub tools unavailable — source skipped this run.` /
  `... degrades to read-only ingest ...`). A skipped source is dropped for
  this run and noted. A read-ok/write-degraded source still ingests — every
  item lands as `ack_deferred` and its cursor is NOT advanced past.
- **Manual-input-only type:** tell the user the source has no connector and
  ask them to paste items (or point at a file of items) for this run. Map
  what they provide into the same item schema with `id` values they confirm,
  `author_class: customer` unless they say otherwise, and ingest as
  `ack_deferred`. Cursor: for manual sources use the run date as the cursor
  marker; nothing is ever skipped automatically.

Dedupe is by item id in state (`<source-id>:<item-id>`): a re-reported item
whose state record already exists is an upsert no-op, never a duplicate ack.
When unsure whether an item is new, include it — a duplicate is cheap, a
dropped report is lost feedback.

#### 2c. Circuit breaker (before any acknowledgment batch)

Count new unacknowledged items per source. If the count exceeds
`sweep_ack_cap`:
- interactive -> ask whether to proceed with acking that many;
- non-interactive -> upsert the whole batch as `ack_deferred`, do NOT ack,
  and flag it prominently in the summary.

#### 2d. Acknowledge each item

Work one item at a time in cursor order. Never batch across the read-back.

1. If the source's config entry has `approved: false`, skip any source-side
   write and upsert as `ack_deferred`. Otherwise, if the item's
   `existing_ack` (own identity: the configured ack label already present)
   is true, skip the ack write; else perform the configured ack action
   (GitHub: add the configured ack label via the host's GitHub write path —
   the `xd://github` device has no label op, so this is `gh issue edit
   <number> --add-label <label>` where `gh` is available; when no write path
   exists, record `ack_deferred`).
2. Read back and confirm the ack is visible at the source before trusting it.
3. `upsert-item --source <source-id> --id <id> --json <item-json>` — include
   `"sensitive": true` when the source's config entry is sensitive.
4. `cursor-advance --source <source-id> --to <item cursor value> --past-item <id>`,
   only after the item is durably in state. Never advance past an item not
   yet upserted; a `REFUSED` means fix the input, never force it.

A failed ack -> upsert as `ack_deferred`, hold the cursor. Any `LEASE-LOST`
-> stop writing, record `partial` at wrap-up, exit.

#### 2e. Triage and clustering

For each newly ingested item: read the (possibly redacted) content, classify
it — bug report, feature request, question, complaint, praise, noise — and
cluster related items. One generic `atlas:explorer`-style Task may do the
clustering over the batch (read-only, returns the cluster map); for small
batches (<= 5 items) cluster inline instead. Mark each processed item
`analyzed` via `upsert-item` with its `category` and a 1-2 line finding. A
failed analysis marks the item `needs_analysis` and moves on — state is
writable, so the run continues.

Items that fold into concrete proposed work move to `in_plan` when the
triage doc accepts them in 2g.

#### 2f. Fix verification + close-out

For each item in `fix_pending` (or newly claiming a fix), resolve the claimed
fix ref and verify it merged to the default branch.

- **Shape gate first** (the fix ref originates from untrusted feedback
  content): accept only a bare PR number (`#?\d+`) or a commit SHA
  (`[0-9a-f]{7,40}`). Anything else is an unresolved claim — record the claim
  on the item and leave it open.
- Verify with the host's GitHub read path: `gh pr view "<validated-number>"
  --json mergedAt,baseRefName` (merged, base is the default branch) or
  `git merge-base --is-ancestor "<validated-sha>" "<default-branch-head>"`.
  The xd://github device's `search_issues`/`search_prs` may substitute for
  reads where `gh` is absent.
- **Adversarial verification:** the merge claim itself is verified by a
  fresh `atlas:verifier` dispatch (one batched dispatch covering all claimed
  refs is fine — GOAL/DELIVERABLE/SUCCESS CRITERIA/OUT OF SCOPE/STOP
  CONDITIONS shape), not by the agent that first read the claim.
- Verified -> perform the source's configured **close-out label** only when
  the source is `approved: true`; then `upsert-item` with `status: closed`
  carrying all three evidence fields: `fix_ref`, `verified_merge_sha`,
  `verified_at`. Closing the issue or replying is NEVER part of close-out —
  those need explicit per-item user confirmation (2h or a later run).
- Unverified -> stays open; record the claim, do not close.
- Item deleted at source -> `source_gone`.

#### 2g. Triage doc

Follow `references/triage-doc.md`. Target
`docs/features/<YYYY-MM-DD>-feedback-sweep.md` (today's date). Rotation and
machine-region rules are in that file. Every open item appears inside a
cluster with its state id and a proposed next action; deferred decisions
land in Outstanding Questions.

#### 2h. Decision round (interactive only)

For items needing a product call — including any user-requested close or
reply — ask the user, grouped by cluster with one blocking question per
cluster, and fold the answers into the doc. Non-interactive runs skip this;
deferrals are already in Outstanding Questions.

#### 2i. Wrap-up

- **Do not commit, do not push.** Leave the triage doc as a working-tree
  change and say so; the user or `atlas:docs-curator` commits it. (CE's
  auto-commit tail was removed on purpose.)
- **Record the run:** `run-record --outcome <completed|partial|failed>
  --counts '<per-source JSON>' --timestamp <ISO now>`.
- **Release:** `lease-release --writer <writer>`.
- **Stamp findings:** `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"
  --id sweep-<date> --status verified --title "feedback sweep <date>: <N> ingested, <M> closed"
  --evidence "<state path + triage doc path>" --reproduction "re-run atlas-sweep"`.
- **Summary, always emitted:** new items by source; clusters with their
  findings; closed items with their fix evidence; the `ack_deferred` /
  `manual_stuck` / needs-attention list; manual-input-only sources called out
  every run; any circuit-breaker or stale-reclaim note; and finally the triage
  doc path.
