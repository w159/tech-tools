#!/usr/bin/env python3
"""Judge a prompt rewrite: does the rewrite still carry every goal and constraint of the original?

The atlas-prompt skill drafts a rewrite, then calls this script before it shows anything. Two checks:

1. Anchors (deterministic, offline). Hard tokens from the original - backtick spans, quoted text,
   paths, URLs, numbers, identifiers and @handles - must appear in the rewrite. A rewrite that drops
   `src/api/v1` or "5 attempts per minute" fails here without any model.
2. Judge (independent model, fresh process). The original and the rewrite go to a different model in
   its own context. It lists the original's goals and constraints, marks each KEPT, WEAKENED, DROPPED
   or UNKNOWN, and lists requirements the rewrite ADDED that the original never asked for. The writer
   never grades its own work (Atlas's adversarial contract).

The judge command is picked per harness so the grader is a different model from the writer when one
is reachable: ATLAS_PROMPT_JUDGE_CMD wins, then `codex exec` from a Claude Code or omp session
(another model family), then `claude -p` (an isolated session with no settings, plugins or MCP),
then `omp -p`. ATLAS_PROMPT_JUDGE_MODEL picks the claude/omp model (default: sonnet).

Exit codes: 0 pass, 1 fail (see the JSON report), 2 judge unavailable (anchors-only verdict),
3 usage error. The report is JSON on stdout. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

VERDICTS = ("KEPT", "WEAKENED", "DROPPED", "UNKNOWN")
DEFAULT_MODEL = "sonnet"
DEFAULT_TIMEOUT = 120

# ---- anchors ---------------------------------------------------------------------------------

_BACKTICK = re.compile(r"`([^`\n]{1,200})`")
_QUOTED = re.compile(r"\"([^\"\n]{3,200})\"|(?<![A-Za-z])'([^'\n]{3,200})'(?![A-Za-z])")
_URL = re.compile(r"https?://[^\s)>\]\"'`]+")
_PATH = re.compile(r"(?<![\w@/.-])(?:\.{0,2}/)?(?:[\w.-]+/)+[\w.-]+|(?<![\w/.-])[\w-]+\.[A-Za-z]{1,6}\b")
_NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?:\s?(?:%|ms|s|sec|seconds?|minutes?|min|hours?|h|days?|"
                     r"MB|GB|KB|px|rpm|x|attempts?|requests?|times?))?(?![\w.])")
_IDENT = re.compile(r"(?<![\w.-])(?:[a-z]+[A-Z]\w*|[A-Za-z]+_\w+|[A-Z][a-z]+[A-Z]\w*)(?![\w-])")
_ROOTED = re.compile(r"(?<![\w/.:-])/[A-Za-z_][\w.-]*(?:/[\w.-]+)*")
_HANDLE = re.compile(r"(?<!\w)@[\w-]{2,}")
# words that look like paths but are not artifacts the user named
_PATH_NOISE = {"e.g", "i.e", "etc", "vs", "and/or", "w/o", "n/a"}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def anchors(text: str) -> list[str]:
    """Hard tokens the user typed that a faithful rewrite has to keep, in first-seen order."""
    if not isinstance(text, str) or not text.strip():
        return []
    found: list[str] = []

    def add(tok: str) -> None:
        tok = tok.strip().strip(".,;:!?")
        if len(tok) < 2 or _norm(tok) in _PATH_NOISE:
            return
        if any(tok in f for f in found):  # already found, or part of a longer token
            return
        found.append(tok)

    for m in _BACKTICK.finditer(text):
        add(m.group(1))
    for m in _QUOTED.finditer(text):
        add(m.group(1) or m.group(2))
    for m in _URL.finditer(text):
        add(m.group(0))
    stripped = _URL.sub(" ", text)
    for m in _PATH.finditer(stripped):
        add(m.group(0))
    for m in _ROOTED.finditer(stripped):
        add(m.group(0))
    for m in _HANDLE.finditer(stripped):
        add(m.group(0))
    for m in _IDENT.finditer(stripped):
        add(m.group(0))
    for m in _NUMBER.finditer(stripped):
        add(m.group(0))
    return found


def missing_anchors(original: str, rewrite: str) -> list[str]:
    """Anchors of `original` that `rewrite` does not contain (whitespace and case folded)."""
    have = _norm(rewrite or "")
    return [a for a in anchors(original) if _norm(a) not in have]


# ---- judge -----------------------------------------------------------------------------------

JUDGE_RUBRIC = """You are grading a prompt rewrite. You did not write it. Be strict and literal.

