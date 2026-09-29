#!/usr/bin/env python3
"""Stdlib-only client for the TypeSafe System One API (model Jev).

POST {ATLAS_TYPESAFE_URL}/v1/systemone with a state and typed questions
(noul | score | choice); returns the parsed JSON response. The API key is read
from TYPESAFE_API_KEY in the process environment only and never appears in
logs, return values, or exception text. Set ATLAS_TYPESAFE_SCORING=off to
disable scoring entirely.

Env: TYPESAFE_API_KEY, ATLAS_TYPESAFE_URL (default https://api.typesafe.ai),
ATLAS_TYPESAFE_MODEL (default jev-latest), ATLAS_TYPESAFE_SCORING.
"""

import json
import os
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://api.typesafe.ai"
DEFAULT_MODEL = "jev-latest"
RETRYABLE = (429, 529)
MAX_RETRIES = 3
MAX_BACKOFF_S = 30.0


class TypeSafeError(Exception):
    def __init__(self, status, message):
        super().__init__(f"TypeSafe API error {status}: {message}")
        self.status = status
        self.message = message


def _key():
    return os.environ.get("TYPESAFE_API_KEY", "").strip()


def available():
    return bool(_key()) and os.environ.get("ATLAS_TYPESAFE_SCORING", "on").lower() != "off"


def _redact(text):
    key = _key()
    return text.replace(key, "***") if key else text


def _retry_after(headers, attempt):
    raw = (headers.get("retry-after") if headers else None) or ""
    try:
        return min(max(float(raw), 0.0), MAX_BACKOFF_S)
    except (TypeError, ValueError):
        return min(2.0**attempt, MAX_BACKOFF_S)


def evaluate(state, questions, *, model=None, timeout=30.0):
    key = _key()
    base = os.environ.get("ATLAS_TYPESAFE_URL", DEFAULT_URL).rstrip("/")
    url = base + "/v1/systemone"
    if not key:
        raise TypeSafeError(401, "TYPESAFE_API_KEY is not set in the environment")
    body = json.dumps(
        {
            "state": state,
            "model": model or os.environ.get("ATLAS_TYPESAFE_MODEL", DEFAULT_MODEL),
            "questions": questions,
        }
    ).encode("utf-8")
    for attempt in range(MAX_RETRIES + 1):
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
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
    raise TypeSafeError(429, f"POST {url} still rate limited after {MAX_RETRIES} retries")
