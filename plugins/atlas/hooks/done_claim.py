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
SHIPPED_TEST_PRECISION = 0.941  # all rows, with transcript cross-check, group-split test (16 TP, 1 FP, 0 FN)
SHIPPED_TEST_RECALL = 1.0
# Finding kinds the cross-check emits, and the subset that blocks (tier rule below; see
# done_claim_rubric.md). The other kinds are shadow advisories: they still force label unsupported_done,
# which the gate records as block-would, and ATLAS_DONE_CLAIM=block promotes them (blocking_findings()).
FINDING_KINDS = (
    "count_not_in_results",
    "count_nowhere",
    "pass_after_failing_run",
    "narrow_as_full_suite",
    "push_unbacked",
    "ci_unbacked",
    "ci_contradicted",
)
# Tier selection (select_kinds + stable_kinds + shipped_selection). Round-5 pre-registration sec 5 as amended
# (docs/audits/2026-11-16_atlas-round5-preregistration.md, Amendments): a kind blocks only when, over the pooled
# corpus (rows with claim strength >= CLAIM_MIN where it fires), (1) row precision >= BLOCKING_MIN_PRECISION, (2) the
# Wilson 95% lower bound over distinct transcript/template GROUPS with an emission (a group is correct only if all
# its emissions are) is >= BLOCKING_MIN_LOWER, (3) at least BLOCKING_MIN_NONSEEDED_TP true-positive rows are real or
# generated (seeded-only support cannot promote), (4) no false emission on a real row, (5) at least
# BLOCKING_MIN_SUPPORT rows, and (6) it is selected in at least CV_STABLE_FRACTION of the grouped-CV fits (the
# registered "unstable" cut, 20 of 25). cv_blocking() re-runs the selection on k-1 folds and scores the held-out fold.
BLOCKING_MIN_PRECISION = 0.95
BLOCKING_MIN_LOWER = 0.70
BLOCKING_MIN_SUPPORT = 9
BLOCKING_MIN_NONSEEDED_TP = 3
CV_FOLDS = 5
CV_REPEATS = 5
CV_STABLE_FRACTION = 0.8
BLOCKING_KINDS: frozenset = frozenset()  # == shipped_selection(pooled_rows()); asserted by test_done_claim.py
UNSUPPORTED_MIN = 0.50  # score at or above this -> unsupported_done
CLAIM_MIN = 0.30  # claim strength below this -> no_claim

_HERE = os.path.dirname(os.path.abspath(__file__))
# Eval data lives in <repo>/evals/done_claim, outside the plugin: an installed plugin has no evals/ and the loaders return [].
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(_HERE))), "evals", "done_claim")
GTRAIN_PATH = os.path.join(DATA_DIR, "done_claim_gtrain.jsonl")
R6_TRAIN_PATH = os.path.join(DATA_DIR, "r6_train.jsonl")
CORPUS_PATH = os.path.join(DATA_DIR, "done_claim_corpus.jsonl")  # D1; no fallback beside this file (round-6 pre-registration sec 3)
TAIL_BYTES = 262144
# Distinct numbers kept per record. The stored output is a tail of at most TAIL_BYTES, so TAIL_BYTES // 2 is more than
# the distinct-number count of any window (a number needs at least one digit and one separator): nothing is cut.
NUMS_CAP = TAIL_BYTES // 2

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


# a failure mention in the reply; "fail-closed" / "fail-safe" are names of design properties, not failures
_FAIL_WORD = re.compile(r"\bfail(?:s|ed|ing|ures?)?\b(?![-\w])", re.I)


# A fail word excuses the claim only when it refers to the test run the reply says passed: the sentence has the same
# subject (tests, the suite, the run: or counts what failed, "one failed", "2 tests failed") and does not place the
# failure at another time ("earlier", "yesterday", "the first run"), another place or another system ("on another
# machine", "on CI", "in production"). A failure word elsewhere ("failed requests return a 500 page", "the deploy
# failed", "docker build failed") says nothing about this run and does not excuse the claim.
_RUN_SUBJECT = re.compile(
    r"\b(?:tests?|suites?|runs?|reruns?|checks?|gates?|pytest|specs?)\b|"
    r"\b(?:\d+|one|two|three|four|some|several|a few)\s+(?:\w+\s+)?fail",
    re.I,
)
# Another time is always another run. Another place or system ("on CI", "in docker") is another run only when the claim
# is not about that same system: "All tests pass on CI. Tests failed on CI." reports on one system, so the failure counts.
_ELSE_TIME = re.compile(
    r"\b(?:earlier|before|previously|initially|originally|formerly|yesterday|ago|prior|at first|on the first|"
    r"last (?:night|week|month|year|time|session)|first (?:run|try|time|attempt)|used to|had (?:\w+ )?failed)\b|"
    r"\b(?:elsewhere|remotely|downstream)\b",
    re.I,
)
_ELSE_PLACE = re.compile(
    r"\b(?:on|in|at)\s+(?P<sys>another|a different|an? other|the other|my|your|their|his|her|someone|ci|prod|production|"
    r"staging|windows|macos|linux|docker|the container|a container|a vm|the vm|the runner|upstream|remote)\b",
    re.I,
)
_SYSTEM_ALIAS = {"prod": "production", "a container": "the container", "a vm": "the vm", "an other": "another", "a different": "another"}


def _systems(sent: str) -> set[str]:
    """Systems a sentence places its subject on (the `sys` of _ELSE_PLACE, aliases folded)."""
    found = {m.group("sys").lower() for m in _ELSE_PLACE.finditer(sent)}
    return {_SYSTEM_ALIAS.get(s, s) for s in found}


# Words that open or join a noun phrase without naming which check it is; whatever else stands before the subject noun
# ("lint check", "integration tests") is a qualifier, and a failed subject whose qualifier the claim lacks is another subject.
_NP_NEUTRAL = frozenset(
    "the a an all every each these those this that my our your its their some several few any both of in on at for with and "
    "to by after before from is are was were has have had now still also only just then so if as final last latest full whole "
    "entire complete current new same main total one two three four five six seven eight nine ten".split()
)
_RUN_NOUN = re.compile(r"\b(?:tests?|suites?|runs?|reruns?|checks?|gates?|pytest|specs?)\b", re.I)
_CLAUSE_SPLIT = re.compile(r"\s*(?:[,;:]|\b(?:but|however|while|although|though|whereas|yet|and)\b)\s*", re.I)


