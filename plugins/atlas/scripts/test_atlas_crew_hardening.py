#!/usr/bin/env python3
"""atlas_crew / atlas_irc edge cases an expert user hits: a check that hangs or forks, a check that prints bytes that
are not UTF-8, a supervisor that died, a run id tmux cannot hold, an owned path outside the project."""

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import types
import unittest
import uuid
from pathlib import Path
from unittest import mock

import _test_isolation  # noqa: F401
import atlas_crew
import atlas_irc

try:
    import pytest  # noqa: F401

    HAVE_PYTEST = True
except ImportError:
    HAVE_PYTEST = False


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except (OSError, IndexError):
        return True


def _pids_with(marker: str) -> list:
    """Pids whose command line holds `marker` (pgrep -f), this process excluded."""
    r = subprocess.run(["pgrep", "-f", marker], capture_output=True, text=True)
    return [int(p) for p in r.stdout.split() if int(p) != os.getpid()]


def _gone(marker: str, wait_s: float = 5.0) -> bool:
    end = time.time() + wait_s
    while time.time() < end:
        if not _pids_with(marker):
            return True
        time.sleep(0.05)
    return not _pids_with(marker)


def _marker() -> str:
    """A `sleep` argument no other process on the machine carries."""
    return "%d.%06d" % (40 + os.getpid() % 50, uuid.uuid4().int % 1000000)


