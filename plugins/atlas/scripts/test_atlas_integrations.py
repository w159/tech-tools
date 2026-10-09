#!/usr/bin/env python3
"""Tests for atlas_integrations / atlas_dash_integrations.

Hermetic: fake `herdr`, `herdr-projects`, `tode` shell stubs on a private PATH record argv, HOME
is a tempdir. Nothing real is spawned and nothing is installed.
"""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import http.client
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import atlas_dash_integrations as routes  # noqa: E402
import atlas_integrations as ai  # noqa: E402

PLUGINS_WITH_VIEWER = [
    {
        "plugin_id": "herdr-projects",
        "name": "Projects",
        "version": "0.2.34",
        "enabled": True,
    },
    {
        "plugin_id": "herdr-file-viewer",
        "name": "viewer",
        "version": "1.18.0",
        "enabled": True,
    },
    {
        "plugin_id": "herdr-firstmate-flow",
        "name": "Captain's Deck",
        "version": "0.7.1",
        "enabled": True,
    },
]
PLUGINS_NO_VIEWER = [
    p for p in PLUGINS_WITH_VIEWER if p["plugin_id"] != "herdr-file-viewer"
]

THREAD = {
    "id": "t1",
    "title": "Fix login",
    "status": "open",
    "kind": "worktree",
    "repo": "",  # filled per test
    "branch": "hp/demo/t1-fix-login",
    "worktree_path": "/wt/t1",
    "cwd": "/wt/t1",
    "pane_id": "w1:p2",
    "pr": "",
    "group": "Working",
    "group_token": "working",
    "note": "idle",
}

STUB = r"""#!/bin/sh
D="$(dirname "$0")"
{ for a in "$@"; do printf 'A:%s\n' "$a"; done; printf -- '--\n'; } >> "$D/$(basename "$0").log"
case " $* " in
  *" plugin list --json "*) cat "$D/plugins.json" ;;
  *" plugin pane open "*) echo '{"ok":true}' ;;
  *" thread start "*) cat > "$D/stdin.txt"; echo '{"id":"t9","kind":"worktree"}' ;;
  *" thread list "*) cat "$D/threads.json" ;;
  *" needs-you "*) echo 'projects: 2 need you' ;;
  *" list "*) printf 'demo\tactive\t1 thread\n' ;;
esac
exit 0
"""


def argvs(path: Path) -> list:
    if not path.exists():
        return []
    out, cur = [], []
    for line in path.read_text().splitlines():
        if line == "--":
            out.append(cur)
            cur = []
        else:
            cur.append(line[2:])
    return out


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.home = self.tmp / "home"
        self.home.mkdir()
        for name in ("herdr", "herdr-projects", "tode"):
            p = self.bin / name
            p.write_text(STUB)
            p.chmod(0o755)
        self.set_plugins(PLUGINS_WITH_VIEWER)
        (self.bin / "threads.json").write_text("[]")
        self.env = {
            k: os.environ.get(k)
            for k in ("PATH", "HOME", "HERDR_PROJECTS_ROOT", "FM_FLOW_HOMES")
        }
        os.environ["PATH"] = f"{self.bin}:/usr/bin:/bin"
        os.environ["HOME"] = str(self.home)
        os.environ.pop("HERDR_PROJECTS_ROOT", None)
        os.environ.pop("FM_FLOW_HOMES", None)
        self.addCleanup(self.restore)
        ai._cache.update(at=0.0, val=None)
        ai._last_open.clear()
        self.project = self.tmp / "proj"
        self.project.mkdir()
        (self.project / "src").mkdir()
        (self.project / "src" / "app.py").write_text("x = 1\n")
        (self.project / ".git").mkdir()
        self.known = [str(self.project)]

    def restore(self):
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def set_plugins(self, rows):
        (self.bin / "plugins.json").write_text(
            json.dumps({"id": "1", "result": {"type": "plugin_list", "plugins": rows}})
        )

    def log(self, name):
        return argvs(self.bin / f"{name}.log")

    def opens(self):
        return [a for a in self.log("herdr") if a[:3] == ["plugin", "pane", "open"]]


