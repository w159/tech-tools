#!/usr/bin/env python3
"""Scaffold the minimal docs/ wiki plus the atlas-internal .atlas/ state.

Creates two trees from templates/, both idempotent: creates only what is
missing, never overwrites an existing non-empty file. Invoked by
atlas-setup as:

    python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <repo-root>

where <repo-root> defaults to the current working directory.

SSOT contract (minimal at a minimum, dynamic thereafter):
  docs/        -- the project wiki. Minimum: CHANGELOG.md (done, verified),
                  ROADMAP.md (planned, in-flight, blocked, deferred). Additional
                  subfolders grow as the project needs them: architecture/,
                  plans/, specs/, audits/, lessons/, features/, decisions/,
                  wiki/ (graphify results), etc.
  .atlas/      -- atlas's own auditable operational state for self-improvement:
                  evidence/ (durable, tracked), .run/ (ephemeral except
                  findings.json; tracked anyway by the repo's deny-by-default
                  .gitignore policy), self-improvement/, memory/, nudge/.
  .atlas/      -- NEVER contains project wiki content (architecture, plans,
                  specs, audits, lessons, wiki). Those belong in docs/. A
                  leftover .atlas/ with any of those subdirs is a defect.

This script is stdlib-only and must run under a stock Python 3 interpreter
with no external deps.
"""

import shutil
import sys
from pathlib import Path

# Minimum durable project-wiki entries. Additional subfolders (architecture/,
# plans/, specs/, graphify/, decisions/, etc.) are created on demand by
# atlas skills, not by this scaffold.
DURABLE_ENTRIES = [
    ("CHANGELOG.md", False),
    ("ROADMAP.md", False),
]

# Atlas-internal entries: the auditable tracking surface for self-improvement.
# .run/ is created by the orchestration hooks on first session, not by this
# scaffold, but is allowlisted here so a fresh repo gets the directory tree
# shape right away. The full set covers evidence, self-improvement, memory,
# nudge, and .run. Project wiki content (architecture, plans, specs, audits,
# lessons, wiki) is NOT here — those grow dynamically in docs/.
ATLAS_ENTRIES = [
    ("evidence", True),
    ("self-improvement", True),
    ("memory", True),
    ("nudge", True),
    (".run", True),
]

# Skeleton files inside atlas-internal subfolders. Seeded from templates/ so
# the directory carries a meaningful placeholder rather than an empty dir.
# docs/ has no seeded subfolders -- the wiki is dynamic and grows on demand.
# .run/ is ephemeral, populated by orchestration hooks on first session, and
# intentionally has no seeded template file.
ATLAS_SEEDED_FILES = [
    "evidence/.gitkeep",
    "self-improvement/.gitkeep",
    "memory/.gitkeep",
    "nudge/.gitkeep",
]

# First-level subdir names under a legacy .atlas/ that hold only
# ephemeral orchestration state and do NOT indicate curated content. A
# .run/ marker is overwritten by the next session anyway; treating it as
# curated traps any operator whose orchestration hook wrote a marker after
# the SSOT split.
EPHEMERAL_LEGACY_NAMES = frozenset({".run", ".DS_Store", "departments"})

# Project wiki subdirs that, if present under .atlas/, mean the project
# wiki and atlas-internal state have been conflated. These belong in docs/.
# The scaffold refuses to proceed if any of these are found with content.
WIKI_SUBDIRS_IN_ATLAS = frozenset({
    "architecture", "audits", "plans", "specs", "lessons", "wiki",
    "features", "decisions", "reference",
})

# Durable root files that, if present under a legacy .atlas/docs/, mean the
# legacy dir holds curated content that must be migrated by hand.
LEGACY_DURABLE_SIBLINGS = (
    "CHANGELOG.md",
    "ROADMAP.md",
    "AGENTS.md",
)


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


def has_durable_legacy_content(legacy: Path) -> bool:
    """True if a leftover .atlas/docs/ holds durable curated content that
    must be migrated by hand. False if legacy holds only ephemeral state
    (a .run/ marker, an active file) that the orchestration hooks will
    overwrite on next session anyway.

    A legacy dir is considered to hold curated content when ANY of the
    durable-sibling files (CHANGELOG.md, ROADMAP.md, AGENTS.md) is present
    at the legacy root, OR any of the known durable subfolders
    (architecture/, plans/, specs/, audits/, evidence/, wiki/, etc.) is
    present with content.
    """
    if not legacy.is_dir():
        return False
    for sibling in LEGACY_DURABLE_SIBLINGS:
        if (legacy / sibling).is_file():
            return True
    # Any first-level subdir of the legacy tree that already has content
    # beyond ephemeral orchestration state is curated. We treat any
    # non-empty, non-ephemeral first-level entry as curated; this is
    # conservative (false positives are fine -- they surface "I had
    # something here" to the operator) without being over-broad (a .run/
    # marker does not block).
    try:
        for child in legacy.iterdir():
            if child.name in EPHEMERAL_LEGACY_NAMES:
                continue
            if is_non_empty(child):
                return True
    except OSError:
        return True  # can't read -> fail closed (block), to be safe
    return False


def has_wiki_content_in_atlas(atlas_root: Path) -> list:
    """Return list of project wiki subdirs found under .atlas/ that should
    be in docs/ instead. Empty list if .atlas/ is clean.
    """
    found = []
    if not atlas_root.is_dir():
        return found
    for name in WIKI_SUBDIRS_IN_ATLAS:
        candidate = atlas_root / name
        if candidate.is_dir() and is_non_empty(candidate):
            found.append(name)
    return found


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

    # Legacy-layout guard 1: a leftover .atlas/docs/ that holds durable
    # curated content is not migrated automatically (it may hold content
    # never reconciled into docs/); refuse to scaffold blind. Ephemeral-
    # only legacy (a stray .run/ marker) is allowed to proceed -- it is
    # orchestration hook state, not curated wiki content.
    legacy = atlas_root / "docs"
    if has_durable_legacy_content(legacy):
        print(
            f"ERROR: legacy {legacy} still holds durable curated content.\n"
            "  .atlas/ must never contain a docs/ subdirectory. Move any unique\n"
            f"  content into {docs_root}/ and delete {legacy}/ before scaffolding.",
            file=sys.stderr,
        )
        return 1

    # Legacy-layout guard 2: project wiki content found directly under .atlas/
    # (e.g. .atlas/architecture/, .atlas/plans/, .atlas/specs/, .atlas/audits/).
    # These belong in docs/. The scaffold refuses to proceed until they are moved.
    wiki_in_atlas = has_wiki_content_in_atlas(atlas_root)
    if wiki_in_atlas:
        print(
            f"ERROR: project wiki content found under {atlas_root}/: {', '.join(wiki_in_atlas)}\n"
            "  .atlas/ must never contain project wiki subdirs. Move them to\n"
            f"  {docs_root}/ before scaffolding.",
            file=sys.stderr,
        )
        return 1

    docs_ok = _scaffold_root(docs_root, DURABLE_ENTRIES, [], "docs/")
    atlas_ok = _scaffold_root(atlas_root, ATLAS_ENTRIES, ATLAS_SEEDED_FILES, ".atlas/")

    if docs_ok and atlas_ok:
        print("OK: minimal wiki + atlas-internal trees are in place.")
        return 0
    print("INCOMPLETE: some durable entries are missing.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
