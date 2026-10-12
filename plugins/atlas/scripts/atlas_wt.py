#!/usr/bin/env python3
"""Isolated worker branches: one git worktree per parallel implementer.

    atlas_wt.py add <agent> [--base main]   worktree .atlas/wt/<agent>, branch worker/<agent>
    atlas_wt.py status                      JSON list, one row per worker/* branch
    atlas_wt.py merge <agent>               verified finding required; --no-ff merge; cleanup
    atlas_wt.py prune                       drop stale worktree metadata + merged orphan branches

Contract: branch `worker/<agent>`, worktree `.atlas/wt/<agent>` under the main
working tree's root. Never pushes, never forces (no --force, no `branch -D`, no
`reset`), never edits the main tree except through the merge itself. Every
refusal exits 1 with the exact reason on stderr.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas_finding import RELPATH, load  # noqa: E402

PREFIX = "worker/"
WT_DIR = (".atlas", "wt")
_AGENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class WtError(Exception):
    """A refusal; the message is the exact reason shown to the user."""


def git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    p = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise WtError(
            "git %s failed (exit %d): %s"
            % (" ".join(args), p.returncode, (p.stderr or p.stdout).strip())
        )
    return p


def main_root(start: Path) -> Path:
    """Top of the MAIN working tree, even when invoked from inside a worktree."""
    p = subprocess.run(
        [
            "git",
            "-C",
            str(start),
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
        ],
        capture_output=True,
        text=True,
    )
    if p.returncode != 0:
        raise WtError("not inside a git repository: %s" % start)
    common = Path(p.stdout.strip())
    return (
        common.parent
        if common.name == ".git"
        else Path(git(start, "rev-parse", "--show-toplevel").stdout.strip())
    )


def _check_agent(agent: str) -> None:
    if not _AGENT_RE.match(agent) or ".." in agent or agent.endswith(".lock"):
        raise WtError("invalid agent name %r (use letters, digits, . _ -)" % agent)


def wt_path(root: Path, agent: str) -> Path:
    return root.joinpath(*WT_DIR, agent)


def _branch_exists(root: Path, branch: str) -> bool:
    return (
        git(
            root, "show-ref", "--verify", "--quiet", "refs/heads/" + branch, check=False
        ).returncode
        == 0
    )


def _registered(root: Path, path: Path) -> bool:
    out = git(root, "worktree", "list", "--porcelain").stdout
    target = os.path.realpath(path)
    return any(
        line.startswith("worktree ") and os.path.realpath(line[9:]) == target
        for line in out.splitlines()
    )


def cmd_add(root: Path, agent: str, base: str) -> dict:
    _check_agent(agent)
    branch, path = PREFIX + agent, wt_path(root, agent)
    if path.exists() and _registered(root, path):
        cur = git(path, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        if cur != branch:
            raise WtError("%s exists but is on %r, not %r" % (path, cur, branch))
        return {
            "agent": agent,
            "branch": branch,
            "worktree": str(path),
            "created": False,
        }
    if path.exists():
        raise WtError(
            "%s exists but is not a registered worktree; remove it by hand" % path
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    if _branch_exists(root, branch):
        git(root, "worktree", "add", str(path), branch)
    else:
        git(root, "worktree", "add", str(path), "-b", branch, base)
    return {"agent": agent, "branch": branch, "worktree": str(path), "created": True}


def _verified_finding(root: Path, agent: str) -> str | None:
    """id of a `verified` finding whose title or evidence names the agent or branch."""
    pat = re.compile(
        r"(?<![\w.-])(?:%s)?%s(?![\w.-])" % (re.escape(PREFIX), re.escape(agent))
    )
    for f in load(root.joinpath(*RELPATH)):
        if not isinstance(f, dict) or f.get("status") != "verified":
            continue
        ev = f.get("evidence") or []
        hay = [str(f.get("title") or "")] + [
            str(e) for e in (ev if isinstance(ev, list) else [ev])
        ]
        if any(pat.search(h) for h in hay):
            return str(f.get("id"))
    return None


def _row(root: Path, branch: str) -> dict:
    agent = branch[len(PREFIX) :]
    path = wt_path(root, agent)
    behind, ahead = (
        int(n)
        for n in git(
            root, "rev-list", "--left-right", "--count", "HEAD..." + branch
        ).stdout.split()
    )
    has_wt = path.is_dir() and _registered(root, path)
    dirty = bool(has_wt and git(path, "status", "--porcelain").stdout.strip())
    return {
        "agent": agent,
        "branch": branch,
        "worktree": str(path) if has_wt else None,
        "head": git(root, "rev-parse", "--short", branch).stdout.strip(),
        "ahead": ahead,
        "behind": behind,
        "dirty": dirty,
        "verified_finding": _verified_finding(root, agent),
        "merged": ahead == 0,
    }


def cmd_status(root: Path) -> list:
    refs = git(
        root, "for-each-ref", "--format=%(refname:short)", "refs/heads/" + PREFIX
    ).stdout.split()
    return [_row(root, b) for b in refs]


def cmd_merge(root: Path, agent: str) -> dict:
    _check_agent(agent)
    branch = PREFIX + agent
    if not _branch_exists(root, branch):
        raise WtError("no branch %s (nothing to merge)" % branch)
    row = _row(root, branch)
    if row["verified_finding"] is None:
        raise WtError(
            "refusing to merge %s: no verified finding in %s whose title or evidence "
            "names %r or %r. Dispatch a verifier against %s and have it record "
            "`atlas_finding.py --status verified` naming the branch."
            % (branch, "/".join(RELPATH), agent, branch, row["worktree"] or branch)
        )
    if row["dirty"]:
        raise WtError(
            "refusing to merge %s: worktree %s has uncommitted changes"
            % (branch, row["worktree"])
        )
    if row["ahead"] == 0:
        raise WtError(
            "refusing to merge %s: no commits ahead of HEAD (use `prune` to clean up)"
            % branch
        )
    m = git(
        root,
        "merge",
        "--no-ff",
        "-m",
        "Merge %s (verified %s)" % (branch, row["verified_finding"]),
        branch,
        check=False,
    )
    if m.returncode != 0:
        git(root, "merge", "--abort", check=False)
        raise WtError(
            "merge of %s failed and was aborted, main tree restored: %s"
            % (branch, (m.stdout + m.stderr).strip())
        )
    sha = git(root, "rev-parse", "HEAD").stdout.strip()
    if row["worktree"]:
        git(root, "worktree", "remove", row["worktree"])
    git(root, "branch", "-d", branch)
    return {
        "agent": agent,
        "branch": branch,
        "merge_commit": sha,
        "finding": row["verified_finding"],
    }


def cmd_prune(root: Path) -> dict:
    git(root, "worktree", "prune")
    removed = []
    for r in cmd_status(root):
        if r["worktree"] is None and r["merged"]:
            git(root, "branch", "-d", r["branch"])
            removed.append(r["branch"])
    return {"pruned_branches": removed}


def main(argv: list | None = None) -> int:
    p = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    p.add_argument("--root", help="repo path (default: cwd)")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("agent")
    a.add_argument("--base", default="main")
    sub.add_parser("status")
    m = sub.add_parser("merge")
    m.add_argument("agent")
    sub.add_parser("prune")
    args = p.parse_args(argv)
    try:
        root = main_root(Path(args.root or os.getcwd()))
        if args.cmd == "add":
            out = cmd_add(root, args.agent, args.base)
        elif args.cmd == "status":
            out = cmd_status(root)
        elif args.cmd == "merge":
            out = cmd_merge(root, args.agent)
        else:
            out = cmd_prune(root)
    except WtError as exc:
        print("atlas_wt: %s" % exc, file=sys.stderr)
        return 1
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
