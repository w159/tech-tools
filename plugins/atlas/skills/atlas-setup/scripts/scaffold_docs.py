#!/usr/bin/env python3
"""Scaffold the durable .atlas/docs/ single source of truth.

Creates the docs tree from templates/. Idempotent: creates only what is
missing, never overwrites an existing non-empty file. Invoked by
atlas-setup as:

    python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <root>

where <root> defaults to <repo-root>/.atlas/docs. This script is stdlib-only
and must run under a stock Python 3 interpreter with no external deps.
"""

import shutil
import sys
from pathlib import Path

# The durable entries the SSOT must contain. Each entry is (relative_path,
# is_dir). Directories are created; files are copied from templates/.
DURABLE_ENTRIES = [
    ("CHANGELOG.md", False),
    ("ROADMAP.md", False),
    ("AGENTS.md", False),
    ("evidence", True),
    ("architecture", True),
    ("reference_files", True),
    ("audits", True),
    ("features", True),
    ("lessons", True),
    ("wiki", True),
    ("specs", True),
    ("plans", True),
]

# Files inside subfolders that also need seeding (relative to root). Each is
# copied from templates/ so the folder carries a meaningful skeleton, not an
# empty dir.
SEEDED_FILES = [
    "evidence/.gitkeep",
    "architecture/README.md",
    "wiki/README.md",
    "specs/README.md",
    "lessons/README.md",
    "audits/README.md",
    "features/README.md",
    "reference_files/README.md",
    "plans/README.md",
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


def scaffold(root: Path) -> int:
    """Create the docs tree at root. Returns the count of durable entries
    that exist after the run (a healthy run ends with len(DURABLE_ENTRIES))."""
    tmpl = templates_dir()
    if not tmpl.is_dir():
        # No templates dir means a broken skill install; fail loud rather
        # than silently producing an empty tree.
        print(f"ERROR: templates dir not found at {tmpl}")
        return 0

    root.mkdir(parents=True, exist_ok=True)
    created = 0

    for rel, is_dir in DURABLE_ENTRIES:
        target = root / rel
        if is_dir:
            target.mkdir(parents=True, exist_ok=True)
        else:
            src = tmpl / rel
            status = copy_seed(src, target)
            print(status)
        # Count the entry as present whether we created it or it already
        # existed; the goal is the full set existing at the end.
        if target.exists():
            created += 1

    # Seed the skeleton files inside the subfolders.
    for rel in SEEDED_FILES:
        src = tmpl / rel
        dst = root / rel
        status = copy_seed(src, dst)
        print(status)

    return created


def main(argv: list) -> int:
    if len(argv) > 1 and argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0

    # Default to <cwd>/.atlas/docs when no root is given. Callers pass the
    # repo root's .atlas/docs explicitly in practice.
    root_str = argv[1] if len(argv) > 1 else str(Path.cwd() / ".atlas" / "docs")
    root = Path(root_str).resolve()

    # Abort gate: a non-empty .atlas/docs/ is already scaffolded. Re-running
    # would only waste time (the original 828-file "took FOREVER" escalation)
    # and risk clobbering curated content. True idempotent no-op: exit 0
    # without creating or overwriting anything.
    if root.is_dir() and is_non_empty(root):
        print(f"already scaffolded, skipping: {root}")
        return 0

    # Dual-SSOT guard: if a root-level docs/ tree already declares the SSOT
    # markers (CHANGELOG.md / ROADMAP.md / AGENTS.md), scaffolding .atlas/docs/
    # creates a competing source of truth. Warn to stderr so the operator can
    # reconcile, but still proceed to fill only missing entries (idempotent).
    repo_root = root.parent.parent
    root_docs = repo_root / "docs"
    ssot_markers = ("CHANGELOG.md", "ROADMAP.md", "AGENTS.md")
    present_markers = [m for m in ssot_markers if (root_docs / m).is_file()]
    if present_markers:
        print(
            "WARNING: dual-SSOT conflict detected.\n"
            f"  Existing root docs/ tree: {root_docs}\n"
            f"  Scaffolding .atlas/docs/ tree: {root}\n"
            "  Both declare SSOT markers "
            f"({', '.join(present_markers)}). "
            "Reconcile into one source of truth to avoid drift.",
            file=sys.stderr,
        )

    print(f"Scaffolding .atlas/docs/ at: {root}")
    count = scaffold(root)
    expected = len(DURABLE_ENTRIES)
    print(f"\nDurable entries present: {count}/{expected}")
    if count == expected:
        print("OK: full SSOT tree is in place.")
        return 0
    print("INCOMPLETE: some durable entries are missing.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