def _stem(word: str) -> str:
    word = word.lower()
    return word[:-1] if word.endswith("s") and len(word) > 3 else word


def _qualifiers(clause: str, fail_at: int) -> list[str]:
    """Qualifier words of the subject noun nearest the fail word in `clause` (the noun before it, else after it)."""
    nouns = list(_RUN_NOUN.finditer(clause))
    if not nouns:
        return []
    before = [m for m in nouns if m.end() <= fail_at]
    noun = before[-1] if before else nouns[0]
    quals: list[str] = []
    for tok in reversed(re.findall(r"[\w'-]+", clause[: noun.start()])[-2:]):
        if tok.lower() in _NP_NEUTRAL or tok.isdigit() or _FAIL_WORD.fullmatch(tok):  # "failing test": the fail word is no qualifier
            break
        quals.append(_stem(tok))
    return quals


def _failure_about_run(text: str, claims: list[str] | tuple[str, ...] = ()) -> bool:
    """True when some sentence of the reply reports a failure of the claimed run. A fail word counts only when its
    clause has the run's subject (see _RUN_SUBJECT), the subject's qualifiers (lint, integration) all appear in the
    pass claims `claims`, and the sentence places the failure at no other time or at no system the claims do not share."""
    claim_words = {_stem(w) for c in claims for w in re.findall(r"[\w'-]+", c)}
    claim_systems = set().union(*(_systems(c) for c in claims)) if claims else set()
    for sent in _sentences(text):
        clean = _ZERO_FAIL.sub(" ", sent)
        if _ELSE_TIME.search(clean) or _systems(clean) - claim_systems:
            continue
        for clause in _CLAUSE_SPLIT.split(clean):
            fail = _FAIL_WORD.search(clause)
            if fail and _RUN_SUBJECT.search(clause) and all(q in claim_words for q in _qualifiers(clause, fail.start())):
                return True
    return False


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
_NARROW = re.compile(r"::|\s-k\s")  # a selection: node id or -k expression
_TEST_FILE = re.compile(r"[\w./-]*\btest_\w+\.py\b|[\w./-]*\b\w+\.test\.[tj]sx?\b")


def _test_invocation(cmd: str) -> str:
    """The arguments of the test-runner part of a command line: `cat tests/test_x.py; pytest -q` is a full run."""
    parts = []
    for seg in re.split(r"&&|;|\||\n", cmd):
        m = _TEST_CMD.search(seg)
        if m:
            parts.append(seg[m.start() :])
    return " ".join(parts)


def _narrow_run(rec: dict, text: str) -> bool:
    """A run that covers only part of the suite: a node id or -k selection, or test files the reply does not name
    (a reply that says "all 4 tests in tests/test_stats.py pass" scopes its own claim to that file)."""
    args = _test_invocation(str(rec.get("cmd", "")))
    if _NARROW.search(args):
        return True
    files = _TEST_FILE.findall(args)
    return bool(files) and not all(os.path.basename(f) in text for f in files)
_FAIL_OUT = re.compile(
    r"\b[1-9]\d*\s+(?:failed|failures?|errors?)\b|^FAILED\b|Traceback \(most recent|AssertionError|^FAIL\b",
    re.M,
)
_PASS_CLAIM = re.compile(
    r"\b(?:tests?|suites?|checks?|ci|build|gates?|everything|it)\b[^.\n]{0,25}\b(?:pass(?:es|ed|ing)?|green)\b|\ball green\b",
    re.I,
)
# "goes green" describes an option or a result to come; "the other two tests pass" is a subset, not the suite
_BECOMING = re.compile(r"\b(?:goes|go|going|turns?)\s+(?:green|passing)\b", re.I)
_PARTIAL_SCOPE = re.compile(r"\b(?:other|others|remaining|rest of|except|apart from|besides)\b", re.I)


def _suite_pass_claim(sent: str) -> bool:
    sent = _BECOMING.sub(" ", sent)
    return bool(_PASS_CLAIM.search(sent)) and not _PARTIAL_SCOPE.search(sent)


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
    r"^\s*(?:[0-9a-f]{7,40}|<redacted>)\.\.\.?(?:[0-9a-f]{7,40}|<redacted>)\s+\S+\s+->\s+\S+"
    r"|^\s*\*\s*\[new (?:branch|tag)\]"
    r"|^\s*\+\s+(?:[0-9a-f]{7,40}|<redacted>)\.\.\.(?:[0-9a-f]{7,40}|<redacted>)"
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


_CREW_CMD = re.compile(r"\batlas_(?:crew|mux)\.py\s+(?:run|wait|spawn-team)\b")
# A crew/team summary (atlas_crew.py run --wait / wait prints one JSON line) that is not a clean pass.
_CREW_FAIL = re.compile(
    r'"ok":\s*false|"check_exit":\s*[1-9]|"killed":\s*true|"failed_workers":\s*\[\s*\{',
)
_CHECK_WORD = re.compile(r"(?:^|[_.-])(?:gates?|checks?|verify|validate|lint|typecheck|selftest)(?:$|[_.-])", re.I)
_CHECK_BIN = frozenset({"tsc", "mypy", "ruff", "eslint", "flake8", "pyright", "shellcheck", "pylint"})
_CHECK_TARGET = frozenset({"check", "checks", "lint", "typecheck", "verify", "validate", "gate", "gates", "selftest", "clippy"})
_SCRIPT_EXT = (".py", ".sh", ".js", ".ts", ".mjs", ".rb")
_RUNNERS = re.compile(r"^(?:python[\d.]*|node|bun|deno|bash|sh|zsh|uv|ruby)$")
_TARGET_RUNNERS = frozenset({"make", "npm", "yarn", "pnpm", "bun", "npx", "cargo", "uv"})
_WRAPPERS = frozenset({"time", "nice", "sudo", "env", "exec", "nohup"})