class TestDetect(Base):
    def tool(self, name):
        return next(t for t in ai.detect(refresh=True)["tools"] if t["name"] == name)

    def test_detects_from_plugin_list_and_binaries(self):
        self.set_plugins(PLUGINS_NO_VIEWER)
        hp = self.tool("herdr-projects")
        self.assertTrue(hp["installed"] and hp["enabled"])
        self.assertEqual(hp["version"], "0.2.34")
        self.assertEqual(
            hp["install_cmd"], "herdr plugin install eliasstravik/herdr-projects"
        )
        self.assertTrue(self.tool("captains-deck")["installed"])
        fv = self.tool("herdr-file-viewer")
        self.assertFalse(fv["installed"])
        self.assertEqual(
            fv["install_cmd"], "herdr plugin install smarzban/herdr-file-viewer"
        )
        self.assertTrue(self.tool("tode")["installed"])
        cm = self.tool("cmux-browser-mcp")
        self.assertFalse(cm["installed"])
        self.assertIn("cmux-browser-mcp", cm["install_cmd"])

    def test_mcp_registration_is_redacted(self):
        cfg = self.home / ".omp" / "agent"
        cfg.mkdir(parents=True)
        (cfg / "mcp.json").write_text(
            json.dumps(
                {
                    "mcpServers": {
                        "cmux-browser": {
                            "command": "node",
                            "args": ["--tok=SECRETARG"],
                            "env": {"API_KEY": "SECRETVAL"},
                        }
                    }
                }
            )
        )
        d = ai.detect(refresh=True)
        self.assertNotIn("SECRETVAL", json.dumps(d))
        self.assertNotIn("SECRETARG", json.dumps(d))
        cm = next(t for t in d["tools"] if t["name"] == "cmux-browser-mcp")
        self.assertTrue(cm["installed"] and cm["enabled"])
        self.assertEqual(d["mcp"][0]["env"], {"API_KEY": "<redacted>"})

    def test_plugins_json_fallback_when_herdr_missing(self):
        (self.bin / "herdr").unlink()
        cfgdir = self.home / ".config" / "herdr"
        cfgdir.mkdir(parents=True)
        (cfgdir / "plugins.json").write_text(json.dumps(PLUGINS_NO_VIEWER))
        self.assertTrue(self.tool("herdr-projects")["installed"])

    def test_detect_is_cached(self):
        ai.detect(refresh=True)
        n = len(self.log("herdr"))
        ai.detect()
        self.assertEqual(len(self.log("herdr")), n)


class TestHp(Base):
    def test_unconfigured_root(self):
        os.environ["HERDR_PROJECTS_ROOT"] = str(self.tmp / "absent")
        r = ai.hp_projects()
        self.assertTrue(r["installed"])
        self.assertFalse(r["configured"])
        self.assertEqual(r["projects"], [])
        self.assertIn("configure --dry-run", r["hint"])
        self.assertEqual(self.log("herdr-projects"), [])

    def test_lists_projects_threads_channels_and_needs_you(self):
        root = self.tmp / "hproot"
        (root / "demo").mkdir(parents=True)
        (root / "demo" / "PROJECT.md").write_text(
            '+++\nname = "Demo"\ngoal = "ship"\nrepos = ["/r"]\n+++\n'
        )
        os.environ["HERDR_PROJECTS_ROOT"] = str(root)
        t = dict(THREAD, repo=str(self.project))
        (self.bin / "threads.json").write_text(json.dumps([t]))
        r = ai.hp_projects()
        self.assertTrue(r["configured"])
        self.assertEqual(r["needs_you"], 2)
        p = r["projects"][0]
        self.assertEqual(
            (p["slug"], p["name"], p["goal"], p["repos"]),
            ("demo", "Demo", "ship", ["/r"]),
        )
        th = p["threads"][0]
        self.assertEqual(th["branch"], "hp/demo/t1-fix-login")
        self.assertEqual(th["channel"], "proj@hp/demo/t1-fix-login")
        self.assertEqual(th["pane_id"], "w1:p2")
        self.assertEqual(
            self.log("herdr-projects")[:2],
            [
                ["--root", str(root), "list"],
                ["--root", str(root), "thread", "list", "demo", "--json"],
            ],
        )
        self.assertFalse(
            any("ticker" in a for c in self.log("herdr-projects") for a in c)
        )

    def start(self, **kw):
        root = self.tmp / "hproot"
        (root / "demo").mkdir(parents=True, exist_ok=True)
        os.environ["HERDR_PROJECTS_ROOT"] = str(root)
        args = dict(
            project="demo",
            title="T",
            repo=str(self.project),
            kind="worktree",
            task="do it",
        )
        args.update(kw)
        return ai.hp_thread_start(**args), root

    def test_thread_start_exact_argv_and_stdin(self):
        task = "line1\n$(touch /tmp/atlas-x); rm -rf /\n"
        r, root = self.start(title="a $(touch /tmp/atlas-x); rm", task=task)
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["thread"]["id"], "t9")
        self.assertEqual(
            self.log("herdr-projects")[-1],
            [
                "--root",
                str(root),
                "thread",
                "start",
                "demo",
                "--title",
                "a $(touch /tmp/atlas-x); rm",
                "--repo",
                str(self.project),
                "--kind",
                "worktree",
                "--task-file",
                "-",
            ],
        )
        self.assertEqual((self.bin / "stdin.txt").read_text(), task)
        self.assertFalse(os.path.exists("/tmp/atlas-x"))

    def test_thread_start_validation_spawns_nothing(self):
        for kw, code in (
            ({"repo": str(self.tmp / "nope")}, "bad_repo"),
            ({"repo": "rel/dir"}, "bad_repo"),
            ({"kind": "yolo"}, "bad_kind"),
            ({"project": "../etc"}, "bad_project"),
            ({"project": "ghost"}, "unknown_project"),
            ({"title": "x\ny"}, "bad_title"),
            ({"task": " "}, "bad_task"),
            ({"repo": None}, "repo_required"),
        ):
            r, _ = self.start(**kw)
            self.assertEqual(r["error"], code, kw)
        self.assertEqual(self.log("herdr-projects"), [])

    def test_tab_kind_needs_no_repo(self):
        r, _ = self.start(repo=None, kind="tab")
        self.assertTrue(r["ok"])
        self.assertNotIn("--repo", self.log("herdr-projects")[-1])


