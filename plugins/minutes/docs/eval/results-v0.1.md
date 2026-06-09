# Minutes Eval v0.1 — Results

> **What this is.** A Claude-on-Claude smoke test of the eval harness against
> a maintainer-authored fixture corpus. It is not independent benchmark
> evidence. The same person wrote the corpus, the questions, and the rubrics;
> the same model family answered the questions and graded the answers. Any
> reader citing "20/20" as category-level evidence is overreading.
>
> **What it proves.** The harness runs end-to-end. The runner, the grader, and
> the LLM-judge pre-grade path produce auditable artifacts. Claude Code given
> Minutes markdown can, on clean questions, resolve documented contradictions
> and track cross-meeting commitments well enough to satisfy maintainer-written
> rubrics.
>
> **v0.2** ([`minutes-n5vj`](https://github.com/silverstein/minutes/issues?q=minutes-n5vj))
> does the rigorous version: multi-corpus, blind-authored holdouts, hallucination
> traps, noisy transcripts, multi-model runs, head-to-head baselines.

## Status

- ✅ Fixture corpus: 10 seeded markdown files (9 meetings + 1 voice memo), 2026-02-28 through 2026-04-17
- ✅ 20 questions with ground-truth answers and pass-fail rubrics
- ✅ Runner (`tests/eval/run_eval.py`) and grader (`tests/eval/grade.py`), model pinned to `claude-sonnet-4-6`
- ✅ First run: 2026-04-20 via Claude Code 2.1.114 on Sonnet 4.6
- ✅ LLM-judge pre-grade committed at [`results-v0.1-graded.md`](./results-v0.1-graded.md)
- ⬜ Independent human sign-off: _pending — do not treat verdicts below as final_

## Raw run numbers (not a benchmark score)

| Metric | Value | How to read it |
|---|---|---|
| Questions attempted | 20 | See `tests/eval/questions.yml` for exact text |
| Subprocess failures | 0 | Every `claude -p` call returned exit 0 |
| LLM-judge verdict | 20/20 PASS (provisional) | Same-family judge; counts as lenient |
| Total wall-clock | 698s (~11.6 min) | Cold-start eval harness overhead, NOT product latency |
| Avg per question | 34.9s | Mostly subprocess startup + repeat corpus reads per call |

Per-category LLM-judge tally (provisional, no human sign-off yet):

| Category | PASS / Total |
|---|---|
| Relationship ownership | 3/3 |
| Active priorities | 3/3 |
| What changed recently | 3/3 |
| Decision history + contradictions | 4/4 |
| Commitment / staleness | 4/4 |
| Cross-meeting inference | 3/3 |
| **Overall (provisional)** | **20/20** |

## Known issues in this specific run

These would cause a strict human grader to re-score and are called out so
nothing is buried under the headline.

1. **Same-family judge is structurally non-independent.** Claude graded Claude. Models are known to be lenient on their own family's output. A sibling run with a different-family judge (GPT, Gemini) would be harder, and the first independent-judge run is likely to produce fewer PASSes. This is the killer caveat; treat it as the top concern, not one of many.

2. **Question q17 surfaced a rubric-precision issue.** Expected: "Yes, one open action item owed to Jamie." Response: "Yes, two action items, which are the same underlying commitment." Judge marked PASS. The response is factually defensible (the fixtures carry two separate `action_items` entries both promising the OKR doc, and the response correctly noted they're the same commitment), but the rubric assumed a single-integer answer. Rubric was imprecise. Future questions should either (a) accept either count with the right framing, or (b) phrase the question to ask about underlying commitments rather than record counts.

3. **Temporal leak.** Several responses reasoned from the real system date ("today is 2026-04-20") instead of the corpus-internal timeline (capped 2026-04-17). A stricter judge should flag this as eval contamination — the model broke the closed-world assumption the corpus is built on. Our judge did not flag it.

4. **Rubrics reward slot coverage over answer discipline.** Because each rubric is a list of required elements, a verbose answer that satisfies every bullet can PASS even when the surface answer is subtly off or contains speculation. A discipline-aware grader would reject answers that add claims the corpus doesn't support; this v0.1 judge doesn't.

## Honest framing

The 20/20 number above is a pre-grade, not a final score. Independent human review would likely reduce it. That's expected — v0.1 is scaffolding, and this run was always going to be the easiest possible grading setup.

The point of publishing this anyway is to get a real artifact in the repo so:
- v0.2 has something concrete to improve against.
- Anyone evaluating Minutes can run the same harness and audit the artifacts.
- The interop claim ("an agent given Minutes markdown can answer real questions") has one honest data point instead of zero.

## Sample graded output

From [`results-v0.1-graded.md`](./results-v0.1-graded.md):

> ### `q11` — decision_history
>
> **Q:** What's the current state of the SSO nested-groups commitment?
>
> **Response:** Shipped on 2026-04-03, three days past Riley's originally-promised 2026-03-31 date. Confirmed delivered per the 2026-04-07 eng standup. The commitment is now closed.
>
> **LLM pre-grade:**
> - RUBRIC_1: pass — "Ship date: 2026-04-03" explicitly named
> - RUBRIC_2: pass — Notes 3 days late vs 2026-03-31
> - RUBRIC_3: pass — States commitment is closed
> - VERDICT: PASS

## Reproducing this run

Agents read the fixture corpus directly as files in the working directory.
The runner passes `cwd=fixture_dir` so each agent's CLI has ambient access to
whatever lives inside that folder. This is a pragmatic workaround for CLI
permission grants that fail in non-interactive subprocess contexts; it is
not the same as an enumerated-manifest access model and means each agent is
being compared on its workspace-access semantics as well as its reasoning.

```bash
git clone https://github.com/silverstein/minutes
cd minutes/tests/eval
pip install pyyaml
python3 run_eval.py --agent claude
python3 grade.py --input results/claude-<timestamp>.json --llm-judge
```

The model is pinned in both scripts to `claude-sonnet-4-6`. Edit there when
you want to bump to a new default.

## What this run does NOT demonstrate

- Whether Minutes is better than alternatives — no baselines.
- Whether a different judge family would agree with the 20/20 pre-grade.
- Whether other agent CLIs (Codex, Gemini) would pass the same corpus.
- Whether the result holds on noisy transcripts, adversarial questions, or
  questions that require the system to refuse ("the corpus doesn't say").
- Broad interop across the "filesystem IS the interface" claim. One agent
  family reading one curated directory is a smoke test, not an interop proof.

## What's next

**v0.2** ([`minutes-n5vj`](https://github.com/silverstein/minutes/issues?q=minutes-n5vj)):
- 3+ corpora in different domains
- 100+ questions
- 30+ blind-authored holdout questions
- Required citation (meeting date + decision text) for every answer
- Hallucination traps and noisy-transcript variants
- Multi-family judge (swap Claude for GPT or Gemini; ideally ensemble)
- Multi-model runs with head-to-head baselines
- Discipline-aware grader that penalizes temporal leaks and corpus boundary violations
- Published raw prompts, raw outputs, judge reasoning, and grader source

Until that ships, this is a working harness with an honest first-run artifact. Not a benchmark.

---

_Last updated: 2026-04-20._
