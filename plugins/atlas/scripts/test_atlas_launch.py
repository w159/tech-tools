"""Tests for atlas_launch (argv, env hygiene), atlas_todo.sweep/restore/carry_over and the todos `start` op."""

import os
import shlex
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_dash_work as work  # noqa: E402
import atlas_herdr  # noqa: E402
import atlas_launch  # noqa: E402
import atlas_mux  # noqa: E402
import atlas_todo  # noqa: E402
from test_atlas_herdr import FakeHerdr, PaneHandler  # noqa: E402


def ok(out=""):
    return SimpleNamespace(returncode=0, stdout=out, stderr="")


class LaunchArgvTest(unittest.TestCase):
    """The explicit tmux fallback (ATLAS_COLONY_TRANSPORT=tmux): the pre-herdr behaviour, unchanged."""

    def setUp(self):
        self.root = tempfile.mkdtemp()

    def run_launch(self, name="a b/../c", cwd=None, **kw):
        calls = []

        def fake_tmux(*args):
            calls.append(args)
            if args[0] == "has-session":
                return SimpleNamespace(returncode=1, stdout="", stderr="")
            return ok()

        env = {
            "CMUX_SOCKET": "x",
            "TERM_PROGRAM": "cmux",
            "PATH": "/usr/bin:/Users/x/.cmuxterm/cmux-cli-shims/1",
            "ATLAS_COLONY_TRANSPORT": "tmux",
        }
        with (
            mock.patch.object(atlas_mux, "_tmux", fake_tmux),
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch("shutil.which", return_value="/usr/bin/tmux"),
            mock.patch.object(atlas_launch, "_binary", return_value="/b/omp"),
        ):
            res = atlas_launch.launch(self.root, name, "do it", cwd=cwd, **kw)
        return res, calls

    def test_interactive_is_detached_and_quoted(self):
        cwd = os.path.join(self.root, "dir with 'quote")
        os.makedirs(cwd)
        res, calls = self.run_launch(cwd=cwd)
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["window"], "a_b____c")
        self.assertEqual(res["attach"], f"tmux attach -t {res['target']}")
        verbs = [c[0] for c in calls]
        self.assertEqual(
            verbs,
            ["has-session", "new-session", "list-windows", "new-window", "set-option"],
        )
        self.assertIn("-d", calls[1])
        self.assertIn("-d", calls[3])
        self.assertEqual(calls[4][-2:], ("remain-on-exit", "on"))
        pane = calls[3][-1]
        words = shlex.split(pane)
        self.assertEqual(words[:2], ["exec", "env"])
        self.assertEqual(words[-3:], ["--cwd", cwd, "@" + res["prompt_file"]])
        self.assertTrue(any(w.startswith("ATLAS_WORKER_NAME=") for w in words))
        self.assertTrue(any(w.startswith("ATLAS_PROJECT_ROOT=") for w in words))
        self.assertFalse(any("CMUX" in w or "cmux" in w for w in words))
        for banned in ("attach", "select-window", "switch-client"):
            self.assertNotIn(banned, verbs)

    def test_worker_env_carries_channel_and_its_registered_lead(self):
        root = tempfile.mkdtemp()
        atlas_todo.open_lead_channel(root, "lead-abc123", ["W"])
        chan = atlas_todo.channels_of(root, "W")[0]
        seen = {}

        def spy(env):
            seen.update(env)
            raise SystemExit

        with (
            mock.patch.dict(os.environ, clear=False),
            mock.patch.object(atlas_launch, "_child_env", spy),
        ):
            os.environ["ATLAS_CHANNEL"] = chan
            os.environ.pop("ATLAS_LEAD_NAME", None)
            with self.assertRaises(SystemExit):
                atlas_launch.launch(root, "W2", "p")
        self.assertEqual("lead-abc123", seen["ATLAS_LEAD_NAME"])
        self.assertEqual(chan, seen["ATLAS_CHANNEL"])
        self.assertIn(
            chan, atlas_todo.channels_of(root, "W2")
        )  # lead side registered it

    def test_launch_without_a_channel_never_joins_the_newest_lead(self):
        root = tempfile.mkdtemp()
        newest = atlas_todo.open_lead_channel(root, "lead-abc123", ["W"])["name"]
        seen = {}

        def spy(env):
            seen.update(env)
            raise SystemExit

        with (
            mock.patch.dict(os.environ, clear=False),
            mock.patch.object(atlas_launch, "_child_env", spy),
        ):
            os.environ.pop("ATLAS_CHANNEL", None)
            os.environ.pop("ATLAS_LEAD_NAME", None)
            with self.assertRaises(SystemExit):
                atlas_launch.launch(root, "fix-1", "p")
        self.assertNotEqual(newest, seen["ATLAS_CHANNEL"])
        self.assertEqual("lead", seen["ATLAS_LEAD_NAME"])
        self.assertNotIn(newest, atlas_todo.channels_of(root, "fix-1"))

    def test_names_are_unique_within_a_taken_set(self):
        self.assertEqual(atlas_launch._unique({"x", "x-2"}, "x"), "x-3")
        self.assertEqual(atlas_launch._unique(set(), "x"), "x")

    def test_headless_goes_through_mux_spawn(self):
        calls = []
        out = SimpleNamespace(returncode=0, stdout='{"ok": true}\n', stderr="")

        def fake_run(argv, **kw):
            calls.append((argv, kw))
            if argv[0] == "git":  # branch lookup for the channel name
                return SimpleNamespace(returncode=1, stdout="", stderr="")
            return out

        with (
            mock.patch.dict(os.environ, {"ATLAS_COLONY_TRANSPORT": "tmux"}),
            mock.patch.object(
                atlas_mux,
                "_tmux",
                lambda *a: (
                    ok()
                    if a[0] != "has-session"
                    else SimpleNamespace(returncode=1, stdout="", stderr="")
                ),
            ),
            mock.patch("shutil.which", return_value="/usr/bin/tmux"),
            mock.patch("subprocess.run", fake_run),
        ):
            res = atlas_launch.launch(
                self.root,
                "fix-1",
                "p",
                interactive=False,
                agent="implementer",
                run="selffix",
                cwd=self.root,
            )
        self.assertTrue(res["ok"], res)
        argv, kw = next(c for c in calls if c[0][0] != "git")
        self.assertEqual(argv[2:4], ["spawn", "--run"])
        self.assertIn("--cwd", argv)
        self.assertEqual(kw["env"]["ATLAS_MUX"], "tmux")

    def test_default_transport_is_claude_bg_and_pane_transports_stay_opt_in(self):
        with (
            mock.patch.dict(os.environ, {}, clear=False),
            mock.patch.object(atlas_herdr, "_server_up", lambda: False),
        ):
            os.environ.pop("ATLAS_COLONY_TRANSPORT", None)
            self.assertEqual(atlas_mux.transport(), "claude-bg")
        with mock.patch.object(atlas_herdr, "_server_up", lambda: True):
            os.environ.pop("ATLAS_COLONY_TRANSPORT", None)
            self.assertEqual(atlas_mux.transport(), "claude-bg")
            with mock.patch.dict(os.environ, {"ATLAS_COLONY_TRANSPORT": "herdr"}):
                self.assertEqual(atlas_mux.transport(), "herdr")
            with mock.patch.dict(os.environ, {"ATLAS_COLONY_TRANSPORT": "tmux"}):
                self.assertEqual(atlas_mux.transport(), "tmux")

    def test_herdr_down_and_tmux_absent_is_a_clear_failure_with_no_spawn(self):
        spawn = mock.Mock()
        with (
            mock.patch.dict(os.environ, {"TMUX": "/stale/sock,1,0", "TMUX_PANE": "%9"}),
            mock.patch.object(atlas_herdr, "_server_up", lambda: False),
            mock.patch.object(atlas_herdr, "_spawn", spawn),
            mock.patch("shutil.which", return_value=None),
        ):
            os.environ.pop("ATLAS_COLONY_TRANSPORT", None)
            res = atlas_launch.launch(self.root, "w", "do it")
        self.assertFalse(res["ok"], res)
        self.assertIn("tmux not found", res["reason"])
        spawn.assert_not_called()


