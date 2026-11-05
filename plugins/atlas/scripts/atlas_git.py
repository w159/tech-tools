#!/usr/bin/env python3
"""Git hygiene for atlas: one policy for branches, worktrees, PRs and protected branches.

    atlas_git.py policy                 resolved policy (built-in < user < project < env) as JSON
    atlas_git.py protected              protected branches of this repo and why each is protected
    atlas_git.py status                 branches + worktrees inventory, caps, what clean would do
    atlas_git.py clean [--remote] [--dry-run]
                                        remove merged branches / idle clean worktrees (never unmerged work)
    atlas_git.py branch <slug> [--base B]
                                        reuse or create ONE working branch (atlas/<slug>), honouring the cap
    atlas_git.py allow <branch> [--minutes N] [--reason TEXT]
                                        one-shot grant to commit/push on a protected branch (the guard
                                        turns this command into a permission prompt the human answers)
    atlas_git.py check <commit|push|branch|worktree|pr> [--branch B] [--target T]
                                        the guard's verdict for an action, as JSON (exit 0 allow, 3 ask, 4 deny)

Why this exists: atlas used to create a branch per ship, a worktree branch per team member per run,
and a PR on every "yes", with three naming schemes no cleaner understood, and nothing stopped a
commit on main while other branches were in use. Every creator now goes through this module.

Safety contract: never deletes a branch whose commits are not reachable from (or squash-equivalent
to) the base; never removes a dirty, locked or recently used worktree; never touches protected
branches; remote deletion only for agent-made branches (prefixes or the creation ledger) and only
when `cleanup_remote` is on; never force-pushes. Stdlib only.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import atlas_harness

DEFAULTS: dict = {
    # caps on what atlas itself creates in one repo
    "max_worktrees": 4,  # linked worktrees (the main checkout does not count)
    "max_branches": 8,  # local non-protected branches before a new one is refused
    "stale_days": 14,  # unmerged + untouched this long -> reported as stale (never deleted)
    "worktree_idle_minutes": 120,  # a clean, merged worktree untouched this long is removable
    # branches made by agents; only these are ever deleted on the remote
    "agent_prefixes": ["atlas/", "worker/", "claude/", "worktree-agent-"],
    # protected beyond the remote's default branch and GitHub branch protection
    "protected": [
        "main",
        "master",
        "trunk",
        "production",
        "prod",
        "live",
        "stable",
        "staging",
        "release",
        "release/*",
        "releases/*",
    ],
    # auto: deny when other branches are active, ask when the protected branch is the only line of work
    "on_protected": "auto",  # auto | deny | ask | allow
    "prs": "ask",  # ask (human confirms each) | off (never) | allow
    "cleanup_local": "merged",  # merged | off
    "cleanup_remote": "merged",  # merged (agent-made branches only) | off
    "auto_clean_hours": 6,  # boot runs a background local clean at most this often (0 = never)
    "active_days": 30,  # a branch with a commit this recent counts as "in use"
}
_CHOICES = {
    "on_protected": ("auto", "deny", "ask", "allow"),
    "prs": ("ask", "off", "allow"),
    "cleanup_local": ("merged", "off"),
    "cleanup_remote": ("merged", "off"),
}
POLICY_REL = (".atlas", "git-policy.json")
RUN_REL = (".atlas", ".run")
LEDGER_NAME = "git-ledger.json"
GRANTS_NAME = "git-grants.json"
CACHE_NAME = "git-cache.json"
STAMP_NAME = "git-clean-stamp.json"
EXIT_ASK, EXIT_DENY = 3, 4


class GitError(Exception):
    """A refusal; the message is the exact reason shown to the user."""


# ---------------------------------------------------------------------------
# git plumbing


def git(
    root, *args: str, check: bool = True, timeout: float = 30
) -> subprocess.CompletedProcess:
    try:
        p = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=dict(os.environ, GIT_TERMINAL_PROMPT="0", LC_ALL="C"),
        )
    except subprocess.TimeoutExpired as exc:
        raise GitError("git %s timed out" % " ".join(args)) from exc
    if check and p.returncode != 0:
        raise GitError(
            "git %s failed (exit %d): %s"
            % (" ".join(args), p.returncode, (p.stderr or p.stdout).strip()[-400:])
        )
    return p


def repo_root(start) -> Path:
    """Top of the MAIN working tree, even from inside a linked worktree."""
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
        raise GitError("not inside a git repository: %s" % start)
    common = Path(p.stdout.strip())
    if common.name == ".git":
        return common.parent
    return Path(git(start, "rev-parse", "--show-toplevel").stdout.strip())


def current_branch(cwd) -> str | None:
    p = git(cwd, "symbolic-ref", "--quiet", "--short", "HEAD", check=False)
    return p.stdout.strip() or None if p.returncode == 0 else None


def _lines(p: subprocess.CompletedProcess) -> list:
    return [ln for ln in p.stdout.splitlines() if ln.strip()]


def remotes(root) -> list:
    return _lines(git(root, "remote", check=False))


def default_branch(root) -> str | None:
    """origin/HEAD, else init.defaultBranch if it exists, else main/master if present."""
    for remote in ("origin", *[r for r in remotes(root) if r != "origin"]):
        p = git(
            root,
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/%s/HEAD" % remote,
            check=False,
        )
        if p.returncode == 0 and "/" in p.stdout:
            return p.stdout.strip().split("/", 1)[1]
    cand = git(
        root, "config", "--get", "init.defaultBranch", check=False
    ).stdout.strip()
    for name in ([cand] if cand else []) + ["main", "master", "trunk"]:
        if _ref_exists(root, "refs/heads/" + name):
            return name
    return None


def _ref_exists(root, ref: str) -> bool:
    return (
        git(root, "show-ref", "--verify", "--quiet", ref, check=False).returncode == 0
    )


# ---------------------------------------------------------------------------
# policy


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _user_policy_path() -> Path:
    home = os.environ.get("ATLAS_HOME") or os.path.join(
        os.path.expanduser("~"), ".atlas"
    )
    return Path(home) / "git-policy.json"


def _coerce(key: str, value, default):
    if isinstance(default, bool):
        return (
            str(value).lower() in ("1", "true", "yes", "on")
            if isinstance(value, str)
            else bool(value)
        )
    if isinstance(default, int):
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return default
    if isinstance(default, list):
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return [str(v) for v in value] if isinstance(value, list) else default
    value = str(value).strip().lower()
    return value if value in _CHOICES.get(key, (value,)) else default


def load_policy(root=None, environ=None) -> dict:
    """Built-in defaults < ~/.atlas/git-policy.json < <repo>/.atlas/git-policy.json < ATLAS_GIT_<KEY>.

    Unknown keys and bad values are ignored (the default stands), so a typo never disables a guard.
    `protected_extra` / `agent_prefixes_extra` append instead of replacing.
    """
    env = os.environ if environ is None else environ
    pol = json.loads(json.dumps(DEFAULTS))
    layers = [_read_json(_user_policy_path())]
    if root is not None:
        layers.append(_read_json(Path(root).joinpath(*POLICY_REL)))
    for layer in layers:
        for key, value in layer.items():
            if key in DEFAULTS:
                pol[key] = _coerce(key, value, pol[key])
            elif key in ("protected_extra", "agent_prefixes_extra"):
                base = key[: -len("_extra")]
                pol[base] = pol[base] + [
                    v for v in _coerce(base, value, []) if v not in pol[base]
                ]
    for key in DEFAULTS:
        raw = env.get("ATLAS_GIT_" + key.upper())
        if raw not in (None, ""):
            pol[key] = _coerce(key, raw, pol[key])
    return pol


# ---------------------------------------------------------------------------
# protected branches


def _run_dir(root) -> Path:
    return Path(root).joinpath(*RUN_REL)


def _cache(root) -> dict:
    return _read_json(_run_dir(root) / CACHE_NAME)


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".%d.tmp" % os.getpid())
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def protected_branches(root, policy=None) -> dict:
    """{name_or_pattern: reason}. Default branch + policy patterns + cached GitHub protection."""
    pol = policy or load_policy(root)
    out = {}
    d = default_branch(root)
    if d:
        out[d] = "default branch"
    for pat in pol["protected"]:
        out.setdefault(pat, "atlas policy")
    for name in _cache(root).get("github_protected") or []:
        out.setdefault(str(name), "GitHub branch protection")
    return out


from atlas_lazyre import lre  # noqa: E402
_GH_URL_RE = lre(
    r"^(?:https?://(?:[^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)"
    r"([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)


def github_slug(root) -> str | None:
    """owner/repo from the origin URL; None unless origin is on github.com."""
    p = git(root, "remote", "get-url", "origin", check=False)
    m = _GH_URL_RE.match(p.stdout.strip()) if p.returncode == 0 else None
    return "%s/%s" % m.groups() if m else None


def refresh_protected(root, timeout: float = 60) -> list | None:
    """Cache GitHub's protected branch names (plus a timestamp) in git-cache.json.

    Fails open and silently: gh missing, unauthenticated, 403, non-github origin or a timeout
    leave the cache untouched and return None."""
    slug = github_slug(root)
    if not slug or not shutil.which("gh"):
        return None
    try:
        p = subprocess.run(
            [
                "gh", "api", "-X", "GET", "--paginate",
                "repos/%s/branches" % slug,
                "-f", "protected=true", "-f", "per_page=100",
                "-q", ".[].name",
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(root),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    names = sorted({ln.strip() for ln in p.stdout.splitlines() if ln.strip()})
    cache = _cache(root)
    cache["github_protected"] = names
    cache["github_protected_at"] = int(time.time())
    try:
        _write_json(_run_dir(root) / CACHE_NAME, cache)
    except OSError:
        return None
    return names


def is_protected(root, branch: str | None, policy=None) -> str | None:
    """Reason the branch is protected, or None."""
    if not branch:
        return None
    for pat, why in protected_branches(root, policy).items():
        if branch == pat or fnmatch.fnmatchcase(branch, pat):
            return why
    return None


def _ts(root, ref: str) -> int:
    p = git(root, "log", "-1", "--format=%ct", ref, check=False)
    try:
        return int(p.stdout.strip())
    except ValueError:
        return 0


def active_other_branches(root, exclude: str | None, policy=None) -> list:
    """Non-protected branches (local or remote) with a commit inside `active_days`."""
    pol = policy or load_policy(root)
    horizon = time.time() - pol["active_days"] * 86400
    p = git(
        root,
        "for-each-ref",
        "--format=%(refname)\t%(committerdate:unix)",
        "refs/heads",
        "refs/remotes",
        check=False,
    )
    seen = []
    for line in _lines(p):
        ref, _, when = line.partition("\t")
        if ref.endswith("/HEAD"):
            continue
        short = (
            ref.split("/", 3)[-1]
            if ref.startswith("refs/remotes/")
            else ref[len("refs/heads/") :]
        )
        if short == exclude or short in seen or is_protected(root, short, pol):
            continue
        try:
            if int(when) >= horizon:
                seen.append(short)
        except ValueError:
            pass
    return seen


# ---------------------------------------------------------------------------
# grants: a human-confirmed, time-boxed exception for one protected branch


def _grants_path(root) -> Path:
    return _run_dir(root) / GRANTS_NAME


def add_grant(root, branch: str, minutes: int, reason: str) -> dict:
    grants = [
        g
        for g in _read_json(_grants_path(root)).get("grants", [])
        if g.get("until", 0) > time.time()
    ]
    grant = {
        "branch": branch,
        "until": int(time.time() + max(1, min(minutes, 240)) * 60),
        "reason": reason[:200],
        "granted_at": int(time.time()),
    }
    grants.append(grant)
    _write_json(_grants_path(root), {"grants": grants})
    return grant


def active_grant(root, branch: str) -> dict | None:
    for g in _read_json(_grants_path(root)).get("grants", []):
        if g.get("branch") == branch and g.get("until", 0) > time.time():
            return g
    return None


# ---------------------------------------------------------------------------
# ledger: branches agents created here (remote cleanup trusts only these + agent prefixes)


def _ledger_path(root) -> Path:
    return _run_dir(root) / LEDGER_NAME


def note_created(root, branch: str) -> None:
    data = _read_json(_ledger_path(root))
    names = data.get("branches") or {}
    names[branch] = int(time.time())
    if len(names) > 500:  # keep it bounded: newest 500
        names = dict(sorted(names.items(), key=lambda kv: kv[1])[-500:])
    _write_json(_ledger_path(root), {"branches": names})


def agent_made(root, branch: str, policy=None) -> bool:
    pol = policy or load_policy(root)
    if any(branch.startswith(p) for p in pol["agent_prefixes"]):
        return True
    return branch in (_read_json(_ledger_path(root)).get("branches") or {})


# ---------------------------------------------------------------------------
# merged detection


def is_merged(root, ref: str, base: str) -> bool:
    """True when every change on `ref` is already in `base`: plain ancestry, or squash/rebase
    equivalence (a synthetic squash commit of ref onto merge-base that `git cherry` marks `-`)."""
    if git(root, "merge-base", "--is-ancestor", ref, base, check=False).returncode == 0:
        return True
    mb = git(root, "merge-base", base, ref, check=False).stdout.strip()
    tree = git(root, "rev-parse", ref + "^{tree}", check=False).stdout.strip()
    if not mb or not tree:
        return False
    if git(root, "rev-parse", mb + "^{tree}", check=False).stdout.strip() == tree:
        return True  # ref adds nothing over the merge base
    squash = git(
        root, "commit-tree", tree, "-p", mb, "-m", "atlas squash probe", check=False
    ).stdout.strip()
    if not squash:
        return False
    out = git(root, "cherry", base, squash, check=False).stdout.strip()
    return out.startswith("-")


# ---------------------------------------------------------------------------
# inventory


def worktrees(root) -> list:
    """Linked worktrees (main checkout excluded) from `git worktree list --porcelain`."""
    rows, cur = [], {}
    for line in git(
        root, "worktree", "list", "--porcelain", check=False
    ).stdout.splitlines() + [""]:
        if not line.strip():
            if cur:
                rows.append(cur)
            cur = {}
            continue
        key, _, val = line.partition(" ")
        if key == "worktree":
            cur["path"] = val
        elif key == "branch":
            cur["branch"] = (
                val[len("refs/heads/") :] if val.startswith("refs/heads/") else val
            )
        elif key == "HEAD":
            cur["head"] = val
        elif key in ("locked", "prunable", "detached", "bare"):
            cur[key] = val or True
    main = os.path.realpath(str(root))
    return [r for r in rows if os.path.realpath(r.get("path", "")) != main]


def _wt_idle_minutes(path: str) -> float:
    """Minutes since anything in the worktree's git admin dir or index changed."""
    newest = 0.0
    for cand in (os.path.join(path, ".git"), path):
        try:
            newest = max(newest, os.stat(cand).st_mtime)
        except OSError:
            pass
    gitfile = os.path.join(path, ".git")
    try:
        with open(gitfile, encoding="utf-8") as fh:
            admin = fh.read().split("gitdir:", 1)[1].strip()
        for name in ("HEAD", "index", "logs/HEAD"):
            try:
                newest = max(newest, os.stat(os.path.join(admin, name)).st_mtime)
            except OSError:
                pass
    except (OSError, IndexError):
        pass
    return (time.time() - newest) / 60 if newest else 1e9