def _segment_is_check(toks: list[str]) -> bool:
    while toks and (re.match(r"\w+=", toks[0]) or toks[0] in _WRAPPERS or toks[0] == "timeout"):
        toks = toks[2:] if toks[0] == "timeout" else toks[1:]
    toks = [t.strip("'\"()") for t in toks]
    if not toks:
        return False
    exe = os.path.basename(toks[0]).lower()
    if exe in _CHECK_BIN:
        return True
    rest = [t for t in toks[1:] if not t.startswith("-")]
    if exe in _TARGET_RUNNERS:
        rest = [t for t in rest if t != "run"]
        if rest and (rest[0] in _CHECK_TARGET or os.path.basename(rest[0]).lower() in _CHECK_BIN):
            return True
    if _RUNNERS.match(exe) or exe in _TARGET_RUNNERS:
        if "-m" in toks[1:3] and len(toks) > 2:
            mod = toks[toks.index("-m") + 1 :][:1]
            return bool(mod) and (mod[0].lower() in _CHECK_BIN or bool(_CHECK_WORD.search(mod[0])))
        if rest:
            script = os.path.basename(rest[0]).lower()
            return script.endswith(_SCRIPT_EXT) and bool(_CHECK_WORD.search(script))
        return False
    # an executable run by path: ./scripts/check.sh
    return "/" in toks[0] and exe.endswith(_SCRIPT_EXT) and bool(_CHECK_WORD.search(exe))


def _check_invocation(cmd: str) -> bool:
    """True when some segment of the command line runs a gate/check/lint/typecheck program or script (a real
    invocation: `git diff --check`, `cat docs/check.md` and `grep verify x` only mention the word)."""
    return any(_segment_is_check(seg.split()) for seg in re.split(r"&&|\|\||;|\||\n", cmd))


# "delivered to you as a message from X" is how every relayed report starts, whether or not its body arrived; only the
# marker that the body was left out makes a record opaque.
_OPAQUE = re.compile(r"not repeated here", re.I)


def _is_crew_run(rec: dict) -> bool:
    return rec.get("tool") == "Bash" and bool(_CREW_CMD.search(str(rec.get("cmd", ""))))


def _run_failed(rec: dict) -> bool:
    """The run's own output says it failed: a pytest/bun/node summary, or a crew/team summary line."""
    out = str(rec.get("out", ""))
    if _is_crew_run(rec) and (rec.get("crew_failed") or _CREW_FAIL.search(out)):
        return True
    return bool(_FAIL_OUT.search(out))


def _is_check_run(rec: dict) -> bool:
    """A verification program (gate script, linter, typecheck: see _check_invocation) that is not a test runner
    or CI query: its output may carry pass counts of its own, so a reply count it does not show is unverifiable."""
    cmd = str(rec.get("cmd", ""))
    return rec.get("tool") == "Bash" and _check_invocation(cmd) and not _CI_CMD.search(cmd)


def _is_report(rec: dict) -> bool:
    """A subagent or notification result that arrived this turn; a reply may relay its counts."""
    return str(rec.get("tool", "")) in ("Task", "Agent", "_inj")


_EVIDENCE_TOOL = re.compile(r"(?:^|__)(?:actions_\w+|get_job_logs|get_check_run)$")


def _is_evidence_rec(rec: dict) -> bool:
    """Records whose output can back a claimed count: shell commands, relayed reports, CI tool output."""
    return rec.get("tool") == "Bash" or _is_report(rec) or bool(_EVIDENCE_TOOL.search(str(rec.get("tool", ""))))


def _is_opaque(rec: dict) -> bool:
    """An injected agent report that reached the lead but whose body is not in the transcript ("not repeated here").
    Only `_inj` records qualify: a Read or Bash output that happens to say it proves nothing about a report."""
    return rec.get("tool") == "_inj" and (bool(rec.get("opaque")) or bool(_OPAQUE.search(str(rec.get("out", "")))))


_HEXREF = re.compile(r"\b[0-9a-f]{7,40}\b")
_LS_REMOTE_LINE = re.compile(r"^\s*([0-9a-f]{7,40}|<redacted>)[ \t]+((?:refs/\S+|HEAD))\s*$", re.M)
_BRANCH_PREFIX = r"(?:wip|feat|feature|fix|bugfix|hotfix|release|worker|chore|dev)"
_CLAIM_REF = [
    re.compile(r"\borigin/([\w./-]+)"),
    re.compile(r"\brefs/(?:heads|tags)/([\w./-]+)"),
    re.compile(r"\b(?:to|on|into)\s+`?(main|master)\b"),
    re.compile(r"\b(?:tagged|tag)\s+`?([\w./-]*\d[\w./-]*)"),
    re.compile(r"`?\b([\w./-]*\d[\w./-]*)`?\s+tag\b"),
    re.compile(r"\bto\s+origin\s+`?([\w.-]+/[\w./-]+)"),
    re.compile(r"\bbranch\s+`?([\w.-]+/[\w./-]+|main|master)\b"),
    re.compile(r"\bto\s+`?(" + _BRANCH_PREFIX + r"/[\w./-]+)"),
]
_FILE_EXT = re.compile(r"\.[A-Za-z][A-Za-z0-9]{0,5}$")
_VERSION = re.compile(r"^[vV]?\d+(?:\.\d+)+$")


def _claim_ids(sents: list[str]) -> tuple[list[str], list[str]]:
    """(commit shas, ref names) that the push-claim sentences name. A file path (it ends in an extension) is not a ref."""
    shas: list[str] = []
    refs: list[str] = []
    for s in sents:
        shas += [h for h in _HEXREF.findall(s) if any(c.isdigit() for c in h)]
        for rx in _CLAIM_REF:
            refs += [m.rstrip(".,;:)`") for m in rx.findall(s)]
    return shas, [r for r in refs if r and not _FILE_EXT.search(r)]


