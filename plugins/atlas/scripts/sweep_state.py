#!/usr/bin/env python3
"""Deterministic single-writer engine for the atlas-sweep state file.

This script is the ONLY writer of `.atlas/.run/sweep-state.json`. Every peer
(read-only connector subagents, the orchestrator) reads state through `read`
and changes it exclusively through the subcommands below, so the lease,
merge, and evidence rules are enforced in one place. Ported from the
compound-engineering plugin's `sweep-state.py` concept onto JSON state.

Usage:
    python3 sweep_state.py lease-acquire  --state P --writer W [--ttl-minutes N]
    python3 sweep_state.py lease-release  --state P --writer W
    python3 sweep_state.py read           --state P [--source S]
    python3 sweep_state.py upsert-item    --state P --writer W --source S --id I --json '{...}'
    python3 sweep_state.py cursor-advance --state P --writer W --source S --to V --past-item I
    python3 sweep_state.py run-record     --state P --writer W --outcome O --counts '{}' [--timestamp T]
    python3 sweep_state.py validate       --state P

Every subcommand prints one status word on line 1, then an optional JSON
payload on line 2. Operational conditions exit 0; CLI misuse exits 2.

Status words: OK | NO-STATE | CORRUPT | LOCKED | STALE-RECLAIMED |
LEASE-LOST | REFUSED | ERROR.

Schema contract (see skills/atlas-sweep/references/state-schema.md):
- `schema_version: 1` must be present once the file exists; a file that
  parses but lacks it is CORRUPT and is never overwritten.
- Unknown top-level keys, item fields, and status values are preserved on
  every write-back (additive-safe forward/backward compatibility).
- `upsert-item` is an id-keyed merge: only keys present in --json change.
- `closed` items must carry fix_ref, verified_merge_sha, verified_at;
  `validate` downgrades under-evidenced closes to fix_pending.
- The lease is a per-checkout single-writer mutex: re-entrant for the same
  writer, LOCKED against a live other writer, STALE-RECLAIMED past TTL.
  Every mutating call re-checks ownership and re-stamps on success.
- An OS advisory lock (flock on `<state>.lock`) serializes each
  load-modify-write, so concurrent engine invocations never clobber each
  other regardless of lease ownership. The .lock file is ephemeral.

Stdlib only.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA_VERSION = 1
EVIDENCE_FIELDS = ("fix_ref", "verified_merge_sha", "verified_at")
REDACT_FIELDS = ("body", "quote")
OUTCOMES = ("completed", "aborted-locked", "partial", "failed")


class Misuse(Exception):
    """CLI misuse: bad arguments or values. Exits 2."""


class Corrupt(Exception):
    """State file exists but is not a parseable v1+ schema. Refuses any
    write; reported as the CORRUPT status word (operational, exit 0)."""


# ---------------------------------------------------------------- IO core

def state_path(raw: str) -> Path:
    p = Path(raw)
    parent = p.parent
    if not parent.is_dir():
        raise Misuse(f"state directory does not exist: {parent}")
    return p


def parse_state(path: Path) -> dict:
    """Read and validate the state file. Missing -> fresh; corrupt -> refuse."""
    if not path.exists():
        return {"schema_version": SCHEMA_VERSION, "sources": {}, "items": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        raise Corrupt(f"state file does not parse as JSON: {path}")
    if not isinstance(data, dict) or "schema_version" not in data:
        raise Corrupt(f"state file has no schema_version: {path}")
    return data


def save_state(path: Path, data: dict) -> None:
    """Atomic write under the caller-held file lock."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".sweep-state-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=False)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def emit(word: str, payload: dict | None = None) -> None:
    print(word)
    if payload is not None:
        print(json.dumps(payload))
    sys.exit(0)


# ------------------------------------------------------------- lease core

def lease_live(lease: dict) -> bool:
    """True when the lease must be treated as live. Staleness is only
    asserted when it can be PROVEN from a parseable timestamp; an
    unparseable timestamp is live and never stomped."""
    ts = parse_iso(lease.get("timestamp"))
    if ts is None:
        return True
    ttl_raw = lease.get("ttl_minutes")
    ttl = float(ttl_raw) if isinstance(ttl_raw, (int, float)) else 60.0
    return datetime.now(timezone.utc) < ts + timedelta(minutes=ttl)