<original>
{original}
</original>

<rewrite>
{rewrite}
</rewrite>

1. List every goal and constraint in <original> as short atomic items, in the user's terms. Count each
   deliverable, each limit ("don't", "only", "except", "without", numbers, names, order) and each stated
   standard of done as its own item.
2. For each item give one verdict:
   KEPT     - the rewrite asks for it with the same force and scope
   WEAKENED - present but softer, narrower, optional, or with its limit loosened
   DROPPED  - absent, or contradicted
   UNKNOWN  - you cannot tell from the text
   Quote the rewrite words that carry it ("" when DROPPED).
3. List requirements in <rewrite> that <original> did not ask for and does not clearly imply. These do
   not count: checks that confirm the asked-for result (run the tests, show the output), rules the
   rewrite attributes to the project's own files (CLAUDE.md, AGENTS.md), and assumptions or notes the
   rewrite labels as such. Scope, features, files, tools or deliverables the user never named do count.

Reply with JSON only, no prose and no code fence:
{{"items": [{{"item": "...", "verdict": "KEPT|WEAKENED|DROPPED|UNKNOWN", "quote": "..."}}],
  "added": ["..."]}}"""


_STYLE_SECTION = re.compile(r"^#{1,6}\s*Output style\s*$.*?(?=^#{1,6}\s|\Z)", re.M | re.S | re.I)


def strip_boilerplate(rewrite: str) -> str:
    """The rewrite minus the fixed `## Output style` directive and a `Checked:` footer line.

    Both are the skill's own constant text, not scope the writer added, so neither is graded."""
    text = _STYLE_SECTION.sub("", rewrite or "")
    text = "\n".join(ln for ln in text.splitlines() if not ln.startswith("Checked:"))
    return text.strip()


def judge_prompt(original: str, rewrite: str) -> str:
    return JUDGE_RUBRIC.format(original=original.strip(), rewrite=strip_boilerplate(rewrite))


def _harness(env: dict) -> str:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import atlas_harness

        return atlas_harness.detect_harness(None, env)
    except Exception:  # noqa: BLE001 - detection is best effort
        return "unknown"


def judge_command(env: dict | None = None, which=shutil.which) -> tuple[list[str], str] | None:
    """(argv prefix, label) for the judge, the prompt appended as the last argv item; None if none."""
    env = dict(os.environ) if env is None else env
    override = env.get("ATLAS_PROMPT_JUDGE_CMD", "").strip()
    if override:
        try:
            return shlex.split(override), "custom"
        except ValueError:  # unbalanced quotes: treat as unusable rather than run a mangled argv
            return None
    model = env.get("ATLAS_PROMPT_JUDGE_MODEL", "").strip() or DEFAULT_MODEL
    harness = _harness(env)
    if harness != "codex" and which("codex"):
        return ["codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only"], "codex"
    if which("claude"):
        return (
            # --tools is variadic: keep a flag after it so it cannot swallow the prompt
            ["claude", "-p", "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--model", model,
             "--max-turns", "1"],
            f"claude:{model}",
        )
    if which("omp"):
        return ["omp", "-p", "--model", model], f"omp:{model}"
    return None