def inventory(root, policy=None) -> dict:
    pol = policy or load_policy(root)
    base = default_branch(root)
    here = current_branch(root)
    wts = worktrees(root)
    checked_out = {w.get("branch") for w in wts if w.get("branch")} | (
        {here} if here else set()
    )
    now = time.time()
    branches = []
    for name in _lines(
        git(
            root, "for-each-ref", "--format=%(refname:short)", "refs/heads", check=False
        )
    ):
        why = is_protected(root, name, pol)
        row = {
            "branch": name,
            "protected": why,
            "agent_made": agent_made(root, name, pol),
            "checked_out": name in checked_out,
            "age_days": round((now - _ts(root, name)) / 86400, 1),
        }
        if not why and base and name != base:
            row["merged"] = is_merged(root, name, base)
            ahead = git(
                root, "rev-list", "--count", "%s..%s" % (base, name), check=False
            ).stdout.strip()
            row["ahead"] = int(ahead) if ahead.isdigit() else None
            row["stale"] = (not row["merged"]) and row["age_days"] >= pol["stale_days"]
        branches.append(row)
    wt_rows = []
    for w in wts:
        path = w.get("path", "")
        exists = os.path.isdir(path)
        dirty = bool(
            exists and git(path, "status", "--porcelain", check=False).stdout.strip()
        )
        br = w.get("branch")
        merged = bool(base and br and is_merged(root, br, base))
        if base and not br and w.get("head"):
            merged = (
                git(
                    root, "merge-base", "--is-ancestor", w["head"], base, check=False
                ).returncode
                == 0
            )
        wt_rows.append(
            {
                "path": path,
                "branch": br,
                "exists": exists,
                "dirty": dirty,
                "locked": bool(w.get("locked")),
                "merged": merged,
                "idle_minutes": round(_wt_idle_minutes(path), 1) if exists else None,
            }
        )
    unprotected = [b for b in branches if not b["protected"]]
    return {
        "root": str(root),
        "default_branch": base,
        "current": here,
        "branches": branches,
        "worktrees": wt_rows,
        "counts": {
            "branches": len(unprotected),
            "max_branches": pol["max_branches"],
            "worktrees": len(wt_rows),
            "max_worktrees": pol["max_worktrees"],
        },
    }


