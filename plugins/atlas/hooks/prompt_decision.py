#!/usr/bin/env python3
"""Local decision model for prompts the regex leaves ambiguous, routing, and the done-claim check.

Two wire protocols, chosen by ATLAS_DECISION_PROTOCOL (auto, ollama, systemone):

- ollama: stock Ollama on 127.0.0.1:11434. One POST /api/chat with stream=false, temperature 0, keep_alive
  and a JSON-schema `format` that has one property per question (a choice question is
  {"choice": enum, "confidence": 0..1}, a noul question is {"noul": 0..1}); the answer is the JSON string in
  message.content. It is validated strictly (enum member, numbers inside [0, 1], no bools); an answer that
  fails validation is dropped, never treated as confident. Default model llama3.2:3b, ATLAS_DECISION_MODEL
  overrides it.
- systemone: TypeSafe's scoring protocol, POST /v1/systemone with model nimble. Stock Ollama does not
  serve it.
- auto (default): one GET /api/tags per endpoint, cached for 10 minutes (in process and through
  decision-proto.json under ATLAS_HOME, mode 0600). A reply with a "models" list means ollama, anything
  else means systemone.

The timeout is 4 seconds so a cold model load can answer; a warm call is well under a second. A timeout,
a connection error, a malformed answer, or a low-confidence answer returns None so the caller keeps the
regex result. This module never calls https://api.typesafe.ai. Session scoring uses typesafe_client for
that host, and only when TYPESAFE_API_KEY is set.

ATLAS_DECISION_URL must name a loopback host (127.0.0.0/8, ::1, localhost); the
prompt text (first 4000 chars) is sent there, so any other host is refused and
the regex result is kept. Set ATLAS_DECISION_ALLOW_REMOTE=1 to opt in to a
non-loopback endpoint.

Every call bypasses http_proxy, https_proxy and all_proxy (an empty ProxyHandler), so a proxy in the
environment can never carry a prompt or a final reply off the machine. After a refused connection no call
is made for 60 seconds (in process, and through decision-down.json under ATLAS_HOME or ~/.atlas, mode
0600), so a machine without Ollama pays that cost at most once a minute.

Systemone criteria values are strings. Local nimble rejects the object form
({definition, includes}) that the hosted API accepts.
"""

from __future__ import annotations

import http.client
import json
import math
import os
import re
import time


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
        for suffix in ("/v1/systemone", "/api/chat", "/api/tags"):
            if base.lower().endswith(suffix):
                base = base[: -len(suffix)].rstrip("/")
                break
        return base
    if os.environ.get("ATLAS_DECISION", "on").strip().lower() == "off":
        return None
    return DEFAULT_URL


NEG_TTL_S = 60.0
_NEG_MEM: dict = {}  # base url -> time.monotonic() deadline after a refused connection


def _neg_path() -> str:
    base = os.environ.get("ATLAS_HOME") or os.path.join(os.path.expanduser("~"), ".atlas")
    return os.path.join(base, "decision-down.json")


def _neg_active(base: str) -> bool:
    """True while `base` refused a connection within the last NEG_TTL_S seconds (this process, or any
    other through the small file under ATLAS_HOME). A machine without Ollama then pays the refused
    connection at most once a minute."""
    if _NEG_MEM.get(base, 0.0) > time.monotonic():
        return True
    try:
        with open(_neg_path(), encoding="utf-8") as fh:
            rec = json.load(fh)
        until = float(rec["until"])
        if rec.get("base") == base and until > time.time():
            _NEG_MEM[base] = time.monotonic() + (until - time.time())
            return True
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return False


def _neg_arm(base: str) -> None:
    _NEG_MEM[base] = time.monotonic() + NEG_TTL_S
    path = _neg_path()
    tmp = "%s.%d.tmp" % (path, os.getpid())
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"base": base, "until": time.time() + NEG_TTL_S}, fh)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _refused(exc: BaseException) -> bool:
    reason = getattr(exc, "reason", exc)
    return isinstance(reason, ConnectionRefusedError)


