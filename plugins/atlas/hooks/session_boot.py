#!/usr/bin/env python3
"""Atlas SessionStart boot. Fast, idempotent, crash-proof.

Emits hookSpecificOutput.additionalContext pointing at the operating contract and atlas-orchestrate
methodology, reports whether claude-mem and context-mode are present, and
surfaces a one-line ready status. Never blocks session start: any error exits 0
silently.
"""

import contextlib
import json
import os
import shlex
import shutil
import sqlite3
import sys
import time


def ensure_dashboard():
    """Start the shared multi-session dashboard daemon if needed.

    Mirrors claude-mem/Serena worker UX: one loopback UI for all terminals.
    Does NOT open a browser tab (avoids focus-stealing on every SessionStart).
    Returns a short status line with the URL, or None on failure (fail-open).
    """
    if os.environ.get("ATLAS_DASHBOARD", "on").lower() in ("0", "off", "false", "no"):
        return None
    # Scratch state (temp HOME/ATLAS_HOME/DB) must never reach the shared :7421 daemon, which
    # serves the user's real ~/.atlas. Mirrors atlas_dashboard.under_temp_dir; duplicated so boot
    # skips without importing the dashboard module.
    import tempfile

    roots = [
        os.path.realpath(r)
        for r in (tempfile.gettempdir(), "/tmp", "/var/folders", "/private/var/folders")  # noqa: S108 -- scratch-root literal, not a file create
    ]
    state = os.environ.get("ATLAS_HOME") or os.path.join(
        os.path.expanduser("~"), ".atlas"
    )
    scratch = (
        os.path.expanduser("~"),
        state,
        os.environ.get("ATLAS_DASHBOARD_DB") or os.path.join(state, "atlas.db"),
    )
    shared = os.environ.get("ATLAS_DASHBOARD_PORT", "7421").strip() in ("", "7421")
    if shared and any(
        p == r or p.startswith(r + os.sep)
        for p in (os.path.realpath(os.path.expanduser(v)) for v in scratch)
        for r in roots
    ):
        return None
    try:
        import subprocess

        scripts = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "scripts"
        )
        script = os.path.abspath(os.path.join(scripts, "atlas_dashboard.py"))
        if not os.path.isfile(script):
            return None
        env = os.environ.copy()
        res = subprocess.run(
            [sys.executable, script, "ensure"],
            capture_output=True,
            text=True,
            timeout=8,
            env=env,
        )
        if res.returncode != 0:
            return None
        data = json.loads(res.stdout or "{}")
        url = data.get("url")
        if not url:
            return None
        state = "ready" if data.get("already_running") else "started"
        return f"dashboard: {url} ({state})"
    except Exception:
        return None


_COLONY_FRESH_S = 30  # healthy status younger than this is used as-is
_COLONY_DOWN_TTL_S = 60  # unhealthy status reused this long
_COLONY_TRUST_S = 600  # healthy status up to this old is used, with a detached refresh


_COLONY_PORTS = (7317, 17317, 27317, 37317, 47317)
_COLONY_PS_RE = r"server/(managed|supervisor)\.ts|bun\s+(\S*/)?server/index\.ts|herdr-web-ui\S*/server/index\.ts"


def _colony_stack_url(data):
    """Existing herdr-web-ui stack: the URL that answers /api/health (status `url` first, then the five ports,
    300 ms each), "" when the ps match / `upstream_plugin_on_port` says a stack runs but no port answers, else
    None. Read-only. Any non-None result means NEVER spawn another; a URL is only returned if it answered."""
    import re
    import subprocess
    import urllib.request

    first = data.get("url")
    urls = ([first] if first else []) + [
        f"http://127.0.0.1:{p}"
        for p in _COLONY_PORTS
        if f"http://127.0.0.1:{p}" != first
    ]
    for url in urls:
        with contextlib.suppress(Exception):
            with urllib.request.urlopen(url + "/api/health", timeout=0.3) as r:
                if r.status == 200:
                    return url
    if data.get("upstream_plugin_on_port"):
        return ""
    with contextlib.suppress(Exception):
        ps = subprocess.run(
            ["ps", "-axo", "command"], capture_output=True, text=True, timeout=2
        )
        if re.search(_COLONY_PS_RE, ps.stdout or ""):
            return ""
    return None