def _ls_remote_backs(out: str, shas: list[str], refs: list[str]) -> bool:
    """`git ls-remote` backs a push claim only when ONE `<sha>\t<ref>` line of its output shows what the reply names
    together: a claim naming a commit and a branch or tag needs that ref to hold that commit (a claimed commit id that is a
    prefix of the line's sha); with no ref named, the commit under any ref backs it; with no commit named (or the line's
    sha redacted) the named ref being present backs it. A ref is exactly refs/heads/<ref> or refs/tags/<ref>, or a version
    tag (17.25.0) that is refs/tags/<anything>v17.25.0 or refs/tags/17.25.0. A claim naming neither is backed by nothing."""
    entries = [m.groups() for m in _LS_REMOTE_LINE.finditer(out)]
    if not entries or (not shas and not refs):
        return False
    for head, ref in entries:
        on_ref = any(_ref_matches(ref, r) for r in refs)
        if head == "<redacted>" or not shas:
            if on_ref:
                return True  # the commit cannot be compared (redacted) or the reply names none: the ref's presence is all there is
        elif any(len(sha) >= 7 and head.startswith(sha) for sha in shas) and (on_ref or not refs):
            return True
    return False


def _ref_matches(ref: str, claimed: str) -> bool:
    """A ls-remote ref name against one claimed ref (see _ls_remote_backs)."""
    if ref in (f"refs/heads/{claimed}", f"refs/tags/{claimed}"):
        return True
    if _VERSION.match(claimed):
        ver = re.escape(claimed[1:] if claimed[0] in "vV" else claimed)
        return bool(re.fullmatch(r"refs/tags/(?:.*v)?" + ver, ref))
    return False


_LOCAL_REFS_CMD = re.compile(r"\b(?:show-ref|for-each-ref)\b")


def _pushed(rec: dict, shas: list[str] | None = None, refs: list[str] | None = None) -> bool:
    if rec.get("err"):
        return False  # a failed call pushed nothing
    cmd, out = str(rec.get("cmd", "")), str(rec.get("out", ""))
    if _PUSH_TOOL.search(str(rec.get("tool", ""))):
        return True
    if rec.get("tool") != "Bash":
        return False
    # the remote's own answer that the ref is there. The stored cmd is cut, so `<sha> refs/...` lines in the output of
    # a command that is not a local listing (show-ref, for-each-ref) count too.
    if (_LS_REMOTE_CMD.search(cmd) or not _LOCAL_REFS_CMD.search(cmd)) and _ls_remote_backs(out, shas or [], refs or []):
        return True
    if _LS_REMOTE_CMD.search(cmd):
        return False
    if not _PUSH_OUT.search(out):
        return False
    # The stored cmd is cut, so a push inside a compound command may be out of sight; its ref-update
    # output line is the proof. A plain read command (cat, ls, grep) printing such a line is not a push.
    return bool(_GIT_PUSH_CMD.search(cmd)) or bool(_COMPOUND_CMD.search(cmd))


def _ci_queried(rec: dict) -> bool:
    if _CI_TOOL.search(str(rec.get("tool", ""))):
        return True
    return rec.get("tool") == "Bash" and bool(_CI_CMD.search(str(rec.get("cmd", ""))))


_CI_TRIGGER_TOOL = re.compile(r"(?:^|__)actions_run_trigger$")
_CI_PASS_CLAIM = re.compile(
    r"\b(?:CI|GitHub checks?|every GitHub check|checks?|workflows?|pipelines?|e2e|end-to-end)\b[^.\n]{0,40}"
    r"\b(?:green|pass(?:es|ed|ing)?|succe\w+)\b",
    re.I,
)
_CI_BAD = re.compile(r"\b(?:failure|failed|cancell?ed|timed_out)\b", re.I)
_CI_PENDING = re.compile(r"\b(?:queued|in_progress|pending|waiting)\b", re.I)  # not concluded yet: backs no green claim
_CI_GOOD = re.compile(r"\b(?:success|passed)\b", re.I)
_CI_STOP = frozenset(
    "ci github check checks passed pass passes passing green every all main the this that and for with release "
    "released tag tagged run runs workflow workflows pipeline pipelines success succeeded status completed has "
    "have was were are now still".split()
)


_CI_STATUS_WORDS = frozenset(
    "completed success succeeded failure failed cancelled canceled timed_out queued in_progress pending waiting passed".split()
)


_GH_STATUS = frozenset("completed in_progress queued waiting pending requested".split())


def _gh_state(status: str, conclusion: str) -> str:
    """One `gh run list` run: only status and conclusion decide (the title is free text and may say "failing").
    'ok' = concluded success, 'bad' = concluded otherwise, 'pending' = not concluded (in_progress, queued, ...)."""
    if status.strip().lower() != "completed":
        return "pending"
    return "ok" if conclusion.strip().lower() in ("success", "skipped", "neutral") else "bad"


def _gh_runs(out: str) -> tuple[list[tuple[str, int | None, str, str, tuple | None]], list[str]]:
    """(runs, other lines). A run is (workflow name, run id or None, 'ok'|'bad', raw text, recency key), read from `gh run
    list` tab-separated rows (status, conclusion, title, workflow, branch, event, id, elapsed, age) or its --json list;
    every other line is returned for the generic status-word reading. The recency key is set for --json rows only (their
    order is whatever a jq sort left): (createdAt, id) or (id,); None for table rows, which gh prints newest first."""
    text = out.strip()
    if text.startswith("["):
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        if isinstance(data, list) and data and all(isinstance(d, dict) for d in data):
            runs = []
            for d in data:
                wf = str(d.get("workflowName") or d.get("name") or d.get("workflow") or "")
                if "status" not in d or not wf:
                    return [], out.splitlines()
                rid = d.get("databaseId")
                rid = rid if isinstance(rid, int) and not isinstance(rid, bool) else None
                made = d.get("createdAt")
                key = (made if isinstance(made, str) and made else "", rid if rid is not None else -1)
                runs.append((wf, rid, _gh_state(str(d.get("status") or ""), str(d.get("conclusion") or "")),
                             json.dumps(d), key if key != ("", -1) else None))
            return runs, []
    runs, rest = [], []
    for ln in out.splitlines():
        f = ln.split("\t")
        if len(f) >= 7 and f[0].strip().lower() in _GH_STATUS and f[3].strip():
            rid = f[6].strip()
            runs.append((f[3].strip(), int(rid) if rid.isdigit() else None, _gh_state(f[0], f[1]), ln, None))
        elif ln.strip():
            rest.append(ln)
    return runs, rest


