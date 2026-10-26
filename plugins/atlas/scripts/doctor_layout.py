#!/usr/bin/env python3
"""Doctor checks and repairs for atlas runtime-state placement.

Runtime state belongs in <project root>/.atlas. Older walkers left stray
`.atlas` dirs in subdirectories, nested `.atlas/.run/.atlas`, a `.atlas` on a
container folder of repos, and project-scope files in ~/.atlas/.run. Nothing
here deletes data: strays are MOVED into an archive folder, collisions and
errors are skipped and reported, and a second run finds nothing to do.

Also holds the read-only docs-naming count and the project-identity check
(projects rows that are git subdirs, inside .atlas, worktree/temp, or missing)
with its DB repoint. Stdlib only; atlas_db is imported lazily.
"""

from __future__ import annotations

import os
import re
import shlex
import shutil
import sqlite3
import time
from urllib.parse import urlparse

import atlas_paths

# Directories never walked: dependency trees and build output.
_PRUNE = {"node_modules", ".git", "venv", "dist", "build", ".next", "__pycache__"}
# Project-scope runtime files that must not live in ~/.atlas/.run.
HOME_RUN_STRAYS = (
    "channels.json",
    "todos.json",
    "todos.json.lock",
    "board",
    "inbox",
    "findings.json",
    "docs_drift_watch.json",
    "atlas-orchestrate.active",
    "verifier_watch.json",
    "native_nudges",
)
_NESTED_DEPTH = 6


def atlas_home():
    return os.environ.get("ATLAS_HOME") or os.path.join(
        os.path.expanduser("~"), ".atlas"
    )


def _pruned(name):
    return name in _PRUNE or name.startswith(".venv")


def _slug(text):
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower() or "root"


def _is_container(path):
    """A non-git folder holding 2+ separate git repos, as children or as
    grandchildren (Projects/Web/<repo> groups repos one level down)."""
    if os.path.exists(os.path.join(path, ".git")):
        return False
    repos = 0

    def children(p):
        try:
            with os.scandir(p) as it:
                return [e.path for e in it if e.is_dir(follow_symlinks=False)]
        except OSError:
            return []

    for child in children(path):
        if os.path.basename(child).startswith(".") or _pruned(os.path.basename(child)):
            continue
        if os.path.exists(os.path.join(child, ".git")):
            repos += 1
        else:
            repos += sum(
                os.path.exists(os.path.join(g, ".git")) for g in children(child)
            )
        if repos >= 2:
            return True
    return False


def _canonical_archive_base(stray_parent):
    """(canonical root, archive base dir) for a stray living in stray_parent.
    Non-project roots (HOME, temp roots) archive into ~/.atlas/archive."""
    canonical = atlas_paths.project_root(stray_parent)
    if atlas_paths._is_non_project(canonical):
        return canonical, os.path.join(atlas_home(), "archive")
    return canonical, os.path.join(canonical, ".atlas", "archive")


def check_atlas_layout(root, home=None):
    """Misplaced runtime-state paths for project `root`.

    Returns [{"kind", "path", "root", "archive_base", "rel"}] with kind one of
    stray (a .atlas below the root), nested (a .atlas inside a .atlas),
    container (a .atlas on a folder of repos, at root or an ancestor) and
    home_run (project-scope files in ~/.atlas/.run)."""
    root = os.path.abspath(root)
    found = []

    def add(kind, path, base_root, archive_base):
        found.append(
            {
                "kind": kind,
                "path": path,
                "root": base_root,
                "archive_base": archive_base,
                "rel": os.path.relpath(path, base_root),
            }
        )

    for cur, dirnames, filenames in os.walk(root):
        if cur != root and (".git" in dirnames or ".git" in filenames):
            dirnames[:] = []  # a nested repo owns its own .atlas
            continue
        if ".atlas" in dirnames:
            dirnames.remove(".atlas")
            if cur != root:
                _, base = _canonical_archive_base(cur)
                add("stray", os.path.join(cur, ".atlas"), root, base)
        dirnames[:] = [d for d in dirnames if not _pruned(d)]

    own = os.path.join(root, ".atlas")
    if os.path.isdir(own):
        base = os.path.join(own, "archive")
        top = own.count(os.sep)
        for cur, dirnames, _files in os.walk(own):
            if ".atlas" in dirnames:
                dirnames.remove(".atlas")
                add("nested", os.path.join(cur, ".atlas"), root, base)
            # archive holds already-quarantined strays; never re-flag them
            dirnames[:] = [
                d
                for d in dirnames
                if not _pruned(d)
                and not (cur == own and d == "archive")
                and cur.count(os.sep) - top < _NESTED_DEPTH
            ]

    user_home = os.path.realpath(os.path.expanduser("~"))
    cur = root
    while True:
        meta = os.path.join(cur, ".atlas")
        if (
            os.path.realpath(cur) != user_home
            and os.path.isdir(meta)
            and _is_container(cur)
        ):
            add("container", meta, cur, os.path.join(atlas_home(), "archive"))
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent

    run = os.path.join(home or atlas_home(), ".run")
    for name in HOME_RUN_STRAYS:
        p = os.path.join(run, name)
        if os.path.lexists(p):
            add("home_run", p, run, os.path.join(home or atlas_home(), "archive"))
    return found


