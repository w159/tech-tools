# Measurement Protocol

Read this before the Phase 1 baseline and again before the Phase 4 re-measurement. It defines what counts as a valid baseline, the identical-method parity checklist, and when to reject the exercise. These rules port CE's "baseline and final confirmation always use the full configured protocol" into a single-experiment loop; the parity checklist is what `atlas:verifier` checks in Phase 5.

## Harness requirements

A measurement harness is any invocation that runs the target workload and emits the metric as a number. It must satisfy all of:

- **Runs standalone.** One command, no interactive input, deterministic working directory.
- **Emits an extractable value.** The metric is a number (or countable/summable output) parseable from the output. Non-numeric goals (prettiness, "feels faster") are not measurable - reject under the baseline gate or help the user pick a proxy metric they accept.
- **Cheap enough to repeat.** The full protocol (3+ samples plus warm-up) must fit the session. A benchmark that takes an hour is a spec problem: agree on a smaller representative workload with the user rather than skipping samples.
- **Immutable during the experiment.** Once the baseline is captured, the harness script and its inputs are frozen. If the code change requires touching a fixture the harness reads, that fixture change must be identical in spirit (same data, just relocated) and must be disclosed to the verifier.

If no harness exists, build one before anything else (a thin script around the workload is usually enough). Building the harness is allowed; skipping the baseline is not.

## Baseline protocol

1. Note environment: hardware-relevant context (battery/plugged, thermal state for laptops, container limits, database seed state, network conditions) goes into `baseline.json` as `environment`. The same conditions must hold at re-measurement.
2. Warm-up: run the workload once and discard the sample if cold-start effects exist. Record that warm-up happened.
3. Sample: run the harness at least 3 times. Record every per-sample value.
4. Aggregate: median (preferred; robust to one outlier), with max-min spread. Mean is acceptable for low-variance metrics; state which was used.
5. Second-pass reproducibility: for cheap harnesses, run 2 more samples and confirm they land inside the observed spread. If they do not, variance is not stationary - treat the baseline as invalid.

### Noise floor

The spread (max-min) of baseline samples is the noise floor. Its consequences:

- **Noise floor above the expected effect**: the planned improvement cannot be detected by this method. Report this and offer: more samples, a more stable metric (p95 instead of mean; counts instead of timings), a larger workload, or fixing the environment. Do not proceed on a baseline that cannot detect the effect you were asked to produce - a "success" inside the noise is indistinguishable from noise.
- **Delta compared against floor at the end**: `|after_median - baseline_median| <= baseline_spread` means "no measurable change," regardless of direction. A percentage inside the floor is not an improvement.

## Rejection conditions (stop the exercise)

Reject and report instead of proceeding when any holds:

- The workload cannot be invoked at all (missing credentials, dead dependency, no entry point).
- The harness exits non-zero or emits no extractable metric, and it cannot be fixed.
- The metric cannot be stabilized below the expected effect size (after honest attempts: more samples, better aggregation, controlled environment).
- The user's real goal is not measurable and no acceptable proxy exists.

State exactly which condition fired and what would unblock a future run. This outcome is a valid result of `atlas-optimize`, not a failure of it.

## Parity checklist (Phase 4 re-measurement)

The re-measurement must be **the same experiment**. Walk every row before declaring the after-capture valid; this is the list `atlas:verifier` independently confirms:

| # | Dimension | Parity requirement |
|---|---|---|
| 1 | Command | Identical harness invocation (same script, same arguments, same entry point). |
| 2 | Working directory | Same cwd as the baseline run. |
| 3 | Environment | Same relevant conditions recorded in `baseline.json.environment` (no background builds, same data seed, same container limits, comparable machine state). |
| 4 | Warm-up | Same warm-up policy: warmed if and only if the baseline was warmed. |
| 5 | Sample count | Same number of samples (minimum 3), same discard rules. |
| 6 | Aggregation | Same aggregate (median vs mean) and same outlier handling. |
| 7 | Metric extraction | Same parsing/field - not a recomputed or redefined metric. |
| 8 | Machine state | No concurrent heavy processes on either run; comparable thermal/battery state for laptops. |

Any row that drifted: fix and re-run the re-measurement, or disclose the drift and let the verifier FAIL the delta. Never quietly re-aggregate to make the delta look better.

## Evidence layout

All captures live in `.atlas/evidence/<YYYY-MM-DD>-<slug>/` (date-first naming per `atlas-loop/references/docs-ssot.md`):

- `baseline.log` - raw per-sample harness output, baseline.
- `baseline.json` - command, cwd, environment notes, per-sample values, aggregate, spread, timestamp.
- `harness.<ext>` - the harness script, if built for this run (frozen after baseline).
- `hypothesis.md` - mechanism, change, expected effect, falsifier.
- `after.log`, `after.json` - same shape as baseline.
- `delta.json` - per-sample and median deltas, percentage, noise-floor comparison, classification.
- `run.log` - narration: gates hit, decisions, deferrals.

Verify each write by reading the file back before relying on it. These files are the verifier's evidence base; a claim absent from them is unverified.