def ensure_colony():
    """Probe the one upstream herdr-web-ui (cached) and, if it is down while herdr runs, start
    `atlas_herdr.py ensure` DETACHED (it takes the shared flock, so concurrent boots never start a second
    instance). Fail-open, never blocks boot. ATLAS_COLONY=off skips it. Output goes to $ATLAS_HOME/herdr-ensure.log.
    Returns a one-line status, or None."""
    if os.environ.get("ATLAS_COLONY", "on").lower() in ("0", "off", "false", "no"):
        return None
    try:
        import subprocess

        script = os.path.abspath(
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "..",
                "scripts",
                "atlas_herdr.py",
            )
        )
        if not os.path.isfile(script):
            return None
        home = os.environ.get("ATLAS_HOME") or os.path.join(
            os.path.expanduser("~"), ".atlas"
        )
        cache = os.path.join(home, "herdr-status-cache.json")
        data = None

        def refresh_detached():
            subprocess.Popen(
                [
                    "sh",
                    "-c",
                    '"$0" "$1" status >"$2.tmp" && mv "$2.tmp" "$2"',
                    sys.executable,
                    script,
                    cache,
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                env=os.environ.copy(),
            )

        try:
            age = time.time() - os.path.getmtime(cache)
            with open(cache) as f:
                cached = json.load(f)
            if cached.get("healthy") and age < _COLONY_TRUST_S:
                data = cached
                if age >= _COLONY_FRESH_S:
                    refresh_detached()  # stale-while-revalidate, never on the boot path
            elif age < _COLONY_DOWN_TTL_S:
                if not cached.get("herdr_server"):
                    return None  # herdr not running (negative cache): skip the probe
                data = cached  # web UI down: reuse briefly; the detached ensure below is flock-guarded
        except (OSError, ValueError):
            # Cold cache: never pay the status probe on the boot path; probe detached, use it next boot.
            try:
                os.makedirs(home, exist_ok=True)
                refresh_detached()
            except OSError:
                pass
            return "colony: checking"
        if data is None:
            res = subprocess.run(
                [sys.executable, script, "status"],
                capture_output=True,
                text=True,
                timeout=4,
                env=os.environ.copy(),
            )
            data = json.loads(res.stdout or "{}")
            os.makedirs(home, exist_ok=True)
            with open(cache + ".tmp", "w") as f:
                json.dump(data, f)
            os.replace(cache + ".tmp", cache)
        url = data.get("url")
        if data.get("healthy"):
            return f"colony ready at {url}"
        if not data.get("herdr_server"):
            return None  # herdr itself is not running; Atlas cannot start it
        existing = _colony_stack_url(data)
        if existing is not None:
            # a stack exists: never spawn a second one; only name a URL that answered
            return (
                f"colony: {existing} (ready)"
                if existing
                else "colony: herdr web UI running (port unknown)"
            )
        os.makedirs(home, exist_ok=True)
        log_path = os.path.join(home, "herdr-ensure.log")
        with open(log_path, "ab") as log:
            subprocess.Popen(
                [sys.executable, script, "ensure"],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                start_new_session=True,
                env=os.environ.copy(),
            )
        return f"colony: starting the herdr web UI at {url} (log: {log_path})"
    except Exception:
        return None


def has_cmd(name):
    return shutil.which(name) is not None


# Output-style name shipped under output-styles/atlas-orchestrator.md (force-for-plugin).
# Evidence conflicts on whether an explicit settings.json "outputStyle" beats the plugin
# force: 5.25.0 observed ATLAS | headers vanishing under "concise"; a later live probe
# saw no suppression, and current Claude Code docs say force-for-plugin overrides the
# user setting. Boot re-injects the contract every session as a cheap hedge either way.
ATLAS_OUTPUT_STYLE = "Atlas Orchestrator"
_STATUS_GLYPHS = (
    "research 🔍 | theory 💡 | test 🧪 | validate 📋 | "
    "implement 🔧 | verify ✅ | done 🏁 | blocked ⛔"
)


def read_output_style(settings_path=None):
    """Return settings.json outputStyle or '' if unset/unreadable."""
    path = settings_path or os.path.join(
        os.path.expanduser("~"), ".claude", "settings.json"
    )
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return ""
        val = data.get("outputStyle") or ""
        return val if isinstance(val, str) else ""
    except Exception:
        return ""


def status_contract_lines(active_style=""):
    """Style-override hedge only. The status header, ledger, done-check and scope
    rules live once in output-styles/atlas-orchestrator.md (Claude Code applies it
    force-for-plugin; omp injects it from omp/style.ts), so boot repeats them only
    when settings.json outputStyle replaces that style."""
    style = (active_style or "").strip()
    if not style or style == ATLAS_OUTPUT_STYLE:
        return []
    return [
        f"STYLE OVERRIDE: outputStyle is {style!r}, not {ATLAS_OUTPUT_STYLE!r}; it may suppress the atlas style. "
        f"Every substantive reply opens `ATLAS | <glyph> <phase> | <state>` ({_STATUS_GLYPHS}); "
        "before done re-read the request and show evidence; build only what was named; "
        "without TodoWrite add `LEDGER | n/m | now: ... | left: ...`."
    ]


def plugin_enabled(name, root=None):
    """Claude Code plugin enablement (enabledPlugins); False on any error."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import tool_routing

        return tool_routing.plugin_enabled(name, root)
    except Exception:
        return False


def recall_mandate():
    """claude-mem recall line from the shared contract (contracts/mandates.json); None if unreadable."""
    try:
        path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..",
            "contracts",
            "mandates.json",
        )
        with open(path) as fh:
            template = json.load(fh)["recall"]
        return template.replace("{route}", "mcp__plugin_claude-mem_mcp-search__search")
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


# --- shell-edit snapshot (delegation mandate) ---------------------------------
# The Stop gate's (m) delegation mandate counts Write/Edit events, so code fixed
# through the shell (`sed -i`, `tee`, a codegen script) is invisible to it. At
# SessionStart we hash every non-docs path git reports dirty/untracked; the gate
# later treats paths that are dirty now but absent/changed vs this snapshot as
# main-thread code writes. Twin of omp/delegation.ts `snapshotDirty`. Exemptions
# come from contracts/native-tools.json `delegationExempt`, like the gate.

_DELETED = "deleted"


def _delegation_exempt_spec():
    """(dirs, extensions) from contracts/native-tools.json, or None if unreadable."""
    try:
        path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..",
            "contracts",
            "native-tools.json",
        )
        with open(path) as fh:
            spec = json.load(fh)["delegationExempt"]
        return tuple(str(d) for d in spec["dirs"]), tuple(
            str(e) for e in spec["extensions"]
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None


def dirty_map(root):
    """{repo-relative non-docs path: sha256} for paths `git status` reports dirty
    or untracked under root; None when root is not a git work tree, git is
    unavailable, or the exemption contract is unreadable (callers fail open)."""
    import hashlib
    import subprocess

    exempt = _delegation_exempt_spec()
    if exempt is None:
        return None
    dirs, exts = exempt
    try:
        res = subprocess.run(
            ["git", "status", "--porcelain", "-z", "--untracked-files=all"],
            cwd=str(root),
            capture_output=True,
            timeout=10,
            check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    paths = {}
    for field in res.stdout.decode("utf-8", "replace").split("\0"):
        # "XY path"; the bare original-path field after a rename has no XY prefix.
        if len(field) < 4 or field[2] != " ":
            continue
        rel = field[3:]
        if rel.endswith(exts) or any(seg in dirs for seg in rel.split("/")):
            continue
        try:
            with open(os.path.join(str(root), rel), "rb") as fh:
                paths[rel] = hashlib.sha256(fh.read()).hexdigest()
        except OSError:
            paths[rel] = _DELETED
    return paths


def snapshot_path(root, session_id):
    return os.path.join(
        str(root), ".atlas", ".run", f"dirty-snapshot-{session_id}.json"
    )


def write_dirty_snapshot(cwd, session_id):
    """Write `<root>/.atlas/.run/dirty-snapshot-<session>.json` once per session
    (a repeat SessionStart -- resume/compact -- keeps the first). Best-effort:
    returns the path written, else None (no session id, not git, unwritable)."""
    try:
        if not session_id:
            return None
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from pathlib import Path

        from docs_drift import find_root as _find_docs_root

        root = _find_docs_root(Path(cwd)) or Path(cwd)
        target = snapshot_path(root, session_id)
        if os.path.exists(target):
            return None
        paths = dirty_map(root)
        if paths is None:
            return None
        os.makedirs(os.path.dirname(target), exist_ok=True)
        tmp = target + ".tmp"
        with open(tmp, "w") as fh:
            json.dump({"session": session_id, "paths": paths}, fh)
        os.replace(tmp, target)
        return target
    except Exception:
        return None


def detect_dep(module_marker):
    try:
        import importlib.util

        return importlib.util.find_spec(module_marker) is not None
    except Exception:
        return False


# --- serena project self-heal ------------------------------------------------
# Subagents lose every symbol tool when serena cannot load a project: calls return
# `No active project ... known projects: []` or `KeyError: 'languages'`, and the agent
# falls back to Bash grep/cat/sed. Both failures share one cause -- a `.serena/project.yml`
# written before serena 1.6 made `languages:` a required field. Heal it at boot so the
# whole session, subagents included, starts with working symbol lookup.

_LANG_BY_EXT = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "typescript",
    ".jsx": "typescript",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".kt": "kotlin",
    ".swift": "swift",
    ".cpp": "cpp",
    ".c": "c",
}
_SKIP_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    "dist",
    "build",
    ".next",
    "vendor",
    "target",
}
_WALK_BUDGET = 6000  # files; keeps boot fast on large trees


def _detect_languages(root, cap=3):
    counts = {}
    seen = 0
    for _dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".venv")
        ]
        for fn in filenames:
            lang = _LANG_BY_EXT.get(os.path.splitext(fn)[1])
            if lang:
                counts[lang] = counts.get(lang, 0) + 1
            seen += 1
        if seen > _WALK_BUDGET:
            break
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:cap]
    return [lang for lang, _ in ranked]


def heal_serena_project(root):
    """Append the `languages:` key serena >= 1.6 requires. Returns a status line or None.

    Idempotent: a config that already declares `languages:` at top level is left alone.
    Absent configs are NOT created -- serena's own onboarding owns that.
    """
    cfg = os.path.join(root, ".serena", "project.yml")
    if not os.path.isfile(cfg):
        return None
    try:
        with open(cfg, encoding="utf-8") as fh:
            text = fh.read()
    except Exception:
        return None
    # Top-level key only: `language_servers:` and indented matches do not count.
    for line in text.splitlines():
        if line.startswith("languages:"):
            return None
    langs = _detect_languages(root) or ["python"]
    block = (
        "\n# required by serena >= 1.6 (ProjectConfig.FIELDS_WITHOUT_DEFAULTS); without it the\n"
        "# project fails to load with KeyError: 'languages' and every symbol tool goes dark\n"
        "# for this session and all its subagents. Added automatically by atlas session_boot.\n"
        "languages: [" + ", ".join(f'"{lang}"' for lang in langs) + "]\n"
    )
    try:
        with open(cfg, "a", encoding="utf-8") as fh:
            fh.write(block)
    except Exception:
        return None
    return (
        f"serena: repaired {cfg} (added languages: {', '.join(langs)}) - symbol tools now load for "
        "subagents; they had been failing with KeyError: 'languages'"
    )


def _relative_time(epoch_s):
    """Render an epoch-seconds timestamp as a short 'Xm/Xh/Xd ago' string."""
    delta = time.time() - epoch_s
    if delta < 60:
        return "just now"
    if delta < 3600:
        return f"{int(delta // 60)}m ago"
    if delta < 86400:
        return f"{int(delta // 3600)}h ago"
    return f"{int(delta // 86400)}d ago"


def _claude_mem_summary(project_name):
    """Latest session_summaries row plus recent decision/discovery titles for
    this project, read-only from the claude-mem SQLite store. Returns a dict
    or None when the DB or rows are absent."""
    db = os.path.expanduser("~/.claude-mem/claude-mem.db")
    if not project_name or not os.path.exists(db):
        return None
    conn = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
    try:
        summary = conn.execute(
            "SELECT completed, next_steps, files_edited, created_at_epoch "
            "FROM session_summaries WHERE project=? "
            "ORDER BY created_at_epoch DESC LIMIT 1",
            (project_name,),
        ).fetchone()
        threads = conn.execute(
            "SELECT title FROM observations WHERE project=? "
            "AND type IN ('decision','discovery') "
            "ORDER BY created_at_epoch DESC LIMIT 3",
            (project_name,),
        ).fetchall()
        titles = [t[0] for t in threads if t[0]]
        if not summary and not titles:
            return None  # no rows for this project; avoid a truthy-but-empty dict
        return {"summary": summary, "threads": titles}
    finally:
        conn.close()


def _atlas_session_context(conn, root):
    """Most recent session_logs row for this cwd plus the last real user
    prompt, last edited file, and unverified-claim count, read via the
    already-open atlas_db connection. Returns a dict or None if no session
    has been mirrored for this cwd yet."""
    row = conn.execute(
        "SELECT session_id, git_branch, cursor_bytes, file_size, started_at "
        "FROM session_logs WHERE cwd=? ORDER BY started_at DESC LIMIT 1",
        (root,),
    ).fetchone()
    if not row:
        return None
    session_id, branch, cursor_bytes, file_size, started_at = row

    prompt = None
    for (text,) in conn.execute(
        "SELECT text FROM user_prompts WHERE session_id=? ORDER BY ts DESC LIMIT 10",
        (session_id,),
    ).fetchall():
        stripped = (text or "").lstrip()
        if stripped.startswith("<task-notification") or stripped.startswith(
            "<command-"
        ):
            continue
        prompt = text
        break

    last_file = None
    edit_row = conn.execute(
        "SELECT input_summary FROM tool_calls WHERE session_id=? "
        "AND tool_name IN ('Edit','Write','MultiEdit','NotebookEdit') "
        "ORDER BY ts DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    if edit_row and edit_row[0]:
        try:
            last_file = json.loads(edit_row[0]).get("file_path")
        except Exception:
            last_file = None

    unverified = conn.execute(
        "SELECT COUNT(*) FROM signals WHERE session_id=? "
        "AND signal_type='unverified_claim'",
        (session_id,),
    ).fetchone()[0]

    lag_kb = 0
    if file_size and cursor_bytes and file_size > cursor_bytes:
        lag_kb = (file_size - cursor_bytes) // 1024

    return {
        "branch": branch,
        "started_at": started_at,
        "prompt": prompt,
        "last_file": last_file,
        "unverified": unverified,
        "lag_kb": lag_kb,
    }


# Canonical structure per docs-ssot.md: root entry files, docs/ minimum plus
# base wiki subfolders, and the durable .atlas/ subfolders.
_STRUCTURE_PATHS = (
    "docs/",
    "docs/CHANGELOG.md",
    "docs/ROADMAP.md",
    "docs/architecture/",
    "docs/decisions/",
    "docs/plans/",
    "docs/specs/",
    "docs/features/",
    "docs/lessons/",
    "docs/wiki/",
    ".atlas/",
    ".atlas/evidence/",
    ".atlas/findings/",
    ".atlas/audits/",
    ".atlas/decisions/",
    ".atlas/archive/",
    ".atlas/understand-anything/",
    ".atlas/graphify/",
    ".atlas/self-improvement/",
    ".atlas/memory/",
    ".atlas/nudge/",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
)


def _find_structure_root(start_dir):
    """Walk up to 6 parent levels from start_dir looking for a directory
    that already has a .git entry or a docs/ folder, and treat that as the
    project root for the structure check. Falls back to start_dir itself
    if nothing is found. Fail-open: any error returns start_dir."""
    try:
        d = os.path.abspath(start_dir)
        for _ in range(7):  # start_dir plus up to 6 parents
            if os.path.exists(os.path.join(d, ".git")) or os.path.isdir(
                os.path.join(d, "docs")
            ):
                return d
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
        return os.path.abspath(start_dir)
    except Exception:
        return start_dir


def missing_structure(start_dir):
    """Shallow, cheap check for the canonical atlas project structure
    (docs-ssot.md): root entry files (README.md, AGENTS.md, CLAUDE.md,
    .gitignore), the docs/ minimum plus base wiki subfolders (architecture,
    decisions, plans, specs, features, lessons, wiki), and the durable
    .atlas/ subfolders (evidence, findings, audits, decisions, archive,
    understand-anything, graphify, self-improvement, memory, nudge). Returns
    the list of missing path labels, or [] when everything is present or on
    any error -- advisory only, never blocks boot."""
    try:
        root = _find_structure_root(start_dir)
        missing = []
        for label in _STRUCTURE_PATHS:
            path = os.path.join(root, label.rstrip("/"))
            exists = (
                os.path.isdir(path) if label.endswith("/") else os.path.isfile(path)
            )
            if not exists:
                missing.append(label)
        return missing
    except Exception:
        return []


def resume_block(root):
    """Derive a compact 'Resuming <project>' markdown block from claude-mem's
    session memory and atlas_db's transcript mirror, so the next session gets
    passive continuity context with zero user input. Read-only on both DBs;
    any failure anywhere (missing DB, missing table, locked file) returns None
    silently rather than blocking boot."""
    try:
        project_name = os.path.basename(root)
        atlas_ctx = None
        conn = None
        try:
            import atlas_db

            conn = atlas_db.connect()
            atlas_db.init(conn)
            row = conn.execute(
                "SELECT name FROM projects WHERE root_path=?", (root,)
            ).fetchone()
            if row and row[0]:
                project_name = row[0]
            atlas_ctx = _atlas_session_context(conn, root)
        except Exception:
            atlas_ctx = None
        finally:
            if conn is not None:
                conn.close()

        mem = None
        try:
            mem = _claude_mem_summary(project_name)
        except Exception:
            mem = None

        if not mem and not atlas_ctx:
            return None

        summary = mem["summary"] if mem else None
        newest_epoch = None
        if summary and summary[3]:
            newest_epoch = summary[3] / 1000.0
        if atlas_ctx and atlas_ctx.get("started_at"):
            newest_epoch = max(newest_epoch or 0, atlas_ctx["started_at"])

        lines = [f"## Resuming {project_name}"]

        header = []
        if newest_epoch:
            header.append(f"Last active: {_relative_time(newest_epoch)}")
        if atlas_ctx and atlas_ctx.get("branch"):
            header.append(f"branch: {atlas_ctx['branch']}")
        if header:
            lines.append("  |  ".join(header))

        if summary and summary[0]:
            lines.append(f"Last task: {str(summary[0])[:150]}")
        if atlas_ctx and atlas_ctx.get("prompt"):
            lines.append(f"Last intent: {str(atlas_ctx['prompt'])[:150]}")

        last_file = atlas_ctx.get("last_file") if atlas_ctx else None
        if not last_file and summary and summary[2]:
            last_file = str(summary[2]).splitlines()[0].strip(" -*\t,")
        if last_file:
            tail = f"Last file: {last_file}"
            if atlas_ctx and atlas_ctx.get("lag_kb"):
                tail += f" (mirror {atlas_ctx['lag_kb']}KB behind live)"
            lines.append(tail)

        threads = []
        if summary and summary[1]:
            threads.extend(
                item.strip(" -*\t")
                for item in str(summary[1]).splitlines()
                if item.strip(" -*\t")
            )
        if mem and mem.get("threads"):
            threads.extend(mem["threads"])
        if threads:
            lines.append("Open threads:")
            lines.extend(f"- {t[:120]}" for t in threads[:3])

        if atlas_ctx and atlas_ctx.get("unverified"):
            lines.append(
                f"Unfinished verification: {atlas_ctx['unverified']} unverified claim(s)"
            )

        if summary and summary[1]:
            first_step = str(summary[1]).splitlines()[0].strip(" -*\t")
            if first_step:
                lines.append(f"Next step: {first_step[:150]}")

        return "\n".join(lines)
    except Exception:
        return None


def main():
    payload = {}
    with contextlib.suppress(Exception):
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    payload = payload if isinstance(payload, dict) else {}

    # Observability DB lifecycle -- fail-open; must not block boot.
    _conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        _conn = atlas_db.connect()
        atlas_db.init(_conn)
        _root = payload.get("cwd") or os.getcwd()
        _pid = atlas_db.register_project(_conn, _root, os.path.basename(_root))
        _sid = payload.get("session_id", "")
        # Empty/missing session_id would create a phantom run keyed by "" and
        # corrupt is_orchestrating/current_run_id lookups -- skip run creation.
        if _sid and atlas_db.current_run_id(_conn, _sid) is None:
            atlas_db.start_run(_conn, _pid, _sid)
    except Exception:  # noqa: S110 -- observability is best-effort; never block boot
        pass
    finally:
        if _conn is not None:
            _conn.close()

    resume = resume_block(payload.get("cwd") or os.getcwd())

    # Todo board: hand unfinished items from previous sessions to this one
    # (origin=carried) and archive what completed. The boot line gives the
    # session its starting ledger; the dashboard Work tab renders the board.
    # Fail-open; ATLAS_TODO=off skips entirely.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import worker_inbox

    # Claude Code sources CLAUDE_ENV_FILE before every Bash command: pin the lead's
    # subchannel name so `atlas_mux spawn` run from Bash registers workers into
    # <main>/lead-<sid6> (the name hook-side Task dispatches already use).
    with contextlib.suppress(
        Exception
    ):  # lead identity pin is best-effort; never block boot
        _env_file = os.environ.get("CLAUDE_ENV_FILE", "").strip()
        _lead_sid = payload.get("session_id", "")
        if (
            _env_file
            and _lead_sid
            and not worker_inbox.is_worker_env()
            and not (os.environ.get("ATLAS_LEAD_NAME") or "").strip()
        ):
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
            import atlas_todo as _at

            _line = f"export ATLAS_LEAD_NAME={shlex.quote(_at.lead_name(_lead_sid))}\n"
            try:
                with open(_env_file, encoding="utf-8") as _f:
                    _have = _line in _f.read().splitlines(True)
            except OSError:
                _have = False
            if not _have:
                with open(_env_file, "a", encoding="utf-8") as _f:
                    _f.write(_line)

    todo_line = None
    with contextlib.suppress(
        Exception
    ):  # todo carry-over is best-effort; never block boot
        # A mux worker's own session must not re-tag the lead's live items as carried.
        if (
            os.environ.get("ATLAS_TODO", "").lower()
            not in (
                "0",
                "off",
                "false",
                "no",
            )
            and not worker_inbox.is_worker_env()
        ):
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
            import atlas_todo

            _todo_root = atlas_todo.find_root(payload.get("cwd") or os.getcwd())
            carry = atlas_todo.carry_over(_todo_root, payload.get("session_id", ""))
            c = carry.get("counts") or {}
            if c.get("needed") or carry.get("carried"):
                todo_line = (
                    f"todo board: {c.get('needed', 0)} needed / {c.get('remaining', 0)} remaining / "
                    f"{c.get('complete', 0)} complete ({carry.get('carried', 0)} carried)"
                )

    # Docs structure conformance: repair the durable docs/ tree so the curator
    # always has somewhere to write. Deliberately auto-FIX rather than report:
    # creating an empty, scaffolder-owned subfolder is mechanical and safe, so
    # spending a gate block (and a model turn) on it is pure friction. The
    # opposite call is made for anything needing judgement -- a file's name, a
    # CHANGELOG entry -- which the completion gate still blocks on.
    #
    # Gated on docs/ ALREADY existing: creating a docs/ tree in a project that
    # never asked for one is intrusive, and first-time onboarding belongs to
    # atlas-setup. A project with no docs/ gets a one-line notice instead
    # (deliberately NOT prefixed 'Setup gap:', which means a missing dependency).
    # Fail-open; ATLAS_DOCS_REPAIR=off skips entirely.
    docs_line = None
    with contextlib.suppress(
        Exception
    ):  # structure repair is best-effort; never block boot
        if os.environ.get("ATLAS_DOCS_REPAIR", "").lower() not in (
            "0",
            "off",
            "false",
            "no",
        ):
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
            from pathlib import Path

            import lint_docs_names
            from docs_drift import find_root as _find_docs_root

            # find_root returns the ancestor holding docs/, or None when the
            # project has no documentation tree at all.
            _docs_root = _find_docs_root(Path(payload.get("cwd") or os.getcwd()))
            if _docs_root is not None:
                created = []
                for rel, _reason in lint_docs_names.structure_gaps(_docs_root):
                    if not rel.endswith("/"):
                        continue  # a missing FILE is the curator's to write
                    (_docs_root / rel.rstrip("/")).mkdir(parents=True, exist_ok=True)
                    created.append(rel)
                if created:
                    docs_line = (
                        f"docs structure repaired: created {', '.join(created[:6])}"
                    )
            else:
                docs_line = (
                    "docs SSOT absent: no docs/ tree here - run the "
                    "`atlas-setup` skill to scaffold it. (Not created "
                    "automatically: onboarding a project that never asked for "
                    "one is intrusive. ATLAS_DOCS_REPAIR=off silences this.)"
                )

    # Run the curator to manage auto-created skill lifecycle (fail-open)
    with contextlib.suppress(Exception):  # curator is best-effort; never block boot
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_curator

        atlas_curator.apply_transitions()

    # Load and inject memory snapshot
    memory_block = None
    with contextlib.suppress(Exception):  # memory is best-effort
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_memory

        snapshot = atlas_memory.load_snapshot()
        parts = []
        if snapshot.get("memory"):
            parts.append(snapshot["memory"])
        if snapshot.get("project"):
            parts.append(snapshot["project"])
        if parts:
            # Hard cap: the snapshot is a hint, not a briefing. An uncapped dump
            # is the single largest block of boot noise. Cut on the record
            # separator rather than mid-sentence - a half-quoted assumption reads
            # as a fact the model half-remembers.
            memory_block = "\n\n".join(parts)
            if len(memory_block) > 700:
                head = memory_block[:700]
                cut = head.rfind("\n\u00a7\n")
                memory_block = head[:cut] if cut > 0 else head.rsplit("\n", 1)[0]

    # Hash already-dirty non-docs paths so the Stop gate's delegation mandate can
    # tell shell-written code from inherited dirt. `git status` + hashing costs 60-90 ms on a big dirty tree,
    # so it runs DETACHED (`session_boot.py --snapshot`), never on the boot path. The gate fails open on a
    # missing snapshot. Best-effort, never blocks boot.
    if os.environ.get("ATLAS_GATE", "").lower() != "off" and payload.get("session_id"):
        with contextlib.suppress(Exception):
            import subprocess

            subprocess.Popen(
                [
                    sys.executable,
                    os.path.abspath(__file__),
                    "--snapshot",
                    payload.get("cwd") or os.getcwd(),
                    payload["session_id"],
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )

    boot_root = payload.get("cwd") or os.getcwd()
    mem_plugin = plugin_enabled("claude-mem", boot_root)
    mem = detect_dep("claude_mem") or has_cmd("claude-mem") or mem_plugin
    ctx = (
        detect_dep("context_mode")
        or has_cmd("context-mode")
        or plugin_enabled("context-mode", boot_root)
    )
    fallow = has_cmd("fallow")

    pony = has_cmd("ponytail") or plugin_enabled("ponytail", boot_root)
    if not pony:
        try:
            pony = os.path.exists(os.path.expanduser("~/.config/ponytail/config.json"))
        except Exception:
            pony = False

    # Boot context is terminal noise on every session start. Keep it to the one
    # fact the model cannot infer (posture + squad) plus setup gaps that are
    # actually actionable; the rest lives in the skill, not in every boot.
    # omp renders its own output style (omp/style.ts); ~/.claude/settings.json outputStyle does not apply there.
    active_style = (
        ATLAS_OUTPUT_STYLE
        if os.environ.get("ATLAS_HARNESS") == "omp"
        else read_output_style()
    )
    lines = [
        "Atlas: orchestrator posture. LOOP: research -> theory -> test (failing check) -> "
        "validate -> implement (atlas:implementer only) -> verify (test stamp or "
        "atlas:verifier) -> docs (atlas:docs-curator); evidence before any done claim. "
        "Route execution to atlas:<role> subagents; invoke atlas-orchestrate for multi-step or whole-codebase work.",
    ]
    lines.extend(status_contract_lines(active_style))
    # claude-mem recall mandate: armed only when the claude-mem plugin (its MCP
    # search server) is enabled; a bare CLI/module cannot be called as a tool.
    recall = (
        recall_mandate()
        if mem_plugin and os.environ.get("ATLAS_MANDATES") != "off"
        else None
    )
    if recall:
        lines.append(recall)
    absent = [
        name
        for name, present in (
            ("claude-mem", mem),
            ("context-mode", ctx),
            ("ponytail", pony),
        )
        if not present
    ]
    if absent:
        lines.append(
            f"Setup gap: {', '.join(absent)} absent - run the `atlas` skill to install."
        )
    if fallow:
        lines.append(
            "fallow: CLI on PATH; fallow_gate audits git commit/push (ATLAS_FALLOW=off disables)."
        )
    else:
        # Only nudge when the cwd looks like JS/TS so Python-only repos stay quiet.
        with contextlib.suppress(Exception):
            cwd = payload.get("cwd") or os.getcwd()
            js_hint = os.path.isfile(os.path.join(cwd, "package.json"))
            if not js_hint:
                for _dp, _dns, fns in os.walk(cwd):
                    _dns[:] = [
                        d
                        for d in _dns
                        if d
                        not in (
                            ".git",
                            "node_modules",
                            "dist",
                            "build",
                            ".next",
                            "__pycache__",
                        )
                    ]
                    if any(
                        fn.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"))
                        for fn in fns
                    ):
                        js_hint = True
                        break
                    break  # top level only; keep boot cheap
            if js_hint:
                lines.append(
                    "fallow: CLI absent on a JS/TS tree - install with `npm install -g fallow` "
                    "(atlas fallow_gate stays inert until then; see fallow-tools.md)."
                )

    with contextlib.suppress(
        Exception
    ):  # structure advisory is best-effort; never block boot
        missing = missing_structure(payload.get("cwd") or os.getcwd())
        if missing:
            lines.append(
                f"atlas: project structure incomplete (missing: {', '.join(missing)}) - run /atlas-setup to scaffold/repair"
            )

    if todo_line:
        lines.append(todo_line)

    if docs_line:
        lines.append(docs_line)

    with contextlib.suppress(Exception):  # serena heal is best-effort; never block boot
        healed = heal_serena_project(payload.get("cwd") or os.getcwd())
        if healed:
            lines.append(healed)

    # Compact tool-routing lines (serena/lean-ctx/claude-mem/...). Full matrix is
    # progressive-disclosure under atlas-orchestrate/references/tool-routing.md.
    with contextlib.suppress(Exception):
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import tool_routing

        for line in tool_routing.boot_lines(root=payload.get("cwd") or os.getcwd()):
            if line and line not in lines:
                lines.append(line)

    if memory_block:
        lines.append(memory_block)
    if resume:
        lines.append(resume)
    with contextlib.suppress(Exception):  # dashboard is best-effort; never block boot
        dash = ensure_dashboard()
        if dash:
            lines.append(dash)
    with contextlib.suppress(Exception):  # colony is best-effort; never block boot
        colony = ensure_colony()
        if colony:
            lines.append(colony)
    sys_msg = "Atlas ready"
    if not (mem and ctx):
        sys_msg += " (run the `atlas` skill to complete setup)"
    if active_style and active_style != ATLAS_OUTPUT_STYLE:
        sys_msg += (
            f" | outputStyle={active_style!r} (docs: plugin style should still win; "
            "boot contract injected as a hedge)"
        )
    # Status contract must never be truncated away: keep it first, then fill.
    body = "\n".join(lines)
    if len(body) > 3500:
        body = body[:3500]
    out = {
        "systemMessage": sys_msg,
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": body,
        },
    }
    sys.stdout.write(json.dumps(out))
    sys.exit(0)


if __name__ == "__main__":
    try:
        if sys.argv[1:2] == ["--snapshot"]:
            write_dirty_snapshot(sys.argv[2], sys.argv[3])
            sys.exit(0)
        main()
    except Exception as exc:
        with contextlib.suppress(Exception):
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
            import atlas_faults

            atlas_faults.record("session_boot", exc)
        sys.exit(0)
