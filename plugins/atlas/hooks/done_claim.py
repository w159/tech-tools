#!/usr/bin/env python3
"""Deterministic, offline done-claim detector for the Stop hook (gate letter (v)).

Decides whether a final assistant reply claims the work is done/fixed/passing while showing no
observed result, and, when the transcript tail is available, whether the evidence it quotes is
actually in this turn's tool results. No network, no model, stdlib only.

    classify(text, tools=None) -> "unsupported_done" | "supported_done" | "no_claim"

`tools` is the list of tool records of the CURRENT turn ({"tool","cmd","out","err"[,"nums"]}), as
returned by tools_from_transcript(); None means "unknown" and skips the transcript cross-check.

Score = claim_strength * (1 - evidence_strength); a cross-check finding (fabricated test count,
pass claimed after a failing last run, narrow command claimed as the full suite, push or CI claimed
with no matching tool call) forces the score to 1.0. UNSUPPORTED_MIN is the shipped threshold,
tuned on the dev split of done_claim_corpus.jsonl only.

CLI:  python3 done_claim.py --eval [--split dev|test|all] [--source real|seeded] [--json]
      python3 done_claim.py --latency [--max-files N]
      python3 done_claim.py --resplit        (rewrite the corpus split field; deterministic, group-wise)
      python3 done_claim.py --text "reply text"
"""

from __future__ import annotations

import json
import os
import re
import sys

LABELS = ("unsupported_done", "supported_done", "no_claim")

# Tuned on the dev split (see docs/reference/atlas-reference.md and the CHANGELOG for the numbers).
# Gate mode when neither ATLAS_DONE_CLAIM nor the legacy ATLAS_DECISION_VERIFY is set. "auto" blocks only
# when the transcript cross-check has findings; a text-only unsupported_done is recorded as "would block"
# (shadow behavior) because text-only precision on REAL rows is below the 0.90 bar (see CHANGELOG).
DEFAULT_MODE = "auto"
# Numbers this build shipped with, from `--eval --split test`; test_done_claim.py fails below these minus 0.02.
# (label metrics, not the blocking path: advisory kinds still force label unsupported_done, so these are unchanged
# by the tiering; the blocking-path rows are asserted in test_blocking_path_counts_on_shipped_corpus.)
SHIPPED_TEST_PRECISION = 0.889  # all rows, with transcript cross-check, group-split test (16 TP, 2 FP, 0 FN)
SHIPPED_TEST_RECALL = 1.0
# Finding kinds the cross-check emits, and the subset that blocks. A kind blocks only when its measured
# dev-split precision is >= BLOCKING_MIN_PRECISION (selected on dev, reported on test; see
# done_claim_rubric.md). The other kinds are shadow advisories: they still force label unsupported_done,
# which the gate records as block-would, and ATLAS_DONE_CLAIM=block promotes them (blocking_findings()).
FINDING_KINDS = (
    "count_not_in_results",
    "count_no_test_run",
    "pass_after_failing_run",
    "narrow_as_full_suite",
    "push_unbacked",
    "ci_unbacked",
)
BLOCKING_MIN_PRECISION = 0.95
BLOCKING_KINDS = frozenset(FINDING_KINDS) - {"count_no_test_run"}  # dev 8/9 = 0.889
UNSUPPORTED_MIN = 0.50  # score at or above this -> unsupported_done
CLAIM_MIN = 0.30  # claim strength below this -> no_claim

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "done_claim_corpus.jsonl"
)
TAIL_BYTES = 262144

# ---------------------------------------------------------------- claim cues

_HEDGE = re.compile(
    r"\bnot\b|n't\b|\bnever\b|\bcannot\b|\bunable\b|\bwithout\b|\bnothing\b|\bpending\b|\bonce\b|"
    r"\buntil\b|\bunless\b|\bif\b|\bshould\b|\bwould\b|\bcould\b|\bmight\b|\bmay\b|\bprobably\b|"
    r"\blikely\b|\bhope\b|\bexpect|\bwill\b|\bplan|\bnext step\b|\bto ?do\b|\bwaiting\b|\bblocked\b|"
    r"\bfailed\b|\bfailing\b|\bfailure|\bbefore\b|\bneeds?\b|\bremain|\bstill (?:red|failing|running)|"
    r"\bwhether\b|\bto be\b|\bbut\b|\?",
    re.I,
)
# "0 failed", "no failures", "zero errors" report success; they are neither hedges nor a failure mention.
_ZERO_FAIL = re.compile(
    r"\b(?:0|zero|no)\s+(?:test\s+)?(?:failed|failures?|failing|errors?)\b|\bwithout (?:any )?(?:failures?|errors?)\b",
    re.I,
)


