#!/usr/bin/env python3
"""Docs conformance for ANY project atlas runs in: check, and fix.

Two checks, one fixer, no project-specific knowledge.

**Naming.** `docs-ssot.md` says an artifact that records an *event* (a plan, an
audit, a spec, a lesson, a decision, a finding, an evidence capture) is named
`<YYYY-MM-DD>-<slug>` so a plain directory listing sorts chronologically. An
artifact that describes *living state* (architecture, features, wiki) is a bare
slug, because it is revised in place and a date would lie. Nothing enforced
this, and the convention itself had drifted: plans were specified both ways in
two different files, and audits were specified date-LAST.

**Structure.** `docs/` is the SSOT, and a project with no `docs/` (or missing a
base subfolder) has nowhere for the curator to write. The required set is the
scaffolder's own durable list, imported from it so the two cannot diverge; a
contract test pins that.

**Fixing.** `--fix` renames a misnamed artifact to its date-first form and then
rewrites every reference to it across the whole tree -- paths in markdown, in
code, and in comments -- because a rename that leaves dangling references has
traded one defect for a worse one. The date is *derived*, never invented: the
file's first commit date, else a date already embedded in the name, else its
mtime. Renames use `git mv` inside a repo so history follows the file.

Only the immediate child of a dated directory is judged. Anything deeper is
that artifact's internal structure (an audit hub's own `plans/`, `evidence/`)
and is none of this linter's business.

Stdlib only. Pure helpers for tests and hooks; git-backed helpers for
run-scoped use.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

__all__ = [
    "DATED_DIRS",
    "LIVING_DIRS",
    "EXEMPT_NAMES",
    "is_dated_name",
    "violations",
    "changed_paths",
    "all_artifact_paths",
    "derive_date",
    "plan_renames",
    "apply_renames",
    "rewrite_references",
    "structure_gaps",
    "required_docs_entries",
]

# Directories whose immediate children are dated event records.
DATED_DIRS = (
    "docs/plans",
    "docs/specs",
    "docs/lessons",
    "docs/decisions",
    "docs/audits",
    "docs/pulses",
    ".atlas/findings",
    ".atlas/decisions",
    ".atlas/audits",
    ".atlas/evidence",
)
# Revised in place, so a date in the name would be a lie, not an ordering key.
LIVING_DIRS = (
    "docs/architecture",
    "docs/features",
    "docs/wiki",
    "docs/standards",
    "docs/reference",
    "docs/api",
)
# Index/placeholder files a scaffolder owns; they are not event records.
EXEMPT_NAMES = frozenset({"README.md", "INDEX.md", ".gitkeep", ".DS_Store"})

# <YYYY-MM-DD>-<slug>. The slug may itself start with a sequence number, which
# is how a same-day ordered set keeps its order (2026-06-23-01-packer-...).
_DATED = re.compile(r"^(\d{4})-(\d{2})-(\d{2})-[a-z0-9][a-z0-9._-]*$")
# A date anywhere but the front: the reported failure mode. Named separately
# because the fix is "move it", not "add one".
_DATE_ANYWHERE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")

# Text suffixes worth rewriting references inside. A rename that updates only
# markdown leaves the code and the comments pointing at a path that is gone.
_TEXT_SUFFIXES = frozenset(
    {
        ".md",
        ".markdown",
        ".txt",
        ".py",
        ".js",
        ".mjs",
        ".cjs",
        ".ts",
        ".tsx",
        ".jsx",
        ".json",
        ".jsonc",
        ".yaml",
        ".yml",
        ".toml",
        ".ini",
        ".cfg",
        ".sh",
        ".bash",
        ".zsh",
        ".ps1",
        ".rb",
        ".go",
        ".rs",
        ".java",
        ".cs",
        ".sql",
        ".html",
        ".css",
        ".env",
        ".gitignore",
        "",
    }
)
_SKIP_DIRS = frozenset(
    {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".mypy_cache"}
)
# This module and its tests cite example artifact names ("atlas-harden-2026-07-07")
# as documentation and as fixtures. A tree-wide bare-name rewrite would edit those
# citations and silently invert the tool's own meaning -- observed once: the fixer
# rewrote its test fixture so `is_dated_name("<compliant name>")` was asserted
# False, and three of its own tests failed. A fixer must never rewrite its own
# definition of the thing it fixes.
_SELF_OWNED = frozenset({"lint_docs_names.py", "test_lint_docs_names.py"})


def _norm(path: str) -> str:
    return str(path).replace("\\", "/").strip().lstrip("./")


def is_dated_name(name: str) -> bool:
    """True when `name` (basename, file suffix already stripped) is
    `<YYYY-MM-DD>-<slug>` with a calendar-shaped date and a safe slug."""
    m = _DATED.match(name)
    if not m:
        return False
    month, day = int(m.group(2)), int(m.group(3))
    return 1 <= month <= 12 and 1 <= day <= 31


def _dated_dir_for(rel: str) -> str | None:
    """The dated directory `rel` sits under, else None."""
    for d in DATED_DIRS:
        if rel.startswith(d + "/") and rel[len(d) + 1 :]:
            return d
    return None


def _slugify(text: str) -> str:
    """Filesystem-safe, Windows-safe, lowercase-kebab. Same derivation the
    docs-ssot naming rule specifies: a colon in a composed name makes the whole
    repo un-checkout-able on Windows."""
    out = re.sub(r"[^a-z0-9._-]+", "-", str(text).lower())
    out = re.sub(r"-{2,}", "-", out).strip("-.")
    return out or "untitled"


def violations(paths) -> list:
    """[(artifact_path, reason)] for every path breaking the date-first rule.

    Pure: takes relative path strings, does no I/O. A living directory, a path
    deeper than the artifact, and an exempt name all pass. One artifact is
    reported once however many of its files changed.
    """
    out = []
    seen = set()
    for raw in paths or []:
        rel = _norm(raw)
        if not rel:
            continue
        dated_dir = _dated_dir_for(rel)
        if dated_dir is None:
            continue
        artifact = rel[len(dated_dir) + 1 :].split("/", 1)[0]
        if artifact in EXEMPT_NAMES:
            continue
        key = dated_dir + "/" + artifact
        if key in seen:
            continue
        seen.add(key)
        stem = artifact[:-3] if artifact.endswith(".md") else artifact
        if is_dated_name(stem):
            continue
        if _DATE_ANYWHERE.search(stem):
            reason = (
                "date is not first (%r): rename to <YYYY-MM-DD>-<slug> so a "
                "listing sorts by time, not by subject" % artifact
            )
        elif stem != stem.lower():
            reason = (
                "not lowercase and not dated (%r): rename to <YYYY-MM-DD>-<slug>"
                % artifact
            )
        else:
            reason = (
                "missing a leading date (%r): rename to <YYYY-MM-DD>-<slug>" % artifact
            )
        out.append((key, reason))
    return out


# --- discovery -----------------------------------------------------------------


def _repo_root(root: Path) -> str | None:
    try:
        out = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        return out.decode(errors="replace").strip() or None
    except Exception:
        return None


def changed_paths(root: Path) -> list:
    """Paths changed in the working tree, index, and untracked.

    Run-scoped on purpose: the completion gate must not block on historical
    names nobody is touching, or a naming guard becomes a wedge.
    """
    repo_root = _repo_root(root)
    if repo_root is None:
        return []
    found: set = set()
    for args in (
        ["git", "-C", repo_root, "diff", "--name-only", "HEAD"],
        ["git", "-C", repo_root, "diff", "--name-only", "--cached"],
        ["git", "-C", repo_root, "ls-files", "--others", "--exclude-standard"],
    ):
        try:
            out = subprocess.check_output(args, stderr=subprocess.DEVNULL, timeout=5)
        except Exception:
            continue
        for line in out.decode(errors="replace").splitlines():
            line = line.strip()
            if line:
                found.add(line)
    return sorted(found)


def all_artifact_paths(root: Path) -> list:
    """Every immediate child of every dated directory that exists under `root`.

    Whole-tree mode, for a one-off migration rather than the run-scoped gate.
    """
    out = []
    for d in DATED_DIRS:
        base = Path(root) / d
        if not base.is_dir():
            continue
        try:
            for child in sorted(base.iterdir()):
                if child.name in EXEMPT_NAMES:
                    continue
                out.append("%s/%s" % (d, child.name))
        except OSError:
            continue
    return out


# --- date derivation -----------------------------------------------------------


def derive_date(root: Path, rel: str) -> str:
    """A real date for `rel`, never an invented one, in priority order:

    1. the date already embedded in its name (the author's own claim);
    2. the date of the commit that added it (git);
    3. its mtime.

    (1) outranks (2) because a trailing-date name like `atlas-harden-2026-07-07`
    already states the date the artifact is *about*, which is more accurate than
    when the file happened to be committed.
    """
    name = rel.rsplit("/", 1)[-1]
    stem = name[:-3] if name.endswith(".md") else name
    m = _DATE_ANYWHERE.search(stem)
    if m:
        month, day = int(m.group(2)), int(m.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            return "%s-%s-%s" % (m.group(1), m.group(2), m.group(3))
    repo_root = _repo_root(root)
    if repo_root:
        try:
            out = subprocess.check_output(
                [
                    "git",
                    "-C",
                    repo_root,
                    "log",
                    "--diff-filter=A",
                    "--format=%ad",
                    "--date=short",
                    "-1",
                    "--",
                    rel,
                ],
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
            stamp = out.decode(errors="replace").strip().splitlines()
            if stamp and re.fullmatch(r"\d{4}-\d{2}-\d{2}", stamp[0]):
                return stamp[0]
        except Exception:
            pass
    try:
        return time.strftime("%Y-%m-%d", time.localtime((Path(root) / rel).stat().st_mtime))
    except OSError:
        return time.strftime("%Y-%m-%d")


def plan_renames(root: Path, viols) -> list:
    """[(old_rel, new_rel)] for each violation, date-first and de-duplicated.

    The slug keeps everything the old name carried except the date it already
    had, so `atlas-harden-2026-07-07` becomes `2026-07-07-atlas-harden` rather
    than losing its subject.
    """
    plans = []
    taken = set()
    for old_rel, _reason in viols:
        parent, name = old_rel.rsplit("/", 1)
        suffix = ".md" if name.endswith(".md") else ""
        stem = name[: -len(suffix)] if suffix else name
        date = derive_date(root, old_rel)
        # Strip the date the name already carried, wherever it sat.
        body = _DATE_ANYWHERE.sub("", stem)
        slug = _slugify(body)
        candidate = "%s/%s-%s%s" % (parent, date, slug, suffix)
        n = 2
        while candidate in taken or (
            (Path(root) / candidate).exists() and candidate != old_rel
        ):
            candidate = "%s/%s-%s-%d%s" % (parent, date, slug, n, suffix)
            n += 1
        if candidate == old_rel:
            continue
        taken.add(candidate)
        plans.append((old_rel, candidate))
    return plans


# --- applying ------------------------------------------------------------------


def apply_renames(root: Path, plans) -> list:
    """Rename each planned path. `git mv` inside a repo so history follows the
    file; plain rename otherwise. Returns the plans that actually moved."""
    repo_root = _repo_root(root)
    moved = []
    for old_rel, new_rel in plans:
        old = Path(root) / old_rel
        new = Path(root) / new_rel
        if not old.exists():
            continue
        new.parent.mkdir(parents=True, exist_ok=True)
        done = False
        if repo_root:
            try:
                subprocess.check_call(
                    ["git", "-C", repo_root, "mv", old_rel, new_rel],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=15,
                )
                done = True
            except Exception:
                done = False
        if not done:
            try:
                os.rename(old, new)
            except OSError:
                continue
        moved.append((old_rel, new_rel))
    return moved


def _text_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for fn in filenames:
            if fn in _SELF_OWNED:
                continue  # never rewrite our own examples/fixtures
            if Path(fn).suffix.lower() in _TEXT_SUFFIXES:
                yield Path(dirpath) / fn


def rewrite_references(root: Path, moved) -> list:
    """Rewrite every reference to a moved artifact, tree-wide.

    Replaces the full relative path first, then the bare artifact name, so a
    mention in prose or a code comment (`see atlas-harden-2026-07-07/`) is
    corrected too -- a rename that leaves dangling references has traded one
    defect for a worse one.

    Returns the list of files changed.
    """
    if not moved:
        return []
    subs = []
    for old_rel, new_rel in moved:
        old_name = old_rel.rsplit("/", 1)[-1]
        new_name = new_rel.rsplit("/", 1)[-1]
        subs.append((old_rel, new_rel))
        old_stem = old_name[:-3] if old_name.endswith(".md") else old_name
        new_stem = new_name[:-3] if new_name.endswith(".md") else new_name
        subs.append((old_name, new_name))
        if old_stem != old_name:
            subs.append((old_stem, new_stem))
    # Longest pattern first: the full path must win over the bare name, or the
    # name substitution would corrupt the path before it is matched.
    subs.sort(key=lambda pair: len(pair[0]), reverse=True)
    touched = []
    for path in _text_files(root):
        try:
            original = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        updated = original
        for old, new in subs:
            if old in updated:
                updated = updated.replace(old, new)
        if updated != original:
            try:
                path.write_text(updated, encoding="utf-8")
            except OSError:
                continue
            try:
                touched.append(str(path.relative_to(root)))
            except ValueError:
                touched.append(str(path))
    return sorted(touched)


# --- structure -----------------------------------------------------------------


def required_docs_entries() -> list:
    """The durable `docs/` entries a project must have, taken from the
    scaffolder's own list so the check and the creator cannot diverge.

    Falls back to a literal copy only if the scaffolder cannot be imported; a
    contract test asserts the two agree.
    """
    fallback = [
        "CHANGELOG.md",
        "ROADMAP.md",
        "architecture",
        "decisions",
        "plans",
        "specs",
        "features",
        "lessons",
        "wiki",
    ]
    try:
        import importlib.util

        scaffold = (
            Path(__file__).resolve().parent.parent
            / "skills"
            / "atlas-setup"
            / "scripts"
            / "scaffold_docs.py"
        )
        spec = importlib.util.spec_from_file_location("_atlas_scaffold", scaffold)
        if spec is None or spec.loader is None:
            return fallback
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return [name for name, _is_dir in mod.DURABLE_ENTRIES]
    except Exception:
        return fallback


def structure_gaps(root: Path) -> list:
    """Missing durable `docs/` entries, as [(relpath, reason)].

    Project-adaptive subfolders (`api/`, `standards/`, `glossary.md`) are NOT
    required: they exist only when the project needs them, and demanding them
    everywhere is the busywork the SSOT rules explicitly avoid. The root
    `README.md` is included because gate condition (e) already requires it.
    """
    gaps = []
    base = Path(root)
    if not (base / "docs").is_dir():
        return [("docs/", "no docs/ tree: the project documentation SSOT is missing")]
    for entry in required_docs_entries():
        target = base / "docs" / entry
        if entry.endswith(".md"):
            if not target.is_file():
                gaps.append(("docs/" + entry, "required docs file is missing"))
        elif not target.is_dir():
            gaps.append(("docs/" + entry + "/", "required docs subfolder is missing"))
    if not (base / "README.md").is_file():
        gaps.append(("README.md", "root README is missing"))
    return gaps


# --- CLI -----------------------------------------------------------------------


def _cli(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    root = Path(os.getcwd())
    if "--root" in args:
        i = args.index("--root")
        root = Path(args[i + 1]) if i + 1 < len(args) else root
        del args[i : i + 2]
    do_fix = "--fix" in args
    whole = "--all" in args
    with_structure = "--structure" in args
    args = [a for a in args if not a.startswith("-")]
    explicit = bool(args)

    if whole:
        paths = all_artifact_paths(root)
        scope = "whole tree"
    elif explicit:
        paths = args
        scope = "explicit"
    else:
        paths = changed_paths(root)
        scope = "changed files"

    rc = 0
    if with_structure:
        gaps = structure_gaps(root)
        if gaps:
            rc = 1
            print("docs structure gaps (%d):" % len(gaps))
            for path, reason in gaps:
                print("  %s -- %s" % (path, reason))
            print(
                "  -> run atlas-setup, or "
                'python3 "$CLAUDE_PLUGIN_ROOT/skills/atlas-setup/scripts/'
                'scaffold_docs.py" <repo-root> (idempotent)'
            )
        else:
            print("docs structure OK")

    bad = violations(paths)
    if not bad:
        print("docs naming OK (%d path(s) checked, %s)" % (len(paths), scope))
        return rc

    if not do_fix:
        print("docs naming violations (%d):" % len(bad))
        for path, reason in bad:
            print("  %s -- %s" % (path, reason))
        print(
            "\nDated records are date-first so a listing sorts chronologically. "
            "See docs-ssot.md 'Naming conventions'. Re-run with --fix to rename "
            "them and rewrite every reference."
        )
        return 1

    plans = plan_renames(root, bad)
    moved = apply_renames(root, plans)
    touched = rewrite_references(root, moved)
    print("renamed %d artifact(s):" % len(moved))
    for old_rel, new_rel in moved:
        print("  %s -> %s" % (old_rel, new_rel))
    print("rewrote references in %d file(s)%s" % (len(touched), ":" if touched else ""))
    for path in touched:
        print("  %s" % path)
    remaining = violations([new for _old, new in moved] or paths)
    if remaining:
        print("STILL NON-CONFORMANT (%d):" % len(remaining))
        for path, reason in remaining:
            print("  %s -- %s" % (path, reason))
        return 1
    return rc


if __name__ == "__main__":
    raise SystemExit(_cli())
