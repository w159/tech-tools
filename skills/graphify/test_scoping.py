#!/usr/bin/env python3
"""WS3 probe: prove graphify's per-root scoping and extra_excludes work against the
real installed engine, BEFORE the SKILL.md documents them.

Runs `detect()` on a single small source root and asserts:
  1. the root is non-empty and under the 200-file size gate (so per-root scoping avoids
     the interactive stall that whole-monorepo scope triggers), and
  2. `extra_excludes` actually drops matching files (the mechanism the skill forwards).

graphify is installed as a uv tool, not into system python, so this script self-locates
graphify's interpreter and re-execs under it. If graphify cannot be found at all, it SKIPs
(exit 0) rather than hard-failing, so the suite stays green on machines without graphify.

Usage:
  python3 skills/graphify/test_scoping.py            # default root: a small MCP server src
  python3 skills/graphify/test_scoping.py --root <p> # probe a specific root
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NoReturn

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ROOT = "mcp_servers/cipp-mcp/src"
SIZE_GATE_FILES = 200


def _find_graphify_python():
    """Return a python interpreter that can import graphify, or None."""
    # Already runnable in this interpreter?
    try:
        import graphify.detect  # noqa: F401

        return sys.executable
    except Exception:
        pass
    # The uv-tool install: derive the interpreter from the `graphify` launcher shebang.
    launcher = shutil.which("graphify")
    if launcher:
        try:
            first = Path(launcher).read_text(errors="ignore").splitlines()[0]
            if first.startswith("#!"):
                cand = first[2:].strip()
                if Path(cand).exists():
                    return cand
        except Exception:
            pass
    # Conventional uv tool location.
    cand = Path.home() / ".local/share/uv/tools/graphifyy/bin/python"
    if cand.exists():
        return str(cand)
    return None


def _skip(msg) -> NoReturn:
    print("SKIP: " + msg)
    sys.exit(0)


def main():
    root_arg = DEFAULT_ROOT
    if "--root" in sys.argv:
        root_arg = sys.argv[sys.argv.index("--root") + 1]
    root = (REPO_ROOT / root_arg).resolve()

    interp = _find_graphify_python()
    if interp is None:
        _skip(
            "graphify not installed; cannot probe scoping (install graphifyy to run this)."
        )

    # Re-exec under graphify's interpreter if we are not already there.
    if interp != sys.executable and not os.environ.get("_GRAPHIFY_PROBE_REEXEC"):
        env = dict(os.environ, _GRAPHIFY_PROBE_REEXEC="1")
        sys.exit(subprocess.call([interp, __file__, "--root", str(root_arg)], env=env))

    try:
        from graphify.detect import detect
    except Exception as e:  # pragma: no cover - guarded by _find_graphify_python
        _skip("graphify import failed under %s: %s" % (interp, e))

    if not root.exists():
        _skip("probe root %s does not exist on this checkout" % root)

    base = detect(root)
    n = base.get("total_files", 0)
    w = base.get("total_words", 0)
    assert n > 0, "expected a non-empty root, got total_files=%s for %s" % (n, root)
    assert n <= SIZE_GATE_FILES, (
        "per-root scope %s has %s files (> %s gate); pick a smaller root for the probe"
        % (root, n, SIZE_GATE_FILES)
    )

    # extra_excludes must measurably drop files. Exclude the dominant code extension.
    excluded = detect(root, extra_excludes=["**/*.ts", "**/*.js", "**/*.py"])
    n2 = excluded.get("total_files", 0)
    assert n2 < n, (
        "extra_excludes did not reduce the file count (%s -> %s); scoping mechanism broken"
        % (n, n2)
    )

    print(
        "PASS: root=%s total_files=%s total_words=%s (<= %s gate)"
        % (root_arg, n, w, SIZE_GATE_FILES)
    )
    print("PASS: extra_excludes dropped files %s -> %s" % (n, n2))


if __name__ == "__main__":
    main()
