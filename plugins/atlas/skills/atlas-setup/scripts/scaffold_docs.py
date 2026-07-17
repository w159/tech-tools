#!/usr/bin/env python3
"""Scaffold + repair the full canonical docs/ + .atlas/ + root-file structure.

Creates every tree from templates/, all idempotent: creates only what is
missing, never overwrites an existing non-empty file. Safe to re-run on a
partially-scaffolded repo (repair) as well as an empty one. Invoked by
atlas-setup as:

    python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <repo-root>

where <repo-root> defaults to the current working directory.

SSOT contract (see atlas-loop/references/docs-ssot.md, authoritative):
  <root>/      -- README.md, AGENTS.md, CLAUDE.md: human/agent entry points.
  docs/        -- the project wiki. Minimum: CHANGELOG.md, ROADMAP.md,
                  AGENTS.md, plus always-applicable base subfolders
                  (architecture/, decisions/, plans/, specs/, features/,
                  lessons/, wiki/). Project-adaptive: api/ + endpoints.md,
                  created only when an API signal is detected.
  .atlas/      -- atlas's own auditable operational state for self-improvement:
                  evidence/, findings/ (+ INDEX.md), audits/, decisions/,
                  archive/, understand-anything/, graphify/, self-improvement/,
                  memory/, nudge/, plus CLAUDE.md + AGENTS.md orientation.
                  .run/ is the only ephemeral subtree.
  .atlas/      -- NEVER contains project wiki content (architecture, plans,
                  specs, lessons, wiki, features, reference). Those belong in
                  docs/. A leftover .atlas/ with any of those subdirs is a
                  defect. (.atlas/audits/ and .atlas/decisions/ ARE legitimate
                  atlas-internal names, distinct from their docs/ namesakes.)
  <root>/.gitignore -- ensured present; content is owned by the
                  atlas-gitignore skill, never authored here.

This script is stdlib-only and must run under a stock Python 3 interpreter
with no external deps.
"""

import shutil
import sys
from pathlib import Path

# Minimum durable docs/ entries: the two root files plus the always-
# applicable base subfolders (each seeded with a placeholder README.md via
# DOCS_SEEDED_FILES below). Project-adaptive subfolders (api/) are handled
# separately, gated on API detection.
DURABLE_ENTRIES = [
    ("CHANGELOG.md", False),
    ("ROADMAP.md", False),
    ("architecture", True),
    ("decisions", True),
    ("plans", True),
    ("specs", True),
    ("features", True),
    ("lessons", True),
    ("wiki", True),
]

DOCS_SEEDED_FILES = [
    "architecture/README.md",
    "decisions/README.md",
    "plans/README.md",
    "specs/README.md",
    "features/README.md",
    "lessons/README.md",
    "wiki/README.md",
]

# docs/AGENTS.md uses a distinctly-named template (docs-agents.md) because
# its destination filename collides with the root and .atlas AGENTS.md seeds.
DOCS_ROOT_FILES = {
    "AGENTS.md": "docs-agents.md",
}

# Project-adaptive: created only when detect_api() finds a signal.
DOCS_API_ENTRIES = [("api", True)]
DOCS_API_SEEDED_FILES = ["api/README.md"]
DOCS_API_ROOT_FILES = {"endpoints.md": "endpoints.md"}

# Root entry-point files, always at the repo root beside .git.
ROOT_FILES = {
    "README.md": "README.md",
    "AGENTS.md": "AGENTS.md",
    "CLAUDE.md": "CLAUDE.md",
}

# Atlas-internal entries: the auditable tracking surface for self-improvement.
# .run/ is created by the orchestration hooks on first session, not by this
# scaffold, but is allowlisted here so a fresh repo gets the directory tree
# shape right away. Project wiki content (architecture, plans, specs,
# lessons, wiki, features) is NOT here -- those grow dynamically in docs/.
ATLAS_ENTRIES = [
    ("evidence", True),
    ("findings", True),
    ("audits", True),
    ("decisions", True),
    ("archive", True),
    ("understand-anything", True),
    ("graphify", True),
    ("self-improvement", True),
    ("memory", True),
    ("nudge", True),
    (".run", True),
]

