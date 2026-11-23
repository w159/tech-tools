#!/usr/bin/env python3
"""Atlas slow, rare upkeep: DB retention + run-kind backfill, `.atlas/.run` cleanup.

Usage: atlas_maint.py [--project ROOT] [--dry-run] [--vacuum] [--force]
Run detached from SessionStart; takes a non-blocking lock, throttled to once per 24 h via
<ATLAS_HOME>/maint-stamp.json. Prints a JSON summary.
"""

import argparse
import json
import os
import shutil
import stat
import sqlite3
import sys
import time

INTERVAL_S = 24 * 3600
# Reclaim space automatically once the freelist is both big and a real share of the file.
VACUUM_MIN_FREE_PAGES = 25000
VACUUM_MIN_FREE_RATIO = 0.10
SWEPT_DIRS = ("logs", "inbox")
# Sessions reclassified per transaction: keeps each write-lock hold short so
# other hooks (5 s busy timeout) are never starved by the maintenance pass.
BACKFILL_BATCH = 500


def atlas_home():
    return os.environ.get("ATLAS_HOME") or os.path.join(os.path.expanduser("~"), ".atlas")


def stamp_path():
    return os.path.join(atlas_home(), "maint-stamp.json")


def load_stamp():
    try:
        with open(stamp_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_stamp(stamp):
    path = stamp_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(stamp, fh)
    os.replace(tmp, path)


def run_retention_days():
    raw = (os.environ.get("ATLAS_RUN_RETENTION_DAYS") or "14").strip().lower()
    if raw in ("off", "false", "no"):
        return 0
    try:
        return max(0, int(float(raw)))
    except ValueError:
        return 14


def due(last, now):
    try:
        return not 0 <= now - float(last) < INTERVAL_S
    except (TypeError, ValueError):
        return True


def _backfill_chunk(conn, sids):
    """Same classification as atlas_db.backfill_run_kinds, for one slice of sessions.
    Commits before returning so the write lock is released between slices."""
    marks = ",".join("?" * len(sids))
    n = 0
    for kind, having in (
        ("worker", "SUM(CASE WHEN is_sidechain=0 THEN 1 ELSE 0 END) = 0"),
        ("orchestrator", "SUM(CASE WHEN is_sidechain=0 THEN 1 ELSE 0 END) >= 1"),
    ):
        n += conn.execute(
            "UPDATE runs SET kind=? WHERE session_id IN ("
            "SELECT session_id FROM messages WHERE session_id IN (%s) "
            "GROUP BY session_id HAVING %s)" % (marks, having),
            (kind, *sids),
        ).rowcount
    conn.commit()
    return n


def _backfill_batched(conn):
    sids = [r[0] for r in conn.execute("SELECT DISTINCT session_id FROM messages")]
    conn.commit()  # end the read snapshot before writing
    n = 0
    for i in range(0, len(sids), BACKFILL_BATCH):
        n += _backfill_chunk(conn, sids[i : i + BACKFILL_BATCH])
    return n


def _db_part(dry_run, vacuum, min_free_pages=None, min_free_ratio=None):
    min_free_pages = VACUUM_MIN_FREE_PAGES if min_free_pages is None else min_free_pages
    min_free_ratio = VACUUM_MIN_FREE_RATIO if min_free_ratio is None else min_free_ratio
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import atlas_db

    if dry_run:
        return {"skipped": "dry-run"}
    conn = atlas_db.connect()
    try:
        atlas_db.init(conn)
        out = {"pruned": atlas_db.prune_old(conn, atlas_db.retention_days())}
        out["backfilled"] = _backfill_batched(conn)
        out["improvements_closed"] = atlas_db.close_unmeasurable_improvements(conn)
        conn.commit()
        free = conn.execute("PRAGMA freelist_count").fetchone()[0]
        total = conn.execute("PRAGMA page_count").fetchone()[0] or 1
        if vacuum or (free >= min_free_pages and free / total >= min_free_ratio):
            out["freelist_pages"] = free
            try:
                atlas_db.vacuum(conn)
                out["vacuumed"] = True
            except sqlite3.OperationalError as e:  # locked or full disk must not fail upkeep
                out["vacuumed"] = False
                out["vacuum_error"] = str(e)
        return out
    finally:
        conn.close()


def _size(path):
    try:
        return os.lstat(path).st_size
    except OSError:
        return 0


def _sweep_files(base, cutoff, dry_run, summary):
    for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
        dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
        for name in filenames:
            path = os.path.join(dirpath, name)
            try:
                st = os.lstat(path)
                if not stat.S_ISREG(st.st_mode) or st.st_mtime >= cutoff:
                    continue
                if not dry_run:
                    os.remove(path)
            except OSError:
                continue
            summary["files"] += 1
            summary["bytes"] += st.st_size


def _newest_mtime(path):
    newest = None
    for dirpath, dirnames, filenames in os.walk(path, followlinks=False):
        for name in filenames:
            try:
                m = os.lstat(os.path.join(dirpath, name)).st_mtime
                newest = m if newest is None else max(newest, m)
            except OSError:
                pass
    return os.lstat(path).st_mtime if newest is None else newest


def clean_project(root, dry_run=False, now=None):
    """Delete old files in .run/logs, .run/inbox and stale .run/crew/<id> dirs. Returns a summary dict."""
    now = time.time() if now is None else now
    real = os.path.realpath(root)
    if real in (os.sep, os.path.realpath(os.path.expanduser("~"))):
        return {"refused": "root is HOME or /"}
    run = os.path.join(real, ".atlas", ".run")
    if os.path.islink(os.path.join(real, ".atlas")) or os.path.islink(run) or not os.path.isdir(run):
        return {"refused": "no .atlas/.run"}
    days = run_retention_days()
    if not days:
        return {"skipped": "retention disabled"}
    cutoff = now - days * 86400
    summary = {"files": 0, "bytes": 0, "crew_dirs": 0}
    for sub in SWEPT_DIRS:
        base = os.path.join(run, sub)
        if os.path.isdir(base) and not os.path.islink(base):
            _sweep_files(base, cutoff, dry_run, summary)
    crew = os.path.join(run, "crew")
    if os.path.isdir(crew) and not os.path.islink(crew):
        for name in os.listdir(crew):
            path = os.path.join(crew, name)
            try:
                if os.path.islink(path) or not os.path.isdir(path) or _newest_mtime(path) >= cutoff:
                    continue
                freed = 0
                for dp, _dn, fns in os.walk(path, followlinks=False):
                    freed += sum(_size(os.path.join(dp, f)) for f in fns)
                if not dry_run:
                    shutil.rmtree(path)
            except OSError:
                continue
            summary["crew_dirs"] += 1
            summary["bytes"] += freed
    return summary


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--project")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--vacuum", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    try:
        import fcntl
    except ImportError:
        print(json.dumps({"skipped": "no fcntl"}))
        return 0
    os.makedirs(atlas_home(), exist_ok=True)
    lock = open(os.path.join(atlas_home(), "maint.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print(json.dumps({"locked": True}))
        return 0
    try:
        now = time.time()
        stamp = load_stamp()
        projects = stamp.get("projects") if isinstance(stamp.get("projects"), dict) else {}
        stamp["projects"] = projects
        result = {"dry_run": args.dry_run}
        if args.force or due(stamp.get("db"), now):
            try:
                result["db"] = _db_part(args.dry_run, args.vacuum)
                if not args.dry_run:
                    stamp["db"] = now
            except Exception as exc:  # noqa: BLE001
                result["db"] = {"error": repr(exc)}
        else:
            result["db"] = {"skipped": "fresh"}
        if args.project:
            key = os.path.realpath(args.project)
            if args.force or due(projects.get(key), now):
                result["project"] = clean_project(key, args.dry_run, now)
                if not args.dry_run and "refused" not in result["project"]:
                    projects[key] = now
            else:
                result["project"] = {"skipped": "fresh"}
        if not args.dry_run:
            save_stamp(stamp)
        print(json.dumps(result))
        return 0
    finally:
        lock.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        sys.exit(0)
