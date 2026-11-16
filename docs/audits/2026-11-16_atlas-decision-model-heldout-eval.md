# Decision model: held-out routing evaluation (stand-in backends)

Date 2026-11-16 (rewritten after two outside critiques). Tool: `plugins/atlas/scripts/atlas_decision_eval.py`.
Data: `decision_eval_set.json` (prompts, both label votes, adjudications), `decision_eval_cache.json`
(every stored backend answer, latency, per-call cost). Every number below is the output of
`python3 plugins/atlas/scripts/atlas_decision_eval.py report`, which runs offline from the cache.

## What was measured

The hook's decision request (system prompt, JSON schema, three questions) answered by
`claude -p --model haiku|sonnet` instead of Ollama (no Ollama model can be downloaded here). These are
stand-ins: the numbers do NOT describe llama3.2:3b. Task class is scored on the scope-matrix classes against
the keyword router (`prompt_optimizer_core.classify_scope`), paired per prompt.

What changed in the tool, and why:

- The request is the shipped request. `prompt_answers` (the hook path) now takes its questions from
  `decision_request`, the function the eval calls. Hook behavior is unchanged (`test_prompt_decision.py`
  37 passed, including a test that the request on the wire equals `decision_request`'s messages and schema).
- The prompt goes to `claude -p` on stdin, not as a trailing argument (a prompt starting with "-" was
  parsed as a flag).
- A failed call is never cached as an answer, and its cost is recorded as the CLI's `total_cost_usd` or
  null (unknown), never 0.0. The cache has 0 calls with unknown cost.
- The confidence threshold and timeout come from `prompt_decision` (`ROUTE_CONFIDENCE_MIN`, `TIMEOUT_S`) and
  the Wilson interval from `done_claim.wilson_interval`; file handles are closed and cache writes are atomic.
- `mine` draws a seeded random sample (seed 20261116 recorded in the set) instead of the first N, and its
  dedup key no longer treats words such as "decade" or "facade" as hex ids. The `src` field is now an
  8-character hash of the project directory name.

## Labeling (circularity removed)

Before, sonnet labeled the set and was then scored on it, and both labelers saw the same class help text
the router prompt uses. Now sonnet is not a labeler. Opus labeled every prompt twice:

- `opus-router`: the hook's own class help (`_CLASS_HELP`).
- `opus-matrix`: class descriptions written from `contracts/scope-matrix.json` (what the matrix staffs each
  class to do, plus its roles and tool profiles, generated from the file).

Both votes are kept. The two votes agreed on 22 of 25 prompts (0.880). A third opus call (matrix
descriptions of the two candidate classes) adjudicated disagreements: dp-007 and dp-011 were adjudicated.
dp-014 ("Address the review comments on my PR"; votes fix vs implement) is NOT adjudicated and is excluded
from scoring: the adjudication call was denied once the spend cap was reached (below). So n = 24, not 25.

## Results (n = 24)

| backend | accuracy | Wilson 95% | latency p50 / p95 |
|---|---|---|---|
| keyword router | 16/24 = 0.667 | [0.467, 0.820] | sub-ms |
| haiku (stand-in) | 21/24 = 0.875 | [0.690, 0.957] | 3.5593 s / 4.0818 s |
| sonnet (stand-in) | 23/24 = 0.958 | [0.798, 0.993] | 3.6989 s / 4.4569 s |

Exact McNemar tests (two-sided binomial on discordant pairs, same 24 prompts, paired with the keyword router):

| comparison | model right / keyword wrong | keyword right / model wrong | exact p |
|---|---|---|---|
| haiku vs keyword | 5 | 0 | 0.0625 |
| sonnet vs keyword | 7 | 0 | 0.0156 |
| hook-combined haiku vs keyword | 2 | 0 | 0.5000 |
| hook-combined sonnet vs keyword | 3 | 0 | 0.2500 |
| timeout-aware hook-combined haiku vs keyword | 2 | 0 | 0.5000 |
| timeout-aware hook-combined sonnet vs keyword | 2 | 0 | 0.5000 |

Only sonnet-alone vs keyword is below 0.05. Nothing about the hook as shipped (model class only when
confident, else keyword) is statistically distinguishable from the keyword router at this n.

Hook-combined (model class only when confidence >= 0.8, else keyword): haiku 18/24 = 0.750 Wilson95
[0.551, 0.880], sonnet 19/24 = 0.792 Wilson95 [0.595, 0.908]. Confident answers were all correct (haiku
12/12, sonnet 16/16), but the model was confident on only 12 and 16 of 24 prompts; elsewhere the keyword
class takes over.

### Timeout

The hook gives the local model `TIMEOUT_S` = 4.0 s. Calls over 4.0 s: haiku 3/24 = 0.125, sonnet 4/24 =
0.167. Treating those calls as no answer (keyword class stands), hook-combined falls to 18/24 = 0.750
Wilson95 [0.551, 0.880] for both haiku and sonnet. These latencies include `claude -p` process start
(about 3.5 s), so they overstate a local-model call; the fraction says how often a `claude -p` backend would
miss the hook's deadline, not how often llama3.2:3b would.

Per-class confusion tables: run the report command.

## Spend

Total USD 1.5750 over 155 calls in the cache file. Spend by this relabeling: 50 opus label calls USD
0.8625, 2 adjudication calls USD 0.2844 (dp-007, dp-011), about USD 1.15 new; USD 0.43 is the earlier
backend and legacy-label spend. The cumulative total passed the 1.5 cap on the second adjudication, so the
dp-014 adjudication was not run (a request to raise the cap was denied and not worked around).

## Limits (read these before citing a number)

- The backends are stand-ins (haiku and sonnet through `claude -p`), not the llama3.2:3b the hook targets.
  Nothing here measures that model.
- n = 24 scored prompts. Intervals are wide and overlap; only one of the six paired tests is under 0.05.
  Treat the model-vs-keyword gap as suggestive.
- The prompts are mostly short skill-trigger probes typed in a scratch directory, not long organic work
  requests. The keyword router and the models may behave differently on real, longer requests.
- Labels come from opus, itself a model, from two description sets; they agree on 0.880 and one prompt is
  unlabeled. Matrix-derived descriptions reduce, not remove, the dependence on how classes are worded (the
  matrix staffs `db` as read-only probing, while the router help describes it as a schema change).
- The pool grew to 38 prompts since the set was built (transcripts keep accumulating). The 25 original
  prompts were kept so the cached haiku and sonnet answers stay paired with them; the 13 newer prompts were
  not used. With a pool at or below the target of 150 the seeded sample keeps every candidate.
- Exclusion of the tuning corpus is by repo text only. An earlier independent 15-prompt set is not stored
  in the repo, so overlap with it is [unverified].
- Latency includes `claude -p` start-up and cannot be compared with Ollama timing.

## Rerun

Offline (no model calls, reads the cache): `python3 plugins/atlas/scripts/atlas_decision_eval.py report`

Full rebuild (spends money, needs `claude` on PATH, `--cap` defaults to 1.5 cumulative):
`mine`, `label --labeler opus --help-source router`, `label --labeler opus --help-source matrix`,
`adjudicate`, `run --backend haiku`, `run --backend sonnet`, `report`.
Test: `env -u CLAUDE_PLUGIN_ROOT /root/.local/bin/pytest plugins/atlas/scripts/test_atlas_decision_eval.py -q -p no:cacheprovider`