class HungCheckTests(unittest.TestCase):
    """A check past its budget is stopped with everything it started, and the caller gets its verdict on time."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.mark = _marker()
        self.addCleanup(lambda: subprocess.run(["pkill", "-f", f"sleep {self.mark}"]))

    def test_run_check_timeout_kills_the_whole_check_tree(self):
        t0 = time.time()
        code, out = atlas_crew._run_check(
            f"sleep {self.mark}; true", self.root, timeout=0.5
        )
        self.assertEqual(code, 124)
        self.assertLess(time.time() - t0, 5)
        self.assertTrue(
            _gone(f"sleep {self.mark}"), "the timed-out check's child is still running"
        )

    def test_run_check_timeout_keeps_the_output_so_far(self):
        code, out = atlas_crew._run_check(
            f"echo started test_x; sleep {self.mark}", self.root, timeout=0.5
        )
        self.assertEqual(code, 124)
        self.assertTrue(out.startswith("timed out after 0.5s"), out)
        self.assertIn("started test_x", out)

    @unittest.skipUnless(HAVE_PYTEST, "pytest is not installed")
    def test_sharded_check_enforces_its_timeout_on_a_shard_whose_test_forks_and_hangs(
        self,
    ):
        (self.root / "test_a.py").write_text(
            "import subprocess, time\n"
            "def test_hang():\n"
            f"    subprocess.Popen(['sleep', '{self.mark}'])\n"
            f"    time.sleep({float(self.mark)})\n"
        )
        (self.root / "test_b.py").write_text("def test_ok():\n    assert True\n")
        cmd = f"{sys.executable} -m pytest -q"
        t0 = time.time()
        code, out = atlas_crew.sharded_check(
            cmd, self.root, ["test_a.py", "test_b.py"], 2, timeout=3
        )
        took = time.time() - t0
        self.assertEqual(code, 124, out)
        self.assertLess(took, 15, f"a 3 s budget took {took:.1f} s")
        self.assertIn("timed out after 3s", out)
        self.assertTrue(
            _gone(f"sleep {self.mark}"), "the hung shard's child is still running"
        )

    def test_irc_unit_check_timeout_kills_the_whole_check_tree(self):
        bus = atlas_irc.init_bus(self.root / "bus", "#t", ["a"], "lead")
        env = {
            "ATLAS_CREW_UNIT_CHECK": f"sleep {self.mark}; true",
            "ATLAS_CREW_ROOT": str(self.root),
        }
        with (
            mock.patch.dict(os.environ, env),
            mock.patch.object(atlas_irc, "CHECK_TIMEOUT_S", 0.5),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(atlas_irc._run_unit_check(bus, "a"), 124)
        self.assertTrue(
            _gone(f"sleep {self.mark}"),
            "the timed-out unit check's child is still running",
        )

    def test_a_signal_to_the_caller_stops_its_running_check(self):
        """`kill` stops the supervisor with SIGTERM: a check it runs must not outlive it."""
        script = (
            "import sys; sys.path.insert(0, %r)\n"
            "import atlas_crew, atlas_irc\n"
            "atlas_irc.stop_checks_on_signal()\n"
            "print(atlas_crew._run_check('sleep %s; true', '.', timeout=60))\n"
        ) % (str(Path(atlas_crew.__file__).resolve().parent), self.mark)
        p = subprocess.Popen(
            [sys.executable, "-c", script], cwd=self.root, start_new_session=True
        )
        end = time.time() + 10
        while time.time() < end and not _pids_with(f"sleep {self.mark}"):
            time.sleep(0.05)
        self.assertTrue(_pids_with(f"sleep {self.mark}"), "the check never started")
        os.killpg(p.pid, 15)
        p.wait(timeout=10)
        self.assertTrue(
            _gone(f"sleep {self.mark}"), "the check outlived the process that ran it"
        )


    def test_crew_kill_stops_the_global_check_the_supervisor_runs(self):
        rundir = self.root / ".atlas/.run/crew/crew-k"
        (rundir / "exit").mkdir(parents=True)
        atlas_irc.init_bus(rundir / "irc", "#crew-k", ["a"], lead="lead")
        plan = {"check": f"sleep {self.mark}; true", "workers": [{"name": "a", "owns": ["a.py"], "task": "t"}]}
        (self.root / "a.py").write_text("a")
        meta = {"run_id": "crew-k", "root": str(self.root), "plan": plan, "tmux": False, "started": time.time(),
                "fix_rounds": 0, "timeout": 120}
        (rundir / "run.json").write_text(json.dumps(meta))
        atlas_crew.atlas_crew_seal.create(rundir, "crew-k")
        (rundir / "exit/a.r0.json").write_text(json.dumps({"exit": 0, "wall_s": 1}))
        sup = subprocess.Popen([sys.executable, str(Path(atlas_crew.__file__).resolve()), "supervise", "--rundir", str(rundir)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.addCleanup(lambda: sup.poll() is None and sup.kill())
        end = time.time() + 20
        while time.time() < end and not _pids_with(f"sleep {self.mark}"):
            time.sleep(0.05)
        self.assertTrue(_pids_with(f"sleep {self.mark}"), "the global check never started")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(atlas_crew.cmd_kill(types.SimpleNamespace(run="crew-k", root=str(self.root))), 0)
        sup.wait(timeout=10)
        self.assertTrue(_gone(f"sleep {self.mark}"), "the global check outlived `kill`")
        self.assertIs(json.loads((rundir / "summary.json").read_text())["killed"], True)


class NonUtf8OutputTests(unittest.TestCase):
    """A check that prints a latin-1 byte (a fixture, a binary diff, a locale message) is a verdict, not a crash."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def test_run_check_survives_bytes_that_are_not_utf8(self):
        code, out = atlas_crew._run_check(
            r"printf 'caf\351 failed\n'; exit 1", self.root
        )
        self.assertEqual(code, 1)
        self.assertIn("caf", out)
        self.assertIn("failed", out)

    def test_irc_unit_check_survives_bytes_that_are_not_utf8(self):
        bus = atlas_irc.init_bus(self.root / "bus", "#t", ["a"], "lead")
        env = {
            "ATLAS_CREW_UNIT_CHECK": r"printf 'caf\351\n'; exit 1",
            "ATLAS_CREW_ROOT": str(self.root),
        }
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(buf):
            self.assertEqual(atlas_irc._run_unit_check(bus, "a"), 1)
        self.assertIn("caf", buf.getvalue())

    def test_supervisor_publishes_a_red_summary_when_the_check_prints_latin1(self):
        rundir = self.root / ".atlas/.run/crew/crew-t"
        (rundir / "exit").mkdir(parents=True)
        atlas_irc.init_bus(rundir / "irc", "#crew-t", ["a"], lead="lead")
        plan = {
            "check": r"printf 'caf\351\n'; exit 1",
            "workers": [{"name": "a", "owns": ["a.py"], "task": "t"}],
        }
        (self.root / "a.py").write_text("a")
        meta = {
            "run_id": "crew-t",
            "root": str(self.root),
            "plan": plan,
            "tmux": False,
            "started": time.time(),
            "fix_rounds": 0,
            "timeout": 60,
        }
        (rundir / "run.json").write_text(json.dumps(meta))
        (rundir / "exit/a.r0.json").write_text(json.dumps({"exit": 0, "wall_s": 1}))
        atlas_crew.cmd_supervise(types.SimpleNamespace(rundir=str(rundir)))
        summary = json.loads((rundir / "summary.json").read_text())
        self.assertIs(summary["ok"], False)
        self.assertEqual(summary["check_exit"], 1)