def _urlopen(req, timeout: float):
    """Open `req` with NO proxies: the endpoint is loopback, so http_proxy/all_proxy must never carry a
    prompt or a final reply off the machine (urllib would honour them by default)."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(req, timeout=timeout)


OLLAMA_DEFAULT_MODEL = "llama3.2:3b"
SYSTEMONE_DEFAULT_MODEL = "nimble"
PROBE_TTL_S = 600.0
_PROTO_MEM: dict = {}  # base url -> (protocol, time.monotonic() deadline)


def _proto_path() -> str:
    base = os.environ.get("ATLAS_HOME") or os.path.join(os.path.expanduser("~"), ".atlas")
    return os.path.join(base, "decision-proto.json")


def _proto_cached(base: str) -> str | None:
    hit = _PROTO_MEM.get(base)
    if hit and hit[1] > time.monotonic():
        return hit[0]
    try:
        with open(_proto_path(), encoding="utf-8") as fh:
            rec = json.load(fh)
        until = float(rec["until"])
        if rec.get("base") == base and rec.get("protocol") in ("ollama", "systemone") and until > time.time():
            _PROTO_MEM[base] = (rec["protocol"], time.monotonic() + (until - time.time()))
            return rec["protocol"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def _proto_store(base: str, protocol: str) -> None:
    _PROTO_MEM[base] = (protocol, time.monotonic() + PROBE_TTL_S)
    path = _proto_path()
    tmp = "%s.%d.tmp" % (path, os.getpid())
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"base": base, "protocol": protocol, "until": time.time() + PROBE_TTL_S}, fh)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _probe(base: str, timeout: float) -> str | None:
    """'ollama' when GET /api/tags answers a JSON object with a "models" list, else 'systemone'. None (and
    the negative cache armed) when the connection is refused; nothing is cached on a timeout."""
    try:
        req = urllib.request.Request(base + "/api/tags", method="GET")
        with _urlopen(req, min(timeout, 1.0)) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        found = isinstance(payload, dict) and isinstance(payload.get("models"), list)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, http.client.HTTPException) as exc:
        if _refused(exc):
            _neg_arm(base)
            return None
        if isinstance(exc, TimeoutError) or (
            isinstance(exc, urllib.error.URLError) and not isinstance(exc, urllib.error.HTTPError)
        ):
            return "systemone"  # unknown right now: do not cache, try the legacy path this once
        found = False
    protocol = "ollama" if found else "systemone"
    _proto_store(base, protocol)
    return protocol


def protocol_for(base: str, timeout: float = TIMEOUT_S) -> str | None:
    """ATLAS_DECISION_PROTOCOL: 'ollama' or 'systemone' as set, else (auto, the default) the probed one."""
    forced = os.environ.get("ATLAS_DECISION_PROTOCOL", "auto").strip().lower()
    if forced in ("ollama", "systemone"):
        return forced
    return _proto_cached(base) or _probe(base, timeout)


def _ollama_schema(questions: dict) -> dict:
    props: dict = {}
    for qid, q in questions.items():
        if not isinstance(q, dict):
            continue
        if q.get("type") == "choice" and isinstance(q.get("criteria"), dict) and q["criteria"]:
            props[qid] = {
                "type": "object",
                "properties": {
                    "choice": {"type": "string", "enum": list(q["criteria"])},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["choice", "confidence"],
            }
        else:
            props[qid] = {
                "type": "object",
                "properties": {"noul": {"type": "number", "minimum": 0, "maximum": 1}},
                "required": ["noul"],
            }
    return {"type": "object", "properties": props, "required": list(props)}


def _ollama_prompt(state: str, questions: dict) -> list:
    lines = [
        "Answer every question about the text the user sends. Reply with JSON only, matching the schema.",
        "A choice question needs one label and your confidence from 0 to 1.",
        "A noul question needs the probability from 0 to 1 that the statement is true.",
        "",
    ]
    for qid, q in questions.items():
        if not isinstance(q, dict):
            continue
        lines.append("%s: %s" % (qid, q.get("instructions", "")))
        crit = q.get("criteria")
        if isinstance(crit, dict):
            for label, text in crit.items():
                lines.append("  - %s: %s" % (label, text if isinstance(text, str) else ""))
    return [
        {"role": "system", "content": "\n".join(lines)},
        {"role": "user", "content": state},
    ]


def _in_unit(value) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and not math.isnan(value)
        and 0.0 <= value <= 1.0
    )


def _ollama_validate(content, questions: dict) -> dict | None:
    """Strictly parse message.content. Each question that is absent or out of schema is dropped; None
    when nothing valid is left. Numbers must be real numbers inside [0, 1] (no clamping, no bools)."""
    try:
        data = json.loads(content) if isinstance(content, str) else None
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    out: dict = {}
    for qid, q in questions.items():
        ans = data.get(qid)
        if not isinstance(ans, dict) or not isinstance(q, dict):
            continue
        if q.get("type") == "choice" and isinstance(q.get("criteria"), dict):
            label, conf = ans.get("choice"), ans.get("confidence")
            if isinstance(label, str) and label in q["criteria"] and _in_unit(conf):
                out[qid] = {"type": "choice", "choice": label, "confidence": float(conf)}
        elif q.get("type") != "choice":
            if _in_unit(ans.get("noul")):
                out[qid] = {"type": "noul", "noul": float(ans["noul"])}
    return out or None


def ask(state: str, questions: dict, timeout: float = TIMEOUT_S) -> dict | None:
    """POST one request carrying `questions` about `state` and return the `answers` dict, or None.

    The shared transport for every decision call: loopback guard (decision_url), lazy urllib with proxies
    disabled, a 60 s negative cache after a refused connection, and fail-open (a refused connection, a
    timeout, a non-JSON, truncated or malformed HTTP body all return None, never raise). Several questions
    belong in ONE call so a hook pays one round trip. The wire protocol is stock Ollama /api/chat or
    TypeSafe /v1/systemone (see the module docstring); both return {question id: answer}."""
    base = decision_url()
    if not base or not questions:
        return None
    if _neg_active(base):
        return None
    protocol = protocol_for(base, timeout)
    if protocol is None:
        return None
    configured = os.environ.get("ATLAS_DECISION_MODEL", "").strip()
    try:
        if protocol == "ollama":
            body = json.dumps(
                {
                    "model": configured or OLLAMA_DEFAULT_MODEL,
                    "messages": _ollama_prompt(state, questions),
                    "stream": False,
                    "format": _ollama_schema(questions),
                    "options": {"temperature": 0},
                    "keep_alive": "10m",
                }
            ).encode("utf-8")
            endpoint = "/api/chat"
        else:
            body = json.dumps(
                {"model": configured or SYSTEMONE_DEFAULT_MODEL, "state": state, "questions": questions}
            ).encode("utf-8")
            endpoint = "/v1/systemone"
        req = urllib.request.Request(
            base + endpoint,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with _urlopen(req, timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, http.client.HTTPException) as exc:
        if _refused(exc):
            _neg_arm(base)
        return None
    if not isinstance(payload, dict):
        return None
    if protocol == "ollama":
        message = payload.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        return _ollama_validate(content, questions)
    answers = payload.get("answers")
    return answers if isinstance(answers, dict) else None


def _unit(value) -> float | None:
    """A number clamped into [0, 1]; None for bools, non-numbers and NaN."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or math.isnan(value):
        return None
    return min(1.0, max(0.0, float(value)))


