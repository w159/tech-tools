#!/usr/bin/env python3
"""PreToolUse guard: protected branches, branch/worktree caps, PR policy (scripts/atlas_git.py).

What it decides, per tool call:
  Bash `git commit|merge|cherry-pick|revert|am` on a protected branch     -> on_protected policy
  Bash `git push` whose destination is a protected branch (or --all)     -> on_protected policy;
                                                                            a force push there: deny
  Bash `git checkout -b|switch -c|branch <new>|worktree add`              -> max_branches / max_worktrees
  Bash `gh pr create|new`, `hub pull-request`, `gh api POST .../pulls`    -> prs policy
  Bash `atlas_git.py allow <branch>`                                      -> ask (the human confirms the grant)
  MCP `*create_pull_request*`, Write `xd://github` {op: pr_create}        -> prs policy
  MCP `push_files|create_or_update_file|delete_file` on a protected branch -> on_protected policy
  Agent/Task with isolation "worktree"                                    -> max_worktrees

Decisions are Claude Code permissionDecision values: deny (Claude reads the reason), ask (the human
gets a permission prompt), or nothing. Fail-open: any error lets the call through, like every atlas
hook. ATLAS_GIT_GUARD=off disables it.
"""

from __future__ import annotations

import json
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))
import atlas_env  # noqa: E402

atlas_env.apply_store_env()
import atlas_hook_guard  # noqa: E402
import atlas_harness  # noqa: E402

_REASON_CLASSES = frozenset(
    ("protected", "cap", "pr", "branch", "worktree", "force", "unread", "other")
)
_COMMITTERS = {"commit", "merge", "cherry-pick", "revert", "am"}
_NO_COMMIT_FLAGS = {
    "--abort",
    "--quit",
    "--skip",
    "--dry-run",
    "--no-commit",
    "-n",
    "--show-current-patch",
}
_BRANCH_QUERY_FLAGS = {
    "-d",
    "-D",
    "--delete",
    "-m",
    "-M",
    "--move",
    "-c",
    "-C",
    "--copy",
    "--list",
    "-l",
    "-a",
    "-r",
    "--all",
    "--remotes",
    "--show-current",
    "--set-upstream-to",
    "-u",
    "--unset-upstream",
    "--contains",
    "--no-contains",
    "--merged",
    "--no-merged",
    "-v",
    "-vv",
    "--verbose",
    "--edit-description",
    "--format",
    "--sort",
    "--points-at",
    "--column",
    "--no-column",
}
_PUSH_VALUE_OPTS = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}
from atlas_lazyre import lre  # noqa: E402
_PR_TOOL = lre(
    r"(?i)(?:^|__)(?:create_pull_request(?:_with_copilot)?|pull_request_create|create_pr|pr_create)$"
)
_API_WRITE_TOOL = lre(
    r"(?i)(?:^|__)(?:push_files|create_or_update_file|delete_file)$"
)
_ATLAS_GIT = lre(r"atlas_git\.py$")


def _decision(kind: str, reason: str, reason_class: str = "other") -> dict:
    return {"decision": kind, "reason": reason, "reason_class": reason_class}


def _reason_class(v: dict) -> str:
    """The closed-enum reason class of a verdict (atlas_git.REASON_CLASSES); anything unmapped is other."""
    rc = v.get("reason_class")
    return rc if rc in _REASON_CLASSES else "other"


def _record(decision: str, v: dict) -> None:
    """hook.git_guard.<decision>.<reason class>: the one place a verdict is counted. Stdlib-only writer."""
    try:
        import atlas_analytics_hot

        atlas_analytics_hot.record(["hook.git_guard.%s.%s" % (decision, _reason_class(v))])
    except Exception:  # noqa: BLE001 -- telemetry never affects the verdict
        pass


def _strongest(verdicts: list) -> dict | None:
    rank = {"deny": 3, "ask": 2}
    best = None
    for v in verdicts:
        if (
            v
            and v.get("decision") in rank
            and (best is None or rank[v["decision"]] > rank[best["decision"]])
        ):
            best = v
    return best


def _resolve_cwd(base: str, chdir: str | None) -> str:
    if not chdir:
        return base
    return (
        chdir if os.path.isabs(chdir) else os.path.normpath(os.path.join(base, chdir))
    )