def _inside(path, base):
    """True when realpath(path) is base or below it (symlinks resolved)."""
    path, base = os.path.realpath(path), os.path.realpath(base)
    return path == base or path.startswith(base.rstrip(os.sep) + os.sep)


def fix_atlas_layout(findings, root, apply=True, today=None, home=None):
    """Move each finding into its archive folder. Never deletes. Returns
    [{"src", "dest", "status": moved|planned|skipped|manual|error, "reason"}].

    Hard guards, so a repair can never leave the project it was asked about:
    a stray/nested source must be inside `root`; only home_run sources may
    live outside it, and only inside `home`/.run; every destination must be
    inside `root` or `home`. Containers sit in an ancestor of the project, so
    they are never moved here: status "manual" carries the command to run."""
    stamp = today or time.strftime("%Y-%m-%d")
    home = home or atlas_home()
    moves = []
    for f in findings:
        slug = _slug(f["rel"] if f["kind"] != "home_run" else "run-" + f["rel"])
        dest = os.path.join(f["archive_base"], f"{stamp}_stray-atlas_{slug}")
        move = {"src": f["path"], "dest": dest, "status": "planned", "reason": ""}
        moves.append(move)
        src_ok = (
            _inside(f["path"], os.path.join(home, ".run"))
            if f["kind"] == "home_run"
            else _inside(f["path"], root)
        )
        if f["kind"] == "container":
            move.update(
                status="manual",
                reason=f"ancestor folder, not moved automatically; run: "
                f"mv {shlex.quote(f['path'])} {shlex.quote(dest)}",
            )
        elif not src_ok or not (_inside(dest, root) or _inside(dest, home)):
            move.update(status="skipped", reason="outside project")
        elif not os.path.lexists(f["path"]):
            move.update(status="skipped", reason="source already gone")
        elif os.path.lexists(dest):
            move.update(status="skipped", reason="archive destination exists")
        elif apply:
            try:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.move(f["path"], dest)
                move["status"] = "moved"
            except OSError as exc:
                move.update(status="error", reason=str(exc))
    return moves


def layout_summary(findings):
    return [f"{f['kind']}: {f['path']}" for f in findings]


def hook_layout(cwd):
    """SessionStart repair for the payload cwd's project. Returns '' when
    nothing was moved or failed, else one short line."""
    root = atlas_paths.project_root(cwd)
    moves = fix_atlas_layout(check_atlas_layout(root), root)
    moved = sum(m["status"] == "moved" for m in moves)
    bad = sum(m["status"] == "error" for m in moves)
    if not (moved or bad):
        return ""
    line = f"atlas layout: moved {moved} stray .atlas path(s) to archive"
    return line + (f"; {bad} failed" if bad else "")


# --- project memory (findings records, global memory tagged with the project) --


def project_memory_status(root):
    """(findings_without_record, global_entries_tagged_with_project). Read-only."""
    try:
        import atlas_finding

        missing = atlas_finding.missing_records(root)
    except Exception:
        missing = 0
    tagged = 0
    try:
        import atlas_memory

        name = os.path.basename(os.path.abspath(root))
        for target in ("memory", "project"):
            tagged += sum(
                1
                for e in atlas_memory.get_entries(target)
                if atlas_memory.tag_of(e) == name
            )
    except Exception:
        pass
    return missing, tagged


def fix_project_memory(root):
    """--fix: backfill findings records, then run the global-to-project memory
    migration when it exists (current project only). Returns printable lines."""
    import atlas_finding

    res = atlas_finding.backfill_findings(root, apply=True)
    out = [f"findings records: {res}"]
    try:
        import inspect

        import atlas_memory

        fn = getattr(atlas_memory, "migrate_global_to_projects", None)
        if fn is None:
            return out + ["memory migration: not available in this atlas_memory"]
        params = inspect.signature(fn).parameters
        kw = {"apply": True} if "apply" in params else {}
        for name in ("root", "project_root", "cwd", "only_root"):
            if name in params:
                kw[name] = root
                break
        out.append(f"memory migration: {fn(**kw)}")
    except Exception as exc:
        out.append(f"memory migration failed: {exc}")
    return out


# --- docs naming (read-only; renames only under --fix) -----------------------