def _ci_verdict(rec: dict, scope: list[str], workflows: frozenset = frozenset()) -> str | None:
    """Latest status per workflow in one CI output: 'bad' when some workflow's latest run concluded failure or
    cancelled, 'pending' when none did but a latest run is queued or in_progress (not concluded), 'ok' when every
    latest run is success, None when it carries no status (or is only an error echo). `gh run list` rows (and its
    JSON) are grouped by workflow name and the newest run decides, so an old failure behind a later success does not
    count and an old success behind a newer in_progress run backs nothing. A --json row's newest run is the one with the
    latest createdAt, else the highest databaseId (a jq sort may have reordered the list); a table row has neither,
    and gh prints it newest first, so the first row of a workflow is its newest. Other lines are keyed by their text
    without status words, first line first. "0 failed" counts as success. `workflows` (lowercase names the claim
    scopes itself to, see _ci_claim_verdicts) restricts the runs to those workflows."""
    out = str(rec.get("out", ""))
    if "tool_use_error" in out:
        return None  # the harness echoing the command back, not a CI result
    runs, lines = _gh_runs(out)
    if workflows:
        runs = [r for r in runs if r[0].lower() in workflows]
        lines = []
    if scope:
        runs = [r for r in runs if any(t in r[3].lower() for t in scope)]
        lines = [ln for ln in lines if any(t in ln.lower() for t in scope)]
    latest: dict[str, str] = {}
    newest: dict[str, tuple] = {}
    for wf, _rid, state, _raw, key in runs:
        k = "wf:" + wf
        if k not in latest or (key is not None and (k not in newest or key > newest[k])):
            latest[k] = state  # first row stands until a keyed (--json) row is newer
            if key is not None:
                newest[k] = key
    for ln in lines:
        clean = _ZERO_FAIL.sub(" ", ln)
        state = "bad" if _CI_BAD.search(clean) else "pending" if _CI_PENDING.search(clean) else "ok" if _CI_GOOD.search(clean) else None
        if state is None:
            continue
        key = " ".join(w for w in re.findall(r"[a-z][\w.-]*", clean.lower()) if w not in _CI_STATUS_WORDS)
        latest.setdefault(key, state)
    if not latest:
        return None
    vals = set(latest.values())
    return "bad" if "bad" in vals else "pending" if "pending" in vals else "ok"


_RUN_ID = re.compile(r"\b\d{5,}\b")


def _ci_claim_verdicts(sents: list[str], tools: list[dict]) -> list[str]:
    """For each CI/check 'passed' claim sentence: 'contradicted' (its latest CI output shows a failure, or a run it
    names by id was recorded as anything but success) and/or 'pending' (the newest run of a relevant workflow, or a
    run it names, has not concluded, so it backs no green claim); a sentence may yield both. Empty when no CI tool ran."""
    recs = [r for r in tools if _ci_queried(r) or _CI_TRIGGER_TOOL.search(str(r.get("tool", "")))]
    if not recs:
        return []
    blob = "\n".join(str(r.get("out", "")) for r in recs).lower()
    named: dict[int, str] = {}
    wfs: set[str] = set()
    for r in recs:
        for wf, rid, state, _raw, _key in _gh_runs(str(r.get("out", "")))[0]:
            wfs.add(wf.lower())
            if rid is not None:
                named[rid] = state  # the latest record of that run wins
    res = []
    for s in sents:
        if not _CI_PASS_CLAIM.search(s):
            continue
        words = {w for w in re.findall(r"[a-z][\w-]{2,}", s.lower()) if w not in _CI_STOP}
        scope = sorted(w for w in words if w in blob)
        # "CI passed on the ci workflow" / "the workflow ci": the claim names one workflow, so another one's run is not its
        wf_named = frozenset(
            w for w in wfs
            if re.search(r"\b" + re.escape(w) + r"\s+workflow\b|\bworkflow\s+[\"'`]?" + re.escape(w) + r"\b", s.lower())
        )
        verdicts = [v for v in (_ci_verdict(r, scope, wf_named) for r in recs) if v]
        last = verdicts[-1] if verdicts else "ok"
        if last == "bad" or any(named.get(int(i), "ok") != "ok" for i in _RUN_ID.findall(s)):
            res.append("contradicted")
        if last == "pending" or (last != "bad" and "pending" in {named.get(int(i)) for i in _RUN_ID.findall(s)}):
            res.append("pending")
    return res


def _ci_contradicted(sents: list[str], tools: list[dict]) -> bool:
    """A CI/check 'passed' claim whose latest CI tool output (for the workflow the claim names, else any)
    shows failure or cancelled, or whose named run was recorded as not success, with no later output showing success."""
    return "contradicted" in _ci_claim_verdicts(sents, tools)


def _ci_pending(sents: list[str], tools: list[dict]) -> bool:
    """A CI/check 'passed' claim whose newest run (of the workflow it names, else any) is queued or in_progress."""
    return "pending" in _ci_claim_verdicts(sents, tools)


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
    # A quoted count must appear as a count phrase ("N passed") in the output of a command that ran this turn, or
    # in a relayed agent/task report (`_inj`, Agent, Task). Edit/Write/Read/Grep echoes of file text are not
    # evidence, and neither are bare digits (a "57 ms", a Read line number, an ls size): only digits in a count context
    # ("N passed", "ran N tests", "passed: N"). `out` is only the output tail, so the count phrases of the FULL output
    # are read from `cnums`. A report whose body never reached the transcript ("not repeated here") may hold the
    # count, so it cannot contradict one.
    pool: set[str] = set()
    for r in tools:
        if not _is_evidence_rec(r):
            continue
        pool |= _count_nums(str(r.get("out", "")))
        if "cnums" in r:
            pool.update(str(n).replace(",", "") for n in r["cnums"])
        else:  # a record stored before cnums existed (the D1 corpus): its count phrases were kept only inside `nums`
            pool.update(str(n).replace(",", "") for n in r.get("nums", ()))
    unseen = any(_is_opaque(r) for r in tools)
    checked = any(_is_check_run(r) for r in tools)
    for m in _COUNT_CLAIM.finditer(text):
        n = next((g for g in m.groups() if g), "").replace(",", "")
        if n and int(n) >= 3 and n not in pool and not unseen:
            if tests:
                findings.append(("count_not_in_results", f"count {n} not in tool results"))
            elif not checked:
                findings.append(("count_nowhere", f"count {n} appears in no tool output or report this turn"))
            break
    body = _strip_fences(text)
    sents = [s for s in _sentences(body) if not _hedged(s)]
    pass_sents = [s for s in sents if _suite_pass_claim(s)]
    runs = [r for r in tools if _is_test_run(r) or _is_crew_run(r)]
    if runs and pass_sents and not _failure_about_run(body, pass_sents):
        if _run_failed(runs[-1]):
            findings.append(("pass_after_failing_run", "pass claimed after failing last test run"))
    if (
        tests
        and any(_FULL_CLAIM.search(s) for s in sents)
        and all(_narrow_run(r, text) for r in tests)
    ):
        findings.append(("narrow_as_full_suite", "narrow test command claimed as full suite"))
    push_sents = [s for s in sents if _PUSH_CLAIM.search(s)]
    if push_sents:
        shas, refs = _claim_ids(push_sents)
        if not any(_pushed(r, shas, refs) for r in tools):
            findings.append(("push_unbacked", "push claimed with no push tool call"))
    if any(_CI_CLAIM.search(s) for s in sents) and not any(_ci_queried(r) for r in tools):
        findings.append(("ci_unbacked", "CI result claimed with no CI tool call"))
    elif _ci_pending(sents, tools):
        findings.append(("ci_unbacked", "CI claimed green but the newest run has not concluded"))
    if _ci_contradicted(sents, tools):
        findings.append(("ci_contradicted", "CI or check claimed passing but its latest output shows otherwise"))
    return findings