def _push_targets(args: list, current: str | None, upstream: str | None) -> tuple:
    """(destination branch names, force, deletes) for `git push <args>`."""
    pos, force, delete, every = [], False, False, False
    i = 0
    while i < len(args):
        a = args[i]
        if a in _PUSH_VALUE_OPTS:
            i += 2
            continue
        if (
            a in ("-f", "--force")
            or a.startswith("--force-with-lease")
            or a == "--force-if-includes"
        ):
            force = True
        elif a in ("-d", "--delete"):
            delete = True
        elif a in ("--all", "--mirror", "--branches"):
            every = True
        elif not a.startswith("-"):
            pos.append(a)
        i += 1
    refspecs = pos[1:]
    targets = []
    for spec in refspecs:
        if spec.startswith("+"):
            force, spec = True, spec[1:]
        src, sep, dst = spec.partition(":")
        name = dst if sep else src
        if name in ("HEAD", "@") or (not sep and src in ("HEAD", "@")):
            name = current or ""
        name = name[len("refs/heads/") :] if name.startswith("refs/heads/") else name
        if name and not name.startswith("refs/tags/"):
            targets.append(name)
    if not refspecs and not every:
        targets.append(upstream or current or "")
    return [t for t in targets if t], force, delete, every


def _new_branch(args: list) -> str | None:
    """Name of the branch a checkout/switch/branch/worktree invocation would create, or None."""
    sub, rest = args[0], args[1:]
    if sub in ("checkout", "switch"):
        flags = (
            ("-b", "-B")
            if sub == "checkout"
            else ("-c", "-C", "--create", "--force-create")
        )
        for j, a in enumerate(rest):
            if a in flags and j + 1 < len(rest):
                return rest[j + 1]
            for f in flags:
                if a.startswith(f + "=") and f.startswith("--"):
                    return a.split("=", 1)[1]
        return None
    if sub == "branch":
        if any(
            a in _BRANCH_QUERY_FLAGS
            or a.startswith(("--format=", "--sort=", "--set-upstream-to="))
            for a in rest
        ):
            return None
        pos = [a for a in rest if not a.startswith("-")]
        return pos[0] if pos else None
    if sub == "worktree" and rest[:1] == ["add"]:
        for j, a in enumerate(rest):
            if a in ("-b", "-B") and j + 1 < len(rest):
                return rest[j + 1]
    return None


def _bash_verdicts(command: str, cwd: str, g) -> list:
    import bash_advisor as ba

    out = []
    for args, chdir in ba._git_invocations(command):
        sub = args[0]
        if sub not in _COMMITTERS and sub not in (
            "push",
            "checkout",
            "switch",
            "branch",
            "worktree",
        ):
            continue  # status/log/diff/add/...: nothing to guard, no subprocess
        if sub in ("checkout", "switch", "branch", "worktree") and not _new_branch(
            args
        ):
            if not (sub == "worktree" and args[1:2] == ["add"]):
                continue
        here = _resolve_cwd(cwd, chdir)
        try:
            root = g.repo_root(here)
        except g.GitError:
            continue
        pol = g.load_policy(root)
        if sub in _COMMITTERS:
            if any(a in _NO_COMMIT_FLAGS for a in args[1:]):
                continue
            br = g.current_branch(here)
            out.append(g.check_action(root, "commit", branch=br, policy=pol))
        elif sub == "push":
            cur = g.current_branch(here)
            up = None
            if cur:
                p = g.git(
                    here,
                    "rev-parse",
                    "--abbrev-ref",
                    "--symbolic-full-name",
                    "@{u}",
                    check=False,
                )
                up = (
                    p.stdout.strip().split("/", 1)[1]
                    if p.returncode == 0 and "/" in p.stdout
                    else None
                )
            targets, force, delete, every = _push_targets(args[1:], cur, up)
            if every:
                targets += [
                    b
                    for b in g._lines(
                        g.git(
                            root,
                            "for-each-ref",
                            "--format=%(refname:short)",
                            "refs/heads",
                            check=False,
                        )
                    )
                ]
            for t in dict.fromkeys(targets):
                why = g.is_protected(root, t, pol)
                if why and (force or delete) and pol["on_protected"] != "allow":
                    out.append(
                        _decision(
                            "deny",
                            "atlas git policy: refusing a %s of protected branch %s (%s). That is never "
                            "automated; the user runs it themselves if they really mean it."
                            % ("delete" if delete else "force push", t, why),
                            "force",
                        )
                    )
                else:
                    out.append(
                        g.check_action(root, "push", branch=cur, target=t, policy=pol)
                    )
        elif sub in ("checkout", "switch", "branch", "worktree"):
            name = _new_branch(args)
            if sub == "worktree" and args[1:2] == ["add"]:
                v = g.check_action(root, "worktree", policy=pol)
                if v["decision"] != "allow":
                    out.append(v)
                    continue
            if name:
                v = g.check_action(root, "branch", policy=pol)
                if v["decision"] == "allow":
                    try:
                        g.note_created(root, name)
                    except OSError:
                        pass
                out.append(v)
    for argv in ba._program_invocations(command, ("gh", "hub")):
        prog, rest = argv[0].rsplit("/", 1)[-1], argv[1:]
        is_pr = (prog == "gh" and rest[:2] in (["pr", "create"], ["pr", "new"])) or (
            prog == "hub" and rest[:1] == ["pull-request"]
        )
        if prog == "gh" and rest[:1] == ["api"]:
            joined = " ".join(rest)
            method = next(
                (
                    rest[j + 1].upper()
                    for j, a in enumerate(rest[:-1])
                    if a in ("-X", "--method")
                ),
                None,
            )
            fields = any(
                a in ("-f", "-F", "--field", "--raw-field", "--input") for a in rest
            )
            is_pr = bool(re.search(r"(?:^|/)pulls/?(?:\s|$)", joined)) and (
                method == "POST" or (method is None and fields)
            )
        if is_pr:
            try:
                root = g.repo_root(cwd)
                out.append(g.check_action(root, "pr", policy=g.load_policy(root)))
            except g.GitError:
                out.append(g.check_action(cwd, "pr", policy=g.load_policy(None)))
    for tokens in ba._command_segments(command):
        tokens = ba._strip_wrappers(tokens)
        idx = next((j for j, t in enumerate(tokens[:3]) if _ATLAS_GIT.search(t)), None)
        if idx is not None and tokens[idx + 1 : idx + 2] == ["allow"]:
            branch = next((t for t in tokens[idx + 2 :] if not t.startswith("-")), "?")
            out.append(
                _decision(
                    "ask",
                    "Atlas asks for a time-boxed exception to commit/push directly on the protected branch "
                    "%r. Approve only if you asked for that in this conversation."
                    % branch,
                    "protected",
                )
            )
    return out


