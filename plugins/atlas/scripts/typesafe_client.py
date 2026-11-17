#!/usr/bin/env python3
"""Stdlib-only client for the TypeSafe System One API (model Jev).

POST {ATLAS_TYPESAFE_URL}/v1/systemone with a state and typed questions
(noul | score | choice); returns the parsed JSON response. The API key is read
from TYPESAFE_API_KEY in the process environment only and never appears in
logs, return values, or exception text. Set ATLAS_TYPESAFE_SCORING=off to
disable scoring entirely.

Env: TYPESAFE_API_KEY, ATLAS_TYPESAFE_URL (default https://api.typesafe.ai),
ATLAS_TYPESAFE_MODEL (default jev-latest), ATLAS_TYPESAFE_SCORING.

A loopback ATLAS_TYPESAFE_URL (127.0.0.1, localhost, ::1) is allowed with no
API key, so a local Ollama nimble/tev1 model can score without sending
excerpts to api.typesafe.ai. Set ATLAS_TYPESAFE_MODEL to that local tag.
The hosted default still requires TYPESAFE_API_KEY.
Local tev1 decision models reject any prompt over 2,048 tokens; the judge state
is budgeted at ~5,250 tokens (turn_scoring.JUDGE_BUDGET_CHARS), so the hosted
jev-latest default (accepts >28k tokens) is the endpoint that fits it.
"""

import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "https://api.typesafe.ai"
DEFAULT_MODEL = "jev-latest"
RETRYABLE = (429, 529)
MAX_RETRIES = 3
MAX_BACKOFF_S = 30.0


def _tls_kwargs():
    """urlopen kwargs: verify against certifi's bundle when certifi is already
    importable (python.org builds ship no system CAs and fail with
    CERTIFICATE_VERIFY_FAILED), else the system default. Verification is never
    disabled."""
    try:
        import certifi
    except ImportError:
        return {}
    return {"context": ssl.create_default_context(cafile=certifi.where())}


class TypeSafeError(Exception):
    def __init__(self, status, message):
        super().__init__(f"TypeSafe API error {status}: {message}")
        self.status = status
        self.message = message


def _key():
    return os.environ.get("TYPESAFE_API_KEY", "").strip()


def _base():
    # Accept a base URL or a pasted full endpoint; the path is appended once in evaluate().
    url = os.environ.get("ATLAS_TYPESAFE_URL", DEFAULT_URL).strip().rstrip("/")
    if url.lower().endswith("/v1/systemone"):
        url = url[: -len("/v1/systemone")].rstrip("/")
    return url


def _loopback(url):
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def available():
    """True when scoring can run. False only for the explicit off switch or when
    nothing was configured at all (no key, no URL): that stays a quiet opt-out.
    A configured non-loopback URL with no key is a misconfiguration, so it
    returns True and evaluate() raises the 401 naming TYPESAFE_API_KEY; see
    missing_key_reason() for callers that want to say so up front."""
    if os.environ.get("ATLAS_TYPESAFE_SCORING", "on").lower() == "off":
        return False
    if _key():
        return True
    explicit = os.environ.get("ATLAS_TYPESAFE_URL", "").strip()
    return bool(explicit)  # loopback scores locally; a hosted URL fails loudly in evaluate()


def missing_key_reason():
    """Why scoring will fail for lack of a key, or None. Set only for an explicit
    non-loopback URL with no TYPESAFE_API_KEY (the case available() lets through)."""
    if _key():
        return None
    explicit = os.environ.get("ATLAS_TYPESAFE_URL", "").strip()
    if explicit and not _loopback(explicit):
        return f"ATLAS_TYPESAFE_URL={explicit} is a hosted endpoint but TYPESAFE_API_KEY is not set"
    return None


def _redact(text):
    key = _key()
    return text.replace(key, "***") if key else text


def _retry_after(headers, attempt):
    raw = (headers.get("retry-after") if headers else None) or ""
    try:
        return min(max(float(raw), 0.0), MAX_BACKOFF_S)
    except (TypeError, ValueError):
        return min(2.0**attempt, MAX_BACKOFF_S)


# Budget for the whole POST body, in bytes: state + questions + model + JSON framing
# and escaping. This (not the state text length) is what the endpoint receives.
MAX_BODY_BYTES = 24_000


def request_model(model=None):
    return model or os.environ.get("ATLAS_TYPESAFE_MODEL", DEFAULT_MODEL)


def encode_body(state, model_name, questions):
    """The exact bytes evaluate() POSTs."""
    return json.dumps(
        {"state": state, "model": model_name, "questions": questions}
    ).encode("utf-8")


def evaluate(state, questions, *, model=None, timeout=30.0):
    key = _key()
    base = _base()
    url = base + "/v1/systemone"
    local = _loopback(base)
    if not key and not local:
        raise TypeSafeError(401, "TYPESAFE_API_KEY is not set in the environment")
    model_name = request_model(model)
    if not local and ":" in model_name:
        # Ollama tags look like name:tag; the hosted API rejects them with a bare "Unknown model".
        raise TypeSafeError(
            400,
            f"model '{model_name}' is a local Ollama tag but ATLAS_TYPESAFE_URL points at a "
            f"hosted endpoint ({base}). Set ATLAS_TYPESAFE_URL=http://127.0.0.1:11434 to score "
            "locally, or set ATLAS_TYPESAFE_MODEL to a hosted model such as jev-latest.",
        )
    body = encode_body(state, model_name, questions)
    if len(body) > MAX_BODY_BYTES:  # backstop: turn_scoring.fit_state trims first, so this never fires for it
        raise TypeSafeError(
            413, f"request body is {len(body)} bytes, over the {MAX_BODY_BYTES}-byte budget"
        )
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    for attempt in range(MAX_RETRIES + 1):
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers=headers,
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout, **_tls_kwargs()) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                detail = ""
            if e.code in RETRYABLE and attempt < MAX_RETRIES:
                time.sleep(_retry_after(e.headers, attempt))
                continue
            hint = " (check TYPESAFE_API_KEY)" if e.code in (401, 403) else ""
            raise TypeSafeError(
                e.code, _redact(f"POST {url} failed{hint}: {detail}")
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise TypeSafeError(
                0,
                _redact(f"POST {url} unreachable (check ATLAS_TYPESAFE_URL): {e}"),
            ) from None
        except ValueError:
            raise TypeSafeError(0, f"POST {url} returned non-JSON body") from None
    raise TypeSafeError(
        429, f"POST {url} still rate limited after {MAX_RETRIES} retries"
    )
