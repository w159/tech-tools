"""Locate the armada plugin root, which owns the vendor MCP connectors.

The 13 vendor connectors (.mcp.json, mcp/<vendor>/, their userConfig) moved from
atlas to armada. The atlas dashboard and control plane still show them, so they
read armada's files from here. One resolver, used by atlas_dashboard.py and
atlas_control.py.

Layouts, tried in order:
  source tree   <repo>/plugins/atlas  ->  <repo>/plugins/armada
  install cache <cache>/<marketplace>/atlas/<version>
                ->  <cache>/<marketplace>/armada/<highest version>

Never raises: with no armada install it returns (None, reason).
"""

from __future__ import annotations

import re
from pathlib import Path

_MARKER = Path(".claude-plugin") / "plugin.json"


def _version_key(name: str) -> tuple:
    """Sort key for a version directory name: numeric parts compare as numbers."""
    parts = re.split(r"[.\-+]", name)
    key = []
    for p in parts:
        key.append((1, int(p), "") if p.isdigit() else (0, 0, p))
    return tuple(key)


def _is_plugin_dir(p: Path) -> bool:
    try:
        return (p / _MARKER).is_file()
    except OSError:
        return False


def find_armada_root(atlas_root: Path | str | None = None) -> tuple[Path | None, str]:
    """Return (armada_root, "") or (None, reason) for the armada beside this atlas."""
    root = Path(atlas_root) if atlas_root else Path(__file__).resolve().parent.parent
    source = root.parent / "armada"
    if _is_plugin_dir(source):
        return source, ""
    cache_base = root.parent.parent / "armada"
    versions: list[Path] = []
    try:
        if cache_base.is_dir():
            versions = [
                d for d in cache_base.iterdir() if d.is_dir() and _is_plugin_dir(d)
            ]
    except OSError:
        versions = []
    if versions:
        versions.sort(key=lambda d: _version_key(d.name))
        return versions[-1], ""
    return None, (
        "armada plugin not found beside atlas (vendor connectors now ship in armada); "
        "install armada from the tech-tools marketplace to manage them here"
    )
