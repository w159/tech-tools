#!/usr/bin/env python3
"""Local System One choice for prompts the regex leaves ambiguous.

Posts one choice question to a loopback /v1/systemone endpoint. The default
is Ollama on 127.0.0.1:11434 with the nimble model. The timeout is 4 seconds
so a cold model load (about 3 seconds on the machine this was measured on)
can answer; a warm call is well under a second. A timeout, a connection
error, or a low-confidence answer returns None so the caller keeps the regex
result. This module never calls https://api.typesafe.ai. Session scoring uses
typesafe_client for that host, and only when TYPESAFE_API_KEY is set.

ATLAS_DECISION_URL must name a loopback host (127.0.0.0/8, ::1, localhost); the
prompt text (first 4000 chars) is sent there, so any other host is refused and
the regex result is kept. Set ATLAS_DECISION_ALLOW_REMOTE=1 to opt in to a
non-loopback endpoint.

Criteria values are strings. Local nimble rejects the object form
({definition, includes}) that the hosted API accepts.
"""

from __future__ import annotations

import json
import os
import re


class _LazyUrllib:
    """urllib.request pulls http.client, email and ssl (~14 ms) and only the optional systemone/ollama call
    uses it: the first access imports the submodule. Kept as a module attribute named `urllib` so callers and
    tests address it as before; prompt_optimizer_core reuses this instance."""

    @property
    def request(self):
        import urllib.request

        return urllib.request

    @property
    def error(self):
        import urllib.error

        return urllib.error

    @property
    def parse(self):
        import urllib.parse

        return urllib.parse


urllib = _LazyUrllib()

CONFIDENCE_MIN = 0.7
PROMOTE_CONFIDENCE = 0.9
PROMOTE_CLASSES = frozenset({"code_change", "investigation"})
# A regex miss is promoted only when the prompt also names an engineering
# object. Otherwise "what does this acronym mean" is an investigation and
# would arm an orchestration run.
_ENGINEERING_HINT = re.compile(
    r"\b(?:hook|gate|function|class|test|api|bug|error|module|schema|"
    r"regex|pytest|commit|sql|endpoint|handler)\b"
    r"|\.[a-z]{1,4}\b",
    re.IGNORECASE,
)
DEFAULT_URL = "http://127.0.0.1:11434"
TIMEOUT_S = 4.0

PROMPT_CLASS = {
    "type": "choice",
    "instructions": "Which class is this user prompt?",
    "criteria": {
        "defect": "A failure is being reported, such as a stack trace, exception, or failing command.",
        "code_change": "Named code, a schema, or config should be modified.",
        "investigation": "Explain, review, or audit existing behavior. No edit is requested.",
        "conversation": "No code and no failure. Chores, food, decor, and acknowledgements.",
    },
}


def _is_loopback(url: str) -> bool:
    import ipaddress

    try:
        host = urllib.parse.urlsplit(url).hostname
    except ValueError:
        return False
    if not host:
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def decision_url() -> str | None:
    """Explicit ATLAS_DECISION_URL (loopback only unless ATLAS_DECISION_ALLOW_REMOTE=1),
    else loopback default, else None when disabled."""
    explicit = os.environ.get("ATLAS_DECISION_URL", "").strip()
    if explicit:
        if (
            not _is_loopback(explicit)
            and os.environ.get("ATLAS_DECISION_ALLOW_REMOTE", "").strip() != "1"
        ):
            return None
        base = explicit.rstrip("/")
        # A pasted full endpoint works too: the path is appended once in local_decision().
        if base.lower().endswith("/v1/systemone"):
            base = base[: -len("/v1/systemone")].rstrip("/")
        return base
    if os.environ.get("ATLAS_DECISION", "on").strip().lower() == "off":
        return None
    return DEFAULT_URL