def choice_of(answers: dict | None, qid: str) -> tuple[str, float] | None:
    """(choice, confidence) of choice question `qid`, or None when absent or malformed. A confidence
    outside [0, 1] is clamped, a bool or NaN is rejected (same rules as noul_of)."""
    answer = (answers or {}).get(qid)
    if not isinstance(answer, dict):
        return None
    choice, confidence = answer.get("choice"), _unit(answer.get("confidence"))
    if not isinstance(choice, str) or confidence is None:
        return None
    return choice, confidence


def noul_of(answers: dict | None, qid: str) -> float | None:
    """Probability of noul question `qid` (0..1), or None when absent or malformed."""
    answer = (answers or {}).get(qid)
    return _unit(answer.get("noul")) if isinstance(answer, dict) else None


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
    _NEG_MEM.clear()
    _PROTO_MEM.clear()
    for stale in (_neg_path(), _proto_path()):
        try:
            os.unlink(stale)
        except OSError:
            pass


def prompt_answers(prompt: str) -> dict | None:
    """Answers for prompt_class, task_class and effort from ONE request.

    Cached for a few seconds per (prompt, endpoint, model), failures included, so the arming band and
    the routing step of the same hook run share a single round trip (and a dead endpoint costs one
    attempt, not two)."""
    base = decision_url()
    if not base:
        return None
    key = (
        prompt,
        base,
        os.environ.get("ATLAS_DECISION_MODEL", ""),
        os.environ.get("ATLAS_DECISION_PROTOCOL", ""),
    )
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
# Second opinion on a deterministic done-claim block: clears it only at or above this observed-result noul.
VERIFY_CLEAR_OBSERVED_MIN = 0.8
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