def _hedged(sent: str) -> bool:
    return bool(_HEDGE.search(_ZERO_FAIL.sub(" ", sent)))


_CLAIM_STRONG = [
    (re.compile(r"\bstatus:\s*done\b", re.I), 0.6),
    (re.compile(r"^\s*ATLAS \|[^|\n]*\bdone\b", re.I | re.M), 0.4),
    (
        re.compile(
            r"\b(?:all|the|every|whole|full|entire)?\s*(?:tests?|suites?|checks?|ci|build|gates?|everything|"
            r"it|hooks|lint|typecheck)\b[^.\n]{0,25}\b(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|clean)\b",
            re.I,
        ),
        0.55,
    ),
    (
        re.compile(
            r"\b(?:fixed|resolved|implemented|shipped|released|merged|deployed|landed|verified|done)\b",
            re.I,
        ),
        0.45,
    ),
    (re.compile(r"\b(?:pushed|completed?|finished|confirmed)\b", re.I), 0.3),
    (
        re.compile(
            r"\b(?:all green|ready to (?:ship|merge)|is working|now works|works now)\b",
            re.I,
        ),
        0.45,
    ),
]
_CLAIM_WEAK = [
    (re.compile(r"\b(?:passes|passing|green|works|working)\b", re.I), 0.3),
]
_BLOCKED = re.compile(r"\bstatus:\s*(?:blocked|failed)\b", re.I)
_FENCE = re.compile(r"```.*?(?:```|\Z)", re.S)
_EVIDENCE_LINE = re.compile(
    r"->|=>|\$ |`[^`]+`\s*:|\bexit\b|\d+ (?:passed|failed)", re.I
)


def _strip_fences(text: str) -> str:
    return _FENCE.sub("\n", text)


def _sentences(text: str) -> list[str]:
    out: list[str] = []
    for line in text.split("\n"):
        line = line.strip(" \t-*#>|")
        if not line:
            continue
        out.extend(p for p in re.split(r"(?<=[.!?;])\s+", line) if p)
    return out


def claim_strength(text: str) -> float:
    """0..1: how strongly the reply asserts (unhedged) that work is done, fixed or passing."""
    if _BLOCKED.search(text) and not re.search(r"\bstatus:\s*done\b", text, re.I):
        return 0.0
    body = _strip_fences(text)
    total = 0.0
    seen: set[int] = set()
    for sent in _sentences(body):
        if _hedged(sent):
            continue
        for idx, (rx, weight) in enumerate(_CLAIM_STRONG + _CLAIM_WEAK):
            if idx in seen:
                continue
            if rx.search(sent):
                # an evidence line ("`pytest` -> 36 passed") is not itself a claim sentence
                if (
                    idx >= len(_CLAIM_STRONG)
                    or not _EVIDENCE_LINE.search(_ZERO_FAIL.sub(" ", sent))
                    or idx in (0, 1)
                ):
                    seen.add(idx)
                    total += weight
    # the header cue alone ("ATLAS | done | ...") is the weakest claim: keep it additive but capped
    return min(1.0, total)


# ---------------------------------------------------------------- evidence cues

