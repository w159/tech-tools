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

Kill switch: ATLAS_GATE_RERUN=off. Timeout: ATLAS_GATE_RERUN_TIMEOUT seconds (default 90, clamped to
MAX_TIMEOUT so the re-run plus the gate's own work stays under the Stop hook timeout in hooks.json).
A timeout, a missing runner or an interpreter that cannot import pytest is INCONCLUSIVE, not red: the
result carries `inconclusive` and the gate neither tells the model to fix a failure nor re-runs a
timed-out command again this session (`timed_out_before` / `note_timed_out`).
Stdlib only; every function fails safe (None / False) on error.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

PROOF_REL = Path(".atlas") / ".run" / "gate-proof.json"
FINDINGS_REL = Path(".atlas") / ".run" / "findings.json"
EVIDENCE_REL = Path(".atlas") / "evidence"
SWITCH = "ATLAS_GATE_RERUN"
TIMEOUT_ENV = "ATLAS_GATE_RERUN_TIMEOUT"
DEFAULT_TIMEOUT = 90.0
# hooks.json gives completion_gate.py 150 s; the gate's own evaluation (run twice around a green re-run)
# needs the rest, so a configured timeout never exceeds this.
MAX_TIMEOUT = 100.0
PROBE_TIMEOUT = 8.0
TIMEOUTS_REL = Path(".atlas") / ".run" / "gate-rerun-timeouts.json"
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
        value = float(os.environ.get(TIMEOUT_ENV) or DEFAULT_TIMEOUT)
    except ValueError:
        return DEFAULT_TIMEOUT
    if value != value:  # NaN
        return DEFAULT_TIMEOUT
    return min(MAX_TIMEOUT, max(5.0, value))


# Where a real interpreter may live when a project-local runner (`.venv/bin/python`) is a symlink out of the
# repo. Deliberately not /tmp, the repo's parent or any other directory a project could plant a script in.
_STD_PREFIXES = tuple(
    p
    for p in (
        "/usr/", "/bin/", "/opt/", "/Library/", "/System/", "/nix/store/",
        os.path.realpath(sys.base_prefix).rstrip("/") + "/",
        *(
            os.path.join(os.path.realpath(os.path.expanduser("~")), d) + "/"
            for d in (".pyenv", ".local/share/uv", ".asdf", ".local/share/mise", "miniconda3", "anaconda3", "micromamba")
        ),
    )
)
_REAL_INTERPRETER = re.compile(r"^(?:python3(?:\.\d+)*|pytest)$")


def _runner_ok(path: str, root: Path, ran: bool) -> bool:
    """May this project-local runner path be executed? A real file inside the repo only when the session
    itself ran that exact command (`ran`); a symlink out of the repo only when it lands on a real
    interpreter (python3*, pytest) under a standard system or tool prefix. Anything else could be a script
    the repo planted."""
    try:
        real = os.path.realpath(path)
        rroot = os.path.realpath(str(root))
    except (OSError, ValueError):
        return False
    if real == rroot or real.startswith(rroot.rstrip(os.sep) + os.sep):
        return ran
    return bool(_REAL_INTERPRETER.match(os.path.basename(real))) and real.startswith(_STD_PREFIXES)


_LOCAL_PY = re.compile(r"^(?:python|python3|python\d+\.\d+)$")


def _local_runner(argv: list, cwd: Path, root: Path, ran: bool = False) -> list | None:
    """argv with an absolute argv[0] when it is a project-local interpreter or pytest (`.venv/bin/python
    -m pytest ...`, `./venv/bin/pytest`): a path inside the project root whose basename is python,
    python3, pythonX.Y (then only `-m pytest`) or pytest. Else None."""
    first = argv[0]
    if "/" not in first:
        return None
    base = os.path.basename(first)
    if base == "pytest":
        pass
    elif _LOCAL_PY.match(base):
        if argv[1:3] != ["-m", "pytest"]:
            return None
    else:
        return None
    path = os.path.normpath(first if os.path.isabs(first) else os.path.join(str(cwd), first))
    for base_root in {str(Path(root).resolve()), os.path.abspath(str(root))}:
        if path == base_root or path.startswith(base_root.rstrip(os.sep) + os.sep):
            return [path] + argv[1:] if _runner_ok(path, root, ran) else None
    return None


def normalize(command: str, root: Path, ran: bool = False) -> tuple[list, Path] | None:
    """(argv, cwd) for an allowlisted test command, else None. `cwd` is always inside `root`. `ran`: the
    session itself executed this exact command (transcript tool_result), which is what lets a real file
    inside the repo (`./tools/pytest`, a copied venv python) be re-run."""
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
    local = _local_runner(argv, cwd, Path(root).resolve(), ran)
    if local is not None:
        return local, cwd
    return None


def _epoch(ts) -> float | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


_SEG_SPLIT = re.compile(r"\n|&&|;|\|\|")
_CD_ONLY = re.compile(r"^cd\s+(\S+)$")


def runnable_part(command: str, root: Path, ran: bool = False) -> str | None:
    """The allowlisted test command inside a Bash call: the whole call when it is one, else the last
    segment of a compound call (`cat >> CHANGELOG.md <<EOF ... EOF` then `python3 -m pytest -q | tail`)
    that is one, with a preceding plain `cd <dir>` kept as its working directory. Only that segment is
    ever re-run, never the rest of the call."""
    if not isinstance(command, str):
        return None
    if normalize(command, root, ran) is not None:
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
            if cand and normalize(cand, root, ran) is not None:
                found = cand
                break
    return found


_EXIT_ERROR = re.compile(r"\s*Exit code \d+")


def _ran(block: dict, text: str) -> bool:
    """Did the Bash call behind this tool_result actually execute? Only a non-error result, or an error
    that is a command's own non-zero exit (`Exit code N`), counts. A permission denial, a PreToolUse hook
    DENY ("PreToolUse:Bash hook error: ..."), a `<tool_use_error>Blocked` and every other error never ran."""
    if not block.get("is_error"):
        return True
    return _EXIT_ERROR.match(text) is not None


def _result_text(block: dict) -> str:
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(c.get("text", "")) for c in content if isinstance(c, dict))
    return ""


