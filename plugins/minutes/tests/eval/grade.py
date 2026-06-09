#!/usr/bin/env python3
"""
Minutes Eval v0.1 — grader.

Reads a run_eval.py output JSON and produces a markdown results table
that a human can check off. Optionally pre-grades with an LLM-as-judge
(--llm-judge).

Usage:
    python3 grade.py --input results/claude-20260420-143000.json
    python3 grade.py --input results/claude-*.json --llm-judge
    python3 grade.py --all  # aggregate every JSON in results/

Output goes to stdout (markdown). Redirect to docs/eval/results-v0.1.md
once you've done human sign-off.
"""

from __future__ import annotations

import argparse
import glob
import json
import pathlib
import subprocess
import sys
from typing import Any


EVAL_DIR = pathlib.Path(__file__).resolve().parent
RESULTS_DIR = EVAL_DIR / "results"


LLM_JUDGE_PROMPT = """\
You are grading an agent's answer to a question about a meeting corpus.

QUESTION: {question}

EXPECTED ANSWER (ground truth):
{expected}

RUBRIC (the answer must satisfy every bullet to pass):
{rubric}

THE AGENT'S ANSWER:
{response}

For each rubric bullet, decide if the agent's answer satisfies it. Then give
an overall verdict of PASS or FAIL. An answer passes only if every rubric bullet
is satisfied. Be strict — partial credit does not pass.

Respond in this exact format, nothing else:

RUBRIC_{{index}}: pass|fail — one-sentence justification
...
VERDICT: PASS|FAIL
"""


def llm_judge(question: str, expected: str, rubric: list[str], response: str) -> str:
    """Shell out to `claude -p` as an LLM-as-judge. Returns raw judgment text."""
    rubric_str = "\n".join(f"{i + 1}. {r}" for i, r in enumerate(rubric))
    prompt = LLM_JUDGE_PROMPT.format(
        question=question,
        expected=expected.strip(),
        rubric=rubric_str,
        response=response.strip() if response else "(no response)",
    )
    try:
        # Judge model pinned so re-grading an old run doesn't silently shift
        # under you. Keep in sync with run_eval.py's claude model.
        proc = subprocess.run(
            [
                "claude",
                "-p",
                prompt,
                "--model",
                "claude-sonnet-4-6",
                "--output-format",
                "text",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if proc.returncode != 0:
            return f"JUDGE_ERROR: exit {proc.returncode}: {proc.stderr[:200]}"
        return proc.stdout.strip()
    except Exception as e:
        return f"JUDGE_ERROR: {e}"


def format_result_row(result: dict[str, Any], judgment: str | None) -> str:
    """One markdown section per question."""
    response = result.get("response") or "_(no response — see raw output)_"
    rubric_list = "\n".join(f"  - [ ] {r}" for r in result["rubric"])
    judgment_block = ""
    if judgment:
        judgment_block = f"\n**LLM pre-grade:**\n```\n{judgment}\n```\n"

    return f"""\
### `{result['id']}` &middot; {result['category']}

**Q:** {result['question']}

**Expected:**
{result['expected'].strip()}

**Rubric:**
{rubric_list}

**Response:**
> {response.replace(chr(10), chr(10) + '> ')}
{judgment_block}
"""


def build_summary_table(all_payloads: list[dict[str, Any]]) -> str:
    """Cross-agent summary table. Rows = questions, columns = agents."""
    agents = sorted({p["agent"] for p in all_payloads})
    by_agent: dict[str, dict[str, dict[str, Any]]] = {}
    for p in all_payloads:
        by_agent.setdefault(p["agent"], {})
        for r in p["results"]:
            by_agent[p["agent"]][r["id"]] = r

    # Collect question list in stable order from the first payload.
    question_ids: list[str] = []
    question_meta: dict[str, dict[str, str]] = {}
    for p in all_payloads:
        for r in p["results"]:
            if r["id"] not in question_meta:
                question_ids.append(r["id"])
                question_meta[r["id"]] = {
                    "category": r["category"],
                    "question": r["question"],
                }

    header = "| ID | Category | Question | " + " | ".join(agents) + " |"
    divider = "|" + "---|" * (3 + len(agents))
    lines = [header, divider]
    for qid in question_ids:
        row = f"| `{qid}` | {question_meta[qid]['category']} | {question_meta[qid]['question'][:70]} |"
        for agent in agents:
            res = by_agent.get(agent, {}).get(qid)
            if not res:
                row += " _(missing)_ |"
            elif res.get("response"):
                row += " _(see below)_ |"
            else:
                row += " _(no response)_ |"
        lines.append(row)
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Minutes Eval v0.1 grader")
    parser.add_argument("--input", help="Specific results JSON to grade")
    parser.add_argument("--all", action="store_true", help="Aggregate every results/*.json")
    parser.add_argument(
        "--llm-judge",
        action="store_true",
        help="Pre-grade responses with `claude -p`. Still requires human sign-off.",
    )
    args = parser.parse_args()

    if not args.input and not args.all:
        sys.stderr.write("Specify --input <file> or --all\n")
        return 1

    paths: list[pathlib.Path] = []
    if args.all:
        paths = sorted(pathlib.Path(p) for p in glob.glob(str(RESULTS_DIR / "*.json")))
    else:
        assumed = pathlib.Path(args.input)
        if not assumed.is_absolute() and not assumed.exists():
            assumed = RESULTS_DIR / args.input
        paths = [assumed]

    if not paths:
        sys.stderr.write("No result files found.\n")
        return 1

    payloads: list[dict[str, Any]] = []
    for p in paths:
        with p.open() as f:
            payloads.append(json.load(f))

    print("# Minutes Eval v0.1 — Results\n")
    if len(payloads) > 1:
        print("## Summary\n")
        print(build_summary_table(payloads))
        print()

    for payload in payloads:
        print(f"## Agent: `{payload['agent']}` &middot; run {payload['timestamp']}\n")
        print(f"Fixture: `{payload['fixture_dir']}` &middot; {payload['question_count']} questions\n")
        for r in payload["results"]:
            judgment = None
            if args.llm_judge and r.get("response"):
                judgment = llm_judge(r["question"], r["expected"], r["rubric"], r["response"])
            print(format_result_row(r, judgment))

    print("---\n")
    print("## Human sign-off\n")
    print("For each rubric bullet above, tick the box when satisfied.")
    print("A question passes only if every rubric bullet is ticked.")
    print()
    print("Redirect this output to `docs/eval/results-v0.1.md` once reviewed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
