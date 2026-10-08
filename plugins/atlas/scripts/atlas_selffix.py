#!/usr/bin/env python3
"""Atlas self-fix: dispatch actionable doctor findings to omp implementers, each in
its own git worktree/branch, gate the result, and leave a passing fix as a branch the
user merges from the Improve page. Nothing is ever pushed; merge is a local `git merge`.

fix_state machine (findings.fix_state):
  none -> queued -> running -> verifying -> ready -> merged
                       |            |          -> (discard) skipped
                       ------------+-> none (auto-retry, attempts < MAX_ATTEMPTS)
                                    -> failed (terminal until manual retry)
  none -> skipped (no fixable target); merged -> regressed (metric got worse; finding reopens)

Worktrees live OUTSIDE the repo: ~/.atlas/worktrees/<repo>-selffix-<id>, branch atlas/selffix-<id>.
Workers start through atlas_launch.launch (a detached herdr pane; tmux only as the explicit fallback).

CLI: atlas_selffix.py [--dry-run | --tick]
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_db  # noqa: E402

MAX_ATTEMPTS = (
    2  # launches per finding before `failed` is terminal (manual retry resets)
)
WORKER_TIMEOUT_S = 2 * 3600
REGRESSION_WINDOW_S = 14 * 86400  # how long a merged fix is watched for regression
VERIFY_TIMEOUT_S = 900
REGRESSION_FACTOR = (
    1.25  # ponytail: telemetry-noise margin; per-metric tolerances if it flaps
)
ACTIVE = ("queued", "running", "verifying")
HIGHER_IS_BETTER = ("verifier_coverage_low", "cache_hit_ratio_low")
SEV_ORDER = {"CRIT": 0, "HIGH": 1, "MED": 2, "LOW": 3}
CONTRACT_TEST = "python3 -m pytest plugins/atlas/hooks/test_atlas_contract.py -q"
DEFAULT_PREFS = {"enabled": True, "interval_min": 30, "max_concurrent": 2}


def _home() -> Path:
    return Path(os.environ.get("ATLAS_HOME") or Path.home() / ".atlas")


def _state_file() -> Path:
    return _home() / "selffix-state.json"


def _read_state() -> dict:
    try:
        return json.loads(_state_file().read_text())
    except (OSError, ValueError):
        return {}


def _write_state(update: dict) -> None:
    st = _read_state()
    st.update(update)
    _home().mkdir(parents=True, exist_ok=True)
    _state_file().write_text(json.dumps(st))


def prefs() -> dict:
    out = dict(DEFAULT_PREFS)
    try:
        import atlas_dash_insights

        out.update(atlas_dash_insights._prefs_read().get("selffix") or {})
    except Exception:  # prefs are best effort; defaults are safe
        pass
    return out


def _git(args, cwd, timeout=120):
    p = subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=timeout
    )
    return p.returncode, (p.stdout + p.stderr).strip()


def _toplevel(path) -> str | None:
    d = path if os.path.isdir(path) else os.path.dirname(path)
    if not os.path.isdir(d):
        return None
    try:
        rc, out = _git(["rev-parse", "--show-toplevel"], d, 20)
    except (OSError, subprocess.SubprocessError):
        return None
    return os.path.realpath(out) if rc == 0 else None


def _is_cache_path(p: str) -> bool:
    p = os.path.realpath(p)
    return "/plugins/cache/" in p + "/" or p.startswith(
        tuple(
            os.path.expanduser(x)
            for x in ("~/.claude/plugins/cache", "~/.omp/plugins/cache")
        )
    )


# turn_quality findings name the atlas surface to tighten ("style: Length budget",
# "style: ...; hook: hooks/completion_gate.py"), not a path. Map the label to the
# file that carries it so those findings are fixable instead of permanently skipped.
_STYLE_FILE = "plugins/atlas/output-styles/atlas-orchestrator.md"
_SURFACE_HOOK = re.compile(r"\b((?:hooks|scripts)/[\w./-]+\.py)\b")


def _surface_file(tp: str) -> str:
    m = _SURFACE_HOOK.search(tp)
    if m and not os.path.isabs(tp) and (":" in tp or " " in tp):
        return "plugins/atlas/" + m.group(1)
    if tp.startswith("style:"):
        return _STYLE_FILE
    return tp


def resolve_target(finding) -> tuple[str | None, str | None, str]:
    """(repo_toplevel, abs_target, reason). repo is None when the finding is not fixable."""
    tp = _surface_file((finding.get("target_path") or "").strip())
    if not tp:
        return None, None, "finding has no target_path"
    plugin = SCRIPTS_DIR.parent
    bases = (
        [os.getcwd()] if os.path.isabs(tp) else [str(plugin.parent.parent), str(plugin)]
    )
    for b in bases:
        cand = os.path.realpath(tp if os.path.isabs(tp) else os.path.join(b, tp))
        if not os.path.exists(cand):
            continue
        if _is_cache_path(cand):
            return None, None, f"target {cand} is under a plugin cache"
        top = _toplevel(cand)
        if top:
            return top, cand, ""
        return None, None, f"target {cand} is not inside a git work tree"
    return None, None, f"target '{tp[:80]}' is not a source file (tool or label name)"


def worktree_for(top: str, fid: int) -> tuple[str, str]:
    return (
        str(_home() / "worktrees" / f"{os.path.basename(top)}-selffix-{fid}"),
        f"atlas/selffix-{fid}",
    )


def _row(conn, fid):
    return atlas_db.get_finding(conn, int(fid))


def _set(conn, fid, state, log=None, **cols):
    cols.update(fix_state=state, fix_updated_at=time.time())
    if log is not None:
        cols["fix_log"] = log[-4000:]
    sets = ",".join(f"{k}=?" for k in cols)
    conn.execute(f"UPDATE findings SET {sets} WHERE id=?", (*cols.values(), fid))
    conn.commit()


def _evidence(f) -> dict:
    try:
        ev = json.loads(f.get("evidence_json") or "{}")
    except ValueError:
        return {}
    return ev if isinstance(ev, dict) else {}


def candidates(conn, limit=200) -> list[dict]:
    rows = conn.execute(
        "SELECT id FROM findings WHERE status IN ('open','accepted') "
        "AND COALESCE(fix_state,'none')='none' LIMIT ?",
        (limit,),
    ).fetchall()
    fs = [_row(conn, r[0]) for r in rows]
    fs.sort(
        key=lambda f: (
            0,
            SEV_ORDER.get((f["severity"] or "").upper(), 9),
            f["id"],
        )
    )
    return fs


def build_prompt(f, wt, branch) -> str:
    ev = _evidence(f)
    metric = ev.get("metric_value")
    miner = ev.get("miner") or (f["fingerprint"] or "").split(":")[0]
    direction = "higher" if miner in HIGHER_IS_BETTER else "lower"
    prior = f.get("fix_log") or ""
    return (
        f"Fix this atlas doctor finding (#{f['id']}, {f['severity']}): {f['title']}\n\n"
        f"Detail: {f['detail']}\n\nProposed action: {f['proposed_action']}\n"
        f"Target: {f['target_path']}\n\n"
        f"You are in a dedicated git worktree: {wt} (branch {branch}). Edit only files in it.\n"
        "Make the smallest correct change, then COMMIT it in this worktree with git add + "
        "git commit. Do not push, merge, or touch any other checkout.\n"
        f"Success metric: the '{miner}' miner's value for this finding (now {metric}) must get "
        f"{direction} or stay equal, and `{_verify_cmd(f)}` must pass in the worktree.\n"
        + (f"\nA previous attempt failed:\n{prior}\n" if prior else "")
    )


def _verify_cmd(f) -> str:
    return _evidence(f).get("test_command") or CONTRACT_TEST


def _worker_launch(top, f, wt):
    import atlas_launch

    # Selffix workers report to the self-fix scheduler, not to whichever lead's shell
    # (ATLAS_CHANNEL/ATLAS_LEAD_NAME) happens to be running it: they get their own
    # `<main>/selffix` channel, so no lead's inbox ever receives their notes.
    todo = atlas_launch.atlas_mux.atlas_todo
    chan = todo.open_lead_channel(top, "selffix", [])["name"]
    return atlas_launch.launch(
        top,
        f"fix-{f['id']}",
        build_prompt(f, wt, f"atlas/selffix-{f['id']}"),
        agent="implementer",
        interactive=False,
        cwd=wt,
        run="selffix",
        env={"ATLAS_CHANNEL": chan, "ATLAS_LEAD_NAME": "selffix"},
    )


def _cleanup(top, wt, branch, drop_branch=True):
    if os.path.isdir(wt):
        _git(["worktree", "remove", "--force", wt], top)
    _git(["worktree", "prune"], top)
    if drop_branch:
        _git(["branch", "-D", branch], top)


def _start(conn, f, top) -> str:
    """queued/none -> running. Returns a one-line outcome."""
    fid = f["id"]
    wt, branch = worktree_for(top, fid)
    _cleanup(top, wt, branch)
    os.makedirs(os.path.dirname(wt), exist_ok=True)
    _set(conn, fid, "queued", fix_branch=branch, fix_worktree=wt)
    rc, out = _git(["worktree", "add", wt, "-b", branch], top)
    if rc:
        _set(conn, fid, "failed", f"worktree creation failed: {out}")
        return f"#{fid} worktree failed: {out}"
    st = _read_state()
    st.setdefault("baseline", {})[str(fid)] = _evidence(f).get("metric_value")
    _write_state(st)
    res = _worker_launch(top, _row(conn, fid), wt)
    attempts = (f.get("fix_attempts") or 0) + 1
    if not res.get("ok"):
        _cleanup(top, wt, branch)
        return _fail(conn, fid, f"launch failed: {res.get('reason')}", attempts)
    _set(conn, fid, "running", fix_target=res.get("target"), fix_attempts=attempts)
    return f"#{fid} running at {res.get('target')}"


def _fail(conn, fid, reason, attempts=None) -> str:
    f = _row(conn, fid)
    attempts = f.get("fix_attempts") or 0 if attempts is None else attempts
    if (
        attempts < MAX_ATTEMPTS
    ):  # auto-retry: back to the pool, reason fed to the next prompt
        _set(conn, fid, "none", reason, fix_attempts=attempts)
        return f"#{fid} will retry ({attempts}/{MAX_ATTEMPTS}): {reason}"
    _set(conn, fid, "failed", reason, fix_attempts=attempts)
    return f"#{fid} failed: {reason}"


def _tmux_kill(
    target,
):  # name kept: tests patch it; now closes a herdr pane or a tmux window
    if target:
        import atlas_launch

        atlas_launch.kill(target)


def _attach_hint(target) -> str:
    import atlas_launch

    return atlas_launch.attach_hint(target)


def _is_live(target) -> bool:
    if not target:
        return False
    import atlas_launch

    return bool(atlas_launch.is_live(target))


def _plugin_root_in(top, wt) -> str:
    rel = os.path.relpath(str(SCRIPTS_DIR.parent), _toplevel(str(SCRIPTS_DIR)) or top)
    return os.path.join(wt, rel)


def _verify(conn, f, top) -> str:
    """running -> verifying -> ready | retry/failed."""
    fid, wt, branch = f["id"], f["fix_worktree"], f["fix_branch"]
    _set(conn, fid, "verifying")
    if not os.path.isdir(wt):
        return _fail(conn, fid, "worktree missing")
    if _git(["status", "--porcelain"], wt)[1]:  # worker forgot to commit
        _git(["add", "-A"], wt)
        _git(["commit", "-m", f"atlas selffix #{fid}: {f['title'][:60]}"], wt)
    rc, n = _git(["rev-list", "--count", f"HEAD..{branch}"], top)
    if rc or not n.isdigit() or int(n) == 0:
        return _fail(conn, fid, "worker made no commits")
    cmd = _verify_cmd(f)
    try:
        p = subprocess.run(
            cmd,
            shell=True,
            cwd=wt,
            capture_output=True,
            text=True,
            timeout=VERIFY_TIMEOUT_S,
        )
        ok, out = p.returncode == 0, (p.stdout + p.stderr)[-1500:]
    except subprocess.TimeoutExpired:
        ok, out = False, f"verify timed out after {VERIFY_TIMEOUT_S}s"
    if not ok:
        return _fail(conn, fid, f"verify failed: `{cmd}`\n{out}")
    base = (_read_state().get("baseline") or {}).get(str(fid))
    after = None
    try:
        import atlas_doctor

        after = atlas_doctor.measure_finding_metric(
            conn, f, root=_plugin_root_in(top, wt)
        )
    except Exception as e:  # unmeasurable miner: verify alone gates
        out += f"\nremeasure error: {e}"
    if after is not None and base is not None and _worse(f, base, after):
        return _fail(conn, fid, f"remeasure worsened: {base} -> {after}")
    _set(conn, fid, "ready", f"verified `{cmd}`; metric {base} -> {after}")
    return f"#{fid} ready ({n} commit(s))"


def _worse(f, base, now) -> bool:
    miner = (f["fingerprint"] or "").split(":")[0]
    if miner in HIGHER_IS_BETTER:
        return now < base / REGRESSION_FACTOR
    return now > base * REGRESSION_FACTOR + 1e-9 if base else now > 0


def _check_running(conn, f, top) -> str | None:
    live = _is_live(f["fix_target"])
    age = time.time() - (f["fix_updated_at"] or 0)
    if live and age < WORKER_TIMEOUT_S:
        return None
    if live:
        _tmux_kill(f["fix_target"])
        return _fail(conn, f["id"], "worker timed out")
    if _branch_state(top, f["fix_branch"]) == "gone":
        return _reconcile_ready(conn, f)  # branch merged+deleted out of band
    return _verify(conn, f, top)


def _check_merged(conn, f, top) -> str | None:
    base = (_read_state().get("baseline") or {}).get(str(f["id"]))
    if base is None or time.time() - (f["fix_updated_at"] or 0) > REGRESSION_WINDOW_S:
        return None
    import atlas_doctor

    now = atlas_doctor.measure_finding_metric(conn, f)
    if now is not None and _worse(f, base, now):
        conn.execute("UPDATE findings SET status='open' WHERE id=?", (f["id"],))
        _set(
            conn, f["id"], "regressed", f"metric regressed after merge: {base} -> {now}"
        )
        return f"#{f['id']} regressed"
    return None


def _branch_state(top, branch) -> str:
    """'gone' (ref missing), 'merged' (already an ancestor of HEAD) or 'live'."""
    if (
        not branch
        or _git(["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"], top)[0]
    ):
        return "gone"
    return (
        "merged"
        if _git(["merge-base", "--is-ancestor", branch, "HEAD"], top)[0] == 0
        else "live"
    )


def _reconcile_ready(conn, f) -> str:
    """A ready fix whose branch was merged/deleted out of band is merged."""
    from atlas_db import set_finding_status

    set_finding_status(conn, int(f["id"]), "applied", applied_at=time.time())
    _set(conn, f["id"], "merged", f"branch {f['fix_branch']} already merged or deleted")
    return f"#{f['id']} merged (branch gone)"


def _top_of(f) -> str | None:
    wt = f.get("fix_worktree")
    if wt and os.path.isdir(wt):
        rc, out = _git(["rev-parse", "--git-common-dir"], wt)
        if rc == 0:
            return os.path.dirname(os.path.realpath(os.path.join(wt, out)))
    return resolve_target(f)[0]


def tick(conn=None) -> dict:
    """One pass: re-mine, advance running fixes, launch new ones up to the cap."""
    _home().mkdir(parents=True, exist_ok=True)
    lock = open(_home() / "selffix.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return {"busy": True, "notes": []}
    own = conn is None
    conn = conn or atlas_db.connect()
    notes: list[str] = []
    try:
        if own:
            atlas_db.init(conn)
            try:
                import atlas_doctor

                atlas_doctor.mine(conn)
            except Exception as e:
                notes.append(f"mine failed: {e}")
        for r in conn.execute(
            "SELECT id FROM findings WHERE fix_state IN ('ready','running','verifying','merged')"
        ).fetchall():
            f = _row(conn, r[0])
            if f["fix_state"] == "ready":
                top = _top_of(f)
                if top and _branch_state(top, f["fix_branch"]) != "live":
                    notes.append(_reconcile_ready(conn, f))
                continue
            top = _top_of(f)
            if not top:
                continue
            fn = _check_merged if f["fix_state"] == "merged" else _check_running
            note = fn(conn, f, top)
            if note:
                notes.append(note)
        cap = int(prefs().get("max_concurrent") or DEFAULT_PREFS["max_concurrent"])
        free = (
            cap
            - conn.execute(
                "SELECT COUNT(*) FROM findings WHERE fix_state IN ('queued','running','verifying')"
            ).fetchone()[0]
        )
        for f in candidates(conn):
            top, _, why = resolve_target(f)
            if not top:
                _set(conn, f["id"], "skipped", why)
                continue
            if free <= 0:
                continue  # keep walking so unfixable findings still get marked skipped
            if _git(["rev-parse", "--verify", "HEAD"], top)[0]:
                notes.append(f"{top} has no commits; stopping")
                break
            notes.append(_start(conn, f, top))
            free -= 1
        _write_state({"last_tick": time.time()})
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()
        if own:
            conn.close()
    return {"busy": False, "notes": notes}


def _dirty_files(top) -> set[str]:
    out = _git(["status", "--porcelain"], top)[1]
    return {
        ln[3:].split(" -> ")[-1].strip('"') for ln in out.splitlines() if ln.strip()
    }


def merge(conn, fid) -> dict:
    f = _row(conn, fid)
    if not f or f["fix_state"] != "ready":
        return {"ok": False, "error": "not_ready", "reason": "finding has no ready fix"}
    top, branch = _top_of(f), f["fix_branch"]
    if not top:
        return {
            "ok": False,
            "error": "no_repo",
            "reason": "cannot locate the repository",
        }
    if _branch_state(top, branch) != "live":
        _reconcile_ready(conn, f)
        return {
            "ok": False,
            "error": "branch_gone",
            "reason": f"branch {branch} is already merged or deleted; marked merged",
        }
    rc, out = _git(["diff", "--name-only", f"HEAD...{branch}"], top)
    overlap = sorted(_dirty_files(top) & set(out.splitlines()))
    if overlap:
        return {
            "ok": False,
            "error": "dirty_overlap",
            "reason": "uncommitted changes in files this fix touches: "
            + ", ".join(overlap),
        }
    rc, out = _git(
        ["merge", "--no-ff", "-m", f"atlas selffix #{fid}: {f['title'][:70]}", branch],
        top,
    )
    if rc:
        _git(["merge", "--abort"], top)
        return {"ok": False, "error": "merge_failed", "reason": out[-600:]}
    from atlas_db import set_finding_status

    set_finding_status(conn, int(fid), "applied", applied_at=time.time())
    _set(conn, fid, "merged", f"merged {branch}")
    _cleanup(top, f["fix_worktree"], branch, drop_branch=False)
    return {"ok": True, "branch": branch}


def discard(conn, fid) -> dict:
    f = _row(conn, fid)
    if not f:
        return {"ok": False, "error": "not_found", "reason": "no such finding"}
    top = _top_of(f)
    _tmux_kill(f.get("fix_target"))
    if top and f.get("fix_worktree"):
        _cleanup(top, f["fix_worktree"], f["fix_branch"])
    _set(conn, fid, "skipped", "discarded by user")
    return {"ok": True}


def retry(conn, fid) -> dict:
    f = _row(conn, fid)
    if not f or f["fix_state"] not in ("failed", "regressed", "skipped"):
        return {
            "ok": False,
            "error": "bad_state",
            "reason": "only failed/regressed/skipped retry",
        }
    top = _top_of(f)
    if top and f.get("fix_worktree"):
        _cleanup(top, f["fix_worktree"], f["fix_branch"])
    _set(conn, fid, "none", fix_attempts=0, fix_log="")
    conn.execute(
        "UPDATE findings SET status='open' WHERE id=? AND status NOT IN ('open','accepted')",
        (fid,),
    )
    conn.commit()
    return {"ok": True}


def snapshot(conn) -> dict:
    """Payload for the Improve page."""
    p = prefs()

    def items(states):
        q = ",".join("?" for _ in states)
        out = []
        for r in conn.execute(
            f"SELECT id FROM findings WHERE fix_state IN ({q})", states
        ):
            f = _row(conn, r[0])
            out.append(
                {
                    "id": f"doctor:{f['id']}",
                    "title": f["title"],
                    "fix_state": f["fix_state"],
                    "branch": f["fix_branch"],
                    "worktree": f["fix_worktree"],
                    "target": f["fix_target"],
                    "attach": _attach_hint(f["fix_target"])
                    if f["fix_target"]
                    else None,
                    "attempts": f["fix_attempts"] or 0,
                    "log": f["fix_log"],
                    "updated": f["fix_updated_at"],
                }
            )
        return out

    ready = items(("ready",))
    for it in ready:
        f = _row(conn, int(it["id"].split(":")[1]))
        top = _top_of(f)
        state = _branch_state(top, it["branch"]) if top else "live"
        it["branch_state"] = state
        it["diffstat"] = (
            _git(["diff", "--stat", f"HEAD...{it['branch']}"], top)[1]
            if state == "live"
            else f"branch gone ({state}); the next tick marks it merged"
        )
    return {
        "enabled": bool(p["enabled"]),
        "interval_min": int(p["interval_min"]),
        "max_concurrent": int(p["max_concurrent"]),
        "running": items(("queued", "running", "verifying")),
        "ready": ready,
        "failed": items(("failed", "regressed")),
        "last_tick": _read_state().get("last_tick"),
    }


def start_scheduler() -> threading.Thread | None:
    """Daemon thread: tick every selffix.interval_min while selffix.enabled. Called only
    from the dashboard's serve(); ATLAS_SELFFIX=0 disables it."""
    if os.environ.get("ATLAS_SELFFIX") == "0":
        return None

    def loop():
        while True:
            time.sleep(60)
            p = prefs()
            last = _read_state().get("last_tick") or 0
            if p["enabled"] and time.time() - last >= int(p["interval_min"]) * 60:
                try:
                    tick()
                except Exception as e:  # never kill the scheduler
                    sys.stderr.write(f"[atlas-selffix] tick failed: {e}\n")
                    _write_state({"last_tick": time.time()})

    t = threading.Thread(target=loop, name="atlas-selffix", daemon=True)
    t.start()
    return t


