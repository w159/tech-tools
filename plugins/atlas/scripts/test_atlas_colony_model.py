"""atlas_colony_model: snapshot shape, pane_state markers, attach_argv, capture. tmux is a PATH shim."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_colony_model as model  # noqa: E402

PANES = (
    "%1\tatlas-t1\tatlas-t1\t111\t0\t0\texplorer-aa\texplorer\tnode\n"
    "%2\tatlas-t1\tatlas-t1\t222\t0\t0\timplementer-bb\timplementer\tomp\n"
    "%3\tatlas-t1\tatlas-t1\t333\t1\t2\tverifier-cc\tverifier\tzsh\n"
)
SCREENS = {
    "%1": "Do you want to proceed?\n❯ 1. Yes\n",
    "%2": "⣾ working ▏ 0:12 · 3 tools\n",
}
FAKE_TMUX = r"""#!/bin/bash
echo "$*" >> "$FAKE_LOG"
case "$1" in
  list-panes) printf '%b' "$FAKE_PANES" ;;
  list-sessions) echo -e "atlas-t1\t1\t0\natlas-view-x\t1\t1\nother\t1\t0" ;;
  capture-pane) t="${@: -1}"; v="FAKE_SCREEN_${t#%}"; printf '%s' "${!v}" ;;
  display-message) printf 'atlas-t1\t@4\n' ;;
  -V) echo "tmux 3.5a" ;;
  *) ;;
