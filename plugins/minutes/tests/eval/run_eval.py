#!/usr/bin/env python3
"""
Minutes Eval v0.1 — runner.

Invokes an agent CLI (Claude Code, Codex, or Gemini) against the fixture
meeting corpus and logs responses to results/<agent>-<timestamp>.json.

Usage:
    python3 run_eval.py --agent claude
    python3 run_eval.py --agent codex
    python3 run_eval.py --agent gemini
    python3 run_eval.py --agent claude --question q05  # single question

Each agent CLI must be installed and authenticated. The runner does not manage
credentials — it shells out to whatever `claude`, `codex`, or `gemini` is on
PATH.

Notes:
- This is a manual-run tool. No retries, no parallelism, no CI wiring in v0.1.
- Agents read the fixture directory directly (via --add-dir or equivalent).
  This tests the "filesystem as API" claim end-to-end.
- Responses are captured raw. Grading is a separate step (grade.py).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import subprocess
import sys
import time
from typing import Any

try:
    import yaml
except ImportError:
    sys.stderr.write("Missing dependency: pip install pyyaml\n")
    sys.exit(1)


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
EVAL_DIR = pathlib.Path(__file__).resolve().parent
FIXTURE_DIR = EVAL_DIR / "fixtures" / "meetings"
RESULTS_DIR = EVAL_DIR / "results"
QUESTIONS_PATH = EVAL_DIR / "questions.yml"

PROMPT_PREAMBLE = """\
You are answering a question about a corpus of meeting markdown files in the
current working directory. Read them directly using your file-reading tools.
Each file is a meeting (or voice memo) with YAML frontmatter at the top and a
transcript below. The YAML has structured fields like `action_items`,
`decisions`, `attendees`, and `people`. Use those when relevant.

Answer the question below as concisely as possible. Cite specific meeting
dates or file names when they sharpen the answer. If the corpus is ambiguous
or a fact is missing, say so explicitly rather than guessing.

QUESTION: {question}
"""


# Per-agent CLI invocation. Each entry is a callable that takes (prompt, fixture_dir)
# and returns a list suitable for subprocess.run.
#
# If any of these flags have changed in the CLI version you have installed,
# edit here. The runner does not hardcode anything beyond these four lines.
AGENT_COMMANDS: dict[str, list[str]] = {
    # Claude Code non-interactive mode. Run with cwd=fixture_dir so Claude has
    # default file access to the corpus without needing interactive permission
    # grants. --output-format text gives us plain stdout we can capture.
    # Model is pinned so reruns are comparable; edit here when a new default
    # lands and you want to bump the eval.
    "claude": [
        "claude",
        "-p",
        "{prompt}",
        "--model",
        "claude-sonnet-4-6",
        "--output-format",
        "text",
    ],
    # Codex CLI. Exact flag name varies by version; `codex exec` is the
    # non-interactive entrypoint in the current OpenAI Codex CLI.
    # If your version uses `codex run` or a different flag, edit here.
    "codex": [
        "codex",
        "exec",
        "{prompt}",
        "--cwd",
        "{fixture_dir}",
    ],
    # Gemini CLI. `gemini -p` is the prompt flag in the Google CLI.
    # The CLI reads the current working directory by default; we invoke from
    # the fixture dir so relative paths resolve.
    "gemini": [
        "gemini",
        "-p",
        "{prompt}",
    ],
}


def load_questions() -> list[dict[str, Any]]:
    with QUESTIONS_PATH.open() as f:
        data = yaml.safe_load(f)
    return data["questions"]


def invoke_agent(agent: str, prompt: str, fixture_dir: pathlib.Path) -> dict[str, Any]:
    """Run one question through one agent CLI. Return a result dict."""
    template = AGENT_COMMANDS[agent]
    cmd = [
        part.replace("{prompt}", prompt).replace("{fixture_dir}", str(fixture_dir))
        for part in template
    ]

    # Run with cwd=fixture_dir so the agent has default file access to the
    # corpus without needing interactive permission grants. This applies to
    # every agent in the table — the fixtures directory IS the working
    # context for the question.
    start = time.monotonic()
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(fixture_dir),
        timeout=180,
    )
    elapsed = time.monotonic() - start

    return {
        "agent": agent,
        "cmd": cmd,
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "elapsed_seconds": round(elapsed, 2),
    }


def run_one(agent: str, question: dict[str, Any], fixture_dir: pathlib.Path) -> dict[str, Any]:
    prompt = PROMPT_PREAMBLE.format(question=question["question"])
    print(f"  [{question['id']}] {question['question'][:80]}", flush=True)
    try:
        res = invoke_agent(agent, prompt, fixture_dir)
    except subprocess.TimeoutExpired:
        res = {
            "agent": agent,
            "cmd": [],
            "exit_code": -1,
            "stdout": "",
            "stderr": "timeout after 180s",
            "elapsed_seconds": 180.0,
        }
    except FileNotFoundError as e:
        res = {
            "agent": agent,
            "cmd": [],
            "exit_code": -2,
            "stdout": "",
            "stderr": f"agent CLI not found on PATH: {e}",
            "elapsed_seconds": 0.0,
        }
    return {
        "id": question["id"],
        "category": question["category"],
        "question": question["question"],
        "expected": question["expected"],
        "rubric": question["rubric"],
        "response": res["stdout"].strip() if res["exit_code"] == 0 else None,
        "raw": res,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Minutes Eval v0.1 runner")
    parser.add_argument(
        "--agent",
        required=True,
        choices=list(AGENT_COMMANDS.keys()),
        help="Which agent CLI to invoke",
    )
    parser.add_argument(
        "--question",
        help="Run only a single question by id (e.g. q05). Default: all questions.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the prompts and commands that would run, without executing.",
    )
    args = parser.parse_args()

    questions = load_questions()
    if args.question:
        questions = [q for q in questions if q["id"] == args.question]
        if not questions:
            sys.stderr.write(f"No question with id={args.question}\n")
            return 1

    if args.dry_run:
        for q in questions:
            prompt = PROMPT_PREAMBLE.format(question=q["question"])
            cmd_template = AGENT_COMMANDS[args.agent]
            cmd = [
                part.replace("{prompt}", prompt).replace("{fixture_dir}", str(FIXTURE_DIR))
                for part in cmd_template
            ]
            print(f"[{q['id']}] would run:")
            print("  " + " ".join(repr(c) for c in cmd))
        return 0

    RESULTS_DIR.mkdir(exist_ok=True)
    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_path = RESULTS_DIR / f"{args.agent}-{timestamp}.json"

    print(f"Running {len(questions)} question(s) through '{args.agent}'...")
    print(f"Fixture dir: {FIXTURE_DIR}")
    print(f"Output:      {out_path}")
    print()

    results = []
    for q in questions:
        results.append(run_one(args.agent, q, FIXTURE_DIR))

    payload = {
        "agent": args.agent,
        "timestamp": timestamp,
        "fixture_dir": str(FIXTURE_DIR),
        "question_count": len(results),
        "results": results,
    }
    with out_path.open("w") as f:
        json.dump(payload, f, indent=2)

    print()
    print(f"Wrote {out_path}")
    print(f"Next: python3 grade.py --input {out_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