# Skeleton files inside atlas-internal subfolders. Seeded from templates/ so
# the directory carries a meaningful placeholder rather than an empty dir.
# .run/ is ephemeral, populated by orchestration hooks on first session, and
# intentionally has no seeded template file.
ATLAS_SEEDED_FILES = [
    "evidence/.gitkeep",
    "audits/.gitkeep",
    "decisions/.gitkeep",
    "archive/.gitkeep",
    "understand-anything/.gitkeep",
    "graphify/.gitkeep",
    "self-improvement/.gitkeep",
    "memory/.gitkeep",
    "nudge/.gitkeep",
]

# .atlas/CLAUDE.md, .atlas/AGENTS.md, and the findings index use distinctly-
# named templates because CLAUDE.md/AGENTS.md collide with the root seeds.
ATLAS_ROOT_FILES = {
    "CLAUDE.md": "atlas-claude.md",
    "AGENTS.md": "atlas-agents.md",
    "findings/INDEX.md": "findings/INDEX.md",
}

# First-level subdir names under a legacy .atlas/ that hold only
# ephemeral orchestration state and do NOT indicate curated content. A
# .run/ marker is overwritten by the next session anyway; treating it as
# curated traps any operator whose orchestration hook wrote a marker after
# the SSOT split.
EPHEMERAL_LEGACY_NAMES = frozenset({".run", ".DS_Store", "departments"})

# Project wiki subdirs that, if present under .atlas/, mean the project
# wiki and atlas-internal state have been conflated. These belong in docs/.
# The scaffold refuses to proceed if any of these are found with content.
# NOTE: "audits" and "decisions" are deliberately excluded -- .atlas/audits/
# and .atlas/decisions/ are legitimate atlas-internal names (see ATLAS_ENTRIES
# above), distinct in meaning from their docs/ namesakes.
WIKI_SUBDIRS_IN_ATLAS = frozenset(
    {
        "architecture",
        "plans",
        "specs",
        "lessons",
        "wiki",
        "features",
        "reference",
    }
)

# Manifest files scanned for a web-framework dependency signal.
API_MANIFEST_FILES = ("package.json", "pyproject.toml", "requirements.txt")
API_FRAMEWORK_SIGNALS = (
    "express",
    "fastify",
    "koa",
    "nestjs",
    "fastapi",
    "flask",
    "django",
    "gin",
    "spring",
)
API_DIR_SIGNALS = ("routes", "controllers", "api")
API_FILE_GLOBS = (
    "*openapi*.json",
    "*openapi*.yaml",
    "*openapi*.yml",
    "*swagger*.json",
    "*swagger*.yaml",
    "*swagger*.yml",
)

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
    # dst is "already present" when it exists and either already has content
    # or the template itself is empty (an empty .gitkeep has nothing to add, so
    # re-copying it would falsely report "seeded" on every idempotent re-run).
    if dst.exists() and (is_non_empty(dst) or not is_non_empty(src)):
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
    """Scaffold one root, creating only what is missing. Always walks the
    full entry set rather than short-circuiting on "root already has some
    content" -- that check would defeat repair: a repo scaffolded by an
    older version of this script (fewer entries) must still get the newly
    added entries filled in on a later run. Per-entry idempotency (mkdir
    exist_ok, copy_seed's own missing/empty check) makes re-running safe."""
    print(f"Scaffolding {label} at: {root}")
    count = scaffold(root, entries, seeded_files)
    expected = len(entries)
    print(f"{label} entries present: {count}/{expected}")
    return count == expected


def scaffold_named_files(root: Path, mapping: dict) -> bool:
    """Seed dst-relative-path -> template-relative-path pairs at root. Used
    where the destination filename collides with a same-named template used
    for a different root (e.g. AGENTS.md at repo root vs docs/ vs .atlas/),
    so the template file needs a distinct name from its destination.
    Returns True if every destination exists after the run."""
    tmpl = templates_dir()
    ok = True
    for dst_rel, tmpl_rel in mapping.items():
        dst = root / dst_rel
        print(copy_seed(tmpl / tmpl_rel, dst))
        if not dst.exists():
            ok = False
    return ok


