# Atlas round 3: decision models, Ollama workers, mod-load gate (2026-11-14)

Base: local HEAD d8a7adce on origin/main e088fd91 (atlas 17.21.1), plus the round 3 working-tree diff.
Release: atlas 17.22.0, marketplace 5.27.0. armada and programmer are unchanged.

## 1. What Jerry asked

- Use a local decision model (Ollama) to make Atlas's routing and its done-claim check smarter, with the deterministic code as fallback.
- Let crew and tmux team workers run on a local Ollama model, and give him a command to benchmark local models against Claude.
- Stop shipping a hooks module that does not load: a release gate that boots the mod in the real host.

## 2. What shipped

### Decision models in routing and the done-claim check

- `hooks/prompt_decision.py`: one shared call (`ask`) to a loopback endpoint, lazy urllib, no proxy, fail open on any error (refused, slow, malformed HTTP, bad UTF-8). A 60 s negative cache (in process and `decision-down.json` under `ATLAS_HOME`, mode 0600) bounds the cost on a machine without Ollama.
- Routing: the prompt hook asks `prompt_class`, `task_class` and `effort` in one request; the model's answer is used only at confidence 0.8 or more with valid values, otherwise the keyword router (`classify_scope`) answers.
- Done-claim check (completion gate letter `v`): two noul questions over the final reply (claims done or fixed; quotes an observed result). Default is shadow: it records `decision.verify.block-would` and never blocks. `ATLAS_DECISION_VERIFY=block` blocks once per turn at claim >= 0.8 and observed result <= 0.3; `off` disables it. The thresholds are uncalibrated, so the check is record-only until they are calibrated.
- `hooks/routing_corpus.jsonl` (86 labeled prompts, every scope-matrix class) and `prompt_optimizer_core.py --eval-routing [--model]`. Counters `decision.route.{model,fallback,agree,disagree}` and `decision.verify.{block,block-would,pass,skip}`.

### Ollama worker provider

- `scripts/atlas_provider.py`: `ATLAS_WORKER_PROVIDER` (claude, ollama, auto), per-role models (`ATLAS_OLLAMA_ROLE_MODELS`, `ATLAS_OLLAMA_MODEL`), `--provider` on `atlas_crew.py run` and `atlas_mux.py spawn`, `atlas_provider.py doctor`.
- Health check: `/api/version`, model in `/api/tags`, `POST /api/show` (needs the `tools` capability and a context of at least 32768), then a real one-token `/v1/messages` probe with a tool. Unhealthy means fall back to Claude with a recorded reason, or refuse under `ATLAS_OLLAMA_STRICT=1`.
- `auto` moves only `explorer` and `docs-auditor` (plus roles with an explicit model entry). A Claude model name is never sent to Ollama. Cloud-routing and credential env vars are removed from Ollama workers. `spawn-team` pins the provider on every seat and pairs Ollama implementers with Claude verifier seats.
- Runtime failover: an Ollama worker whose endpoint dies mid-run (repeated `api_retry` events, or a 404 / 5xx result) is relaunched once on Claude, in crew and in the mux pane.
- Local workers report `cost_usd` 0 and `local: true`; `tokens_workers.tokens_local` is new.

### Benchmark command

`atlas_provider.py bench --models claude:<model>,ollama:<model> [--runs N] [--task T] [--check C] [--timeout S] [--out F]` runs a bundled slugify crew task through the real `atlas_crew.py run` per provider in a fresh temp git repo, runs the fixture unittest itself, and prints a table of cold and warm wall time, tokens, Claude cost and pass rate. It refuses with exit 2 when the Ollama model is not healthy, and excludes any run that fell back to another provider.

### Mod-load release gate

`scripts/atlas_mod_gate.py` loads the hooks module the way a session does. Offline checks are labelled smoke (they use a hand-written host stub). `--live` boots every module in `hooks.json` through the real `claude plugin test` under an isolated HOME; `--require-live` turns a skipped live check into a FAIL. CI: `atlas-mod-gate` (CLI pinned) and non-blocking `atlas-mod-gate-latest` in `tests.yml`; `mod-gate` job in `release.yml` that the `release` job needs (read-only token, no secrets). `oven-sh/setup-bun` is pinned to a commit SHA.

### Telemetry dashboard deploy

Deploy `dpl_8hGbkFg2KnDEc4vbEXQAkvcGnfm9` verified by the `telemetry-e2e` run 43642107861: HTTP 201, test rows 1 -> 2.

### Crew stop exact-match fix

Crew stop and process-group lookup now match the run exactly (argv component or `--name <run_id>-` token), so they never signal an unrelated process whose command line merely contains the run id. This closes the open item in section 14 of the round 2 audit.

## 3. Reviews

- Sonnet outside-expert review: 3 P0, 10 P1, 2 P2.
- Opus verifier: D0 to D8.
- Re-verify after the fixes: all CLOSED.