class TestOpenFile(Base):
    def call(self, path, **kw):
        return ai.open_file(path, kw.pop("root", str(self.project)), self.known, **kw)

    def test_exact_argv_with_line_and_range(self):
        r = self.call(str(self.project / "src" / "app.py"), line=42)
        self.assertTrue(r["ok"], r)
        self.assertEqual(
            self.opens()[-1],
            [
                "plugin",
                "pane",
                "open",
                "--plugin",
                "herdr-file-viewer",
                "--entrypoint",
                "file-viewer",
                "--placement",
                "split",
                "--direction",
                "right",
                "--focus",
                "--env",
                f"HERDR_FILE_VIEWER_ROOT={self.project}",
                "--env",
                "HERDR_FILE_VIEWER_OPEN=src/app.py:42",
            ],
        )
        self.assertNotIn("--cwd", self.opens()[-1])
        ai._last_open.clear()
        self.call("src/app.py", rng=[3, 9])
        self.assertEqual(self.opens()[-1][-1], "HERDR_FILE_VIEWER_OPEN=src/app.py:3-9")

    def test_out_of_root_and_symlink_escape_spawn_nothing(self):
        outside = self.tmp / "secret.txt"
        outside.write_text("s")
        os.symlink(outside, self.project / "link.txt")
        os.symlink(self.tmp, self.project / "dirlink")
        for p in (
            str(outside),
            "../secret.txt",
            "link.txt",
            "dirlink/secret.txt",
            "/etc/hosts",
        ):
            r = self.call(p)
            self.assertEqual(r["http"], 403, p)
        self.assertEqual(self.opens(), [])

    def test_unknown_root_and_bad_input(self):
        other = self.tmp / "other"
        other.mkdir()
        (other / "f").write_text("")
        self.assertEqual(self.call("f", root=str(other))["http"], 403)
        self.assertEqual(self.call("src/app.py", root="relative")["http"], 400)
        self.assertEqual(self.call("src/app.py", line=0)["http"], 400)
        self.assertEqual(self.call("src/app.py", line=1, rng=[1, 2])["http"], 400)
        self.assertEqual(self.call("src/app.py", rng=[5, 2])["http"], 400)
        self.assertEqual(self.call("src/app.py", placement="overlay")["http"], 400)
        self.assertEqual(self.opens(), [])

    def test_plugin_absent_is_424_with_install_cmd(self):
        self.set_plugins(PLUGINS_NO_VIEWER)
        r = self.call("src/app.py")
        self.assertEqual((r["http"], r["error"]), (424, "plugin_not_installed"))
        self.assertEqual(
            r["install_cmd"], "herdr plugin install smarzban/herdr-file-viewer"
        )
        self.assertEqual(self.opens(), [])

    def test_dedupe_second_viewer_same_root(self):
        self.assertTrue(self.call("src/app.py")["ok"])
        r = self.call("src/app.py", line=3)
        self.assertEqual((r["http"], r["error"]), (429, "duplicate_viewer"))
        self.assertEqual(len(self.opens()), 1)

    def test_injection_names_stay_data(self):
        name = "$(touch pwned-y); rm.txt"
        (self.project / name).write_text("")
        self.assertTrue(self.call(name)["ok"])
        self.assertEqual(self.opens()[-1][-1], f"HERDR_FILE_VIEWER_OPEN={name}")
        self.assertFalse(
            os.path.exists("pwned-y") or (self.project / "pwned-y").exists()
        )
        self.assertEqual(self.call("src/app.py; rm -rf x")["http"], 404)