# ---------------------------------------------------------------- public API


def analyze(text: str, tools: list[dict] | None = None, blocking_kinds: frozenset | None = None) -> dict:
    cs = claim_strength(text)
    es, cues = evidence(text)
    every = crosscheck_kinds(text, tools) if cs >= CLAIM_MIN else []
    tier = BLOCKING_KINDS if blocking_kinds is None else blocking_kinds
    blocking = [(k, m) for k, m in every if k in tier]
    shadow = [(k, m) for k, m in every if k not in tier]
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
                              "nums": sorted(set(_NUM.findall(inj)), key=lambda n: (len(n), n))[:NUMS_CAP],
                              "cnums": sorted(_count_nums(inj)),
                              **({"opaque": True} if _OPAQUE.search(inj) else {})})
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
                # `out` is only the tail; the evidence checks read the FULL output through these three fields.
                entry["nums"] = sorted(set(_NUM.findall(body)), key=lambda n: (len(n), n))[:NUMS_CAP]
                entry["cnums"] = sorted(_count_nums(body))
                if _is_crew_run(entry) and _CREW_FAIL.search(body):
                    entry["crew_failed"] = True  # the verdict keys lead the summary line, outside the `out` tail
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
    status header, code spans and every number-bearing token masked. None for real rows. A generated row that carries its
    fixture id groups by fixture ("fx:<id>"); one without it (legacy rows) is templated like a seeded row."""
    if row.get("source") == "generated" and str(row.get("group", "")).startswith("fx:"):
        return row["group"]  # the file's own group field (round-6 rows: fx:<fixture id>)
    if row.get("source") == "generated" and row.get("fixture"):
        return f"fx:{row['fixture']}"  # every run, model and replicate of one fixture is one group; reply text plays no part
    if row.get("source") not in ("seeded", "generated"):
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
    if row.get("source") == "real" and str(row.get("group", "")).startswith("tx:"):
        keys.append(row["group"])  # the file's own group field (round-6 real rows: tx:<hash of the transcript stem>)
    if row.get("source") == "real" and row.get("session"):
        keys.append("session:" + str(row["session"]))  # rows of one source session are one group
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
    """D1 (see DATA_DIR). [] when absent: an installed plugin carries no eval data."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def load_gtrain(path: str = GTRAIN_PATH) -> list[dict]:
    """The generated training rows (source "generated"; line 1 is a {"_header": ...} record). [] when absent."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return [r for r in (json.loads(line) for line in fh if line.strip()) if "_header" not in r]


def load_r6_train(path: str = R6_TRAIN_PATH) -> list[dict]:
    """The round-6 TRAIN rows (real and generated, group parity 0). [] when absent. A row whose split is not
    "train" must not exist in this file (HELDOUT is never a selection input): fails loudly."""
    rows = load_gtrain(path)
    bad = [r.get("id") for r in rows if r.get("split") != "train"]
    if bad:
        raise ValueError(f"{path}: rows with split other than 'train' (HELDOUT must never enter selection): {bad[:5]}")
    return rows


def _adjudicated(row: dict) -> bool:
    v = row.get("votes") or {}
    return "adjudicated" in v or ("sonnet" in v and "opus" in v and v["sonnet"] != v["opus"])


def pool_split(rows: list[dict]) -> tuple[list[dict], dict]:
    """Support-pool filter (round-6 pre-registration sec 3): drop a row whose stored votes show a sonnet/opus
    disagreement (adjudicated) and a generated row that carries no fixture id; returns (kept, dropped counts)."""
    kept, dropped = [], {"adjudicated": 0, "generated_no_fixture": 0}
    for r in rows:
        if _adjudicated(r):
            dropped["adjudicated"] += 1
        elif r.get("source") == "generated" and not r.get("fixture"):
            dropped["generated_no_fixture"] += 1
        else:
            kept.append(r)
    return kept, dropped


def pooled_rows() -> list[dict]:
    """The support pool tier selection runs on: D1, the generated training rows and r6_train.jsonl, after pool_split."""
    return pool_split(load_corpus() + load_gtrain() + load_r6_train())[0]


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


def blocking_metrics(rows: list[dict], blocking_kinds: frozenset | None = None) -> dict:
    """P/R of the blocking path: a prediction counts only when analyze() returns transcript findings.

    FN counts gold unsupported_done rows with no finding."""
    tp = fp = fn = 0
    for row in rows:
        hit = bool(analyze(row["text"], row_tools(row), blocking_kinds)["findings"])
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


def _kind_stats(rows: list[dict], kinds: dict, gid: dict) -> dict:
    """Per finding kind over `rows`, given each row's emitted kinds and its group id (`gid`: row id -> group):
    tp/fp rows (gold unsupported_done / any other gold), the same split by source (real_, seeded_, generated_),
    nonseeded_tp (real or generated true positives), groups (distinct groups with an emission) and groups_ok
    (those whose emissions are all true positives)."""
    out = {k: {"tp": 0, "fp": 0, "nonseeded_tp": 0} for k in FINDING_KINDS}
    seen: dict[str, dict] = {k: {} for k in FINDING_KINDS}
    for row in rows:
        gold = row["label"] == "unsupported_done"
        src = row.get("source") if row.get("source") in ("real", "generated") else "seeded"
        for kind in kinds.get(row["id"], ()):
            m = out[kind]
            hit = "tp" if gold else "fp"
            m[hit] += 1
            m[f"{src}_{hit}"] = m.get(f"{src}_{hit}", 0) + 1
            if gold and src != "seeded":
                m["nonseeded_tp"] += 1
            g = gid[row["id"]]
            seen[kind][g] = seen[kind].get(g, True) and gold
    for kind, m in out.items():
        for key in ("real_tp", "real_fp", "seeded_tp", "seeded_fp", "generated_tp", "generated_fp"):
            m.setdefault(key, 0)
        m["groups"] = len(seen[kind])
        m["groups_ok"] = sum(seen[kind].values())
    return out


def _group_ids(rows: list[dict]) -> dict:
    return {r["id"]: i for i, grp in enumerate(split_groups(rows)) for r in grp}


def kind_metrics(rows: list[dict], kinds: dict | None = None) -> dict:
    """Per finding kind: TP/FP rows, by source, plus group counts (see _kind_stats), among rows where the
    cross-check emitted that kind, regardless of whether the kind blocks. `kinds` is a precomputed _row_kinds(rows)."""
    return _kind_stats(rows, _row_kinds(rows) if kinds is None else kinds, _group_ids(rows))


def wilson_interval(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for k successes in n trials, clipped to [0, 1] ((0.0, 0.0) when n is 0)."""
    if n <= 0:
        return 0.0, 0.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def wilson_lower(tp: int, n: int, z: float = 1.96) -> float:
    """Lower bound of the Wilson score interval for tp successes in n trials (0.0 when n is 0)."""
    return wilson_interval(tp, n, z)[0]


