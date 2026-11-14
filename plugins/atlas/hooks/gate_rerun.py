"""gate_rerun -- the completion gate's own adversarial check: re-run the session's test command.

A run that shipped code used to be blocked at Stop until the model wrote an evidence file, a findings
row, a todo plan with the required phases, and dispatched an atlas:verifier subagent to re-run the very
test the model had just run. On a measured 8-module task that paperwork tail cost about 80 s and about
500k tokens per run, and proved nothing the test had not already proved.

The gate now does the independent check itself, which is stronger and cheaper:

  1. `last_test_command` reads the transcript (never the model's summary) for the last test-runner
     command the main thread ran during this run.
  2. `normalize` accepts it only in a strict allowlisted form (pytest, npm/yarn/pnpm/bun test, go test,
     cargo test, make test, npx vitest run/jest; optional `cd <dir inside root> &&`, optional trailing
     `2>&1`, `| tail -N`, `| head -N`; no other shell metacharacters). Anything else is not re-run.
  3. `rerun` executes it in the project root with a timeout, as argv (no shell).
  4. `write_proof` records the result: an evidence file under .atlas/evidence/, a `verified` row in
     .atlas/.run/findings.json stamped `verified_by: completion-gate`, and .atlas/.run/gate-proof.json.
  5. `valid_proof` (read-only; evaluate() and the band call it) accepts the proof only for this session,
     inside this run's window, exit 0, and only while no file this run wrote changed after it.

The model's word is never the evidence: the hook runs the test. A failing re-run is reported in the block
reason with the command, exit code and output tail.

Kill switch: ATLAS_GATE_RERUN=off. Timeout: ATLAS_GATE_RERUN_TIMEOUT seconds (default 90).
Stdlib only; every function fails safe (None / False) on error.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

PROOF_REL = Path(".atlas") / ".run" / "gate-proof.json"
FINDINGS_REL = Path(".atlas") / ".run" / "findings.json"
EVIDENCE_REL = Path(".atlas") / "evidence"
SWITCH = "ATLAS_GATE_RERUN"
TIMEOUT_ENV = "ATLAS_GATE_RERUN_TIMEOUT"
DEFAULT_TIMEOUT = 90.0
TAIL_CHARS = 1500

# Accepted runner prefixes, as argv token tuples. The first match wins; the rest of the argv may only be
# plain arguments (flags, paths, -k expressions without shell metacharacters).
_RUNNERS = (
    ("python3", "-m", "pytest"),
    ("python", "-m", "pytest"),
    ("uv", "run", "pytest"),
    ("uv", "run", "python", "-m", "pytest"),
    ("pytest",),
    ("npm", "test"),
    ("npm", "run", "test"),
    ("yarn", "test"),
    ("pnpm", "test"),
    ("bun", "test"),
    ("go", "test"),
    ("cargo", "test"),
    ("make", "test"),
    ("npx", "vitest", "run"),
    ("npx", "jest"),
)
_TRAILERS = re.compile(r"(?:\s+2>&1)?(?:\s*\|\s*(?:tail|head)\s+-n?\s*\d+)?\s*;?\s*$")
_CD = re.compile(r"^\s*cd\s+(\S+)\s*&&\s*")
_META = re.compile(r"[;&|<>`$(){}\\\n!*?]")


def switched_off() -> bool:
    return os.environ.get(SWITCH, "").strip().lower() in {"off", "0", "false"}


def _timeout() -> float:
    try:
        return max(5.0, float(os.environ.get(TIMEOUT_ENV) or DEFAULT_TIMEOUT))
    except ValueError:
        return DEFAULT_TIMEOUT


def normalize(command: str, root: Path) -> tuple[list, Path] | None:
    """(argv, cwd) for an allowlisted test command, else None. `cwd` is always inside `root`."""
    if not isinstance(command, str):
        return None
    cmd = command.strip()
    cwd = Path(root).resolve()
    m = _CD.match(cmd)
    if m:
        target = Path(m.group(1).strip("'\""))
        target = (cwd / target).resolve() if not target.is_absolute() else target.resolve()
        try:
            target.relative_to(cwd)
        except ValueError:
            return None  # never run anything outside the project
        if not target.is_dir():
            return None
        cwd = target
        cmd = cmd[m.end():]
    cmd = _TRAILERS.sub("", cmd).strip()
    if not cmd or _META.search(cmd):
        return None
    try:
        argv = shlex.split(cmd)
    except ValueError:
        return None
    for prefix in _RUNNERS:
        if tuple(argv[: len(prefix)]) == prefix:
            return argv, cwd
    return None


def _epoch(ts) -> float | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


_SEG_SPLIT = re.compile(r"\n|&&|;|\|\|")
_CD_ONLY = re.compile(r"^cd\s+(\S+)$")


def runnable_part(command: str, root: Path) -> str | None:
    """The allowlisted test command inside a Bash call: the whole call when it is one, else the last
    segment of a compound call (`cat >> CHANGELOG.md <<EOF ... EOF` then `python3 -m pytest -q | tail`)
    that is one, with a preceding plain `cd <dir>` kept as its working directory. Only that segment is
    ever re-run, never the rest of the call."""
    if not isinstance(command, str):
        return None
    if normalize(command, root) is not None:
        return command.strip()
    found, cd = None, ""
    for seg in _SEG_SPLIT.split(command):
        seg = seg.strip()
        if not seg:
            continue
        m = _CD_ONLY.match(seg)
        if m:
            cd = f"cd {m.group(1)} && "
            continue
        for cand in ((cd + seg) if cd else None, seg):
            if cand and normalize(cand, root) is not None:
                found = cand
                break
    return found


def last_test_command(transcript_path: str, started: float | None, root: Path) -> str | None:
    """The last main-thread Bash command of this run that `normalize` accepts, read from the transcript."""
    if not transcript_path or "/subagents/" in transcript_path.replace("\\", "/"):
        return None
    last = None
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"tool_use"' not in line or '"Bash"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if rec.get("isSidechain"):
                    continue
                if started is not None:
                    when = _epoch(rec.get("timestamp"))
                    if when is None or when < started:
                        continue
                for block in ((rec.get("message") or {}).get("content")) or []:
                    if not (isinstance(block, dict) and block.get("type") == "tool_use"):
                        continue
                    if block.get("name") != "Bash":
                        continue
                    part = runnable_part(str((block.get("input") or {}).get("command") or ""), root)
                    if part is not None:
                        last = part
    except OSError:
        return None
    return last


def rerun(command: str, root: Path) -> dict | None:
    """Run the normalized command; {command, argv, cwd, exit, tail, seconds} or None when not allowlisted."""
    norm = normalize(command, root)
    if norm is None:
        return None
    argv, cwd = norm
    t0 = time.time()
    env = dict(os.environ)
    env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    try:
        proc = subprocess.run(
            argv, cwd=str(cwd), env=env, stdin=subprocess.DEVNULL, capture_output=True,
            text=True, timeout=_timeout(),
        )
        code, out = proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except subprocess.TimeoutExpired:
        code, out = 124, f"timed out after {_timeout():.0f}s"
    except OSError as exc:
        code, out = 127, str(exc)
    return {
        "command": command.strip(),
        "argv": argv,
        "cwd": str(cwd),
        "exit": code,
        "tail": out[-TAIL_CHARS:],
        "seconds": round(time.time() - t0, 2),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write_proof(root: Path, session: str, result: dict) -> dict:
    """Persist a green re-run: evidence file, verified findings row, gate-proof.json. Returns the proof."""
    root = Path(root)
    at = time.time()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    sid6 = re.sub(r"[^A-Za-z0-9]", "", session)[:6] or "nosess"
    ev = root / EVIDENCE_REL / f"{stamp}_gate-rerun_{sid6}.txt"
    ev.parent.mkdir(parents=True, exist_ok=True)
    ev.write_text(
        f"completion-gate re-run (independent of the model)\n"
        f"cwd: {result['cwd']}\ncommand: {result['command']}\nexit: {result['exit']}\n"
        f"seconds: {result['seconds']}\n--- output tail ---\n{result['tail']}\n",
        encoding="utf-8",
    )
    findings_path = root / FINDINGS_REL
    findings_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = json.loads(findings_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = []
    items = data if isinstance(data, list) else (data.get("findings") if isinstance(data, dict) else None)
    if not isinstance(items, list):
        items = []
    items.append(
        {
            "id": f"gate-rerun-{sid6}-{int(at)}",
            "surface": "test",
            "category": "verification",
            "severity": "info",
            "title": f"completion gate re-ran `{result['command']}`: exit 0",
            "evidence": [str(ev.relative_to(root))],
            "status": "verified",
            "verified_at": _now_iso(),
            "verified_by": "completion-gate",
        }
    )
    payload = items if isinstance(data, list) or not isinstance(data, dict) else {**data, "findings": items}
    tmp = findings_path.with_name(f".{findings_path.name}.tmp{os.getpid()}")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, findings_path)
    proof = {
        "session": session,
        "at": at,
        "command": result["command"],
        "cwd": result["cwd"],
        "exit": result["exit"],
        "seconds": result["seconds"],
        "evidence": str(ev.relative_to(root)),
    }
    proof_path = root / PROOF_REL
    tmp = proof_path.with_name(f".{proof_path.name}.tmp{os.getpid()}")
    tmp.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, proof_path)
    return proof


def _abs(p: str, root: Path) -> Path:
    q = Path(p)
    return q if q.is_absolute() else Path(root) / q


_DOCS_DIRS = ("docs", ".atlas", ".claude")
_DOCS_EXTS = (".md", ".mdx", ".rst", ".txt")


def _is_docs(p: str, root: Path) -> bool:
    """Docs and run scratch do not invalidate a proof: the lead updates the CHANGELOG after the check."""
    try:
        rel = _abs(str(p), root).resolve().relative_to(Path(root).resolve())
    except (ValueError, OSError):
        return False
    return (rel.parts and rel.parts[0] in _DOCS_DIRS) or rel.suffix.lower() in _DOCS_EXTS


def _stale(at: float, root: Path, run_paths) -> bool:
    for p in run_paths or ():
        if _is_docs(str(p), root):
            continue
        try:
            if _abs(str(p), root).stat().st_mtime > at + 0.5:
                return True  # code changed after the check ran: the proof no longer covers it
        except OSError:
            continue
    return False


def valid_proof(root: Path, session: str, started: float | None, run_paths=()) -> dict | None:
    """The proof when it belongs to this session and run, exited 0, and no file this run wrote changed after
    it; else None. Read-only."""
    if switched_off() or not session:
        return None
    try:
        proof = json.loads((Path(root) / PROOF_REL).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(proof, dict) or proof.get("session") != session or proof.get("exit") != 0:
        return None
    try:
        at = float(proof.get("at"))
    except (TypeError, ValueError):
        return None
    if started is not None and at < started:
        return None
    if _stale(at, root, run_paths):
        return None
    return proof


def crew_proof(root: Path, session: str, started: float | None, run_paths=()) -> dict | None:
    """A crew run of this session whose engine re-ran the global check green, as a proof dict; else None.
    The crew supervisor (scripts/atlas_crew.py) runs the plan's global check itself after every worker
    stopped, so its summary is the same kind of independent evidence as a gate re-run. Read-only."""
    if not session:
        return None
    best = None
    for meta_path in sorted((Path(root) / ".atlas" / ".run" / "crew").glob("*/run.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            summary_path = meta_path.with_name("summary.json")
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            at = summary_path.stat().st_mtime
        except (OSError, ValueError):
            continue
        if str(meta.get("lead_session") or "").strip() != session:
            continue
        if not (summary.get("ok") is True and summary.get("check_exit") == 0 and summary.get("check")):
            continue
        if started is not None and at < started:
            continue
        if _stale(at, root, run_paths):
            continue
        if best is None or at > best["at"]:
            best = {
                "session": session,
                "at": at,
                "command": summary.get("check"),
                "exit": 0,
                "crew_run": summary.get("run"),
                "evidence": str(summary_path.relative_to(root)),
            }
    return best