def parse_judge(text: str) -> dict | None:
    """The first JSON object in the judge's reply that has an `items` list; None when there is none."""
    if not isinstance(text, str):
        return None
    dec = json.JSONDecoder()
    for m in re.finditer(r"\{", text):
        try:
            obj, _ = dec.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("items"), list):
            items = []
            for it in obj["items"]:
                if not isinstance(it, dict):
                    continue
                v = str(it.get("verdict", "UNKNOWN")).upper()
                items.append({"item": str(it.get("item", "")), "verdict": v if v in VERDICTS else "UNKNOWN",
                              "quote": str(it.get("quote", ""))})
            added = [str(a) for a in obj.get("added", []) if str(a).strip()] if isinstance(
                obj.get("added"), list) else []
            return {"items": items, "added": added}
    return None


def run_judge(original: str, rewrite: str, env: dict | None = None, timeout: int | None = None,
              runner=subprocess.run) -> tuple[dict | None, str]:
    """(parsed verdict or None, judge label or reason it is unavailable)."""
    env = dict(os.environ) if env is None else env
    cmd = judge_command(env)
    if cmd is None:
        return None, "unavailable: no codex, claude or omp on PATH"
    argv, label = cmd
    if timeout is None:
        try:
            timeout = int(env.get("ATLAS_PROMPT_JUDGE_TIMEOUT", DEFAULT_TIMEOUT))
        except ValueError:
            timeout = DEFAULT_TIMEOUT
    # a scratch cwd keeps the judge out of the project: no CLAUDE.md, no hooks, no .atlas writes
    with tempfile.TemporaryDirectory(prefix="atlas-judge-") as cwd:
        try:
            proc = runner(argv + [judge_prompt(original, rewrite)], capture_output=True, text=True,
                          timeout=timeout, cwd=cwd, env=env)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return None, f"unavailable: {label} {type(exc).__name__}"
    parsed = parse_judge(getattr(proc, "stdout", "") or "")
    if parsed is None:
        return None, f"unavailable: {label} gave no verdict (rc {getattr(proc, 'returncode', '?')})"
    return parsed, label


def verdict(original: str, rewrite: str, judged: dict | None, label: str) -> dict:
    """Combine the anchor check and the judge into one report."""
    missing = missing_anchors(original, rewrite)
    report = {"anchors_missing": missing, "judge": label, "items": [], "added": []}
    if rewrite.strip() == "SKIP":
        report.update(passed=True, kept=0, total=0, reason="SKIP")
        return report
    if judged is not None:
        report["items"] = judged["items"]
        report["added"] = judged["added"]
    bad = [i for i in report["items"] if i["verdict"] in ("WEAKENED", "DROPPED")]
    report["kept"] = sum(1 for i in report["items"] if i["verdict"] == "KEPT")
    report["total"] = len(report["items"])
    report["passed"] = not missing and not bad and not report["added"]
    if judged is None:
        report["passed"] = not missing
    return report


def format_footer(report: dict) -> str:
    """The one line the skill prints under the rewrite."""
    if report.get("reason") == "SKIP":
        return ""
    if not report["items"]:
        return f"Checked: anchors {'kept' if not report['anchors_missing'] else 'missing'} ({report['judge']})"
    return f"Checked: {report['kept']}/{report['total']} goals kept, {len(report['added'])} added ({report['judge']})"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--original", required=True, help="file holding the user's original request")
    ap.add_argument("--rewrite", required=True, help="file holding the drafted rewrite")
    ap.add_argument("--anchors-only", action="store_true", help="skip the model judge")
    a = ap.parse_args(argv)
    try:
        with open(a.original, encoding="utf-8") as fh:
            original = fh.read()
        with open(a.rewrite, encoding="utf-8") as fh:
            rewrite = fh.read()
    except OSError as exc:
        print(json.dumps({"error": str(exc)}))
        return 3
    if a.anchors_only or rewrite.strip() == "SKIP":
        judged, label = None, "anchors-only"
    else:
        judged, label = run_judge(original, rewrite)
    report = verdict(original, rewrite, judged, label)
    report["footer"] = format_footer(report)
    print(json.dumps(report, indent=1))
    if report["passed"]:
        return 0 if (judged is not None or a.anchors_only or report.get("reason") == "SKIP") else 2
    return 1


if __name__ == "__main__":
    sys.exit(main())