def detect_api(repo_root: Path) -> bool:
    """True if the project shows a web-API signal at the repo root: an
    OpenAPI/Swagger file, a routes/controllers/api directory, or a web
    framework dependency named in package.json/pyproject.toml/requirements.txt.
    No signal -> docs/api/ and docs/endpoints.md are not created."""
    for pattern in API_FILE_GLOBS:
        if any(repo_root.glob(pattern)):
            return True
    for name in API_DIR_SIGNALS:
        if (repo_root / name).is_dir():
            return True
    for manifest in API_MANIFEST_FILES:
        path = repo_root / manifest
        if not path.is_file():
            continue
        try:
            text = path.read_text(errors="ignore").lower()
        except OSError:
            continue
        if any(signal in text for signal in API_FRAMEWORK_SIGNALS):
            return True
    return False


def gitignore_seed_path() -> Path:
    """Resolve the .gitignore seed owned by the atlas-gitignore skill, a
    sibling skill directory. This script never authors gitignore content
    itself -- atlas-gitignore owns the zero-trust allowlist template."""
    return (
        Path(__file__).resolve().parent.parent.parent
        / "atlas-gitignore"
        / "templates"
        / "gitignore.seed"
    )


def ensure_gitignore(repo_root: Path) -> str:
    """Copy the atlas-gitignore seed to <repo-root>/.gitignore if missing.
    Never touches an existing .gitignore -- a separate skill maintains it."""
    dst = repo_root / ".gitignore"
    if dst.exists() and is_non_empty(dst):
        return f"keep existing: {dst}"
    src = gitignore_seed_path()
    if not src.is_file():
        return (
            f"MISSING SEED: {src} (cannot seed {dst}; owned by atlas-gitignore skill)"
        )
    shutil.copy2(src, dst)
    return f"seeded: {dst}"


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
    # (e.g. .atlas/architecture/, .atlas/plans/, .atlas/specs/, .atlas/lessons/).
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

    docs_ok = _scaffold_root(docs_root, DURABLE_ENTRIES, DOCS_SEEDED_FILES, "docs/")
    atlas_ok = _scaffold_root(atlas_root, ATLAS_ENTRIES, ATLAS_SEEDED_FILES, ".atlas/")

    # docs/AGENTS.md, .atlas/CLAUDE.md + .atlas/AGENTS.md + findings/INDEX.md:
    # distinctly-named templates avoiding the root-file collision (see
    # scaffold_named_files docstring).
    docs_root_ok = scaffold_named_files(docs_root, DOCS_ROOT_FILES)
    atlas_root_ok = scaffold_named_files(atlas_root, ATLAS_ROOT_FILES)

    # Root entry-point files (README.md, AGENTS.md, CLAUDE.md), always at
    # the repo root beside .git -- never inside docs/ or .atlas/.
    root_ok = scaffold_named_files(repo_root, ROOT_FILES)

    # Project-adaptive: docs/api/ + docs/endpoints.md, only when the repo
    # shows an API signal. No signal -> nothing created, per the SSOT.
    api_ok = True
    if detect_api(repo_root):
        print("API signal detected: scaffolding docs/api/ and docs/endpoints.md")
        api_count = scaffold(docs_root, DOCS_API_ENTRIES, DOCS_API_SEEDED_FILES)
        api_ok = api_count == len(DOCS_API_ENTRIES)
        api_ok = scaffold_named_files(docs_root, DOCS_API_ROOT_FILES) and api_ok
    else:
        print("no API signal detected: skipping docs/api/ and docs/endpoints.md")

    # .gitignore: ensure present, content owned by the atlas-gitignore skill.
    print(ensure_gitignore(repo_root))

    all_ok = (
        docs_ok and atlas_ok and docs_root_ok and atlas_root_ok and root_ok and api_ok
    )
    if all_ok:
        print("OK: full docs/ + .atlas/ + root canonical structure is in place.")
        return 0
    print("INCOMPLETE: some durable entries are missing.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