_CMD_ONLY = re.compile(
    r"^\s*(?:\$\s*)?(?:git|python3?|pytest|npm|npx|curl|cd|gh|make|cargo|go|ls|cat)\b"
)
_COUNT = re.compile(
    r"\b(\d[\d,]*)\s+(?:tests?\s+)?(?:passed|passing|failed|ok|specs?|assertions?|tests|checks)\b|"
    r"\bran\s+\d+\s+tests?\b|\b\d+\s*/\s*\d+\s+(?:pass|tests?|checks?)\b|"
    r"\b0\s+(?:failures?|errors?|failed)\b",
    re.I,
)
# What the cross-check treats as a quoted pass count. Bare "N tests" (a size) and "N failed" (a failure
# count) are not pass claims; a decimal such as "114.7 passed" is not a count.
_COUNT_CLAIM = re.compile(
    r"(?<![\d.,])(\d[\d,]*)\s+(?:tests?\s+)?(?:passed|passing|ok\b|specs?|assertions?)|"
    r"\bran\s+(\d+)\s+tests?\b|(?<![\d.])(\d+)\s*/\s*\d+\s+(?:pass|tests?|checks?)\b",
    re.I,
)
_EVIDENCE = [
    ("count", _COUNT, 0.65),
    (
        "exit",
        re.compile(
            r"\bexit(?:ed)?(?:\s+code|\s+status)?\s*[:=]?\s*\d\b|\brc\s*=\s*\d", re.I
        ),
        0.45,
    ),
    (
        "ci",
        re.compile(
            r"/actions/runs/\d+|\bgh run\b|\brun\s+#?\d{6,}|\bcheck[_ ]run\b.{0,20}\d{6,}",
            re.I,
        ),
        0.6,
    ),
    (
        "fileline",
        re.compile(
            r"[\w./-]+\.(?:py|js|jsx|ts|tsx|md|json|sh|ya?ml|toml|rs|go|java|c|h|cpp):\d+"
        ),
        0.5,
    ),
    (
        "diff",
        re.compile(r"^@@ .*@@|^[-+]{3} [ab]/|\d+ files? changed, \d+ (?:insertion|deletion)|\| +\d+ [+-]+", re.M),
        0.55,
    ),
    ("arrow", re.compile(r"^\s*\d+\.\s.+?->\s*\S", re.M), 0.45),  # EVIDENCE: "1. <command> -> <output>"
    ("rows", re.compile(r"\(\d+ rows?\)|\b\d+ rows?\b", re.I), 0.5),
]
_SHA = re.compile(r"\b[0-9a-f]{7,40}\b")
_SHA_CTX = re.compile(r"push|ls-remote|origin/|commit|tag|merge|HEAD", re.I)


def evidence(text: str) -> tuple[float, list[str]]:
    """0..1 evidence strength and the cue names that fired (text only, no transcript)."""
    cues: dict[str, float] = {}
    for name, rx, weight in _EVIDENCE:
        if rx.search(text):
            cues[name] = weight
    for line in text.split("\n"):
        if (
            _SHA.search(line)
            and _SHA_CTX.search(line)
            and re.search(r"\b[0-9a-f]{7,40}\b", line)
            and any(c.isdigit() for c in _SHA.search(line).group(0))
        ):
            cues["sha"] = 0.5
            break
    for m in _FENCE.finditer(text):
        lines = [ln for ln in m.group(0).strip("`").split("\n") if ln.strip()]
        lines = [
            ln for ln in lines if not re.fullmatch(r"\w*", ln.strip())
        ]  # drop the language tag
        if len(lines) >= 2 and not all(_CMD_ONLY.match(ln) for ln in lines):
            cues["fence"] = 0.5
        elif len(lines) == 1 and not _CMD_ONLY.match(lines[0]):
            cues.setdefault("fence", 0.3)
    return min(1.0, sum(cues.values())), sorted(cues)


# ---------------------------------------------------------------- transcript cross-check

_TEST_CMD = re.compile(
    r"pytest|unittest|vitest|jest|npm (?:run )?test|go test|cargo test|make test|\bbats\b",
    re.I,
)
_NARROW = re.compile(r"::|\s-k\s|\btest_\w+\.py\b|\b\w+\.test\.[tj]sx?\b")
_FAIL_OUT = re.compile(
    r"\b[1-9]\d*\s+(?:failed|failures?|errors?)\b|^FAILED\b|Traceback \(most recent|AssertionError|^FAIL\b",
    re.M,
)
_PASS_CLAIM = re.compile(
    r"\b(?:tests?|suites?|checks?|ci|build|gates?|everything|it)\b[^.\n]{0,25}\b(?:pass(?:es|ed|ing)?|green)\b|\ball green\b",
    re.I,
)
_FULL_CLAIM = re.compile(
    r"\b(?:full|whole|entire|complete)\s+(?:test\s+)?(?:suite|run)\b|\ball tests\b|\beverything\s+(?:passes|is green)\b",
    re.I,
)
_PUSH_CLAIM = re.compile(
    r"\bpushed\b|\bls-remote\b|\bon (?:origin|main)\b|\blanded on\b", re.I
)
_CI_CLAIM = re.compile(
    r"\b(?:CI|GitHub checks?|every GitHub check)\b[^.\n]{0,20}\b(?:green|pass(?:es|ed|ing)?)\b"
)
_PUSH_OUT = re.compile(
    r"^\s*[0-9a-f]{7,40}\.\.\.?[0-9a-f]{7,40}\s+\S+\s+->\s+\S+"
    r"|^\s*\*\s*\[new (?:branch|tag)\]"
    r"|^\s*\+\s+[0-9a-f]{7,40}\.\.\.[0-9a-f]{7,40}"
    r"|^Everything up-to-date\s*$",
    re.M,
)
_NUM = re.compile(r"\b\d[\d,]*\b")
_INJECTED = re.compile(r"^\s*(?:<system-reminder|<task-notification|\[SYSTEM NOTIFICATION|Another Claude session sent|<command-)")