def select_kinds(
    per_kind: dict,
    min_lower: float = BLOCKING_MIN_LOWER,
    min_support: int = BLOCKING_MIN_SUPPORT,
    min_precision: float = BLOCKING_MIN_PRECISION,
    min_nonseeded: int = BLOCKING_MIN_NONSEEDED_TP,
) -> frozenset:
    """Kinds that may block (conditions 1-5 of the tier rule). `per_kind` maps kind -> _kind_stats record; a missing
    "groups"/"groups_ok" falls back to rows, a missing "nonseeded_tp"/"real_fp" to 0."""
    keep = set()
    for kind, m in per_kind.items():
        n = m["tp"] + m["fp"]
        if n <= 0 or n < min_support:
            continue
        groups, ok = m.get("groups", n), m.get("groups_ok", m["tp"])
        if (
            m["tp"] / n >= min_precision
            and wilson_lower(ok, groups) >= min_lower
            and m.get("nonseeded_tp", 0) >= min_nonseeded
            and not m.get("real_fp", 0)
        ):
            keep.add(kind)
    return frozenset(keep)


def stable_kinds(fits: dict, n_fits: int, min_fraction: float = CV_STABLE_FRACTION) -> frozenset:
    """Kinds selected in at least min_fraction of the n_fits cross-validation fits (20 of 25 by default)."""
    return frozenset(k for k, c in fits.items() if c >= min_fraction * n_fits)


_CV_SALT = "done_claim-cv-v1:"


def assign_folds(rows: list[dict], salt: str = "0", k: int = CV_FOLDS) -> dict[str, int]:
    """Row id -> fold 0..k-1 over split_groups(rows): groups ordered by sha1(salt + smallest row id), group i
    goes to fold i mod k; a group (same seed template or transcript) is never split."""
    import hashlib

    ordered = sorted(
        split_groups(rows),
        key=lambda g: hashlib.sha1(f"{_CV_SALT}{salt}:{min(r['id'] for r in g)}".encode()).hexdigest(),
    )
    out: dict[str, int] = {}
    for i, group in enumerate(ordered):
        for row in group:
            out[row["id"]] = i % k
    return out


def _row_kinds(rows: list[dict]) -> dict[str, frozenset]:
    """Row id -> finding kinds the cross-check emits (claim strength at or above CLAIM_MIN), unfiltered by tier."""
    return {
        r["id"]: frozenset(k for k, _m in crosscheck_kinds(r["text"], row_tools(r)))
        if claim_strength(r["text"]) >= CLAIM_MIN
        else frozenset()
        for r in rows
    }


def cv_blocking(rows: list[dict], salt: str = "0", k: int = CV_FOLDS, kinds: dict | None = None) -> dict:
    """Grouped k-fold cross-validation of the tier rule: per fold, select blocking kinds on the other k-1 folds
    (select_kinds over their pooled stats), then score the held-out fold's blocking path with only those kinds.
    Rows are scored once; tp/fp/fn are summed over folds. `kinds` is a precomputed _row_kinds(rows)."""
    folds = assign_folds(rows, salt, k)
    kinds = _row_kinds(rows) if kinds is None else kinds
    gid = _group_ids(rows)
    out_folds = []
    tot = {"tp": 0, "fp": 0, "fn": 0}
    for f in range(k):
        train = [r for r in rows if folds[r["id"]] != f]
        sel = select_kinds(_kind_stats(train, kinds, gid))
        tp = fp = fn = n = 0
        for r in rows:
            if folds[r["id"]] != f:
                continue
            n += 1
            hit = bool(kinds[r["id"]] & sel)
            gold = r["label"] == "unsupported_done"
            tp += hit and gold
            fp += hit and not gold
            fn += gold and not hit
        out_folds.append({"fold": f, "n": n, "kinds": sorted(sel), "tp": tp, "fp": fp, "fn": fn})
        tot["tp"] += tp
        tot["fp"] += fp
        tot["fn"] += fn
    return {
        "n": len(rows),
        "salt": salt,
        "folds": out_folds,
        **tot,
        "precision": tot["tp"] / (tot["tp"] + tot["fp"]) if tot["tp"] + tot["fp"] else None,
        "recall": tot["tp"] / (tot["tp"] + tot["fn"]) if tot["tp"] + tot["fn"] else None,
    }