class DeadSupervisorTests(unittest.TestCase):
    """`wait` tells the lead when the supervisor died without a summary instead of 'still running' forever."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.rundir = atlas_crew._run_dir(self.root, "r1")
        (self.rundir / "exit").mkdir(parents=True)
        (self.rundir / "irc").mkdir()
        meta = {
            "run_id": "r1",
            "started": time.time() - 10,
            "plan": {"workers": [{"name": "a"}]},
            "tmux": False,
        }
        (self.rundir / "run.json").write_text(json.dumps(meta))

    def _dead_pid(self) -> int:
        p = subprocess.Popen(["true"])
        p.wait()
        return p.pid

    def test_wait_reports_a_supervisor_that_died_without_a_summary(self):
        (self.rundir / "supervisor.pid").write_text(str(self._dead_pid()))
        (self.rundir / "supervisor.log").write_text(
            "Traceback (most recent call last):\nValueError: boom\n"
        )
        buf = io.StringIO()
        t0 = time.time()
        with contextlib.redirect_stdout(buf):
            code = atlas_crew.cmd_wait(
                types.SimpleNamespace(run="r1", root=str(self.root), timeout=5)
            )
        out = json.loads(buf.getvalue())
        self.assertEqual(code, 1, out)
        self.assertLess(time.time() - t0, 4)
        self.assertIs(out["ok"], False)
        self.assertIn("supervisor", out["error"])
        self.assertIn("ValueError: boom", out.get("supervisor_log_tail", ""))

    def test_wait_keeps_waiting_while_the_supervisor_lives(self):
        sup = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", "supervise", str(self.rundir)])
        self.addCleanup(sup.wait)
        self.addCleanup(sup.kill)
        end = time.time() + 10  # the real supervisor writes its own pid after exec; wait for this one's exec
        while time.time() < end and Path(f"/proc/{sup.pid}").exists() and \
                "supervise" not in Path(f"/proc/{sup.pid}/cmdline").read_bytes().decode("utf-8", "replace"):
            time.sleep(0.01)
        (self.rundir / "supervisor.pid").write_text(str(sup.pid))
        with contextlib.redirect_stdout(io.StringIO()):
            code = atlas_crew.cmd_wait(
                types.SimpleNamespace(run="r1", root=str(self.root), timeout=0.3)
            )
        self.assertEqual(code, 3)

    def test_wait_does_not_call_a_killed_run_dead_while_kill_writes_its_summary(self):
        (self.rundir / "supervisor.pid").write_text(str(self._dead_pid()))
        (self.rundir / "killed").write_text("1")
        with contextlib.redirect_stdout(io.StringIO()):
            code = atlas_crew.cmd_wait(
                types.SimpleNamespace(run="r1", root=str(self.root), timeout=0.3)
            )
        self.assertEqual(code, 3)

    def test_wait_treats_a_recycled_supervisor_pid_as_dead(self):
        (self.rundir / "supervisor.pid").write_text(str(os.getpid()))  # alive, but not this run's supervisor
        if not Path(f"/proc/{os.getpid()}/cmdline").exists():
            self.skipTest("no /proc")
        with contextlib.redirect_stdout(io.StringIO()):
            code = atlas_crew.cmd_wait(types.SimpleNamespace(run="r1", root=str(self.root), timeout=2))
        self.assertEqual(code, 1)


class KillRecycledPidTests(unittest.TestCase):
    """`kill` of a run signals only that run's processes: a pid file left by a finished run may name a pid the
    system has since given to an unrelated process."""

    def test_kill_leaves_alone_a_process_that_reuses_a_recorded_pid(self):
        if not Path(f"/proc/{os.getpid()}/cmdline").exists():
            self.skipTest("no /proc")
        with tempfile.TemporaryDirectory() as tmp:
            rundir = atlas_crew._run_dir(tmp, "r1")
            (rundir / "pid").mkdir(parents=True)
            (rundir / "wpid").mkdir()
            (rundir / "run.json").write_text(json.dumps({"run_id": "r1", "started": time.time(), "tmux": False,
                                                         "plan": {"workers": [{"name": "a"}]}}))
            atlas_crew.atlas_crew_seal.create(rundir, "r1")
            strangers = [subprocess.Popen(["sleep", "30"], start_new_session=True) for _ in range(2)]
            for p in strangers:
                self.addCleanup(lambda p=p: (p.poll() is None and p.kill(), p.wait()))
            (rundir / "pid" / "a").write_text(str(strangers[0].pid))
            (rundir / "wpid" / "a.r0").write_text(str(strangers[1].pid))
            with contextlib.redirect_stdout(io.StringIO()):
                atlas_crew.cmd_kill(types.SimpleNamespace(run="r1", root=tmp))
            time.sleep(0.3)
            self.assertEqual([p.poll() for p in strangers], [None, None], "kill signalled processes of no run")


class RunIdTests(unittest.TestCase):
    """A run id names a tmux session and a directory: one that neither can hold is refused before anything starts."""

    def _run(self, tmp, run_id):
        plan = {"workers": [{"name": "z", "owns": ["z.py"], "task": "t"}]}
        Path(tmp, "p.json").write_text(json.dumps(plan))
        buf = io.StringIO()
        with (
            mock.patch.dict(os.environ, {"ATLAS_CREW_TMUX": "off"}),
            mock.patch.object(atlas_crew, "_launch", lambda *x: None),
            mock.patch.object(atlas_crew.subprocess, "Popen"),
            contextlib.redirect_stdout(buf),
        ):
            code = atlas_crew.cmd_run(
                types.SimpleNamespace(
                    plan=str(Path(tmp, "p.json")),
                    root=tmp,
                    run_id=run_id,
                    model=None,
                    effort=None,
                    fix_rounds=0,
                    timeout=60,
                    no_tmux=True,
                    wait=0,
                    spec=None,
                    files=None,
                    session="s",
                )
            )
        return code, json.loads(buf.getvalue())

    def test_a_run_id_with_a_dot_colon_or_slash_is_refused(self):
        for bad in ("v1.2", "a:b", "../escape", "a/b", "-x"):
            with tempfile.TemporaryDirectory() as tmp:
                code, out = self._run(tmp, bad)
                self.assertEqual(code, 2, (bad, out))
                self.assertIn("run id", out["error"])
                self.assertFalse(Path(tmp, ".atlas/escape").exists())
                self.assertFalse(
                    Path(tmp, ".atlas/.run/crew").exists()
                    and any(Path(tmp, ".atlas/.run/crew").iterdir())
                )

    def test_a_plain_run_id_still_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = self._run(tmp, "fix-2_b")
            self.assertEqual(code, 0, out)
            self.assertEqual(out["run"], "fix-2_b")


class OwnedPathTests(unittest.TestCase):
    """An owned path outside the project is refused at load time, not a supervisor crash at the end of the run."""

    def test_owned_paths_outside_the_root_are_refused(self):
        for bad in ("/etc/hosts", "../sibling.py", "pkg/../../x.py", "/abs/*.py"):
            with tempfile.TemporaryDirectory() as tmp:
                Path(tmp, "p.json").write_text(
                    json.dumps({"workers": [{"name": "a", "owns": [bad], "task": "t"}]})
                )
                with self.assertRaises(ValueError) as cm:
                    atlas_crew.load_plan(Path(tmp, "p.json"))
                self.assertIn(bad, str(cm.exception))

    def test_relative_owned_paths_inside_the_root_still_load(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "p.json").write_text(
                json.dumps(
                    {
                        "workers": [
                            {
                                "name": "a",
                                "owns": ["pkg/a.py", "./b.py", "src/*.py"],
                                "task": "t",
                            }
                        ]
                    }
                )
            )
            self.assertEqual(
                atlas_crew.load_plan(Path(tmp, "p.json"))["workers"][0]["owns"],
                ["pkg/a.py", "./b.py", "src/*.py"],
            )


class IsOursExactMatchTests(unittest.TestCase):
    def _ours(self, argv, run_id="a1"):
        raw = "\0".join(argv).encode() + b"\0"
        with mock.patch.object(Path, "read_bytes", return_value=raw):
            return atlas_crew._is_ours(4242, run_id)

    def test_substring_of_run_id_in_unrelated_argv_is_not_ours(self):
        self.assertFalse(self._ours(["sleep", "30", "--tag", "xa1y"]))
        self.assertFalse(self._ours(["sleep", "30", "a1"]))
        self.assertFalse(self._ours(["vim", "/tmp/a10/file", "--name", "a1x-w"]))

    def test_supervisor_wrapper_and_worker_shapes_are_ours(self):
        rd = "/repo/.atlas/crew/a1"
        self.assertTrue(self._ours(["python3", "atlas_crew.py", "supervise", "--rundir", rd]))
        self.assertTrue(
            self._ours(["python3", "atlas_crew.py", "worker", "--rundir", rd, "--name", "w"])
        )
        self.assertTrue(
            self._ours(["claude", "--name", "a1-w", "--settings", rd + "/worker-settings.json"])
        )
        self.assertTrue(self._ours(["claude", "--name=a1-w"]))
        self.assertTrue(self._ours(["python3", "gateway.py", rd]))



if __name__ == "__main__":
    unittest.main()