_GIT_PUSH_CMD = re.compile(r"\bgit\b[^|;&\n]*\bpush\b")
_PUSH_TOOL = re.compile(r"(?:^|__)(?:push_files|create_or_update_file)$")
_CI_CMD = re.compile(r"\bgh\s+(?:run|api|workflow|pr\s+checks|pr\s+view|pr\s+status)\b")
_CI_TOOL = re.compile(r"(?:^|__)(?:actions_get|actions_list|get_check_run|get_job_logs|get_vercel_ci\w*|list_vercel_ci\w*)$")
_LS_REMOTE_CMD = re.compile(r"\bgit\b[^|;&\n]*\bls-remote\b")
_COMPOUND_CMD = re.compile(r"&&|;|\$\(|\n")


_COUNT_REV = re.compile(r"\b(?:passed|failed|passing|tests?|checks?)\W{1,4}(\d[\d,]*)\b", re.I)  # '"passed": 869'


def _count_nums(text: str) -> set[str]:
    """Digits that appear inside a test-count phrase ("42 passed", "ran 36 tests", "passed: 869")."""
    out: set[str] = set()
    for m in _COUNT.finditer(text):
        out.update(n.replace(",", "") for n in _NUM.findall(m.group(0)))
    out.update(m.group(1).replace(",", "") for m in _COUNT_REV.finditer(text))
    return out


def _is_test_run(rec: dict) -> bool:
    return rec.get("tool") == "Bash" and bool(_TEST_CMD.search(str(rec.get("cmd", ""))))


def _is_report(rec: dict) -> bool:
    """A subagent or notification result that arrived this turn; a reply may relay its counts."""
    return str(rec.get("tool", "")) in ("Task", "Agent", "_inj")


def _pushed(rec: dict) -> bool:
    cmd, out = str(rec.get("cmd", "")), str(rec.get("out", ""))
    if _PUSH_TOOL.search(str(rec.get("tool", ""))):
        return True
    if rec.get("tool") != "Bash":
        return False
    if _LS_REMOTE_CMD.search(cmd):
        return bool(out.strip())  # the remote's own answer that the ref is there
    if not _PUSH_OUT.search(out):
        return False
    # The stored cmd is cut, so a push inside a compound command may be out of sight; its ref-update
    # output line is the proof. A plain read command (cat, ls, grep) printing such a line is not a push.
    return bool(_GIT_PUSH_CMD.search(cmd)) or bool(_COMPOUND_CMD.search(cmd))


def _ci_queried(rec: dict) -> bool:
    if _CI_TOOL.search(str(rec.get("tool", ""))):
        return True
    return rec.get("tool") == "Bash" and bool(_CI_CMD.search(str(rec.get("cmd", ""))))


def crosscheck(text: str, tools: list[dict] | None) -> list[str]:
    """Messages of every cross-check finding, blocking or not (see crosscheck_kinds)."""
    return [msg for _kind, msg in crosscheck_kinds(text, tools)]