def _executed_bash_cwd(transcript_path: str, started: float | None) -> list:
    """[(command, result_text, cwd)] for the main-thread Bash calls of this run that actually ran: a tool_use
    whose tool_result came back and was not a permission denial. A call that was denied, blocked or never
    answered is not here. Oldest first. Never raises."""
    if not transcript_path or "/subagents/" in transcript_path.replace("\\", "/"):
        return []
    calls: dict = {}
    order: list = []
    results: dict = {}
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"tool_use"' not in line and '"tool_result"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(rec, dict) or rec.get("isSidechain"):
                    continue
                for block in ((rec.get("message") or {}).get("content")) or []:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_use" and block.get("name") == "Bash" and block.get("id"):
                        if started is not None:
                            when = _epoch(rec.get("timestamp"))
                            if when is None or when < started:
                                continue
                        calls[block["id"]] = (
                            str((block.get("input") or {}).get("command") or ""),
                            str(rec.get("cwd") or ""),
                        )
                        order.append(block["id"])
                    elif block.get("type") == "tool_result" and block.get("tool_use_id"):
                        text = _result_text(block)
                        if not _ran(block, text):
                            continue
                        results[block["tool_use_id"]] = text
    except OSError:
        return []
    return [(calls[i][0], results[i], calls[i][1]) for i in order if i in results]


def executed_bash(transcript_path: str, started: float | None) -> list:
    """[(command, result_text)]; see `_executed_bash_cwd`."""
    return [(c, o) for c, o, _ in _executed_bash_cwd(transcript_path, started)]


def last_test_command(transcript_path: str, started: float | None, root: Path) -> str | None:
    """The last main-thread Bash command of this run that `normalize` accepts AND that the session really
    executed (it has a tool_result, not a denial), read from the transcript."""
    last = None
    for command, _ in executed_bash(transcript_path, started):
        part = runnable_part(command, root, ran=True)
        if part is not None:
            last = part
    return last