class _NoTmux:
    """A tmux stand-in that fails the test if anything on the default path calls it."""

    def __init__(self, tc):
        self.tc = tc

    def __call__(self, *a, **k):
        self.tc.fail(f"tmux was invoked on the herdr path: {a}")


class HerdrLaunchTest(unittest.TestCase):
    """Default transport: panes are created over the herdr socket; tmux is never called."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.handler = PaneHandler()
        self.fake = FakeHerdr(self.handler)
        self.addCleanup(self.fake.close)
        env = {"HERDR_SOCKET_PATH": self.fake.path, "ATLAS_DB": "/lead/db.sqlite"}
        p = mock.patch.dict(os.environ, env)
        p.start()
        self.addCleanup(p.stop)
        os.environ.pop("ATLAS_COLONY_TRANSPORT", None)
        for patcher in (
            mock.patch.object(atlas_mux, "_tmux", _NoTmux(self)),
            mock.patch("subprocess.run", self._no_tmux_run(subprocess.run)),
            mock.patch.object(atlas_launch, "_binary", return_value="/b/omp"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def _no_tmux_run(self, real):
        def run(argv, *a, **k):
            if argv and Path(str(argv[0])).name == "tmux":
                self.fail(f"tmux was invoked on the herdr path: {argv}")
            return real(argv, *a, **k)

        return run

    def sent(self):
        return [p for m, p in self.fake.calls if m == "pane.send_input"]

    def test_interactive_launch_creates_a_pane_whose_command_carries_the_pins(self):
        res = atlas_launch.launch(self.root, "my worker", "do it", run="work")
        self.assertTrue(res["ok"], res)
        self.assertEqual(
            set(res),
            {
                "ok",
                "session",
                "window",
                "target",
                "attach",
                "prompt_file",
                "started_at",
                "reason",
            },
        )
        self.assertEqual((res["session"], res["window"]), ("atlas-work", "my_worker"))
        self.assertTrue(res["target"].startswith("herdr:w"))
        self.assertTrue(atlas_launch.is_live(res["target"]))
        words = shlex.split(self.sent()[0]["text"])
        self.assertEqual(words[:2], ["exec", "env"])
        self.assertIn("ATLAS_WORKER_NAME=my_worker", words)
        self.assertIn(f"ATLAS_PROJECT_ROOT={os.path.abspath(self.root)}", words)
        self.assertIn("ATLAS_DB=/lead/db.sqlite", words)  # FORWARDED_ENV
        self.assertEqual(
            words[-3:], ["--cwd", os.path.abspath(self.root), "@" + res["prompt_file"]]
        )
        ws = next(p for m, p in self.fake.calls if m == "workspace.create")
        self.assertEqual((ws["label"], ws["focus"]), ("atlas-work", False))
        self.assertEqual(ws["env"]["ATLAS_WORKER_NAME"], "my_worker")

    def test_second_launch_with_same_name_gets_a_unique_suffix(self):
        a = atlas_launch.launch(self.root, "dup", "p")
        b = atlas_launch.launch(self.root, "dup", "p")
        self.assertEqual((a["window"], b["window"]), ("dup", "dup-2"))

    def test_kill_closes_the_pane_and_it_is_no_longer_live(self):
        res = atlas_launch.launch(self.root, "k", "p")
        atlas_launch.kill(res["target"])
        self.assertFalse(atlas_launch.is_live(res["target"]))
        self.assertIn("/?pane=", atlas_launch.attach_hint(res["target"]))

    def test_herdr_error_is_a_failed_result(self):
        os.environ["HERDR_SOCKET_PATH"] = "/nonexistent/h.sock"
        with mock.patch.object(atlas_mux, "transport", lambda: "herdr"):
            res = atlas_launch.launch(self.root, "x", "p")
        self.assertFalse(res["ok"])
        self.assertIn("socket_missing", res["reason"])

    def test_headless_spawn_uses_herdr_and_posts_notes_through_mux(self):
        """mux spawn on the default transport: a pane whose command is the run-worker invocation."""
        env = dict(os.environ, ATLAS_MUX="tmux", ATLAS_PROJECT_ROOT=self.root)
        prompt = os.path.join(self.root, "p.txt")
        Path(prompt).write_text("hi")
        env["ATLAS_MUX_OMP_CONFIG"] = os.path.join(self.root, "no-config.yml")
        out = subprocess.run(
            [
                sys.executable,
                str(Path(atlas_mux.__file__)),
                "spawn",
                "--run",
                "work",
                "--name",
                "hw",
                "--harness",
                "omp",
                "--agent",
                "implementer",
                "--prompt-file",
                prompt,
                "--root",
                self.root,
                "--model",
                "x/y",
                "--thinking",
                "low",
            ],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        words = shlex.split(self.sent()[0]["text"])
        self.assertIn("ATLAS_WORKER_NAME=hw", words)
        self.assertIn(f"ATLAS_PROJECT_ROOT={self.root}", words)
        self.assertIn("run-worker", words)
        self.assertEqual(words[words.index("--name") + 1], "hw")


class TodoLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def board(self, items, last="s2"):
        b = atlas_todo.empty_board(self.root)
        b["last_session_id"] = last
        b["items"] = items
        atlas_todo.save(self.root, b)

    @staticmethod
    def item(i, content, age_s, **kw):
        base = {
            "id": i,
            "content": content,
            "status": "pending",
            "owner": None,
            "origin": "session",
            "session_id": "s2",
            "updated_at": time.time() - age_s,
            "archived": False,
        }
        base.update(kw)
        return base

    def test_sweep(self):
        self.board(
            [
                self.item("old", "stale one", 90000),
                self.item("fresh", "fresh one", 60),
                self.item(
                    "adv-old",
                    "advisor[concern]: x",
                    3 * 3600,
                    origin="advisor",
                    session_id="s1",
                ),
                self.item(
                    "adv-cur",
                    "advisor[concern]: y",
                    3 * 3600,
                    origin="advisor",
                    session_id="s2",
                ),
                self.item(
                    "adv-legacy",
                    "advisor[blocker]: z",
                    3 * 3600,
                    origin="manual",
                    session_id="s1",
                ),
                self.item("d1", "same", 300),
                self.item("d2", "same", 100),
                self.item(
                    "live", "launched", 90000, launch={"target": "atlas-work:live"}
                ),
                self.item("done", "finished", 90000, status="completed"),
            ]
        )
        with mock.patch.object(
            atlas_launch, "is_live", lambda t: t == "atlas-work:live"
        ):
            self.assertEqual(atlas_todo.sweep(self.root), 4)
        by = {i["id"]: i for i in atlas_todo.load(self.root)["items"]}
        archived = {k for k, v in by.items() if v["archived"]}
        self.assertEqual(archived, {"old", "adv-old", "adv-legacy", "d1"})
        self.assertEqual(by["d1"]["archived_reason"], "duplicate")
        with mock.patch.object(
            atlas_launch, "is_live", lambda t: t == "atlas-work:live"
        ):
            self.assertEqual(atlas_todo.sweep(self.root), 0)

    def test_restore(self):
        self.board(
            [
                self.item(
                    "a",
                    "x",
                    10,
                    archived=True,
                    archived_reason="stale",
                    status="completed",
                )
            ]
        )
        r = atlas_todo.restore(self.root, "a")
        self.assertTrue(r["ok"])
        self.assertEqual(
            (r["item"]["status"], r["item"]["archived"]), ("pending", False)
        )
        self.assertNotIn("archived_reason", r["item"])

    def test_carry_over_resets_unowned_in_progress_and_keeps_advisor(self):
        self.board(
            [
                self.item("a", "work", 10, status="in_progress", session_id="s1"),
                self.item(
                    "adv", "advisor[concern]: q", 10, origin="advisor", session_id="s1"
                ),
            ]
        )
        atlas_todo.carry_over(self.root, "s3")
        by = {i["id"]: i for i in atlas_todo.load(self.root)["items"]}
        self.assertEqual((by["a"]["status"], by["a"]["session_id"]), ("pending", "s3"))
        self.assertEqual(by["adv"]["session_id"], "s1")


class StartOpTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.item = atlas_todo.add(self.root, "ship it", origin="session")["item"]

    def post(self, body):
        ctx = SimpleNamespace(
            json=lambda: dict(body, project=self.root),
            project_root=lambda p: self.root if p == self.root else None,
        )
        return work.h_todos_post(ctx)

    def test_start_claims_for_window_and_stores_launch(self):
        res = {
            "ok": True,
            "window": "todo-x",
            "target": "atlas-work:todo-x",
            "session": "atlas-work",
            "attach": "tmux attach -t atlas-work:todo-x",
            "prompt_file": "/p",
            "started_at": 1.0,
            "reason": None,
        }
        with (
            mock.patch.object(atlas_launch, "launch", return_value=res) as m,
            mock.patch.object(atlas_launch, "is_live", return_value=True),
        ):
            status, body = self.post({"op": "start", "id": self.item["id"]})
        self.assertEqual(status, 200, body)
        self.assertEqual(m.call_args.args[1], f"todo-{self.item['id']}")
        self.assertIn("complete --root", m.call_args.args[2])
        stored = atlas_todo.load(self.root)["items"][0]
        self.assertEqual(
            (stored["status"], stored["owner"], stored["launch"]),
            ("in_progress", "todo-x", res),
        )
        self.assertEqual(body["item"]["owner"], "todo-x")
        self.assertTrue(body["item"]["live"])

    def test_failed_launch_leaves_item_and_returns_command(self):
        res = {"ok": False, "reason": "tmux not found", "prompt_file": "/p"}
        with mock.patch.object(atlas_launch, "launch", return_value=res):
            status, body = self.post({"op": "start", "id": self.item["id"]})
        self.assertEqual(status, 502)
        self.assertEqual(
            (body["error"], body["reason"]), ("launch_failed", "tmux not found")
        )
        self.assertIn("@/p", body["command"])
        self.assertEqual(atlas_todo.load(self.root)["items"][0]["status"], "pending")

    def test_assign_with_launch_names_window_after_owner(self):
        res = {
            "ok": True,
            "window": "alice",
            "target": "atlas-work:alice",
            "session": "atlas-work",
            "attach": "",
            "prompt_file": "/p",
            "started_at": 1.0,
            "reason": None,
        }
        with (
            mock.patch.object(atlas_launch, "launch", return_value=res) as m,
            mock.patch.object(atlas_launch, "is_live", return_value=False),
        ):
            status, _ = self.post(
                {
                    "op": "assign",
                    "id": self.item["id"],
                    "owner": "alice",
                    "launch": True,
                }
            )
        self.assertEqual(status, 200)
        self.assertEqual(m.call_args.args[1], "alice")

    def test_restore_and_archived_listing(self):
        atlas_todo.sweep(self.root, ttl_s=-1)
        state = work.todos_state(self.root, archived=True)
        self.assertEqual(state["phases"][0]["items"][0]["archived_reason"], "stale")
        self.assertEqual(work.todos_state(self.root)["phases"], [])
        status, _ = self.post({"op": "restore", "id": self.item["id"]})
        self.assertEqual(status, 200)
        self.assertEqual(len(work.todos_state(self.root)["phases"]), 1)


if __name__ == "__main__":
    unittest.main()