# ---------------------------------------------------------------------------
# clean


def plan_clean(inv: dict, policy: dict) -> dict:
    """What a clean would remove, and what it would only report. Pure over the inventory."""
    remove_wt, keep_wt = [], []
    for w in inv["worktrees"]:
        if not w["exists"]:
            remove_wt.append({**w, "why": "missing on disk (prune metadata)"})
        elif w["locked"]:
            keep_wt.append({**w, "why": "locked"})
        elif w["dirty"]:
            keep_wt.append({**w, "why": "uncommitted changes"})
        elif not w["merged"]:
            keep_wt.append({**w, "why": "unmerged commits"})
        elif (w["idle_minutes"] or 0) < policy["worktree_idle_minutes"]:
            keep_wt.append(
                {**w, "why": "in use (touched %.0f min ago)" % (w["idle_minutes"] or 0)}
            )
        else:
            remove_wt.append({**w, "why": "clean and merged"})
    freed = {w["branch"] for w in remove_wt if w.get("branch")}
    remove_br, report_br = [], []
    for b in inv["branches"]:
        if b["protected"] or b["branch"] == inv["current"]:
            continue
        if b["checked_out"] and b["branch"] not in freed:
            continue
        if b.get("merged"):
            remove_br.append(
                {"branch": b["branch"], "why": "merged into %s" % inv["default_branch"]}
            )
        elif b.get("stale"):
            report_br.append(
                {
                    "branch": b["branch"],
                    "why": "stale: unmerged, %s days old" % b["age_days"],
                }
            )
    return {
        "remove_worktrees": remove_wt,
        "keep_worktrees": keep_wt,
        "remove_branches": remove_br,
        "report": report_br,
    }