def ask(state: str, questions: dict, timeout: float = TIMEOUT_S) -> dict | None:
    """POST one request carrying `questions` about `state` and return the `answers` dict, or None.

    The shared transport for every decision call: loopback guard (decision_url), lazy urllib, and
    fail-open (a refused connection, a timeout, a non-JSON or malformed body all return None, never
    raise). Several questions belong in ONE call so a hook pays one round trip."""
    base = decision_url()
    if not base or not questions:
        return None
    model = os.environ.get("ATLAS_DECISION_MODEL", "nimble").strip() or "nimble"
    try:
        body = json.dumps(
            {"model": model, "state": state, "questions": questions}
        ).encode("utf-8")
        req = urllib.request.Request(
            base + "/v1/systemone",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    answers = payload.get("answers")
    return answers if isinstance(answers, dict) else None


def choice_of(answers: dict | None, qid: str) -> tuple[str, float] | None:
    """(choice, confidence) of choice question `qid`, or None when absent or malformed."""
    answer = (answers or {}).get(qid)
    if not isinstance(answer, dict):
        return None
    choice, confidence = answer.get("choice"), answer.get("confidence")
    if not isinstance(choice, str) or not isinstance(confidence, (int, float)):
        return None
    return choice, float(confidence)


def noul_of(answers: dict | None, qid: str) -> float | None:
    """Probability of noul question `qid` (0..1), or None when absent or malformed."""
    answer = (answers or {}).get(qid)
    value = answer.get("noul") if isinstance(answer, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return min(1.0, max(0.0, float(value)))


# One-line class descriptions for the routing question. The class NAMES come from
# contracts/scope-matrix.json at call time; a class added there without a line here still gets a
# generic description, so the question never lists a class the resolver cannot route.
_CLASS_HELP = {
    "implement": "Build or change behavior: a feature, a refactor, a rename, new code.",
    "fix": "Repair a reported defect, crash, failing test or wrong output.",
    "verify": "Run checks and confirm that finished work holds. No new code.",
    "audit": "Read-only review, investigation or research of existing code. No edits.",
    "docs": "Write or update documentation, a README or a changelog.",
    "db": "Change a database schema, migration or query.",
    "ui-test": "Drive a user interface in a browser and report what breaks.",
    "test": "Write or update automated tests.",
    "db-audit": "Read-only review of a live database schema or privileges.",
}
EFFORT_QUESTION = {
    "type": "choice",
    "instructions": "How much work is this request?",
    "criteria": {
        "low": "One small change in one place.",
        "medium": "A few related changes or a few files.",
        "high": "Many files, a whole subsystem, or several separate jobs.",
    },
}
_MATRIX_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "contracts", "scope-matrix.json"
)


def scope_classes() -> list[str]:
    """Routable class names, read from the scope matrix. Empty when it cannot be read."""
    try:
        with open(_MATRIX_PATH, encoding="utf-8") as fh:
            return list((json.load(fh).get("classes") or {}).keys())
    except (OSError, ValueError):
        return []


def task_class_question(classes: list[str] | None = None) -> dict | None:
    names = scope_classes() if classes is None else classes
    if not names:
        return None
    return {
        "type": "choice",
        "instructions": "Which kind of work does this request ask for? Ignore a kind the user says not to do.",
        "criteria": {c: _CLASS_HELP.get(c, "Work of class %s." % c) for c in names},
    }


_PROMPT_CACHE: dict = {"key": None, "at": 0.0, "answers": None}
_PROMPT_CACHE_TTL_S = 10.0


def reset_cache() -> None:
    _PROMPT_CACHE.update(key=None, at=0.0, answers=None)


def prompt_answers(prompt: str) -> dict | None:
    """Answers for prompt_class, task_class and effort from ONE request.

    Cached for a few seconds per (prompt, endpoint, model), failures included, so the arming band and
    the routing step of the same hook run share a single round trip (and a dead endpoint costs one
    attempt, not two)."""
    import time

    base = decision_url()
    if not base:
        return None
    key = (prompt, base, os.environ.get("ATLAS_DECISION_MODEL", ""))
    now = time.monotonic()
    if _PROMPT_CACHE["key"] == key and now - _PROMPT_CACHE["at"] < _PROMPT_CACHE_TTL_S:
        return _PROMPT_CACHE["answers"]
    questions = {"prompt_class": PROMPT_CLASS, "effort": EFFORT_QUESTION}
    tc = task_class_question()
    if tc:
        questions["task_class"] = tc
    answers = ask(prompt[:4000], questions, TIMEOUT_S)
    _PROMPT_CACHE.update(key=key, at=now, answers=answers)
    return answers


def local_decision(prompt: str) -> tuple[str, float] | None:
    """Return (choice, confidence) or None. None means keep the regex answer."""
    return choice_of(prompt_answers(prompt), "prompt_class")


ROUTE_CONFIDENCE_MIN = 0.8


def route_choice(prompt: str) -> dict:
    """The model's routing answer: {"task_class": str|None, "effort": str|None}, each set only when
    its confidence is at least ROUTE_CONFIDENCE_MIN and the value is valid. Empty values mean
    "use the keyword heuristic"."""
    out: dict = {"task_class": None, "effort": None}
    answers = prompt_answers(prompt)
    picked = choice_of(answers, "task_class")
    if picked and picked[1] >= ROUTE_CONFIDENCE_MIN and picked[0] in scope_classes():
        out["task_class"] = picked[0]
    picked = choice_of(answers, "effort")
    if picked and picked[1] >= ROUTE_CONFIDENCE_MIN and picked[0] in EFFORT_QUESTION["criteria"]:
        out["effort"] = picked[0]
    return out


VERIFY_TIMEOUT_S = 1.5
VERIFY_CLAIMS_MIN = 0.8
VERIFY_OBSERVED_MAX = 0.3
VERIFY_QUESTIONS = {
    "asserts_success": {
        "type": "noul",
        "instructions": "The reply states that the work is done, fixed, or passing.",
        "criteria": {
            "true": "Says done, fixed, passing, or verified.",
            "false": "No success claim, or it says the check was not run.",
        },
    },
    "names_observed_result": {
        "type": "noul",
        "instructions": "The reply quotes a command result, a test count, a file and line, or query rows.",
        "criteria": {
            "true": "Quotes command output, a test count, a file:line, or query rows.",
            "false": "Quotes none of these.",
        },
    },
}


def verify_reply(reply: str) -> tuple[float, float] | None:
    """(claims, observed) noul probabilities for a final reply, from one request within
    VERIFY_TIMEOUT_S, or None (endpoint off, slow, down or malformed)."""
    answers = ask(reply[-4000:], VERIFY_QUESTIONS, VERIFY_TIMEOUT_S)
    claims = noul_of(answers, "asserts_success")
    observed = noul_of(answers, "names_observed_result")
    if claims is None or observed is None:
        return None
    return claims, observed


def apply_verdict(
    regex_yes: bool, verdict: tuple[str, float] | None, prompt: str = ""
) -> bool:
    """Veto on a confident conversation label. Promote a regex miss only when
    the label is a code change or an investigation, confidence is at least 0.9,
    and the prompt names an engineering object.

    A bare defect label does not arm. "The service is down" must not flip an
    orchestration session on by itself. Low confidence keeps the regex answer.
    """
    if not verdict:
        return regex_yes
    choice, confidence = verdict
    if confidence < CONFIDENCE_MIN:
        return regex_yes
    if choice == "conversation":
        return False
    if (
        not regex_yes
        and choice in PROMOTE_CLASSES
        and confidence >= PROMOTE_CONFIDENCE
        and _ENGINEERING_HINT.search(prompt)
    ):
        return True
    return regex_yes
