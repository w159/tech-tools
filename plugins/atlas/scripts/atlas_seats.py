#!/usr/bin/env python3
"""Seat-backend facade: OpenRig (atlas_rig) by default, herdr (atlas_herdr) as fallback.

ATLAS_SEAT_BACKEND=rig|herdr|off overrides detection. Every public function delegates to the chosen module."""

from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_NAMES = (
    "status",
    "ensure",
    "ensure_server",
    "list_panes",
    "create_pane",
    "close_pane",
    "close_run",
    "pane_live",
    "send_prompt",
    "agents",
)


def _node_ok() -> bool:
    try:
        v = subprocess.run(
            ["node", "--version"], capture_output=True, text=True, timeout=5
        ).stdout
        return bool(shutil.which("npm")) and int(
            v.strip().lstrip("v").split(".")[0]
        ) in (22, 24)
    except Exception:
        return False


def backend() -> str:
    """rig | herdr | none. Rig wins when its binary exists or it can be installed silently."""
    env = (os.environ.get("ATLAS_SEAT_BACKEND") or "").strip().lower()
    if env in ("rig", "herdr"):
        return env
    if env == "off":
        return "none"
    rig = importlib.import_module("atlas_rig")
    if rig._bin() or _node_ok():
        return "rig"
    try:
        h = importlib.import_module("atlas_herdr").status()
        if h.get("installed") or h.get("herdr_server"):
            return "herdr"
    except Exception:
        pass
    return "none"


def _mod():
    b = backend()
    if b == "none":
        raise RuntimeError("no seat backend (rig and herdr unavailable)")
    return importlib.import_module("atlas_rig" if b == "rig" else "atlas_herdr")


def _delegate(name):
    return lambda *a, **kw: getattr(_mod(), name)(*a, **kw)


for _n in _NAMES:
    globals()[_n] = _delegate(_n)

_status = status  # the delegating function bound above


def status() -> dict:
    """Backend status plus `backend` and `web_ui` (True only for herdr: the rig url is a health URL, not an iframe)."""
    b = backend()
    return {**_status(), "backend": b, "web_ui": b == "herdr"}


def capture(pane_id, lines: int = 40) -> dict:
    """Recent terminal text of a seat. herdr has no equivalent here; use rpc("pane.read") behind a herdr check."""
    if backend() != "rig":
        return {"ok": False, "error": "not_supported"}
    return importlib.import_module("atlas_rig").capture(pane_id, lines)


# --- herdr-only passthroughs: the dashboard keeps these behind `backend() == "herdr"` ---------


def _herdr():
    return importlib.import_module("atlas_herdr")


def __getattr__(
    name,
):  # PromptRefused / SockError: the exception types callers catch (lazy, no import cycle)
    if name == "PromptRefused":
        return _herdr().PromptRefused
    if name == "SockError":
        return _herdr().HerdrSockError
    raise AttributeError(name)


def rpc(method: str, params: dict | None = None, timeout: float = 0.5) -> dict:
    return _herdr().rpc(method, params, timeout=timeout)


def web_url() -> str:
    """The herdr colony web UI URL (where the Command Center frames panes); independent of the active backend."""
    h = _herdr()
    h._refresh_url()
    return h._where()[1]


def reset_status_cache() -> None:
    """Drop the cached status so the page's next read is fresh."""
    _herdr()._status_cache = None


def main(argv: list[str]) -> int:
    cmds = {
        "backend": lambda: {"backend": backend()},
        **{
            c: globals()[f]
            for c, f in (
                ("status", "status"),
                ("ensure", "ensure"),
                ("list-panes", "list_panes"),
                ("agents", "agents"),
            )
        },
    }
    if len(argv) != 2 or argv[1] not in cmds:
        sys.stderr.write(
            "usage: atlas_seats.py backend|status|ensure|list-panes|agents\n"
        )
        return 2
    out = cmds[argv[1]]()
    print(json.dumps(out, indent=2))
    return 0 if not isinstance(out, dict) or out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