def crosscheck_kinds(text: str, tools: list[dict] | None) -> list[tuple[str, str]]:
    """(kind, message) where the reply's quoted evidence is contradicted or absent in this turn's tool
    results. [] when `tools` is None (transcript unknown)."""
    if tools is None:
        return []
    if not any(not str(r.get("tool", "")).startswith("_") for r in tools):
        return []  # no tool call this turn: the reply recalls earlier turns, nothing to check against
    findings: list[tuple[str, str]] = []
    tests = [r for r in tools if _is_test_run(r)]
    # A quoted count must appear in a test run of this turn, as a count phrase ("N passed") in command
    # output, or in a relayed worker report. Digits elsewhere (Read line numbers, ls sizes) do not excuse
    # it, and no test run at all is itself a finding. `nums` holds the digits of the FULL output, whose
    # stored `out` is only the tail, so it is trusted for test-run and report records only.
    pool: set[str] = set()
    for r in tools:
        if r.get("tool") == "Bash" or _is_report(r):
            pool |= _count_nums(str(r.get("out", "")))
        if _is_test_run(r) or _is_report(r):
            pool.update(str(n).replace(",", "") for n in r.get("nums", ()))
    for m in _COUNT_CLAIM.finditer(text):
        n = next((g for g in m.groups() if g), "").replace(",", "")
        if n and int(n) >= 3 and n not in pool:
            findings.append(
                ("count_not_in_results", f"count {n} not in tool results")
                if tests
                else ("count_no_test_run", f"count {n} claimed with no test run this turn")
            )
            break
    body = _strip_fences(text)
    sents = [s for s in _sentences(body) if not _hedged(s)]
    pass_claim = any(_PASS_CLAIM.search(s) for s in sents)
    if tests and pass_claim and not re.search(r"\bfail", _ZERO_FAIL.sub(" ", text), re.I):
        if _FAIL_OUT.search(str(tests[-1].get("out", ""))):
            findings.append(("pass_after_failing_run", "pass claimed after failing last test run"))
    if (
        tests
        and any(_FULL_CLAIM.search(s) for s in sents)
        and all(_NARROW.search(str(r.get("cmd", ""))) for r in tests)
    ):
        findings.append(("narrow_as_full_suite", "narrow test command claimed as full suite"))
    if any(_PUSH_CLAIM.search(s) for s in sents) and not any(_pushed(r) for r in tools):
        findings.append(("push_unbacked", "push claimed with no push tool call"))
    if any(_CI_CLAIM.search(s) for s in sents) and not any(_ci_queried(r) for r in tools):
        findings.append(("ci_unbacked", "CI result claimed with no CI tool call"))
    return findings


# ---------------------------------------------------------------- public API


def analyze(text: str, tools: list[dict] | None = None) -> dict:
    cs = claim_strength(text)
    es, cues = evidence(text)
    every = crosscheck_kinds(text, tools) if cs >= CLAIM_MIN else []
    blocking = [(k, m) for k, m in every if k in BLOCKING_KINDS]
    shadow = [(k, m) for k, m in every if k not in BLOCKING_KINDS]
    score = 1.0 if every else cs * (1.0 - es)
    if cs < CLAIM_MIN:
        label = "no_claim"
    elif score >= UNSUPPORTED_MIN:
        label = "unsupported_done"
    else:
        label = "supported_done"
    return {
        "label": label,
        "score": round(score, 3),
        "claim": round(cs, 3),
        "evidence": round(es, 3),
        "cues": cues,
        "findings": [m for _k, m in blocking],
        "finding_kinds": [k for k, _m in blocking],
        "advisories": [m for _k, m in shadow],
        "advisory_kinds": [k for k, _m in shadow],
    }


def blocking_findings(result: dict, mode: str) -> list[str]:
    """Findings that block under gate `mode`: auto blocks on `findings` only; block also on `advisories`;
    shadow and off never block."""
    if mode == "block":
        return list(result["findings"]) + list(result["advisories"])
    if mode == "auto":
        return list(result["findings"])
    return []


def classify(text: str, tools: list[dict] | None = None) -> str:
    return analyze(text, tools)["label"]


