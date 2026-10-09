#!/usr/bin/env python3
"""Local System One choice for prompts the regex leaves ambiguous.

Posts one choice question to a loopback /v1/systemone endpoint. The default
is Ollama on 127.0.0.1:11434 with the nimble model. The timeout is 4 seconds
so a cold model load (about 3 seconds on the machine this was measured on)
can answer; a warm call is well under a second. A timeout, a connection
error, or a low-confidence answer returns None so the caller keeps the regex
result. This module never calls https://api.typesafe.ai. Session scoring uses
typesafe_client for that host, and only when TYPESAFE_API_KEY is set.

Criteria values are strings. Local nimble rejects the object form
({definition, includes}) that the hosted API accepts.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

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


def decision_url() -> str | None:
    """Explicit ATLAS_DECISION_URL, else loopback, else None when disabled."""
    explicit = os.environ.get("ATLAS_DECISION_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    if os.environ.get("ATLAS_DECISION", "on").strip().lower() == "off":
        return None
    return DEFAULT_URL


def local_decision(prompt: str) -> tuple[str, float] | None:
    """Return (choice, confidence) or None. None means keep the regex answer."""
    base = decision_url()
    if not base:
        return None
    model = os.environ.get("ATLAS_DECISION_MODEL", "nimble").strip() or "nimble"
    body = json.dumps(
        {
            "model": model,
            "state": prompt[:4000],
            "questions": {"prompt_class": PROMPT_CLASS},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        base + "/v1/systemone",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    answer = (payload.get("answers") or {}).get("prompt_class") or {}
    if not isinstance(answer, dict):
        return None
    choice = answer.get("choice")
    confidence = answer.get("confidence")
    if not isinstance(choice, str) or not isinstance(confidence, (int, float)):
        return None
    return choice, float(confidence)


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