| Finding | Fix |
|---|---|
| D1 (P1): `http_proxy` leaked prompt and reply text to a proxy; probe: a proxy listener received the decision POST | Decision and loopback health calls use an empty `ProxyHandler`; probe now shows 0 proxy connections |
| D2 (P2): `ask()` "never raises" was false for `BadStatusLine` / `IncompleteRead` | `ask()` fails open on malformed HTTP, truncated body, bad UTF-8 |
| D3 (P1): router regressions ("login does not work fix it", "this is not working please fix", "Don't audit the db schema, add a column", "don't just review it, fix it") | Negation removes only the class verb it governs; state words are no negation; negation never turns a write ask into audit or db-audit; corpus 45/86 -> 84/86 |
| D4 (release P0): `atlas_mod_gate.py --live` failed on the tree (usage.ts `$.env.get(name)`) and the old word list turned failures into SKIP | usage.ts fixed in 17.21.1; gate now fails on `HooksError` / `(fail)`, needs one pass per probe, `--require-live` |
| D8: confidence handling | `choice_of` rejects bool and NaN, clamps to 0..1 like `noul_of` |
| Provider P0/P1 (Sonnet): Ollama defaults, `auto` equal to `ollama`, Claude model names sent to Ollama, no tools / context check, cloud env and account token inherited by workers, loopback check parsed differently by Python and Node | `/api/show` and probe checks, `ATLAS_OLLAMA_AUTO_ROLES`, model-name rule, env strip list, strict `is_loopback`, `spawn-team` provider pinning, runtime failover |
| CI P1 (Sonnet): release credentials in the job that installs the CLI from npm; unpinned action | Separate `mod-gate` job (`contents: read`, no secrets); setup-bun pinned by SHA |
| P2 (this release): "I don't think we need an audit, please just patch the null check in api.py" routed to audit | "don't think we need", "do not think we need", "no need for", "don't need", "do not need" negate the class noun; `patch` is a fix cue; test `test_think_we_need_and_need_phrases_negate_the_class_noun` failed first ('audit' != 'fix', then 'implement' != 'fix' until the cue) |
| P2 (this release): decision and provider tests could reset the real `~/.atlas` caches | The suites already import `_test_isolation` (ATLAS_HOME in a tempdir); new `StateIsolationTests` in `test_prompt_decision.py` and `test_atlas_provider.py` fail if the cache paths ever resolve under the real home. `decision-down.json` mtime was unchanged and no `provider-health.json` appeared after both suites ran |

## 4. Evidence

| Check | Result |
|---|---|
| Hooks suite | 3070 passed, 4 skipped |
| Scripts suite | 5953 passed, 1 skipped |
| Mod gate, live | PASS 4 pass / 0 fail / 0 skip |
| Routing accuracy, keyword router, shipped corpus | HEAD 45/86 -> 84/86 (tuned on this corpus) |
| Routing accuracy, independent prompts | 12/15 |
| Real `claude -p` against the stub endpoint | reached the stub |
| Runtime failover | verified against the real CLI's `api_retry` stream |

Harness smoke, Claude only, n=1, not a benchmark (`atlas_provider.py bench --models claude:claude-haiku-5-5 --runs 1`; it only proves the harness runs end to end, one run says nothing about speed):

```
claude:claude-haiku-5-5 run 1/1 cold: wall 5.0 s, pass=True
| provider:model | phase | n | excluded | wall s mean | wall s min-max | tok in | tok out | cache read | Claude USD | pass |
|---|---|---|---|---|---|---|---|---|---|---|
| claude:claude-haiku-5-5 | cold | 1 | 0 | 5.0 | 5.0-5.0 | 5464 | 589 | 4408 | 0.0000 | 1/1 |
```

The Claude USD column showed 0.0000 because the cost was unknown, not zero: the worker was stopped after its verified DONE, before its `result` event, so no `total_cost_usd` was ever read (there is no price table; cost comes only from that event). A missing price entry was the wrong diagnosis. `usage_of` now reports `cost_known` false for such a log, the crew summary carries `cost_complete` false, and the bench prints n/a (null in the JSON) instead of 0.0000.

## 5. Not verified

- No real Ollama model was run in development. Everything model-side ran against a local stub endpoint and the real `claude` CLI.
- No live mid-run Ollama death; failover was verified against the CLI's `api_retry` stream with a stub.
- In-process Agent-tool subagents cannot move to Ollama.
- The done-claim check is record-only until calibrated; its thresholds are not derived from data.
- The 84/86 routing score is on the corpus the router was tuned on; the independent check scored 12/15.
- The `oven-sh/setup-bun` SHA to v2 mapping was not checked against the network.
- The new CI jobs (`atlas-mod-gate`, `atlas-mod-gate-latest`, `mod-gate`) have not run on GitHub yet.
- `claude --bg` workers get the provider env at spawn; whether the background daemon honours it was not verified.

## 6. Blockers

The container network policy refused `ollama.com`, `registry.ollama.ai`, `huggingface.co` and `api.typesafe.ai`, so no model could be pulled.

## 7. Run the benchmark on your machine

```
ollama pull qwen3:8b
OLLAMA_CONTEXT_LENGTH=64000 ollama serve      # skip if the Ollama app is already running; keep the context at 32768 or more
python3 plugins/atlas/scripts/atlas_provider.py doctor --provider ollama --model qwen3:8b   # exit 0 = healthy
python3 plugins/atlas/scripts/atlas_provider.py bench \
  --models claude:claude-sonnet-5-5,ollama:qwen3:8b --runs 3 --out /tmp/atlas-bench.json
```

## 8. Follow-ups (also in `docs/ROADMAP.md`)

- Calibrate the done-claim thresholds from the `decision.verify.*` counters before enabling `block`.
- Run the real Ollama benchmark above and record the table.
- Add the Claude Platform on AWS and Bedrock Mantle env names to the Ollama worker strip list once the Claude Code docs name them.
- Mux failover for a worker that authenticates only through `ATLAS_WORKER_FORWARD_ENV` (a token-only auth worker cannot be relaunched on Claude after the pane unset it).