def _imports_pytest(interp: str, cwd: Path, env: dict, budget: float) -> bool:
    try:
        proc = subprocess.run(
            [interp, "-c", "import pytest"], cwd=str(cwd), env=env, stdin=subprocess.DEVNULL,
            capture_output=True, timeout=max(1.0, min(PROBE_TIMEOUT, budget)),
        )
        return proc.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def _pytest_interpreter(argv: list, cwd: Path, root: Path, env: dict, deadline: float) -> str | None:
    """The interpreter that can import pytest for a `<python> -m pytest` argv: the argv's own when it can,
    else a project venv's (`.venv/bin/python` under cwd, then root). None when no interpreter can."""
    seen, cands = set(), [argv[0]]
    for base in (Path(cwd), Path(root)):
        for rel in (".venv/bin/python", "venv/bin/python"):
            cands.append(str(base / rel))
    for cand in cands:
        if cand in seen:
            continue
        seen.add(cand)
        if os.path.isabs(cand) and not os.access(cand, os.X_OK):
            continue
        if cand != argv[0] and not _runner_ok(cand, root, False):
            continue  # never probe-run a file the repo could have planted
        left = deadline - time.time()
        if left <= 1.0:
            return None
        if _imports_pytest(cand, cwd, env, left):
            return cand
    return None


def rerun(command: str, root: Path, ran: bool = False) -> dict | None:
    """Run the normalized command; {command, argv, cwd, exit, tail, seconds, inconclusive} or None when not
    allowlisted. `inconclusive` is True for a timeout, a runner that is not installed, or no interpreter
    that can import pytest: no verdict either way, never a red."""
    norm = normalize(command, root, ran)
    if norm is None:
        return None
    argv, cwd = norm
    t0 = time.time()
    limit = _timeout()
    deadline = t0 + limit
    env = dict(os.environ)
    env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    inconclusive = False
    if argv[1:3] == ["-m", "pytest"] and (
        argv[0] in ("python", "python3") or os.path.isabs(argv[0])
    ):
        interp = _pytest_interpreter(argv, cwd, Path(root).resolve(), env, deadline)
        if interp is None:
            code, out, inconclusive = (
                127, "no interpreter can import pytest (hook PATH python and project .venv checked)", True,
            )
            argv_run = None
        else:
            argv = [interp] + argv[1:]
            argv_run = argv
    else:
        argv_run = argv
    if argv_run is not None:
        try:
            proc = subprocess.run(
                argv_run, cwd=str(cwd), env=env, stdin=subprocess.DEVNULL, capture_output=True,
                text=True, timeout=max(1.0, deadline - time.time()),
            )
            code, out = proc.returncode, (proc.stdout or "") + (proc.stderr or "")
        except subprocess.TimeoutExpired:
            code, out, inconclusive = 124, f"timed out after {limit:.0f}s", True
        except OSError as exc:
            code, out, inconclusive = 127, str(exc), True
    if code in (4, 5) and any(os.path.basename(a) == "pytest" for a in argv[:4]):
        # pytest usage error / nothing collected (e.g. `-k` matched nothing): no verdict on the code
        inconclusive = True
    return {
        "command": command.strip(),
        "argv": argv,
        "cwd": str(cwd),
        "exit": code,
        "tail": out[-TAIL_CHARS:],
        "seconds": round(time.time() - t0, 2),
        "inconclusive": inconclusive,
    }


def timed_out_before(root: Path, session: str, command: str) -> bool:
    """True when this session's re-run of `command` already timed out. Read-only; fails to False."""
    try:
        data = json.loads((Path(root) / TIMEOUTS_REL).read_text(encoding="utf-8"))
        return command.strip() in (data.get(session) or [])
    except (OSError, ValueError, AttributeError, TypeError):
        return False


def note_timed_out(root: Path, session: str, command: str) -> None:
    """Record that this session's re-run of `command` timed out, so it is not re-run again. Best effort."""
    try:
        path = Path(root) / TIMEOUTS_REL
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        cmds = data.setdefault(session, [])
        if command.strip() not in cmds:
            cmds.append(command.strip())
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.tmp{os.getpid()}")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


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


def _crew_scripts() -> set:
    """The one atlas_crew.py a lead's call may legitimately run: this plugin's own, the sibling of the
    atlas_crew_seal.py that `_unsealed` verifies with. A copy or another path never counts."""
    return {os.path.realpath(Path(__file__).resolve().parent.parent / "scripts" / "atlas_crew.py")}