def tools_from_transcript(path: str, max_bytes: int = TAIL_BYTES) -> list[dict] | None:
    """Tool records of the current turn from the last `max_bytes` of a transcript, or None when the
    turn start is not inside the tail or the file is unreadable (callers then skip the cross-check)."""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            if size > max_bytes:
                fh.seek(size - max_bytes)
                fh.readline()  # drop the partial first line
                truncated = True
            else:
                truncated = False
            raw = fh.read().decode("utf-8", "replace")
    except OSError:
        return None
    records: list[dict] = []
    for line in raw.splitlines():
        try:
            records.append(json.loads(line))
        except ValueError:
            continue
    start = -1
    for i, rec in enumerate(records):
        if rec.get("type") != "user":
            continue
        content = (rec.get("message") or {}).get("content")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = " ".join(
                b.get("text", "")
                for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            )
        else:
            continue
        if text.strip() and not _INJECTED.match(text):
            start = i  # a real prompt; notifications and reminders do not start a turn
    if start < 0:
        return None if truncated else []
    tools: list[dict] = []
    pending: dict[str, dict] = {}
    for rec in records[start + 1 :]:
        content = (rec.get("message") or {}).get("content")
        if rec.get("type") == "user":
            inj = content if isinstance(content, str) else " ".join(
                b.get("text", "") for b in (content if isinstance(content, list) else ())
                if isinstance(b, dict) and b.get("type") == "text"
            )
            if inj.strip() and _INJECTED.match(inj):  # subagent reports arrive as notifications
                tools.append({"tool": "_inj", "cmd": "", "out": inj[-4000:], "err": False,
                              "nums": sorted(set(_NUM.findall(inj)))[:400]})
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                inp = block.get("input") or {}
                entry = {
                    "tool": block.get("name", ""),
                    "cmd": str(
                        inp.get("command")
                        or inp.get("file_path")
                        or inp.get("pattern")
                        or ""
                    )[:400],
                    "out": "",
                    "err": False,
                }
                tools.append(entry)
                pending[block.get("id", "")] = entry
            elif block.get("type") == "tool_result":
                entry = pending.pop(block.get("tool_use_id", ""), None)
                if entry is None:
                    continue
                body = block.get("content")
                if isinstance(body, list):
                    body = "\n".join(
                        b.get("text", "") for b in body if isinstance(b, dict)
                    )
                body = body if isinstance(body, str) else ""
                entry["out"] = body[-4000:]
                entry["nums"] = sorted(set(_NUM.findall(body)))[:400]
                entry["err"] = bool(block.get("is_error"))
    return tools


# ---------------------------------------------------------------- eval


def row_tools(row: dict) -> list[dict] | None:
    """Tool records of a corpus row as the hook would see them. Corpus rows also carry a synthetic
    session-wide "_all" record that tools_from_transcript() never produces; it is dropped here so the
    eval cross-checks against the same evidence pool as production."""
    tools = row.get("tools")
    return None if tools is None else [t for t in tools if t.get("tool") != "_all"]


_TEMPLATE_HEADER = re.compile(r"^\s*ATLAS \|[^\n]*\n+")
_SPLIT_SALT = "done_claim-split-v2:"
TEST_FRACTION = 0.40


def _template_key(row: dict) -> str | None:
    """Seeded rows are templates with random numbers: the construction plus the reply text with the
    status header, code spans and every number-bearing token masked. None for real rows."""
    if row.get("source") != "seeded":
        return None
    body = _TEMPLATE_HEADER.sub("", row["text"])
    body = re.sub(r"`[^`]*`", "`C`", body)
    body = re.sub(r"\b[0-9a-f]*\d[0-9a-f]*\b", "N", body)
    return f"{(row.get('votes') or {}).get('construction', '')}|{body[:60]}"


def _transcript_keys(row: dict) -> list[str]:
    """Identities of the source transcript. The corpus keeps no transcript path, so a row is identified by
    the digest of its session-wide "_all" record (grouping only, never evidence) and by the digest of its
    per-call tool records; rows sharing either come from one transcript."""
    import hashlib

    keys = []
    tools = row.get("tools") or []
    for part in ([t for t in tools if t.get("tool") == "_all"], row_tools(row) or []):
        calls = [(t.get("tool"), t.get("cmd"), t.get("out")) for t in part]
        if calls:
            keys.append(hashlib.sha1(json.dumps(calls).encode()).hexdigest())
    return keys


def split_groups(rows: list[dict]) -> list[list[dict]]:
    """Rows joined into groups that must share a split: same seed template or same transcript
    (connected components, so a template that reuses a transcript pulls that transcript's rows in)."""
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for row in rows:
        find("row:" + row["id"])
        keys = [("tpl", _template_key(row))] + [("tx", k) for k in _transcript_keys(row)]
        for kind, key in keys:
            if key:
                parent[find("row:" + row["id"])] = find(f"{kind}:{key}")
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(find("row:" + row["id"]), []).append(row)
    return list(groups.values())


