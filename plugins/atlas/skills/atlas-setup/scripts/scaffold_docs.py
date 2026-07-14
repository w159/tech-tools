#!/usr/bin/env python3
"""Scaffold the durable docs/ single source of truth plus .atlas/ internal state.

Creates two trees from templates/, both idempotent: creates only what is
missing, never overwrites an existing non-empty file. Invoked by
atlas-setup as:

    python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <repo-root>

where <repo-root> defaults to the current working directory. Project
documentation (CHANGELOG.md, ROADMAP.md, AGENTS.md, architecture/,
reference_files/, features/, lessons/, wiki/, specs/, plans/) is scaffolded
at <repo-root>/docs/. Atlas-internal state (evidence/, audits/) is
scaffolded at <repo-root>/.atlas/ directly -- .atlas/ never gets a docs/
subdirectory. This script is stdlib-only and must run under a stock
Python 3 interpreter with no external deps.
"""

import shutil
import sys
from pathlib import Path

# The durable project-doc entries that live under docs/. Each entry is
# (relative_path, is_dir). Directories are created; files are copied from
# templates/.
DURABLE_ENTRIES = [
    ("CHANGELOG.md", False),
    ("ROADMAP.md", False),
    ("AGENTS.md", False),
    ("architecture", True),
    ("reference_files", True),
    ("features", True),
    ("lessons", True),
    ("wiki", True),
    ("specs", True),
    ("plans", True),
]

# Skeleton files inside the docs/ subfolders, seeded from templates/ so the
# folder carries a meaningful placeholder rather than an empty dir.
SEEDED_FILES = [
    "architecture/README.md",
    "wiki/README.md",
    "specs/README.md",
    "lessons/README.md",
    "features/README.md",
    "reference_files/README.md",
    "plans/README.md",
]

# Atlas-internal entries: self-improvement evidence and audit trail. These
# live directly under .atlas/, never under a .atlas/docs/ layer.
ATLAS_ENTRIES = [
    ("evidence", True),
    ("audits", True),
]

ATLAS_SEEDED_FILES = [
    "evidence/.gitkeep",
    "audits/README.md",
]


def templates_dir() -> Path:
    """Resolve the templates/ folder relative to this script's location.

    Relies on the invariant that this script lives at
    <skill>/scripts/scaffold_docs.py and templates/ is a sibling at
    <skill>/templates/. Works correctly under CLAUDE_SKILL_DIR invocation.
    """
    return Path(__file__).resolve().parent.parent / "templates"


def is_non_empty(path: Path) -> bool:
    """A file is non-empty if it has any byte; a dir is non-empty if it has
    any entry that is not itself an empty placeholder."""
    if path.is_file():
        return path.stat().st_size > 0
    if path.is_dir():
        return any(path.iterdir())
    return False


def copy_seed(src: Path, dst: Path) -> str:
    """Copy a template file to dst if dst is missing or empty. Returns a
    one-line status string for the report."""
    if not src.is_file():
        return f"MISSING TEMPLATE: {src} (cannot seed {dst})"
    if dst.exists() and is_non_empty(dst):
        return f"keep existing: {dst}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return f"seeded: {dst}"


def scaffold(root: Path, entries: list, seeded_files: list) -> int:
    """Create the given entries/seeded files at root. Returns the count of
    entries that exist after the run (a healthy run ends with len(entries))."""
    tmpl = templates_dir()
    if not tmpl.is_dir():
        # No templates dir means a broken skill install; fail loud rather
        # than silently producing an empty tree.
        print(f"ERROR: templates dir not found at {tmpl}")
        return 0

    root.mkdir(parents=True, exist_ok=True)
    created = 0

    for rel, is_dir in entries:
        target = root / rel
        if is_dir:
            target.mkdir(parents=True, exist_ok=True)
        else:
            src = tmpl / rel
            print(copy_seed(src, target))
        # Count the entry as present whether we created it or it already
        # existed; the goal is the full set existing at the end.
        if target.exists():
            created += 1

    for rel in seeded_files:
        src = tmpl / rel
        dst = root / rel
        print(copy_seed(src, dst))

    return created


def _scaffold_root(root: Path, entries: list, seeded_files: list, label: str) -> bool:
    """Scaffold one root (idempotent no-op if already non-empty). Returns
    True if the full entry set is present after the run."""
    if root.is_dir() and is_non_empty(root):
        print(f"already scaffolded, skipping: {root}")
        return True
    print(f"Scaffolding {label} at: {root}")
    count = scaffold(root, entries, seeded_files)
    expected = len(entries)
    print(f"{label} entries present: {count}/{expected}")
    return count == expected


def main(argv: list) -> int:
    if len(argv) > 1 and argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0

    repo_root = Path(argv[1] if len(argv) > 1 else Path.cwd()).resolve()
    docs_root = repo_root / "docs"
    atlas_root = repo_root / ".atlas"

    # Legacy-layout guard: a leftover .atlas/docs/ from before this SSOT
    # split is not migrated automatically (it may hold curated content
    # never reconciled into docs/); refuse to scaffold blind.
    legacy = atlas_root / "docs"
    if legacy.is_dir() and is_non_empty(legacy):
        print(
            f"ERROR: legacy {legacy} still exists and is non-empty.\n"
            "  .atlas/ must never contain a docs/ subdirectory. Move any unique\n"
            f"  content into {docs_root}/ and delete {legacy}/ before scaffolding.",
            file=sys.stderr,
        )
        return 1

    docs_ok = _scaffold_root(docs_root, DURABLE_ENTRIES, SEEDED_FILES, "docs/")
    atlas_ok = _scaffold_root(atlas_root, ATLAS_ENTRIES, ATLAS_SEEDED_FILES, ".atlas/")

    if docs_ok and atlas_ok:
        print("OK: full SSOT tree is in place.")
        return 0
    print("INCOMPLETE: some durable entries are missing.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