esac
"""


class ModelTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        run = Path(self.root, ".atlas", ".run")
        (run / "teams").mkdir(parents=True)
        (run / "logs").mkdir()
        (run / "teams" / "t1.json").write_text(
            json.dumps(
                {
                    "team_id": "t1",
                    "class": "audit",
                    "effort": "low",
                    "task": "map it\nsecond line",
                    "channel": "proj@main/lead-x",
                    "transport": "tmux",
                    "created": 1000.0,
                    "members": [
                        {"name": "explorer-aa", "role": "explorer"},
                        {"name": "implementer-bb", "role": "implementer"},
                        {"name": "verifier-cc", "role": "verifier"},
                    ],
                }
            )
        )
        (run / "channels.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "channels": {
                        "proj@main/lead-x": {
                            "name": "proj@main/lead-x",
                            "kind": "lead",
                            "lead": "lead-x",
                            "members": [
                                {"name": "explorer-aa", "role": "explorer"},
                                {"name": "implementer-bb", "role": "implementer"},
                                {
                                    "name": "verifier-cc",
                                    "role": "verifier",
                                    "exit_code": 0,
                                },
                            ],
                        }
                    },
                }
            )
        )
        for n, first in (
            ("explorer-aa", "$ claude -p --model sonnet"),
            ("implementer-bb", "$ omp --mode json"),
            ("verifier-cc", "$ codex exec --json -m gpt-5"),
        ):
            (run / "logs" / f"{n}.log").write_text(first + "\nrest\n")
        (run / "board").mkdir()
        (run / "board" / "explorer-aa.jsonl").write_text(
            json.dumps(
                {
                    "ts": 5.0,
                    "seq": 1,
                    "owner": "explorer-aa",
                    "to": "lead-x",
                    "text": "found it",
                    "kind": "blocked",
                    "channel": "proj@main/lead-x",
                }
            )
            + "\n"
        )
        shim = Path(self.root, "bin")
        shim.mkdir()
        t = shim / "tmux"
        t.write_text(FAKE_TMUX)
        t.chmod(t.stat().st_mode | stat.S_IXUSR)
        self.log = Path(self.root, "tmux.log")
        env = {
            "PATH": f"{shim}:{os.environ['PATH']}",
            "FAKE_LOG": str(self.log),
            "FAKE_PANES": PANES,
            "FAKE_SCREEN_1": SCREENS["%1"],
            "FAKE_SCREEN_2": SCREENS["%2"],
            "ATLAS_HOME": self.root,
        }
        p = mock.patch.dict(os.environ, env)
        p.start()
        self.addCleanup(p.stop)

    def test_all_projects_includes_other_projects_teams(self):
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        o = os.path.realpath(other.name)
        (Path(o, ".atlas", ".run", "teams")).mkdir(parents=True)
        Path(o, ".atlas", ".run", "teams", "t2.json").write_text(
            json.dumps({"team_id": "t2", "class": "fix", "effort": "low", "task": "other", "created": 2.0, "members": [{"name": "worker-zz", "role": "implementer"}]})
        )
        projects = [{"root": self.root, "name": "a", "channels": 1}, {"root": o, "name": "b", "channels": 0}]
        with mock.patch.object(model, "_projects", return_value=projects):
            s = model.snapshot(self.root, True)
        by_id = {c["id"]: c for c in s["colonies"]}
        self.assertEqual(by_id["t2"]["project"], o)
        self.assertEqual(by_id["t1"]["project"], self.root)
        self.assertIn("worker-zz", {x["name"] for x in s["seats"] if x["colony"] == "t2"})
        with mock.patch.object(model, "_projects", return_value=projects[:1]):
            self.assertNotIn("t2", {c["id"] for c in model.snapshot(self.root)["colonies"]})

    def test_snapshot_shape_and_seats(self):
        s = model.snapshot(self.root)
        self.assertEqual(
            list(s),
            [
                "ok",
                "host",
                "clock",
                "project",
                "colonies",
                "seats",
                "feed",
                "needs",
                "specs",
                "projects",
                "terminals",
                "system",
            ],
        )
        col = s["colonies"][0]
        self.assertEqual(
            (col["id"], col["label"], col["session"], col["transport"], col["task"]),
            ("t1", "t1 · audit/low", "atlas-t1", "tmux", "map it"),
        )
        self.assertEqual(
            [p["id"] for p in col["pods"]], ["explorer", "implementer", "verifier"]
        )
        seat = {x["name"]: x for x in s["seats"]}
        self.assertEqual(
            set(seat["explorer-aa"]),
            {
                "name",
                "colony",
                "project",
                "pod",
                "role",
                "runtime",
                "model",
                "state",
                "exit_code",
                "target",
                "pid",
                "queue",
                "work",
                "now",
                "log_path",
                "last_active",
                "lead",
            },
        )
        self.assertEqual(
            (
                seat["explorer-aa"]["runtime"],
                seat["explorer-aa"]["model"],
                seat["explorer-aa"]["state"],
            ),
            ("claude", "sonnet", "blocked"),
        )
        self.assertEqual(
            (
                seat["implementer-bb"]["runtime"],
                seat["implementer-bb"]["state"],
                seat["implementer-bb"]["target"],
            ),
            ("omp", "working", "%2"),
        )
        self.assertEqual(
            (
                seat["verifier-cc"]["runtime"],
                seat["verifier-cc"]["state"],
                seat["verifier-cc"]["exit_code"],
            ),
            ("codex", "finished", 0),
        )
        self.assertEqual(seat["explorer-aa"]["now"], "found it")
        self.assertEqual([n["kind"] for n in s["needs"]], ["blocked"])
        self.assertEqual(
            s["terminals"],
            [{"session": "atlas-t1", "windows": 1, "attached": 0, "panes": 3}],
        )
        self.assertTrue(s["system"]["tmux"]["ok"])
        self.assertIn("audit", {x["name"] for x in s["specs"] if x["kind"] == "team"})

    def test_pane_state_markers(self):
        cases = [
            ("claude", "✻ Thinking… (esc to interrupt)\n> ", "working"),
            ("claude", "done\n❯ ", "idle"),
            ("claude", "Do you want to run this?\n❯ 1. Yes", "blocked"),
            ("claude", "Proceed (y/n)", "blocked"),
            ("codex", "• Working (12s • esc to interrupt)\n› ", "working"),
            ("codex", "ready\n› ask", "idle"),
            ("omp", "Working…\n❯", "working"),
            ("omp", "ok\n❯ x", "idle"),
            ("omp", "\x1b[32m⣷ working\x1b[0m", "working"),
            ("claude", " ✔ DONE · 0:10 · 3 tools", "idle"),
            ("omp", " ✖ FAILED · 0:10", "idle"),
            ("claude", "random output", "unknown"),
            ("claude", "", "unknown"),
        ]
        for rt, text, want in cases:
            self.assertEqual(model.pane_state(text, rt), want, (rt, text))

    def test_capture_and_missing_tmux(self):
        self.assertIn("working", model.capture("%2", 50, ansi=False))
        self.assertIn("capture-pane -p -J -S -50 -t %2", self.log.read_text())
        model.capture("%2", ansi=True)
        self.assertIn("capture-pane -p -J -e -S -200 -t %2", self.log.read_text())
        with mock.patch.dict(os.environ, {"PATH": "/nonexistent"}):
            self.assertEqual(model.capture("%2"), "")
            self.assertEqual(model.snapshot(self.root)["terminals"], [])

    def test_attach_argv(self):
        setup, argv = model.attach_argv("%2", "ab12")
        self.assertEqual(
            setup[0],
            ["tmux", "new-session", "-d", "-t", "atlas-t1", "-s", "atlas-view-ab12"],
        )
        self.assertIn(["tmux", "select-window", "-t", "atlas-view-ab12:@4"], setup)
        self.assertIn(["tmux", "select-pane", "-t", "%2"], setup)
        self.assertEqual(argv[:4], ["tmux", "attach-session", "-t", "atlas-view-ab12"])
        self.assertEqual(argv[4:], [";", "set-option", "-t", "atlas-view-ab12", "destroy-unattached", "on"])
        self.assertFalse(any("destroy-unattached" in c for c in setup))
        self.assertTrue(any(c[1] == "if-shell" and "resize-pane -Z -t %2" in c[-1] for c in setup))
        setup, _ = model.attach_argv("atlas-t1:worker", "cd34")
        self.assertIn(["tmux", "select-window", "-t", "atlas-view-cd34:worker"], setup)
        model.cleanup_view("ab12")
        self.assertIn("kill-session -t atlas-view-ab12", self.log.read_text())


@unittest.skipUnless(shutil.which("tmux"), "tmux missing")
class RealTmuxViewTest(unittest.TestCase):
    def test_view_survives_setup_then_cleanup(self):
        import subprocess
        import time

        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            env = {**os.environ, "TMUX_TMPDIR": tmp}
            env.pop("TMUX", None)
            with mock.patch.dict(os.environ, env, clear=True):
                tm = lambda *a: subprocess.run(["tmux", *a], capture_output=True, text=True, env=env)  # noqa: E731
                made = tm("new-session", "-d", "-s", "atlas-rt", "-x", "80", "-y", "24", "-P", "-F", "#{pane_id}", "cat")
                pane = made.stdout.strip()
                self.assertTrue(pane.startswith("%"), made.stderr)
                tm("split-window", "-d", "-t", "atlas-rt", "cat")
                setup, _ = model.attach_argv(pane, "rt1")
                for c in setup:
                    r = subprocess.run(c, capture_output=True, text=True, env=env)
                    self.assertEqual(r.returncode, 0, (c, r.stderr))
                time.sleep(0.5)
                self.assertEqual(tm("has-session", "-t", "atlas-view-rt1").returncode, 0)
                self.assertEqual(tm("display-message", "-p", "-t", "atlas-view-rt1", "#{window_zoomed_flag}").stdout.strip(), "1")
                model.cleanup_view("rt1")
                self.assertNotEqual(tm("has-session", "-t", "atlas-view-rt1").returncode, 0)
                tm("kill-server")  # inside the with: a cleanup would run after TMPDIR is gone and leak the server


if __name__ == "__main__":
    unittest.main()