def remote_candidates(root, policy, remote: str = "origin") -> list:
    """Agent-made remote branches fully merged into the default branch."""
    base = default_branch(root)
    if not base or remote not in remotes(root):
        return []
    base_ref = (
        "%s/%s" % (remote, base)
        if _ref_exists(root, "refs/remotes/%s/%s" % (remote, base))
        else base
    )
    out = []
    for ref in _lines(
        git(
            root,
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/remotes/" + remote,
            check=False,
        )
    ):
        name = ref.split("/", 1)[1] if "/" in ref else ref
        if (
            name in ("HEAD", base)
            or is_protected(root, name, policy)
            or not agent_made(root, name, policy)
        ):
            continue
        if is_merged(root, ref, base_ref):
            out.append({"remote": remote, "branch": name})
    return out


def clean(root, policy=None, remote: bool = False, dry_run: bool = False) -> dict:
    pol = policy or load_policy(root)
    if pol["cleanup_local"] == "off" and not remote:
        return {"ok": True, "skipped": "cleanup_local=off"}
    git(root, "worktree", "prune", check=False)
    inv = inventory(root, pol)
    plan = plan_clean(inv, pol)
    done = {
        "worktrees_removed": [],
        "branches_deleted": [],
        "remote_deleted": [],
        "errors": [],
    }
    if not dry_run and pol["cleanup_local"] != "off":
        for w in plan["remove_worktrees"]:
            if not w["exists"]:
                continue  # prune above already dropped its metadata
            p = git(root, "worktree", "remove", w["path"], check=False)  # never --force
            (done["worktrees_removed"] if p.returncode == 0 else done["errors"]).append(
                w["path"]
                if p.returncode == 0
                else "%s: %s" % (w["path"], p.stderr.strip()[-200:])
            )
        for b in plan["remove_branches"]:
            # -d first (refuses unmerged); a squash-merged branch needs -D, allowed only because
            # is_merged proved every change is already in the base.
            p = git(root, "branch", "-d", b["branch"], check=False)
            if (
                p.returncode != 0
                and inv["default_branch"]
                and is_merged(root, b["branch"], inv["default_branch"])
            ):
                p = git(root, "branch", "-D", b["branch"], check=False)
            (done["branches_deleted"] if p.returncode == 0 else done["errors"]).append(
                b["branch"]
                if p.returncode == 0
                else "%s: %s" % (b["branch"], p.stderr.strip()[-200:])
            )
    rplan = []
    if remote and pol["cleanup_remote"] != "off":
        git(root, "fetch", "--prune", "--quiet", check=False, timeout=60)
        rplan = remote_candidates(root, pol)
        if not dry_run:
            for r in rplan:
                p = git(
                    root,
                    "push",
                    r["remote"],
                    "--delete",
                    r["branch"],
                    check=False,
                    timeout=60,
                )
                (
                    done["remote_deleted"] if p.returncode == 0 else done["errors"]
                ).append(
                    "%s/%s" % (r["remote"], r["branch"])
                    if p.returncode == 0
                    else "%s/%s: %s"
                    % (r["remote"], r["branch"], p.stderr.strip()[-200:])
                )
    # The stamp is what session boot reads (no git on the boot path): when we last cleaned and what is left.
    if not dry_run:  # a dry run must not postpone the real clean
        nwt, cwt, _ = _over_cap(root, "worktree", pol)
        nbr, cbr, _ = _over_cap(root, "branch", pol)
        _write_json(
            _run_dir(root) / STAMP_NAME,
            {
                "at": int(time.time()),
                "worktrees": nwt,
                "max_worktrees": cwt,
                "branches": nbr,
                "max_branches": cbr,
            },
        )
    _analytics("git.clean.worktrees", len(done["worktrees_removed"]))
    _analytics("git.clean.branches", len(done["branches_deleted"]))
    _analytics("git.clean.remote", len(done["remote_deleted"]))
    return {
        "ok": not done["errors"],
        "dry_run": dry_run,
        "plan": plan,
        "remote_plan": rplan,
        **done,
    }