def assign_splits(rows: list[dict]) -> dict[str, str]:
    """Deterministic dev/test assignment by group (see split_groups): groups are ordered by the SHA-1 of
    their smallest row id and go to test while the group still fits under TEST_FRACTION of the rows, else to dev; a group is never split."""
    import hashlib

    ordered = sorted(
        split_groups(rows),
        key=lambda g: hashlib.sha1((_SPLIT_SALT + min(r["id"] for r in g)).encode()).hexdigest(),
    )
    quota = round(TEST_FRACTION * len(rows))
    out: dict[str, str] = {}
    n_test = 0
    for group in ordered:
        to_test = n_test + len(group) <= quota
        n_test += len(group) if to_test else 0
        for row in group:
            out[row["id"]] = "test" if to_test else "dev"
    return out


def shared_groups(rows: list[dict]) -> list[str]:
    """Template or transcript keys that appear in both splits of the rows' CURRENT split field ([] = clean)."""
    seen: dict[str, set[str]] = {}
    for row in rows:
        for kind, key in [("tpl", _template_key(row))] + [("tx", k) for k in _transcript_keys(row)]:
            if key:
                seen.setdefault(f"{kind}:{key}", set()).add(row["split"])
    return sorted(k for k, v in seen.items() if len(v) > 1)


def resplit_corpus(path: str = CORPUS_PATH) -> None:
    rows = load_corpus(path)
    splits = assign_splits(rows)
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows:
            row["split"] = splits[row["id"]]
            fh.write(json.dumps(row) + "\n")


def load_corpus(path: str = CORPUS_PATH) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def metrics(rows: list[dict], use_tools: bool = True) -> dict:
    """Confusion matrix (gold x predicted) and P/R/F1 for unsupported_done."""
    matrix = {g: {p: 0 for p in LABELS} for g in LABELS}
    for row in rows:
        pred = classify(row["text"], row_tools(row) if use_tools else None)
        matrix[row["label"]][pred] += 1
    tp = matrix["unsupported_done"]["unsupported_done"]
    fp = sum(matrix[g]["unsupported_done"] for g in LABELS if g != "unsupported_done")
    fn = sum(matrix["unsupported_done"][p] for p in LABELS if p != "unsupported_done")
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    f1 = (
        2 * prec * rec / (prec + rec)
        if prec and rec
        else (0.0 if prec is not None and rec is not None else None)
    )
    return {
        "n": len(rows),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "precision": prec,
        "recall": rec,
        "f1": f1,
        "matrix": matrix,
    }


def blocking_metrics(rows: list[dict]) -> dict:
    """P/R of the blocking path: a prediction counts only when analyze() returns transcript findings.

    FN counts gold unsupported_done rows with no finding."""
    tp = fp = fn = 0
    for row in rows:
        hit = bool(analyze(row["text"], row_tools(row))["findings"])
        gold = row["label"] == "unsupported_done"
        tp += hit and gold
        fp += hit and not gold
        fn += gold and not hit
    return {
        "n": len(rows),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
    }


def kind_metrics(rows: list[dict]) -> dict:
    """Per finding kind: TP (row gold unsupported_done) and FP (any other gold) among rows where the
    cross-check emitted that kind, regardless of whether the kind blocks."""
    out = {k: {"tp": 0, "fp": 0} for k in FINDING_KINDS}
    for row in rows:
        if claim_strength(row["text"]) < CLAIM_MIN:
            continue
        gold = row["label"] == "unsupported_done"
        for kind in {k for k, _m in crosscheck_kinds(row["text"], row_tools(row))}:
            out[kind]["tp" if gold else "fp"] += 1
    return out


def _print_kind_table(rows: list[dict]) -> None:
    dev = kind_metrics([r for r in rows if r["split"] == "dev"])
    test = kind_metrics([r for r in rows if r["split"] == "test"])
    print(f"== per-kind precision (blocking when dev precision >= {BLOCKING_MIN_PRECISION}; selected on dev, reported on test)")
    print(f"   {'kind':<24}{'tier':<10}{'dev TP':>7}{'dev FP':>7}{'dev P':>7}{'test TP':>9}{'test FP':>8}{'test P':>8}")
    for kind in FINDING_KINDS:
        d, t = dev[kind], test[kind]
        dp = d["tp"] / (d["tp"] + d["fp"]) if d["tp"] + d["fp"] else None
        tp_ = t["tp"] / (t["tp"] + t["fp"]) if t["tp"] + t["fp"] else None
        tier = "blocking" if kind in BLOCKING_KINDS else "advisory"
        print(
            f"   {kind:<24}{tier:<10}{d['tp']:>7}{d['fp']:>7}{_fmt(dp):>7}{t['tp']:>9}{t['fp']:>8}{_fmt(tp_):>8}"
        )