class TestOpenEditor(Base):
    def wait_log(self):
        for _ in range(50):
            if self.log("tode"):
                break
            time.sleep(0.05)
        return self.log("tode")

    def test_goto_and_folder_argv(self):
        f = str(self.project / "src" / "app.py")
        self.assertTrue(ai.open_editor(f, self.known, line=7)["ok"])
        self.assertEqual(self.wait_log()[-1], ["--goto", f"{f}:7:1"])
        self.assertTrue(ai.open_editor(str(self.project), self.known)["ok"])
        for _ in range(50):
            if len(self.log("tode")) == 2:
                break
            time.sleep(0.05)
        self.assertEqual(self.log("tode")[-1], [str(self.project)])

    def test_out_of_root_and_symlink_and_absent(self):
        os.symlink(self.tmp, self.project / "esc")
        self.assertEqual(ai.open_editor("/etc/hosts", self.known)["http"], 403)
        self.assertEqual(
            ai.open_editor(str(self.project / "esc"), self.known)["http"], 403
        )
        self.assertEqual(ai.open_editor("rel", self.known)["http"], 400)
        (self.bin / "tode").unlink()
        r = ai.open_editor(str(self.project), self.known)
        self.assertEqual((r["http"], r["error"]), (424, "tool_not_installed"))
        self.assertEqual(self.log("tode"), [])

    def test_injection_path_is_one_argv_element(self):
        name = self.project / "$(touch pwned-z); rm"
        name.write_text("")
        self.assertTrue(ai.open_editor(str(name), self.known)["ok"])
        self.assertEqual(self.wait_log()[-1], ["--goto", f"{name}:1:1"])
        self.assertFalse(
            os.path.exists("pwned-z") or (self.project / "pwned-z").exists()
        )


class TestDeck(Base):
    def test_firstmate_absent(self):
        d = ai.deck_status()
        self.assertTrue(d["installed"])
        self.assertEqual(
            (d["available"], d["reason"]), (False, "Firstmate not installed")
        )

    def test_homes_present_without_plugin_root_probe(self):
        (self.home / "firstmate").mkdir()
        d = ai.deck_status()
        self.assertTrue(d["available"])
        self.assertEqual(d["homes"], [str(self.home / "firstmate")])