def docs_naming_violations(root):
    """[(path, reason)] from lint_docs_names, or [] when unavailable."""
    try:
        from pathlib import Path

        import lint_docs_names

        p = Path(root)
        return lint_docs_names.violations(lint_docs_names.all_artifact_paths(p))
    except Exception:  # advisory check: never break the doctor
        return []


def fix_docs_naming(root):
    """Apply renames and reference rewrites. Returns [(old, new)] moved."""
    from pathlib import Path

    import lint_docs_names

    p = Path(root)
    bad = lint_docs_names.violations(lint_docs_names.all_artifact_paths(p))
    moved = lint_docs_names.apply_renames(p, lint_docs_names.plan_renames(p, bad))
    lint_docs_names.rewrite_references(p, moved)
    return moved


# --- scoring ----------------------------------------------------------------


def hosted_scoring_url():
    """The explicit ATLAS_TYPESAFE_URL (env, else ~/.atlas/settings.json env)
    when it is not loopback, else ''."""
    url = os.environ.get("ATLAS_TYPESAFE_URL", "").strip()
    if not url:
        try:
            import json

            with open(
                os.path.join(atlas_home(), "settings.json"), encoding="utf-8"
            ) as fh:
                url = str(json.load(fh)["env"].get("ATLAS_TYPESAFE_URL", "")).strip()
        except (OSError, ValueError, KeyError, AttributeError, TypeError):
            url = ""
    if not url:
        return ""
    host = (urlparse(url if "//" in url else "//" + url).hostname or "").lower()
    return "" if host in ("127.0.0.1", "localhost", "::1") else url


def context_limit_errors(conn, now=None):
    """Count of 7-day scoring errors from the local model's 2048-token limit."""
    since = (now or time.time()) - 7 * 86400
    return conn.execute(
        "SELECT COUNT(*) FROM turn_scores WHERE judgment='scoring_error' "
        "AND scored_at >= ? AND label LIKE '%expected 1%2048%'",
        (since,),
    ).fetchone()[0]


# --- project identity -------------------------------------------------------

_TEMP_PREFIXES = ("/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/")


def classify_project(path):
    """git_subdir | inside_atlas | worktree_temp | missing | ok (exclusive)."""
    parts = path.split(os.sep)
    if ".atlas" in parts:
        return "inside_atlas"
    if "worktrees" in parts or path.startswith(_TEMP_PREFIXES):
        return "worktree_temp"
    if not os.path.exists(path):
        return "missing"
    target = atlas_paths.project_root(path)
    if target != path and os.path.exists(os.path.join(target, ".git")):
        return "git_subdir"
    return "ok"


def check_project_identity(conn):
    """({category: count}, [(id, path, category)]) over projects rows. Read-only."""
    counts = {"git_subdir": 0, "inside_atlas": 0, "worktree_temp": 0, "missing": 0}
    rows = []
    for pid, path in conn.execute("SELECT id, root_path FROM projects"):
        cat = classify_project(path)
        if cat in counts:
            counts[cat] += 1
            rows.append((pid, path, cat))
    return counts, rows


def fix_project_identity(conn, db_file, backups_dir=None, now=None):
    """Re-point runs/facets of git_subdir and inside_atlas rows at the row of
    their project root. Backs up the DB first. Returns [(old_path, new_path)]."""
    import atlas_db

    _counts, rows = check_project_identity(conn)
    # Rows are kept (other tables reference them); only ones that still own
    # runs or facets have anything to move, which keeps a re-run a no-op.
    todo = [
        (i, p)
        for i, p, c in rows
        if c in ("git_subdir", "inside_atlas")
        and conn.execute(
            "SELECT EXISTS(SELECT 1 FROM runs WHERE project_id=?) "
            "OR EXISTS(SELECT 1 FROM facets WHERE project_id=?)",
            (i, i),
        ).fetchone()[0]
    ]
    if not todo:
        return []
    backups = backups_dir or os.path.join(atlas_home(), "backups")
    os.makedirs(backups, exist_ok=True)
    dest = os.path.join(backups, f"atlas-{time.strftime('%Y%m%d-%H%M%S')}.db")
    out = sqlite3.connect(dest)
    try:
        conn.backup(out)  # consistent under WAL, unlike a file copy
    finally:
        out.close()
    changed = []
    for old_id, path in todo:
        target = atlas_paths.project_root(path)
        if target == path:
            continue
        new_id = atlas_db.register_project(conn, target)
        if new_id is None or new_id == old_id:
            continue
        conn.execute(
            "UPDATE runs SET project_id=? WHERE project_id=?", (new_id, old_id)
        )
        conn.execute(
            "UPDATE facets SET project_id=? WHERE project_id=?", (new_id, old_id)
        )
        changed.append((path, target))
    conn.commit()
    return changed
