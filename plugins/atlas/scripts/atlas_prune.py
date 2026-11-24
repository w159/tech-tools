#!/usr/bin/env python3
"""Prune closed runtime state under <root>/.atlas/.run so the mod's per-poll stat cost stays flat.

Removes, never touching findings.json, todos.json, channels.json or anything outside .atlas/.run:
  - crew/<id>      finished (no live supervisor.pid), idle > 1 day, beyond the newest 20
  - board/*.jsonl  owner is in no channel of channels.json, idle > 7 days, beyond the newest 50
  - teams/archive  reaped team records idle > 1 day (live records in teams/*.json are never touched)
  - dirty-snapshot-*.json  beyond the newest 5 and idle > 1 day (a live session's baseline is young)

`--dry-run` prints the plan and deletes nothing. Kill switch: ATLAS_PRUNE=off.
"""

import argparse
import json
import os
import shutil
import sys
import time

DAY = 86400
CREW_KEEP, CREW_AGE = 20, DAY
BOARD_KEEP, BOARD_AGE = 50, 7 * DAY
TEAM_AGE = DAY
SNAP_KEEP, SNAP_AGE = 5, DAY


def _mtime(path):
    try:
        return os.stat(path).st_mtime
    except OSError:
        return None


def _entries(base, pred):
    """[(mtime, path)] of names under base passing pred, newest first."""
    out = []
    try:
        names = os.listdir(base)
    except OSError:
        return out
    for name in names:
        path = os.path.join(base, name)
        m = _mtime(path)
        if m is not None and pred(name, path):
            out.append((m, path))
    return sorted(out, reverse=True)


def _alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True  # EPERM: exists
    return True


def _crew_live(path):
    try:
        with open(os.path.join(path, "supervisor.pid"), encoding="utf-8") as fh:
            return _alive(int(fh.read().strip()))
    except (OSError, ValueError):
        return False


def _live_owners(run):
    try:
        with open(os.path.join(run, "channels.json"), encoding="utf-8") as fh:
            chans = json.load(fh).get("channels") or {}
    except (OSError, ValueError, AttributeError):
        return None  # unreadable: prune no board file
    owners = set()
    for ch in chans.values():
        for m in ch.get("members") or []:
            owners.add(m.get("name"))
        owners.add(ch.get("lead"))
    return owners


def plan(root, now=None):
    """[(kind, path)] to delete. Pure read."""
    now = time.time() if now is None else now
    run = os.path.join(str(root), ".atlas", ".run")
    out = []

    crews = _entries(os.path.join(run, "crew"), lambda n, p: os.path.isdir(p))
    for m, p in crews[CREW_KEEP:]:
        if now - m > CREW_AGE and not _crew_live(p):
            out.append(("crew", p))

    owners = _live_owners(run)
    if owners is not None:
        boards = _entries(
            os.path.join(run, "board"),
            lambda n, p: n.endswith(".jsonl") and os.path.isfile(p),
        )
        for m, p in boards[BOARD_KEEP:]:
            if now - m > BOARD_AGE and os.path.basename(p)[: -len(".jsonl")] not in owners:
                out.append(("board", p))

    for m, p in _entries(
        os.path.join(run, "teams", "archive"), lambda n, p: n.endswith(".json")
    ):
        if now - m > TEAM_AGE:
            out.append(("team", p))

    snaps = _entries(
        run, lambda n, p: n.startswith("dirty-snapshot-") and n.endswith(".json")
    )
    for m, p in snaps[SNAP_KEEP:]:
        if now - m > SNAP_AGE:
            out.append(("snapshot", p))
    return out


def apply(items):
    n = 0
    for _kind, p in items:
        try:
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
            n += 1
        except OSError:
            pass  # best effort; the next boot retries
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    if os.environ.get("ATLAS_PRUNE", "").lower() in ("off", "0", "false"):
        print("atlas_prune: disabled (ATLAS_PRUNE=off)")
        return 0
    items = plan(args.root)
    if args.dry_run:
        for kind, p in items:
            print(f"would remove {kind}: {p}")
        print(f"{len(items)} item(s) would be removed")
        return 0
    print(f"removed {apply(items)} of {len(items)} item(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
