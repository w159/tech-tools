#!/usr/bin/env python3
"""Persistent record of swallowed hook crashes.

Hooks fail open (a crash must never block the harness), which made a crashing
hook truly silent. Each top-level fail-open handler calls ``record`` so the
crash lands in ``<ATLAS_HOME or ~/.atlas>/hook-faults.jsonl``. Both functions
are best-effort and never raise.
"""

from __future__ import annotations

import json
import os
import time

MAX_BYTES = 1 << 20  # 1 MiB; on overflow keep the newest half
_NAME = "hook-faults.jsonl"
_ERR_CAP = 500


def _path() -> str:
    base = os.environ.get("ATLAS_HOME") or os.path.join(
        os.path.expanduser("~"), ".atlas"
    )
    return os.path.join(base, _NAME)


def _truncate(path: str) -> None:
    with open(path, "rb") as f:
        data = f.read()
    keep = data[len(data) // 2 :]
    nl = keep.find(b"\n")  # drop the partial leading line
    keep = keep[nl + 1 :] if nl != -1 else b""
    tmp = path + ".tmp"
    try:
        with open(tmp, "wb") as f:
            f.write(keep)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def record(hook: str, exc: BaseException, cwd: str | None = None) -> None:
    """Append one JSON fault line. Never raises."""
    try:
        path = _path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        line = json.dumps(
            {
                "ts": time.time(),
                "hook": str(hook),
                "error": str(exc)[:_ERR_CAP],
                "type": type(exc).__name__,
                "cwd": cwd if cwd is not None else os.getcwd(),
            }
        )
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        if os.path.getsize(path) > MAX_BYTES:
            _truncate(path)
    except Exception:  # noqa: BLE001 -- the recorder must never become the fault
        pass


def load(since: float = 0.0) -> list[dict]:
    """Return fault records with ts >= since, oldest first. Never raises."""
    out: list[dict] = []
    try:
        with open(_path(), encoding="utf-8") as f:
            for raw in f:
                try:
                    rec = json.loads(raw)
                    if isinstance(rec, dict) and float(rec.get("ts", 0)) >= since:
                        out.append(rec)
                except (ValueError, TypeError):
                    continue
    except Exception:  # noqa: BLE001
        pass
    return out