def check_holder(data: dict, writer: str) -> str | None:
    """Return None when `writer` may mutate, else a LEASE-LOST reason."""
    lease = data.get("lease")
    if not lease:
        return None
    if lease.get("writer") == writer:
        return None
    return f"lease held by {lease.get('writer')!r}"


def restamp(data: dict, writer: str, ttl_minutes: float | None = None) -> None:
    lease = data.setdefault("lease", {})
    lease["writer"] = writer
    lease["timestamp"] = now_iso()
    if ttl_minutes is not None:
        lease["ttl_minutes"] = ttl_minutes


# ------------------------------------------------------------ subcommands

def cmd_lease_acquire(args) -> None:
    path = state_path(args.state)
    ttl = args.ttl_minutes
    if ttl <= 0:
        raise Misuse("--ttl-minutes must be positive")
    with locked(path):
        data = parse_state(path)
        lease = data.get("lease")
        if lease and lease.get("writer") != args.writer and lease_live(lease):
            emit("LOCKED")
        prev = None
        if lease and lease.get("writer") != args.writer:
            prev = {"previous_writer": lease.get("writer"),
                    "previous_timestamp": lease.get("timestamp")}
        restamp(data, args.writer, ttl)
        save_state(path, data)
        emit("STALE-RECLAIMED", prev) if prev else emit("OK")


def cmd_lease_release(args) -> None:
    path = state_path(args.state)
    with locked(path):
        data = parse_state(path)
        lease = data.get("lease")
        if lease and lease.get("writer") != args.writer:
            emit("LEASE-LOST")
        data.pop("lease", None)
        save_state(path, data)
        emit("OK")


def cmd_read(args) -> None:
    path = state_path(args.state)
    if not path.exists():
        emit("NO-STATE")
    data = parse_state(path)
    if args.source:
        entry = (data.get("sources") or {}).get(args.source, {})
        emit("OK", {"source": args.source, "cursor": entry.get("cursor")})
    emit("OK", data)


def cmd_upsert_item(args) -> None:
    try:
        incoming = json.loads(args.json)
    except json.JSONDecodeError as exc:
        raise Misuse(f"--json is not valid JSON: {exc}")
    if not isinstance(incoming, dict):
        raise Misuse("--json must be a JSON object")
    path = state_path(args.state)
    with locked(path):
        data = parse_state(path)
        lost = check_holder(data, args.writer)
        if lost:
            emit("LEASE-LOST")
        items = data.setdefault("items", {})
        sources = data.setdefault("sources", {})
        key = f"{args.source}:{args.id}"
        existing = dict(items.get(key) or {})
        # Sensitive redaction: drop body/quote at write time when either the
        # item or its source entry is flagged, so redacted content never
        # reaches disk.
        src_sensitive = bool((sources.get(args.source) or {}).get("sensitive"))
        if incoming.get("sensitive") or src_sensitive:
            for field in REDACT_FIELDS:
                incoming.pop(field, None)
                existing.pop(field, None)
        # Id-keyed merge: incoming keys replace, everything else preserved.
        merged = {**existing, **incoming, "source": args.source, "id": args.id}
        items[key] = merged
        src = sources.setdefault(args.source, {})
        src.setdefault("sensitive", bool(incoming.get("sensitive")))
        restamp(data, args.writer)
        save_state(path, data)
        emit("OK", {"key": key, "status": merged.get("status")})


def cursor_regresses(old: str | None, new: str) -> bool:
    if old is None:
        return False

    def as_num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    a, b = as_num(old), as_num(new)
    if a is not None and b is not None:
        return b < a
    return str(new) < str(old)


def cmd_cursor_advance(args) -> None:
    path = state_path(args.state)
    with locked(path):
        data = parse_state(path)
        lost = check_holder(data, args.writer)
        if lost:
            emit("LEASE-LOST")
        items = data.setdefault("items", {})
        key = f"{args.source}:{args.past_item}"
        if key not in items:
            emit("REFUSED")
        sources = data.setdefault("sources", {})
        entry = sources.setdefault(args.source, {})
        old = entry.get("cursor")
        if cursor_regresses(old, args.to):
            emit("REFUSED")
        entry["cursor"] = args.to
        restamp(data, args.writer)
        save_state(path, data)
        emit("OK", {"source": args.source, "cursor": args.to})


