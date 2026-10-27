# Atlas core mods: contract, verdicts, offload, route

Date: 2026-10-27. Branch: `claude/atlas-mods-live-core` (off `claude/project-thread-9eezyd`, atlas 16.0.0).

## Why

The Claude Code band and pane and the omp mission panel showed workers, the phase rail, the channel and gate
groups. None of them showed the four things Atlas exists for:

- the operating contract (did replies open with the header, do done items carry evidence),
- honesty by pitting models against each other (worker claims vs verifier verdicts),
- tmux context offload (how much context the workers held that the lead never had to),
- decision models (which class/effort cell picked which seats, and which model each seat actually ran).

A live check also found the band never drew in a real Claude Code session: the AbovePrompt render hook wrote
`$.state` (the unasked docked pane open), the engine denies writes during `ui.render`, and it skipped the
whole hook (`atlas: ui.render hook skipped: threw HooksError: atlas: state.set: denied: it was made while
ui.render is being dispatched`). The open now happens in `dockTick`, called from the rebuild tick.

## Sources (run scratch both harnesses already write)

| Pillar | Source | Read as |
| --- | --- | --- |
| contract | reply first lines (turn.complete answer), `todos.json`, gate groups | header ok/total, done items with evidence, done items with a verified finding, open gates |
| verdicts | `.atlas/.run/findings.json` (atlas_finding.py), `board/*.jsonl` report notes | verdict rows; claims = `STATUS: DONE` reports from claimant roles (implementer, runner, test-engineer, docs-curator); each claim is checked by the first unused verdict recorded after it |
| offload | `.atlas/.run/logs/<worker>.log` (claude stream-json or omp `--mode json`) and the worker's report note | brief = first call's context (system prompt + brief, which the lead already holds); peak = largest call context; kept = peak - brief; returned = report chars / 4 |
| route | `.atlas/.run/teams/<id>.json`, `contracts/scope-matrix.json`, the worker logs | class/effort -> seats (role, count, model, effort) -> the model each member's log shows it ran; a seat whose run model is not its family is drift |

All parsing is pure (`plugins/atlas/mod/data/core.ts`), so both harnesses render the same numbers.

## Surfaces

| Surface | Claude Code | omp |
| --- | --- | --- |
| band row under the rail | `coreCells` -> one row of CONTRACT / VERDICT / OFFLOAD / ROUTE chips | same cells in the mission panel |
| detail | pane tab `g` "core": four sections, then the gate groups | `/atlas-core` report |
| toasts | refutation, verification, needs-evidence, worker done with its offload | notify |
| status | `atlas ✔N ✖N ⚠N ⇆Nx` | setStatus |
| command | `/atlas-core` (works headless) | `/atlas-core` |

## Measured on a real run

Scratch repo with a planted bug (`mean` divided by `len - 1`), tmux transport:

- `fix/low` team: implementer (sonnet/medium) fixed it and reported `STATUS: DONE`.
- `verify/low` team: verifier reproduced it and recorded `mean-fix verified`.
- `verify/low` team: verifier checked a false claim ("mean accepts any iterable") and recorded `mean-iterable rejected`.
- Offload: 3 workers kept 17.9k tokens of context past their briefs and returned 608 tokens of reports (about 30x).
- Every seat ran `claude-sonnet-5-5`, matching its `sonnet` seat.

That run is frozen as `plugins/atlas/contracts/core-fixture.ts`.