def _analytics(key: str, n: int = 1) -> None:
    if n <= 0:
        return
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import atlas_analytics

        atlas_analytics.record(key, n)
    except Exception:  # noqa: BLE001 -- analytics never breaks git hygiene
        pass


# ---------------------------------------------------------------------------
# one working branch per piece of work


_SLUG_RE = lre(r"[^a-z0-9._-]+")


def slugify(text: str) -> str:
    s = _SLUG_RE.sub("-", text.lower()).strip("-.")
    s = re.sub(r"-{2,}", "-", s)[:48].strip("-.")
    return s or "work"


def ensure_branch(
    root, slug: str, base: str | None = None, policy=None, switch: bool = True
) -> dict:
    """Reuse atlas/<slug> if it exists, else create it from base, after a clean if at the cap."""
    pol = policy or load_policy(root)
    name = (
        slug
        if slug.startswith(tuple(pol["agent_prefixes"]))
        else "atlas/" + slugify(slug)
    )
    if is_protected(root, name, pol):
        raise GitError("refusing: %s is a protected branch name" % name)
    created = False
    if not _ref_exists(root, "refs/heads/" + name):
        verdict = check_action(root, "branch", policy=pol)
        if verdict["decision"] == "deny":
            raise GitError(verdict["reason"])
        start = base or default_branch(root) or "HEAD"
        git(root, "branch", name, start)
        note_created(root, name)
        created = True
        _analytics("git.branch.created")
    else:
        _analytics("git.branch.reused")
    if switch and current_branch(root) != name:
        git(root, "switch", name)
    return {"branch": name, "created": created, "switched": switch}