def cmd_run_record(args) -> None:
    if args.outcome not in OUTCOMES:
        raise Misuse(f"--outcome must be one of {', '.join(OUTCOMES)}")
    try:
        counts = json.loads(args.counts)
    except json.JSONDecodeError as exc:
        raise Misuse(f"--counts is not valid JSON: {exc}")
    if not isinstance(counts, dict):
        raise Misuse("--counts must be a JSON object")
    timestamp = args.timestamp or now_iso()
    if parse_iso(timestamp) is None:
        raise Misuse(f"--timestamp is not an ISO instant: {timestamp}")
    path = state_path(args.state)
    # Intentionally lease-agnostic: an aborted-locked run must be able to
    # record that fact while the holder is mid-sweep. The file lock keeps
    # this write from clobbering the holder's concurrent upserts.
    with locked(path):
        data = parse_state(path)
        data["last_run"] = {
            "timestamp": timestamp,
            "outcome": args.outcome,
            "writer": args.writer,
            "counts": counts,
        }
        save_state(path, data)
        emit("OK", data["last_run"])


def cmd_validate(args) -> None:
    path = state_path(args.state)
    # Lease-agnostic repair, run at sweep start.
    with locked(path):
        data = parse_state(path)
        downgraded = []
        for key, item in (data.get("items") or {}).items():
            if item.get("status") != "closed":
                continue
            if any(not item.get(f) for f in EVIDENCE_FIELDS):
                item["status"] = "fix_pending"
                downgraded.append(key)
        if downgraded:
            save_state(path, data)
        emit("OK", {"downgraded": downgraded})


class locked:
    """OS advisory lock serializing one load-modify-write."""

    def __init__(self, path: Path):
        self.lock_path = Path(str(path) + ".lock")

    def __enter__(self):
        self.fh = open(self.lock_path, "a+")
        fcntl.flock(self.fh, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        try:
            fcntl.flock(self.fh, fcntl.LOCK_UN)
        finally:
            self.fh.close()
        return False


COMMANDS = {
    "lease-acquire": cmd_lease_acquire,
    "lease-release": cmd_lease_release,
    "read": cmd_read,
    "upsert-item": cmd_upsert_item,
    "cursor-advance": cmd_cursor_advance,
    "run-record": cmd_run_record,
    "validate": cmd_validate,
}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="sweep_state.py", add_help=True)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("lease-acquire")
    p.add_argument("--state", required=True)
    p.add_argument("--writer", required=True)
    p.add_argument("--ttl-minutes", type=float, default=60.0)
    p.set_defaults(fn=cmd_lease_acquire)

    p = sub.add_parser("lease-release")
    p.add_argument("--state", required=True)
    p.add_argument("--writer", required=True)
    p.set_defaults(fn=cmd_lease_release)

    p = sub.add_parser("read")
    p.add_argument("--state", required=True)
    p.add_argument("--source")
    p.set_defaults(fn=cmd_read)

    p = sub.add_parser("upsert-item")
    p.add_argument("--state", required=True)
    p.add_argument("--writer", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--json", required=True)
    p.set_defaults(fn=cmd_upsert_item)

    p = sub.add_parser("cursor-advance")
    p.add_argument("--state", required=True)
    p.add_argument("--writer", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--to", required=True)
    p.add_argument("--past-item", required=True)
    p.set_defaults(fn=cmd_cursor_advance)

    p = sub.add_parser("run-record")
    p.add_argument("--state", required=True)
    p.add_argument("--writer", required=True)
    p.add_argument("--outcome", required=True)
    p.add_argument("--counts", default="{}")
    p.add_argument("--timestamp")
    p.set_defaults(fn=cmd_run_record)

    p = sub.add_parser("validate")
    p.add_argument("--state", required=True)
    p.set_defaults(fn=cmd_validate)

    args = parser.parse_args(argv)
    try:
        args.fn(args)
    except Corrupt as exc:
        emit("CORRUPT", {"detail": str(exc)})
    except Misuse as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