_SEP = re.compile(r"^[&|;()<>]+$")
_PY = re.compile(r"^python[\d.]*$")
_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def _expand_plugin_root(tok: str) -> str | None:
    """Expand only CLAUDE_PLUGIN_ROOT (from the gate's own env); any other `$`, backtick or unexpanded
    reference refuses the token."""
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if root:
        tok = tok.replace("${CLAUDE_PLUGIN_ROOT}", root).replace("$CLAUDE_PLUGIN_ROOT", root)
    return None if ("$" in tok or "`" in tok) else tok


def _script_after_interpreter(seg: list) -> tuple[str, list] | None:
    """(script token, args after it) when the segment runs a script with python (`python3 -S -u x.py a`,
    `/usr/bin/python3 x.py`, `uv run [--flags] python x.py`), else None. `-m` / `-c` never run a script."""
    i = 0
    while i < len(seg) and _ASSIGN.match(seg[i]):
        i += 1  # VAR=x prefixes
    if i < len(seg) and os.path.basename(seg[i]) == "uv":
        if i + 1 >= len(seg) or seg[i + 1] != "run":
            return None
        i += 2
        while i < len(seg) and seg[i].startswith("-"):
            i += 1
    if i >= len(seg) or not _PY.match(os.path.basename(seg[i])):
        return None
    i += 1
    while i < len(seg) and seg[i].startswith("-"):
        if seg[i] in ("-m", "-c") or seg[i].startswith(("-m", "-c")):
            return None
        i += 1
    if i >= len(seg):
        return None
    return seg[i], seg[i + 1 :]


def _invokes_crew(command: str, cwd: str = "") -> bool:
    """True when the Bash command launches the crew engine itself: `<python> <path>/atlas_crew.py run ...`
    where <path> resolves (CLAUDE_PLUGIN_ROOT expanded, relative paths against `cwd` or a preceding
    `cd <dir> &&`) to this plugin's scripts/atlas_crew.py. `echo atlas_crew r1`, a quoted string or some
    other script named atlas_crew.py do not qualify, and neither does `wait` or any other subcommand: only a
    launch earns credit."""
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        toks = list(lex)
    except ValueError:
        return False
    segments, cur = [], []
    for t in toks:
        if _SEP.match(t):
            segments.append(cur)
            cur = []
        else:
            cur.append(t)
    segments.append(cur)
    allowed = _crew_scripts()
    here = cwd
    for seg in segments:
        if not seg:
            continue
        if seg[0] == "cd" and len(seg) == 2:
            target = _expand_plugin_root(seg[1])
            if target is not None:
                here = target if os.path.isabs(target) else (os.path.join(here, target) if here else "")
            continue
        found = _script_after_interpreter(seg)
        if found is None:
            continue
        script, rest = found
        script = _expand_plugin_root(script)
        if script is None or os.path.basename(script) != "atlas_crew.py" or not rest or rest[0] != "run":
            continue
        if not os.path.isabs(script):
            if not here:
                continue
            script = os.path.join(here, script)
        if os.path.realpath(script) in allowed:
            return True
    return False


def _engine_json(out: str, run_id: str) -> bool:
    """Does this command output hold a JSON object the crew engine emits for `run_id`? Either the summary
    (`run` == id, an int `check_exit`, a `workers` list, no `error`) that `wait` / `run --wait` print, or the
    launch object (`run` == id, ok true, a `workers` list, no `error`). A refusal such as
    {"ok": false, "error": "... never started ..."} names the run id too and never counts."""
    dec = json.JSONDecoder()
    pos = out.find("{")
    while pos != -1:
        try:
            obj, end = dec.raw_decode(out, pos)
        except ValueError:
            pos = out.find("{", pos + 1)
            continue
        pos = out.find("{", end)
        if not isinstance(obj, dict) or obj.get("run") != run_id or "error" in obj:
            continue
        if not isinstance(obj.get("workers"), list):
            continue
        code = obj.get("check_exit")
        if isinstance(code, int) and not isinstance(code, bool):
            return True
        if "check_exit" not in obj and obj.get("ok") is True and "next" in obj:
            return True  # the launch object
    return False


