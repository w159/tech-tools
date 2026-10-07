#!/usr/bin/env python3
"""Shared env preloader for atlas's Python MCP connectors.

The Python twin of load.mjs: same precedence (shell exports beat ATLAS_ENV_FILE,
which beats the default file, which beats CFG_*; empty or unexpanded values are
never used), then it runs the connector module as __main__.

Empty-string promotion matters here: a vendored server that reads
os.environ.get("X", default) would take "" over its own default, so an
unconfigured connector must see the variable unset, not blank.

stdout is reserved for JSON-RPC; diagnostics go to stderr only.

Usage: python load.py <module.to.run>
"""

import os
import runpy
import sys


def _is_unexpanded(value: str) -> bool:
    return value.startswith("${") and value.endswith("}")


def _is_usable(value: str) -> bool:
    return bool(value) and not _is_unexpanded(value)


def _note(msg: str) -> None:
    # Names only, never values: stderr is the one place a diagnostic may go.
    print(f"[atlas env] {msg}", file=sys.stderr)


def _load_env_file(path: str, label: str, shell_keys: set) -> None:
    """Fill os.environ from a KEY=VALUE file; variables the shell exported win."""
    if not os.path.isfile(path):
        _note(f"{label} not found: {path} (skipped)")
        return
    try:
        if os.stat(path).st_mode & 0o077:
            _note(f"{path} is group/world-readable; run chmod 600")
        with open(path, encoding="utf-8") as handle:
            lines = handle.read().split("\n")
    except OSError as err:
        _note(f"failed to load {path}: {err}")
        return
    for line in lines:
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        key, sep, value = trimmed.partition("=")
        if not sep:
            continue
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        # A blank `KEY=` line (the `.env.example` convention) or an unexpanded
        # `${...}` placeholder is never a value.
        if not key or not _is_usable(value):
            continue
        if key in shell_keys:
            if os.environ.get(key) != value:
                _note(f"{key}: shell export wins over {path}")
            continue
        os.environ[key] = value


def _promote_cfg(shell_keys: set) -> None:
    for key in list(os.environ):
        if not key.startswith("CFG_"):
            continue
        name = key[4:]
        value = os.environ[key]
        if not _is_usable(value):
            continue
        if name not in os.environ:
            os.environ[name] = value
        elif os.environ[name] != value and name not in shell_keys:
            _note(
                f"{name}: env file value wins over saved userConfig ({key}); "
                "update or remove the file entry"
            )


def main() -> None:
    if len(sys.argv) < 2:
        print("[atlas env] usage: load.py <module.to.run>", file=sys.stderr)
        sys.exit(2)
    # Precedence (highest first): variables exported by the launching shell,
    # ATLAS_ENV_FILE, the per-user default file, then CFG_<NAME> (userConfig)
    # filling any remaining gap.
    shell_keys = {k for k, v in os.environ.items() if _is_usable(v)}
    default_env_file = os.path.join(
        os.path.expanduser("~"), ".config", "atlas", "atlas.env"
    )
    _load_env_file(default_env_file, "default env file", shell_keys)
    env_file = os.environ.get("ATLAS_ENV_FILE")
    if env_file:
        _load_env_file(env_file, "ATLAS_ENV_FILE", shell_keys)
    _promote_cfg(shell_keys)
    module = sys.argv[1]
    # The connector parses sys.argv itself; hand it a clean argv.
    sys.argv = [module] + sys.argv[2:]
    runpy.run_module(module, run_name="__main__")


if __name__ == "__main__":
    main()