# ---------------------------------------------------------------------------
# the verdict the guard hook applies


def _over_cap(root, kind: str, pol: dict) -> tuple:
    if kind == "worktree":
        n, cap = len(worktrees(root)), pol["max_worktrees"]
    else:
        n = sum(
            1
            for b in _lines(
                git(
                    root,
                    "for-each-ref",
                    "--format=%(refname:short)",
                    "refs/heads",
                    check=False,
                )
            )
            if not is_protected(root, b, pol)
        )
        cap = pol["max_branches"]
    return n, cap, (cap > 0 and n >= cap)


# Closed set of why a verdict fired (the schema's "reason" enum). Every ask/deny from check_action carries
# exactly one in "reason_class"; the hook records it as hook.git_guard.<decision>.<class>. "cap" and
# "other" are part of the enum; no rule here maps to them (other is the hook's fallback).
REASON_CLASSES = ("protected", "cap", "pr", "branch", "worktree", "force", "unread", "other")


def check_action(
    root, action: str, branch: str | None = None, target: str | None = None, policy=None
) -> dict:
    """{"decision": allow|ask|deny, "reason": str[, "reason_class": one of REASON_CLASSES on ask/deny]}.
    action: commit | push | branch | worktree | pr. Rule -> class: pr policy -> pr; branch cap -> branch;
    worktree cap -> worktree; commit/push on a protected branch -> protected."""
    pol = policy or load_policy(root)
    script = "python3 %s" % os.path.abspath(__file__)
    if action == "pr":
        if pol["prs"] == "allow":
            return {"decision": "allow", "reason": ""}
        if pol["prs"] == "off":
            return {
                "decision": "deny",
                "reason_class": "pr",
                "reason": "atlas git policy: opening pull requests is off for this repo (prs=off). Push the "
                "branch and give the user the compare URL instead; the user can open the PR, or set "
                '"prs": "ask" in .atlas/git-policy.json.',
            }
        return {
            "decision": "ask",
            "reason_class": "pr",
            "reason": "atlas git policy (prs=ask): opening a pull request is the user's call. Approve only if "
            'you asked for this PR. Set "prs": "allow" or "off" in .atlas/git-policy.json to stop this prompt.',
        }
    if action in ("branch", "worktree"):
        n, cap, over = _over_cap(root, action, pol)
        if over and pol["cleanup_local"] != "off":
            clean(root, pol)
            n, cap, over = _over_cap(root, action, pol)
        if over:
            noun = (
                "linked worktrees"
                if action == "worktree"
                else "unprotected local branches"
            )
            return {
                "decision": "deny",
                "reason_class": action,
                "reason": "atlas git policy: %d %s already (cap %d; merged ones were cleaned). Reuse an "
                "existing one (`%s status`), merge or remove finished work, or raise %s in "
                ".atlas/git-policy.json." % (n, noun, cap, script, "max_worktrees" if action == "worktree" else "max_branches"),
            }
        return {"decision": "allow", "reason": ""}
    # commit / push: protected-branch rule
    ref = target or branch
    why = is_protected(root, ref, pol)
    if not why or pol["on_protected"] == "allow":
        return {"decision": "allow", "reason": ""}
    grant = active_grant(root, ref)
    if grant:
        return {
            "decision": "allow",
            "reason": "grant until %d: %s" % (grant["until"], grant["reason"]),
        }
    mode = pol["on_protected"]
    others = active_other_branches(root, exclude=ref, policy=pol)
    if mode == "auto":
        mode = "deny" if others else "ask"
    verb = "commit on" if action == "commit" else "push to"
    if mode == "ask":
        return {
            "decision": "ask",
            "reason_class": "protected",
            "reason": "atlas git policy: this would %s %s (%s). Approve only if you asked for it."
            % (verb, ref, why),
        }
    in_use = (" Other branches in use: %s." % ", ".join(others[:6])) if others else ""
    return {
        "decision": "deny",
        "reason_class": "protected",
        "reason": "atlas git policy: refusing to %s %s (%s).%s Work on a branch instead: `%s branch <slug>` "
        "(reuses atlas/<slug> if it exists). Only if the user explicitly asked for %s in this conversation: "
        '`%s allow %s --reason "<their words>"` (they confirm it in a permission prompt), then retry.'
        % (verb, ref, why, in_use, script, ref, script, ref),
    }