def dry_run(conn) -> list[dict]:
    out, cap = [], int(prefs()["max_concurrent"])
    for f in candidates(conn):
        top, _, why = resolve_target(f)
        row = {"id": f["id"], "title": f["title"], "target": f["target_path"]}
        if not top:
            row["skip"] = why
        else:
            row["worktree"], row["branch"] = worktree_for(top, f["id"])
            row["pick"] = sum(1 for r in out if r.get("pick")) < cap
        out.append(row)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--dry-run", action="store_true", help="print picks; create nothing"
    )
    ap.add_argument("--tick", action="store_true", help="run one real tick")
    a = ap.parse_args(argv)
    if a.tick:
        print(json.dumps(tick(), indent=2))
        return 0
    conn = atlas_db.connect()
    atlas_db.init(conn)  # idempotent migration only; no rows are written
    rows = dry_run(conn)
    cap = prefs()["max_concurrent"]
    print(
        f"cap={cap}; {len(rows)} candidate finding(s) (open/accepted, fix_state none)"
    )
    for r in rows:
        if r.get("pick"):
            print(
                f"PICK  #{r['id']} {r['title']}\n      worktree={r['worktree']}\n      branch={r['branch']}"
            )
        elif "skip" in r:
            print(f"SKIP  #{r['id']} {r['title']}  -- {r['skip']}")
        else:
            print(f"WAIT  #{r['id']} {r['title']}  (over cap)  branch={r['branch']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
