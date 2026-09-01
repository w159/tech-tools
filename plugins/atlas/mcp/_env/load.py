#!/usr/bin/env python3
"""Shared env preloader for atlas's Python MCP connectors.

The Python twin of load.mjs: same precedence (ATLAS_ENV_FILE beats CFG_*,
empty or unexpanded CFG_* values are never promoted), then it runs the
connector module as __main__.

Empty-string promotion matters here: a vendored server that reads
os.environ.get("X", default) would take "" over its own default, so an
unconfigured connector must see the variable unset, not blank.

stdout is reserved for JSON-RPC; diagnostics go to stderr only.

Usage: python load.py <module.to.run>
"""

import os
import runpy
import sys


def _load_env_file(path: str) -> None:
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.read().split("\n")
    except OSError as err:
        print(f"[atlas env] failed to load {path}: {err}", file=sys.stderr)
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
        if key:
            os.environ[key] = value


def _promote_cfg() -> None:
    for key in list(os.environ):
        if not key.startswith("CFG_"):
            continue
        name = key[4:]
        value = os.environ[key]
        unexpanded = value.startswith("${") and value.endswith("}")
        if name not in os.environ and value and not unexpanded:
            os.environ[name] = value


def main() -> None:
    if len(sys.argv) < 2:
        print("[atlas env] usage: load.py <module.to.run>", file=sys.stderr)
        sys.exit(2)
    env_file = os.environ.get("ATLAS_ENV_FILE")
    if env_file and os.path.isfile(env_file):
        _load_env_file(env_file)
    _promote_cfg()
    module = sys.argv[1]
    # The connector parses sys.argv itself; hand it a clean argv.
    sys.argv = [module] + sys.argv[2:]
    runpy.run_module(module, run_name="__main__")


if __name__ == "__main__":
    main()