def _unsealed(rundir: Path, summary) -> bool:
    """True when `summary` (the object the caller parsed from this run's summary.json, read once) is not signed by
    the engine that started the run (scripts/atlas_crew_seal.py: a key record under the Atlas home and an HMAC over
    the summary). A summary edited or copied after signing fails here. The seal is no boundary against code run
    as the same user (it can call `create` and `sign`); the launch check in `_engine_run` is what ties a run to
    this plugin's engine. Fails closed."""
    try:
        scripts = str(Path(__file__).resolve().parent.parent / "scripts")
        if scripts not in sys.path:
            sys.path.insert(0, scripts)
        import atlas_crew_seal

        return atlas_crew_seal.verify_obj(rundir, summary) is not None
    except Exception:
        return True


def _engine_run(
    meta_path: Path, meta: dict, summary, started: float | None, transcript_path: str, display: bool = False,
    cwd: str = "",
) -> bool:
    """Is this crew run dir the engine's own work, launched by this session? Nothing on disk is unforgeable
    (the model can write any file), so all three must hold: run.json's run_id equals the directory name,
    the engine's supervisor.log exists, and an executed Bash call of this session (tool_result back, not a
    denial) launched the run with this plugin's scripts/atlas_crew.py `run` and printed the engine's own JSON for the run id (the launch object, or
    the summary `run --wait` prints; a refusal that merely names the id does not count, and a `wait` alone earns nothing), and the
    summary's seal verifies (`_unsealed`).
    Shared by `crew_proof` (green) and `crew_red`."""
    run_id = meta_path.parent.name
    if meta.get("run_id") != run_id or not meta_path.with_name("supervisor.log").is_file():
        return False
    if _unsealed(meta_path.parent, summary):
        return False
    if display and not transcript_path:
        return True  # a display-only caller with no transcript to check: engine files only (see crew_proof)
    return any(
        _invokes_crew(cmd, rec_cwd or cwd) and _engine_json(out, run_id)
        for cmd, out, rec_cwd in _executed_bash_cwd(transcript_path, started)
    )


def crew_proof(
    root: Path, session: str, started: float | None, run_paths=(), transcript_path: str = "",
    display: bool = False, cwd: str = "",
) -> dict | None:
    """A crew run of this session whose engine re-ran the global check green, as a proof dict; else None.
    The crew supervisor (scripts/atlas_crew.py) runs the plan's global check itself after every worker
    stopped, so its summary is the same kind of independent evidence as a gate re-run, once `_engine_run`
    shows the run is the engine's and this session launched it. `display=True` is for callers that only
    show state and waive nothing (atlas_gates.py, the omp panel): with no transcript they accept the engine's
    own files alone and mark the proof `launch_checked: False`. Read-only."""
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
        if not isinstance(summary, dict):
            continue
        if str(meta.get("lead_session") or "").strip() != session:
            continue
        if not (summary.get("ok") is True and summary.get("check_exit") == 0 and summary.get("check")):
            continue
        if not _engine_run(meta_path, meta, summary, started, transcript_path, display, cwd):
            continue
        if started is not None and at < started:
            continue
        if _stale(at, root, run_paths):
            continue
        if best is None or at > best["at"]:
            best = {
                "launch_checked": bool(transcript_path),
                "session": session,
                "at": at,
                "command": summary.get("check"),
                "exit": 0,
                "crew_run": summary.get("run"),
                "evidence": str(summary_path.relative_to(root)),
            }
    return best


def crew_red(
    root: Path, session: str, started: float | None, run_paths=(), transcript_path: str = "", cwd: str = ""
) -> dict | None:
    """A crew run of this session whose engine ran the global check and it stayed RED (summary ok false,
    check_exit a non-zero int, not killed), as a dict; else None. The independent red signal that makes an honest
    `blocked` report credible. Same session/window/staleness rules as `crew_proof`. Read-only."""
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
        if not isinstance(summary, dict):
            continue
        if str(meta.get("lead_session") or "").strip() != session:
            continue
        if summary.get("killed") is True:
            continue  # a run stopped by `kill` never reached its check: not an engine-verified red
        if not _engine_run(meta_path, meta, summary, started, transcript_path, False, cwd):
            continue
        code = summary.get("check_exit")
        if not (summary.get("ok") is False and isinstance(code, int) and not isinstance(code, bool) and code != 0):
            continue
        if started is not None and at < started:
            continue
        if _stale(at, root, run_paths):
            continue
        if best is None or at > best["at"]:
            best = {"session": session, "at": at, "exit": code, "crew_run": summary.get("run")}
    return best
