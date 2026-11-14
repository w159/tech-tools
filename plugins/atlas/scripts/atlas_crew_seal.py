"""atlas_crew_seal -- a keyed signature on a crew run's summary.json, so a hand-edited or copied summary is caught.

The seal is NOT a security boundary. A model that can run arbitrary code as the same user can read the key
record below, or import this module and call `create` / `sign`, and so forge a seal. What it does catch:

  * a summary.json edited after the engine wrote it (red -> green), or copied to another run dir or run id;
  * a run dir written by hand with no engine behind it, as far as nothing but file writes was used.

How it works: `atlas_crew.py run` calls `create`: a random key goes into a record under the seal home (the
ATLAS_HOME at run start, else ~/.atlas, written into run.json as `seal_home` so a later `wait` or gate under another
ATLAS_HOME still finds it), `crew-seals/<sha256 of the run dir's real path>.json`, mode 0600 in a 0700 directory.
The supervisor (and `kill`) publish summary.json through `sign`: an added `sig` key, an HMAC-SHA256 over the run
dir's real path and the summary's canonical JSON (sorted keys, no `sig`). `verify` recomputes it; no record, no
`sig`, or any edit after signing fails it. `remove` drops a run's record; `create` also prunes records older than
14 days or whose run dir is gone.

Who relies on it: `atlas_crew.py wait` refuses an unverified summary. The completion gate (hooks/gate_rerun.py)
credits a crew run only when the seal verifies AND the session transcript shows a Bash call that ran this
plugin's own scripts/atlas_crew.py `run` and printed that run id: a forged run dir, or a `python -c` that calls
`create` and `sign`, has no such launch in the transcript. The launch check is what catches a forged run dir; the
seal catches edits and copies. Stdlib only.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

SEALS = "crew-seals"
SIG = "sig"


PRUNE_AFTER_S = 14 * 86400


def home() -> Path:
    """The seal home of this process: ATLAS_HOME, else ~/.atlas."""
    return Path(os.environ.get("ATLAS_HOME") or os.path.join(os.path.expanduser("~"), ".atlas"))


def _real(rundir) -> str:
    return os.path.realpath(str(rundir))


def seal_home(rundir) -> Path:
    """Where this run's record lives: the `seal_home` its run.json names (written at run start), else the
    current seal home. A different ATLAS_HOME in the verifying process then does not hide the record."""
    try:
        named = json.loads((Path(rundir) / "run.json").read_text(encoding="utf-8")).get("seal_home")
        if isinstance(named, str) and os.path.isabs(named):
            return Path(named)
    except (OSError, ValueError, AttributeError):
        pass
    return home()


def record_path(rundir, at: Path | None = None) -> Path:
    return (at or seal_home(rundir)) / SEALS / (hashlib.sha256(_real(rundir).encode()).hexdigest()[:40] + ".json")


def _prune(directory: Path, keep: Path) -> None:
    """Drop records whose run dir is gone or that are older than PRUNE_AFTER_S. Best effort."""
    now = time.time()
    try:
        entries = list(directory.glob("*.json"))
    except OSError:
        return
    for rec in entries:
        if rec == keep:
            continue
        try:
            old = now - rec.stat().st_mtime > PRUNE_AFTER_S
            try:
                gone = not os.path.isdir(json.loads(rec.read_text(encoding="utf-8")).get("rundir") or "")
            except (ValueError, AttributeError):
                gone = False
            if old or gone:
                rec.unlink()
        except OSError:
            pass


def create(rundir, run_id: str, at: Path | None = None) -> bool:
    """Write this run's key record under `at` (default: the current seal home), replacing any earlier one for the
    same path, and prune stale records. False when it cannot be written."""
    path = record_path(rundir, at)
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"run_id": run_id, "rundir": _real(rundir), "key": secrets.token_hex(32)}, f)
        os.chmod(path, 0o600)
    except OSError:
        return False
    _prune(path.parent, path)
    return True


def remove(rundir) -> None:
    """Delete a run's record (its run dir was reaped or removed)."""
    try:
        record_path(rundir).unlink()
    except OSError:
        pass


def _key(rundir) -> bytes | None:
    try:
        rec = json.loads(record_path(rundir).read_text(encoding="utf-8"))
        if rec.get("rundir") != _real(rundir) or rec.get("run_id") != Path(rundir).name:
            return None
        key = rec.get("key")
        return key.encode() if isinstance(key, str) and len(key) >= 32 else None
    except (OSError, ValueError, AttributeError):
        return None


def _mac(key: bytes, rundir, summary: dict) -> str:
    body = json.dumps({k: v for k, v in summary.items() if k != SIG}, sort_keys=True, separators=(",", ":"))
    return hmac.new(key, (_real(rundir) + "\n" + body).encode(), hashlib.sha256).hexdigest()


def sign(rundir, summary: dict) -> dict:
    """The summary with its `sig`; unchanged when the run has no record (nothing can then verify it)."""
    key = _key(rundir)
    if key is None:
        return {k: v for k, v in summary.items() if k != SIG}
    return {**{k: v for k, v in summary.items() if k != SIG}, SIG: _mac(key, rundir, summary)}


def verify_obj(rundir, summary) -> str | None:
    """None when `summary` carries a valid signature for this run dir, else why it does not."""
    if not isinstance(summary, dict):
        return "summary is not a JSON object"
    key = _key(rundir)
    if key is None:
        return f"no seal record under {seal_home(rundir)}: the crew engine never started this run, or its seal could not be written"
    sig = summary.get(SIG)
    if not isinstance(sig, str) or not hmac.compare_digest(sig, _mac(key, rundir, summary)):
        return "summary signature missing or wrong: it was not written by the crew engine, or was edited"
    return None


def verify(rundir) -> str | None:
    """None when rundir/summary.json is validly signed, else why not."""
    try:
        summary = json.loads((Path(rundir) / "summary.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "summary.json unreadable"
    return verify_obj(rundir, summary)