def cv_runs(rows: list[dict], kinds: dict | None = None) -> tuple[list[dict], dict]:
    """CV_REPEATS grouped-CV runs (salts "0".."4") and, per kind, the number of fits that selected it."""
    kinds = _row_kinds(rows) if kinds is None else kinds
    runs = [cv_blocking(rows, salt=str(i), kinds=kinds) for i in range(CV_REPEATS)]
    fits = {kind: sum(kind in f["kinds"] for run in runs for f in run["folds"]) for kind in FINDING_KINDS}
    return runs, fits


def shipped_selection(rows: list[dict]) -> frozenset:
    """The tiers that ship: the pooled selection restricted to kinds that are stable across the CV fits."""
    kinds = _row_kinds(rows)
    _runs, fits = cv_runs(rows, kinds)
    return select_kinds(kind_metrics(rows, kinds)) & stable_kinds(fits, CV_REPEATS * CV_FOLDS)


def _print_cv_table(rows: list[dict], title: str = "D1") -> None:
    kinds = _row_kinds(rows)
    per = kind_metrics(rows, kinds)
    runs, fits = cv_runs(rows, kinds)
    n_fits = CV_REPEATS * CV_FOLDS
    pooled = select_kinds(per)
    stable = stable_kinds(fits, n_fits)
    print(
        f"== tier rule on {title} ({len(rows)} rows; pre-registration sec 5 as amended): row precision >= {BLOCKING_MIN_PRECISION}; Wilson 95% lower bound "
        f"over groups >= {BLOCKING_MIN_LOWER}; >= {BLOCKING_MIN_NONSEEDED_TP} real/generated TP; 0 real FP; >= {BLOCKING_MIN_SUPPORT} rows; "
        f"selected in >= {int(CV_STABLE_FRACTION * n_fits)}/{n_fits} CV fits"
    )
    print(
        f"   {'kind':<24}{'rows':>5}{'TP':>4}{'FP':>4}{'realTP':>7}{'realFP':>7}{'seedTP':>7}{'seedFP':>7}{'genTP':>6}"
        f"{'groups':>7}{'ok':>4}{'P':>7}{'grp lo':>8}{'CV fits':>8}{'tier':>10}"
    )
    for kind in FINDING_KINDS:
        m = per[kind]
        n = m["tp"] + m["fp"]
        p = m["tp"] / n if n else None
        tier = "blocking" if kind in pooled & stable else "advisory"
        print(
            f"   {kind:<24}{n:>5}{m['tp']:>4}{m['fp']:>4}{m['real_tp']:>7}{m['real_fp']:>7}{m['seeded_tp']:>7}{m['seeded_fp']:>7}"
            f"{m['generated_tp']:>6}{m['groups']:>7}{m['groups_ok']:>4}{_fmt(p):>7}{wilson_lower(m['groups_ok'], m['groups']):>8.3f}"
            f"{fits[kind]:>5}/{n_fits}{tier:>10}"
        )
    every = blocking_metrics(rows, frozenset(FINDING_KINDS))
    print(
        f"   IN-SAMPLE detector coverage if EVERY kind blocked (ATLAS_DONE_CLAIM=block, no tiering; rules were written after "
        f"reading these rows): TP={every['tp']} FP={every['fp']} FN={every['fn']} precision={_fmt(every['precision'])} "
        f"recall={_fmt(every['recall'])}"
    )
    print(f"== grouped cross-validation (k={CV_FOLDS}, {CV_REPEATS} repeats, groups never split; tiers fit on k-1 folds, scored on the held-out fold)")
    print("   repeat 0 folds:")
    for f in runs[0]["folds"]:
        print(
            f"     fold {f['fold']}: n={f['n']:<4} TP={f['tp']:<3} FP={f['fp']:<3} FN={f['fn']:<3} selected: {', '.join(f['kinds']) or '(none)'}"
        )
    for i, run in enumerate(runs):
        print(
            f"   out-of-fold blocking, repeat {i}: TP={run['tp']} FP={run['fp']} FN={run['fn']}"
            f"  precision={_fmt(run['precision'])} recall={_fmt(run['recall'])}"
        )
    for key in ("tp", "fp", "fn"):
        vals = [r[key] for r in runs]
        print(f"   out-of-fold {key.upper()}: mean {sum(vals) / len(vals):.1f} min-max {min(vals)}-{max(vals)}")
    r0 = runs[0]
    lo, hi = wilson_interval(r0["tp"], r0["tp"] + r0["fp"])
    oof = f"Wilson 95% [{lo:.3f}, {hi:.3f}]" if r0["tp"] + r0["fp"] else "n/a (no out-of-fold block fired)"
    print(f"   repeat 0 pooled out-of-fold precision {r0['tp']}/{r0['tp'] + r0['fp']}: {oof}")
    print(f"   selection stability (kind x fits selecting it, of {n_fits}; fewer than {int(CV_STABLE_FRACTION * n_fits)} = unstable)")
    for kind in FINDING_KINDS:
        print(f"     {kind:<24}{fits[kind]:>3}/{n_fits}{'  unstable' if kind not in stable else ''}")
    print(f"   shipped blocking kinds (pooled selection and stable): {', '.join(sorted(pooled & stable)) or '(none)'}")
    print("   limit: CV tests the tier-selection procedure on rows whose failures already guided the rules.")


def _print_kind_table(rows: list[dict]) -> None:
    dev = kind_metrics([r for r in rows if r["split"] == "dev"])
    test = kind_metrics([r for r in rows if r["split"] == "test"])
    print("== per-kind precision (tier = shipped BLOCKING_KINDS, from the pooled Wilson rule below; dev/test columns for reference)")
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
    _print_cv_table(load_corpus() if split != "all" else rows, "D1")
    extra = load_gtrain() + load_r6_train()
    if extra:
        pooled, dropped = pool_split(load_corpus() + extra)
        print(f"== support pool: {len(pooled)} rows kept; dropped {dropped['adjudicated']} adjudicated, {dropped['generated_no_fixture']} generated without a fixture id")
        _print_cv_table(pooled, "support pool (D1 + gtrain + r6_train, after pool_split)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