# ---------------------------------------------------------------------------
# CLI


def _emit(obj, code: int = 0) -> int:
    print(json.dumps(obj, indent=2, sort_keys=True))
    return code


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="atlas_git", description=(__doc__ or "").splitlines()[0]
    )
    p.add_argument("--root", help="repo path (default: cwd)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("policy")
    pr = sub.add_parser("protected")
    pr.add_argument(
        "--refresh",
        action="store_true",
        help="re-read GitHub branch protection via gh into the cache (fails open)",
    )
    sub.add_parser("status")
    c = sub.add_parser("clean")
    c.add_argument(
        "--remote",
        action="store_true",
        help="also delete merged agent-made remote branches",
    )
    c.add_argument("--dry-run", action="store_true")
    b = sub.add_parser("branch")
    b.add_argument("slug")
    b.add_argument("--base")
    b.add_argument("--no-switch", action="store_true")
    a = sub.add_parser("allow")
    a.add_argument("branch")
    a.add_argument("--minutes", type=int, default=30)
    a.add_argument("--reason", default="")
    k = sub.add_parser("check")
    k.add_argument("action", choices=("commit", "push", "branch", "worktree", "pr"))
    k.add_argument("--branch")
    k.add_argument("--target")
    args = p.parse_args(argv)
    try:
        root = repo_root(Path(args.root or os.getcwd()))
        pol = load_policy(root)
        if args.cmd == "policy":
            return _emit(pol)
        if args.cmd == "protected":
            if args.refresh:
                refresh_protected(root)
            return _emit(protected_branches(root, pol))
        if args.cmd == "status":
            inv = inventory(root, pol)
            return _emit({**inv, "clean_plan": plan_clean(inv, pol)})
        if args.cmd == "clean":
            out = clean(root, pol, remote=args.remote, dry_run=args.dry_run)
            return _emit(out, 0 if out.get("ok") else 1)
        if args.cmd == "branch":
            return _emit(
                ensure_branch(
                    root, args.slug, args.base, pol, switch=not args.no_switch
                )
            )
        if args.cmd == "allow":
            if not args.reason.strip():
                raise GitError("allow needs --reason quoting the user's request")
            return _emit(
                {
                    "ok": True,
                    "grant": add_grant(root, args.branch, args.minutes, args.reason),
                }
            )
        branch = args.branch or current_branch(root)
        v = check_action(
            root, args.action, branch=branch, target=args.target, policy=pol
        )
        if v["decision"] == "ask":
            v["decision"], v["reason"] = atlas_harness.codex_safe_decision("ask", v["reason"])
        return _emit(v, {"allow": 0, "ask": EXIT_ASK, "deny": EXIT_DENY}[v["decision"]])
    except GitError as exc:
        print("atlas_git: %s" % exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