class TestRoutes(Base):
    def ctx(self, body=None):
        class C:
            query = {}
            groups = ()

            def json(s):
                return body or {}

            def db(s):
                raise RuntimeError("no db")

        return C()

    def test_route_table(self):
        got = {(m, p) for m, p, _ in routes.ROUTES}
        for want in (
            ("GET", r"^/api/v2/integrations$"),
            ("GET", r"^/api/v2/projects/hp$"),
            ("GET", r"^/api/v2/deck$"),
            ("POST", r"^/api/v2/projects/hp/threads$"),
            ("POST", r"^/api/v2/open-file$"),
            ("POST", r"^/api/v2/open-editor$"),
        ):
            self.assertIn(want, got)

    def test_status_codes_flow_through(self):
        orig = routes.known_roots
        routes.known_roots = lambda ctx: self.known
        self.addCleanup(setattr, routes, "known_roots", orig)
        s, b = routes._open_file(
            self.ctx({"path": "/etc/hosts", "root": str(self.project)})
        )
        self.assertEqual((s, b["error"]), (403, "path_outside_root"))
        self.assertNotIn("http", b)
        s, b = routes._open_editor(self.ctx({"path": str(self.project)}))
        self.assertEqual(s, 200)

    def test_all_posts_need_the_dashboard_token(self):
        spec = importlib.util.spec_from_file_location(
            "atlas_dashboard", SCRIPTS / "atlas_dashboard.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertIn(
            "atlas_dash_integrations",
            [m for m in ("atlas_dash_integrations",) if m not in mod.V2_MOUNT_ERRORS],
        )
        httpd = mod._Server((mod.LOOPBACK, 0), mod.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        port = httpd.server_address[1]
        for path in (
            "/api/v2/projects/hp/threads",
            "/api/v2/open-file",
            "/api/v2/open-editor",
        ):
            conn = http.client.HTTPConnection(mod.LOOPBACK, port, timeout=10)
            conn.request(
                "POST",
                path,
                body=b"{}",
                headers={
                    "Host": f"{mod.LOOPBACK}:{port}",
                    "Content-Type": "application/json",
                },
            )
            resp = conn.getresponse()
            resp.read()
            conn.close()
            self.assertEqual(resp.status, 401, path)
        self.assertEqual(self.opens(), [])
        self.assertEqual(self.log("tode"), [])


class TestHostileRoots(Base):
    """A populated DB with '/', $HOME, /tmp, /etc rows must not authorise anything."""

    def ctx(self, body, roots):
        import sqlite3

        class C:
            query = {}
            groups = ()

            def json(s):
                return body

            def db(s):
                c = sqlite3.connect(":memory:")
                c.execute("CREATE TABLE projects (root_path TEXT)")
                c.executemany("INSERT INTO projects VALUES (?)", [(r,) for r in roots])
                return c

        return C()

    def setUp(self):
        super().setUp()
        orig = routes.atlas_herdr.agents
        routes.atlas_herdr.agents = lambda *a, **k: {"agents": []}
        self.addCleanup(setattr, routes.atlas_herdr, "agents", orig)
        self.hostile = [
            "/",
            str(self.home),
            "/tmp",
            "/etc",
            "/var",
            "/private",
            "/Users",
        ]

    def no_spawns(self):
        time.sleep(0.2)
        self.assertEqual(self.log("tode"), [])
        self.assertEqual(self.opens(), [])

    def test_hostile_roots_403_and_no_spawn(self):
        for root, path in (
            ("/etc", "/etc/hosts"),
            ("/", "/etc/hosts"),
            ("/tmp", "/tmp"),
            (str(self.home), str(self.home)),
        ):
            s, b = routes._open_file(
                self.ctx({"root": root, "path": path}, self.hostile)
            )
            self.assertEqual(s, 403, (root, b))
        for path in ("/etc/hosts", str(self.home), "/tmp", "/"):
            s, b = routes._open_editor(self.ctx({"path": path}, self.hostile))
            self.assertEqual(s, 403, (path, b))
        self.no_spawns()

    def test_legit_project_still_works_alongside_hostile_rows(self):
        rows = self.hostile + [str(self.project)]
        f = str(self.project / "src" / "app.py")
        s, b = routes._open_file(self.ctx({"root": str(self.project), "path": f}, rows))
        self.assertEqual(s, 200, b)
        s, b = routes._open_editor(self.ctx({"path": f}, rows))
        self.assertEqual(s, 200, b)
        s, _ = routes._open_editor(self.ctx({"path": "/etc/hosts"}, rows))
        self.assertEqual(s, 403)

    def test_nonexistent_row_symlink_escape_and_prefix_sibling(self):
        gone = str(self.tmp / "gone")
        sib = self.tmp / "proj2"
        sib.mkdir()
        (sib / "f").write_text("")
        os.symlink("/etc", self.project / "etc_link")
        for rows, path in (
            ([gone], gone),  # row says so, directory does not exist
            ([str(self.project)], str(sib / "f")),  # proj2 is not inside proj
            (
                [str(self.project)],
                str(self.project / "etc_link" / "hosts"),
            ),  # symlink escape
        ):
            s, b = routes._open_editor(self.ctx({"path": path}, rows))
            self.assertIn(s, (403, 404), (path, b))
        link_root = self.tmp / "linkroot"
        os.symlink("/etc", link_root)  # a symlinked "project" resolving into /etc
        s, _ = routes._open_file(
            self.ctx({"root": str(link_root), "path": "hosts"}, [str(link_root)])
        )
        self.assertEqual(s, 403)
        self.no_spawns()


class TestCredentialPaths(TestHostileRoots):
    """Verifier reproduction: credential / dot-config / unmarked roots and targets are 403, zero spawns."""

    def setUp(self):
        super().setUp()
        h = self.home
        dirs = (
            ".agents",
            ".codex",
            ".claude",
            "MEGA",
            "Downloads",
            ".config/cmux",
            ".ssh",
        )
        for rel in (
            ".agents/x",
            ".codex/auth.json",
            ".claude/settings.json",
            "MEGA/x",
            "Downloads/x",
            ".config/cmux/x",
            ".ssh/id_ed25519",
        ):
            p = h / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("s")
        for d in dirs:
            if (
                d != "MEGA"
            ):  # even with a marker, dot-dirs and bare home dirs are refused
                (h / d / ".git").mkdir(exist_ok=True)
        (h / "Downloads" / ".git").mkdir(exist_ok=True)
        self.rows = [str(h / d) for d in dirs]
        self.rows += [
            str(h / ".codex" / "auth.json"),
            str(h / ".claude" / "settings.json"),
        ]
        self.targets = [
            h / ".agents",
            h / ".codex" / "auth.json",
            h / ".claude" / "settings.json",
            h / "MEGA",
            h / "Downloads",
            h / ".config" / "cmux",
            h / ".ssh" / "id_ed25519",
        ]

    def test_credential_roots_and_targets_403_no_spawn(self):
        for t in self.targets:
            s, b = routes._open_editor(self.ctx({"path": str(t)}, self.rows))
            self.assertEqual(s, 403, (t, b))
            root = t if t.is_dir() else t.parent
            s, b = routes._open_file(
                self.ctx({"root": str(root), "path": str(t)}, self.rows)
            )
            self.assertEqual(s, 403, (t, b))
        self.no_spawns()

    def test_dot_and_secret_targets_inside_valid_project(self):
        p = self.project
        for rel in (
            ".env",
            ".env.local",
            "k.pem",
            "id_rsa",
            "credentials.json",
            ".npmrc",
            "auth.json",
            ".git/config",
            ".ssh/id_ed25519",
            ".aws/credentials",
            ".claude/settings.json",
        ):
            f = p / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text("s")
            s, b = routes._open_editor(self.ctx({"path": str(f)}, [str(p)]))
            self.assertEqual((s, b["error"]), (403, "forbidden_path"), rel)
            s, b = routes._open_file(self.ctx({"root": str(p), "path": rel}, [str(p)]))
            self.assertEqual((s, b["error"]), (403, "forbidden_path"), rel)
        # a symlink inside the project pointing at a credential file resolves and is refused
        os.symlink(self.home / ".codex" / "auth.json", p / "link.txt")
        s, _ = routes._open_editor(self.ctx({"path": str(p / "link.txt")}, [str(p)]))
        self.assertEqual(s, 403)
        self.no_spawns()

    def test_unmarked_root_refused_and_marked_allowed_with_dot_allowlist(self):
        bare = self.tmp / "bare"
        bare.mkdir()
        (bare / "f").write_text("")
        s, _ = routes._open_editor(self.ctx({"path": str(bare / "f")}, [str(bare)]))
        self.assertEqual(s, 403)
        self.no_spawns()
        ci = self.project / ".github" / "workflows" / "ci.yml"
        ci.parent.mkdir(parents=True)
        ci.write_text("on: push\n")
        (self.project / "README.md").write_text("hi")
        rows = [str(self.project)]
        for f in (ci, self.project / "README.md"):
            s, b = routes._open_editor(self.ctx({"path": str(f)}, rows))
            self.assertEqual(s, 200, (f, b))
        s, b = routes._open_file(
            self.ctx(
                {"root": str(self.project), "path": ".github/workflows/ci.yml"}, rows
            )
        )
        self.assertEqual(s, 200, b)
        time.sleep(0.3)
        for argv in self.log("tode"):
            for d in (".codex", ".claude", ".ssh", ".agents", ".config"):
                self.assertFalse(any(str(self.home / d) in a for a in argv), argv)


if __name__ == "__main__":
    unittest.main()