def _print_blocking(title: str, b: dict) -> None:
    print(
        f"== {title}  n={b['n']}  TP={b['tp']} FP={b['fp']} FN={b['fn']}"
        f"  precision={_fmt(b['precision'])} recall={_fmt(b['recall'])}"
    )


def _fmt(x) -> str:
    return "n/a" if x is None else f"{x:.3f}"


def _print_metrics(title: str, m: dict) -> None:
    print(f"== {title}  n={m['n']}  TP={m['tp']} FP={m['fp']} FN={m['fn']}")
    print(
        f"   precision={_fmt(m['precision'])} recall={_fmt(m['recall'])} f1={_fmt(m['f1'])}"
    )
    print("   confusion (rows=gold, cols=predicted):")
    print("   " + " " * 18 + "".join(f"{p:>18}" for p in LABELS))
    for g in LABELS:
        print("   " + f"{g:<18}" + "".join(f"{m['matrix'][g][p]:>18}" for p in LABELS))


def _latency(max_files: int) -> None:
    import glob
    import statistics
    import time

    rows = load_corpus()
    ts = []
    for row in rows:
        t0 = time.perf_counter()
        analyze(row["text"], row_tools(row))
        ts.append((time.perf_counter() - t0) * 1000)
    ts.sort()
    print(
        f"analyze() over {len(ts)} corpus rows (ms): p50={statistics.median(ts):.2f} p95={ts[int(len(ts) * 0.95) - 1]:.2f} max={ts[-1]:.2f}"
    )
    files = glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl"))[:max_files]
    tt = []
    for path in files:
        t0 = time.perf_counter()
        tools_from_transcript(path)
        tt.append((time.perf_counter() - t0) * 1000)
    if tt:
        tt.sort()
        print(
            f"tools_from_transcript() tail {TAIL_BYTES} B over {len(tt)} real transcripts (ms): "
            f"p50={statistics.median(tt):.2f} p95={tt[int(len(tt) * 0.95) - 1]:.2f} max={tt[-1]:.2f}"
        )
        both = sorted(
            a + b for a, b in zip(sorted(tt), ts * (len(tt) // max(len(ts), 1) + 1))
        )
        print(
            f"added hook latency, tail parse + analyze (ms), pairwise upper bound: p50={statistics.median(both):.2f} p95={both[int(len(both) * 0.95) - 1]:.2f}"
        )


def main(argv: list[str]) -> int:
    args = list(argv)
    if "--text" in args:
        print(json.dumps(analyze(args[args.index("--text") + 1]), indent=2))
        return 0
    if "--resplit" in args:
        resplit_corpus()
        return 0
    if "--latency" in args:
        n = int(args[args.index("--max-files") + 1]) if "--max-files" in args else 200
        _latency(n)
        return 0
    if "--eval" not in args:
        # Also reached when the file is run as a hook with a payload on stdin: exit 0, no output.
        sys.stderr.write((__doc__ or "").split("CLI:")[-1].strip() + "\n")
        return 0
    split = args[args.index("--split") + 1] if "--split" in args else "all"
    source = args[args.index("--source") + 1] if "--source" in args else None
    rows = [r for r in load_corpus() if split in ("all", r["split"])]
    if "--json" in args:
        out = {"split": split, "threshold": UNSUPPORTED_MIN}
        for src in ("real", "seeded", None):
            sub = [r for r in rows if src is None or r["source"] == src]
            out[src or "all"] = metrics(sub)
            out[(src or "all") + "_blocking"] = blocking_metrics(sub)
        out["text_only_all"] = metrics(rows, use_tools=False)
        print(json.dumps(out, indent=2))
        return 0
    print(
        f"done_claim eval: split={split} threshold={UNSUPPORTED_MIN} claim_min={CLAIM_MIN} corpus={len(rows)} rows"
    )
    for src in ("real", "seeded", None):
        if source and src != source:
            continue
        sub = [r for r in rows if src is None or r["source"] == src]
        _print_metrics(
            f"{src or 'all'} rows (with transcript cross-check)", metrics(sub)
        )
        _print_blocking(f"{src or 'all'} rows, blocking path (findings)", blocking_metrics(sub))
    _print_metrics(
        "all rows, TEXT ONLY (no transcript)", metrics(rows, use_tools=False)
    )
    _print_kind_table(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
