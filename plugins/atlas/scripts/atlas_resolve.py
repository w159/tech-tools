#!/usr/bin/env python3
"""Deterministic subagent scope resolver: (task_class, effort) -> team shape.

Pure stdlib. Data lives in contracts/scope-matrix.json, shared with
omp/resolve.ts (identical semantics). CLI: atlas_resolve.py <class> <effort> [--paths a,b]
"""

import json
import posixpath
import sys
from pathlib import Path

MATRIX = Path(__file__).resolve().parents[1] / "contracts" / "scope-matrix.json"


def normalize_paths(paths):
    """Sorted, de-duplicated, posix-normalized, no leading './'."""
    return sorted(
        {posixpath.normpath(p.strip()) for p in (paths or []) if p and p.strip()}
    )


def resolve(task_class, effort, paths=None):
    classes = json.loads(MATRIX.read_text())["classes"]
    if task_class not in classes:
        raise ValueError(f"unknown task_class {task_class!r}; known: {sorted(classes)}")
    cell = classes[task_class].get(effort)
    if cell is None:
        raise ValueError(
            f"unknown effort {effort!r}; known: {sorted(classes[task_class])}"
        )
    return {
        "task_class": task_class,
        "effort": effort,
        **cell,
        "file_scope": normalize_paths(paths),
    }


def main(argv):
    if argv[:1] in (["-h"], ["--help"]):
        print("usage: atlas_resolve.py <class> <effort> [--paths a,b]")
        return 0
    if len(argv) < 2:
        print("usage: atlas_resolve.py <class> <effort> [--paths a,b]", file=sys.stderr)
        return 2
    paths = argv[argv.index("--paths") + 1].split(",") if "--paths" in argv else None
    try:
        print(json.dumps(resolve(argv[0], argv[1], paths), sort_keys=True))
    except ValueError as e:
        print(e, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
