#!/usr/bin/env python3
"""atlas_launch -- start an agent session as a DETACHED herdr pane (tmux window only as the explicit fallback).

launch(root, name, prompt, ...) -> {"ok", "session", "window", "target", "attach", "prompt_file", "started_at", "reason"}
is_live(target)                 -> `herdr:<pane>` exists in herdr, or a tmux window exists and its pane is not dead

Transport (atlas_mux.transport): herdr by default (workspace `atlas-<run>`, one tab per worker, created over the
herdr socket); tmux when ATLAS_COLONY_TRANSPORT=tmux or herdr is not running. Never attaches, focuses or opens a UI.
Interactive: `omp --cwd <cwd> @<prompt_file>` in a pane that carries ATLAS_PROJECT_ROOT, ATLAS_WORKER_NAME and the
FORWARDED_ENV lead env. Headless: atlas_mux `spawn` (omp -p, agent role, exits when done).
Both force ATLAS_MUX=tmux (the mux opt-in gate) in the CHILD env only and strip every CMUX_* var / cmux shim.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_mux  # noqa: E402

_BAD = re.compile(r"[^A-Za-z0-9_-]")
_MAX_NAME = 40


def _sanitize(name: str) -> str:
    return _BAD.sub("_", str(name or "").strip())[:_MAX_NAME].strip("_") or "agent"


def _unique(taken: set, name: str) -> str:
    base, n, out = name, 1, name
    while out in taken:
        n += 1
        suffix = f"-{n}"
        out = base[: _MAX_NAME - len(suffix)] + suffix
    return out


def _binary(harness: str, env: dict) -> str | None:
    """Absolute harness path; omp prefers ~/.bun/bin/omp, and cmux shims are never picked."""
    if harness == "omp":
        bun = Path.home() / ".bun" / "bin" / "omp"
        if bun.is_file() and os.access(bun, os.X_OK):
            return str(bun)
    found = shutil.which(harness, path=env.get("PATH"))
    return (
        found
        if found and ".cmuxterm" not in found and "cmux-cli-shims" not in found
        else None
    )


def _child_env(extra: dict | None) -> dict:
    env = atlas_mux.clean_env()
    env.update(
        {
            str(k): str(v)
            for k, v in (extra or {}).items()
            if not str(k).startswith("CMUX_")
        }
    )
    env["ATLAS_MUX"] = "tmux"
    return env


def _fail(reason: str, **kw) -> dict:
    return {
        "ok": False,
        "reason": reason,
        "session": None,
        "window": None,
        "target": None,
        "attach": None,
        "prompt_file": None,
        "started_at": None,
        **kw,
    }


def _write_prompt(root: str, window: str, prompt: str) -> str:
    d = Path(root) / ".atlas" / ".run" / "launch"
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{window}-{int(time.time())}.md"
    path.write_text(prompt, encoding="utf-8")
    return str(path)


def _ensure_session(session: str, cwd: str) -> str | None:
    if atlas_mux._tmux("has-session", "-t", session).returncode == 0:
        return None
    res = atlas_mux._tmux("new-session", "-d", "-s", session, "-n", "lead", "-c", cwd)
    return (
        None
        if res.returncode == 0
        else f"tmux new-session failed: {res.stderr.strip()}"
    )


def _taken(use: str, run: str) -> set:
    """Worker names already in use in this run on the chosen transport."""
    if use == "herdr":
        import atlas_herdr

        try:
            return {p["label"] for p in atlas_herdr.list_panes(run)}
        except atlas_herdr.HerdrSockError:
            return set()
    return {w["name"] for w in (atlas_mux._windows(atlas_mux._session(run)) or [])}


def launch(
    root: str,
    name: str,
    prompt: str,
    *,
    harness: str = "omp",
    agent: str | None = None,
    interactive: bool = True,
    cwd: str | None = None,
    run: str = "work",
    env: dict | None = None,
) -> dict:
    root = os.path.abspath(root)
    cwd = os.path.abspath(cwd or root)
    if not atlas_mux.NAME_RE.match(run or ""):
        return _fail(f"invalid run {run!r}: use [A-Za-z0-9_-]")
    if harness not in ("omp", "claude"):
        return _fail(f"unsupported harness {harness!r}")
    env = dict(env or {})
    # The channel comes from the launching lead (explicit env, else its own process env);
    # a launch with neither lands in `<main>/lead`, never in whichever lead opened last.
    env_chan, env_lead = atlas_mux.atlas_todo.env_channel(root)
    chan = (env.get("ATLAS_CHANNEL") or env_chan).strip()
    lead = (env.get("ATLAS_LEAD_NAME") or env_lead).strip()
    use = atlas_mux.transport()
    if use == "tmux" and not shutil.which(
        "tmux", path=atlas_mux.clean_env().get("PATH")
    ):
        return _fail("tmux not found on PATH (and herdr is not running)")
    session = atlas_mux._session(run)
    if use == "tmux":
        err = _ensure_session(session, cwd)
        if err:
            return _fail(err)
    window = _unique(_taken(use, run), _sanitize(name))
    # Membership is granted here, on the lead side, before the worker exists.
    chan = atlas_mux.atlas_todo.register_member(root, window, chan, lead or None)
    env["ATLAS_CHANNEL"] = chan
    env["ATLAS_LEAD_NAME"] = lead or str(
        (atlas_mux.atlas_todo.get_channel(root, chan) or {}).get("lead") or "lead"
    )
    child = _child_env(env)
    prompt_file = _write_prompt(root, window, prompt)
    started = time.time()
    pane_id = None
    if interactive:
        binary = _binary(harness, child)
        if not binary:
            return _fail(
                f"{harness} binary not found (cmux shims are skipped)",
                prompt_file=prompt_file,
            )
        cmd = (
            [binary, "--cwd", cwd, f"@{prompt_file}"]
            if harness == "omp"
            else [binary, prompt]
        )
        pane_env = {
            "ATLAS_PROJECT_ROOT": root,
            "ATLAS_WORKER_NAME": window,
            "PATH": child.get("PATH", ""),
        }
        pane_env.update(
            {k: os.environ[k] for k in atlas_mux.FORWARDED_ENV if os.environ.get(k)}
        )
        pane_env.update({k: v for k, v in child.items() if k in (env or {})})
        pane = atlas_mux.pane_command(pane_env, cmd)
        if use == "herdr":
            import atlas_herdr

            made = atlas_herdr.create_pane(window, pane, cwd=cwd, run=run, env=pane_env)
            if not made["ok"]:
                return _fail(made["reason"], prompt_file=prompt_file)
            pane_id = made["pane_id"]
            atlas_mux.atlas_todo.set_member_handles(
                root, window, chan or None, pane_id=pane_id
            )
        else:
            res = atlas_mux._tmux(
                "new-window", "-d", "-t", f"{session}:", "-n", window, "-c", cwd, pane
            )
            if res.returncode != 0:
                return _fail(
                    f"tmux new-window failed: {res.stderr.strip()}",
                    prompt_file=prompt_file,
                )
            atlas_mux._tmux(
                "set-option", "-w", "-t", f"{session}:{window}", "remain-on-exit", "on"
            )
    else:
        argv = [
            sys.executable,
            str(Path(atlas_mux.__file__).resolve()),
            "spawn",
            "--run",
            run,
            "--name",
            window,
            "--harness",
            harness,
            "--agent",
            agent or "implementer",
            "--prompt-file",
            prompt_file,
            "--root",
            root,
            "--cwd",
            cwd,
        ]
        out = subprocess.run(argv, capture_output=True, text=True, env=child, cwd=root)
        try:
            data = json.loads(out.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            data = {
                "ok": False,
                "error": (out.stderr or out.stdout).strip()
                or "mux spawn gave no output",
            }
        if not data.get("ok"):
            return _fail(
                str(data.get("error") or "mux spawn failed"), prompt_file=prompt_file
            )
    if use == "herdr":
        import atlas_herdr

        target = f"herdr:{pane_id}" if pane_id else f"{session}:{window}"
        attach = f"{atlas_herdr.HERDR_URL}/"
    else:
        target = f"{session}:{window}"
        attach = f"tmux attach -t {target}"
    return {
        "ok": True,
        "session": session,
        "window": window,
        "target": target,
        "attach": attach,
        "prompt_file": prompt_file,
        "started_at": started,
        "reason": None,
    }


def is_live(target: str) -> bool:
    """A `herdr:<pane>` target is live while the pane exists; anything else is a tmux `session:window`."""
    if not target:
        return False
    if target.startswith("herdr:"):
        import atlas_herdr

        return atlas_herdr.pane_live(target[len("herdr:") :])
    try:
        res = atlas_mux._tmux("list-panes", "-t", target, "-F", "#{pane_dead}")
    except OSError:
        return False
    return res.returncode == 0 and "0" in res.stdout.split()


def kill(target: str) -> None:
    """Close one launched worker (a `herdr:<pane>` pane, or a tmux window). Best effort, never raises."""
    if not target:
        return
    if target.startswith("herdr:"):
        import atlas_herdr

        atlas_herdr.close_pane(target[len("herdr:") :])
    else:
        atlas_mux._tmux("kill-window", "-t", target)


def attach_hint(target: str) -> str:
    """How a human reaches a launched worker: the colony web UI for a herdr pane, `tmux attach` otherwise."""
    if target.startswith("herdr:"):
        import atlas_herdr

        return f"{atlas_herdr.HERDR_URL}/?pane={target[len('herdr:') :]}&machine=local"
    return f"tmux attach -t {target}"