def _relevant(tool: str, ti: dict) -> bool:
    if tool == "Bash":
        cmd = ti.get("command")
        return isinstance(cmd, str) and bool(
            re.search(r"\b(?:git|gh|hub)\b|atlas_git\.py", cmd)
        )
    if tool == "Write":
        return str(ti.get("file_path") or "").startswith("xd://github")
    if tool in ("Agent", "Task"):
        return ti.get("isolation") == "worktree"
    return bool(_PR_TOOL.search(tool) or _API_WRITE_TOOL.search(tool))


def verdict(payload: dict, g=None) -> dict | None:
    """The strongest decision for this tool call, or None to let it through."""
    if os.environ.get("ATLAS_GIT_GUARD", "").lower() in ("off", "0", "false"):
        return None
    tool = str(payload.get("tool_name") or "")
    ti = payload.get("tool_input") or {}
    if not isinstance(ti, dict):
        return None
    if not _relevant(tool, ti):
        return None  # most tool calls: no atlas_git import, no subprocess
    if g is None:
        import atlas_git as g  # noqa: N813
    cwd = str(payload.get("cwd") or os.getcwd())
    if tool == "Bash":
        return _strongest(_bash_verdicts(ti["command"], cwd, g))
    if _PR_TOOL.search(tool):
        return g.check_action(cwd, "pr", policy=g.load_policy(_safe_root(g, cwd)))
    if tool == "Write" and str(ti.get("file_path") or "").startswith("xd://github"):
        try:
            op = json.loads(ti.get("content") or "{}").get("op")
        except (ValueError, AttributeError):
            op = None
        if op == "pr_create":
            return g.check_action(cwd, "pr", policy=g.load_policy(_safe_root(g, cwd)))
        return None
    if _API_WRITE_TOOL.search(tool):
        branch = ti.get("branch")
        root = _safe_root(g, cwd)
        if not isinstance(branch, str) or not branch or root is None:
            return None
        v = g.check_action(root, "push", target=branch, policy=g.load_policy(root))
        return v if v["decision"] != "allow" else None
    if tool in ("Agent", "Task") and ti.get("isolation") == "worktree":
        root = _safe_root(g, cwd)
        if root is None:
            return None
        v = g.check_action(root, "worktree", policy=g.load_policy(root))
        return v if v["decision"] != "allow" else None
    return None


def _safe_root(g, cwd):
    try:
        return g.repo_root(cwd)
    except Exception:  # noqa: BLE001
        return None


def main() -> int:
    payload = atlas_hook_guard.load_payload("git_guard")
    if (
        not isinstance(payload, dict)
        or payload.get("hook_event_name", "PreToolUse") != "PreToolUse"
    ):
        return 0
    v = verdict(payload)
    if not v or v.get("decision") not in ("deny", "ask"):
        return 0
    decision, reason = atlas_harness.codex_safe_decision(
        v["decision"], v["reason"], payload=payload
    )
    _record(decision, v)
    sys.stdout.write(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": decision,
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(atlas_hook_guard.run_hook("git_guard", main))
