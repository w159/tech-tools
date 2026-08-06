import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HOOK = os.path.join(os.path.dirname(__file__), "docs_drift_watch.py")

sys.path.insert(0, os.path.dirname(__file__))
import docs_drift_watch as dw  # noqa: E402

GIT_ENV = dict(
    os.environ,
    GIT_AUTHOR_NAME="t",
    GIT_AUTHOR_EMAIL="t@t",
    GIT_COMMITTER_NAME="t",
    GIT_COMMITTER_EMAIL="t@t",
)


def _run(payload, cwd=None):
    return subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=cwd,
    )


class DocsDriftWatchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        os.makedirs(os.path.join(self.tmp, ".atlas", ".run"), exist_ok=True)
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        with open(os.path.join(self.tmp, "docs", "CHANGELOG.md"), "w") as f:
            f.write("# CHANGELOG\n")
        with open(os.path.join(self.tmp, "docs", "ROADMAP.md"), "w") as f:
            f.write("# ROADMAP\n")
        with open(os.path.join(self.tmp, ".atlas", ".run", "state.json"), "w") as f:
            f.write("{}\n")
        # git diff only sees TRACKED files -- pre-create and commit every path
        # the tests will later "edit", so modifying them shows up as a diff.
        for name in (
            "app.py",
            "app2.py",
            "app3.py",
            "app4.py",
            "app5.py",
            "regression.py",
        ):
            with open(os.path.join(self.tmp, name), "w") as f:
                f.write("0\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=GIT_ENV,
        )

    def _write(self, relpath, content="x\n"):
        path = os.path.join(self.tmp, relpath)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        return path

    def _edit(self, relpath, content="x\n", session_id=None):
        path = self._write(relpath, content)
        payload = {
            "cwd": self.tmp,
            "tool_input": {"file_path": path},
            "tool_name": "Write",
        }
        if session_id is not None:
            payload["session_id"] = session_id
        return _run(payload)

    def _expire_git_cache(self):
        # Force the next hook invocation to re-query git instead of reusing
        # the cached diff, without a real sleep: back-date the cached
        # timestamp past GIT_CACHE_TTL_SECONDS directly in the state file
        # (a separate subprocess -- time.monotonic can't be monkeypatched
        # across that boundary).
        state_path = os.path.join(self.tmp, ".atlas", ".run", "docs_drift_watch.json")
        try:
            with open(state_path) as f:
                state = json.load(f)
        except (FileNotFoundError, ValueError):
            return
        if "git_cache" in state:
            state["git_cache"]["ts"] = 0.0
            with open(state_path, "w") as f:
                json.dump(state, f)

    def test_no_docs_dir_is_silent(self):
        no_docs = tempfile.mkdtemp()
        path = os.path.join(no_docs, "app.py")
        with open(path, "w") as f:
            f.write("x\n")
        r = _run({"cwd": no_docs, "tool_input": {"file_path": path}})
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_docs_file_edit_is_silent(self):
        r = self._edit("docs/ROADMAP.md")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_atlas_dir_edit_is_silent(self):
        r = self._edit(".atlas/.run/state.json")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_gate_off_is_silent(self):
        path = self._write("app.py")
        r = _run(
            {"cwd": self.tmp, "tool_input": {"file_path": path}},
        )
        # sanity: without ATLAS_GATE=off this one warns
        self.assertIn("docs drift", r.stdout)
        env = dict(os.environ, ATLAS_GATE="off")
        path2 = self._write("app2.py")
        r2 = subprocess.run(
            [sys.executable, HOOK],
            input=json.dumps({"cwd": self.tmp, "tool_input": {"file_path": path2}}),
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(r2.stdout.strip(), "")

    def test_first_drifting_edit_warns(self):
        r = self._edit("app.py")
        self.assertIn("docs drift", r.stdout)
        self.assertIn("atlas:docs-curator", r.stdout)

    def test_second_through_fourth_drifting_edits_are_silent(self):
        self._edit("app.py")  # 1st -> warns
        for n in (2, 3, 4):
            r = self._edit("app%d.py" % n)
            self.assertEqual(r.stdout.strip(), "", "edit #%d should be silent" % n)

    def test_fifth_drifting_edit_warns(self):
        self._edit("app.py")  # 1
        for n in (2, 3, 4):
            self._edit("app%d.py" % n)
        r = self._edit("app5.py")  # 5th
        self.assertIn("docs drift", r.stdout)

    def test_drift_cleared_then_reintroduced_warns_again(self):
        self._edit("app.py")  # 1st -> warns, streak=1
        # editing docs/CHANGELOG.md itself is a silent no-op (it's a docs path,
        # short-circuited before the streak is touched) -- but it puts docs/
        # into the git diff, so the NEXT (non-docs) edit observes no-drift
        # and resets the streak.
        self._edit("docs/CHANGELOG.md", content="# CHANGELOG\n- x\n")
        # the docs edit above changes what git would report; expire the
        # cached diff so the next check re-queries git instead of reusing
        # the pre-docs-edit result.
        self._expire_git_cache()
        r_reset = self._edit("app2.py")
        self.assertEqual(r_reset.stdout.strip(), "")
        # commit everything so docs/ drops out of the diff, then drift again
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "docs update"],
            check=True,
            capture_output=True,
            env=GIT_ENV,
        )
        # the commit above changes what git would report; expire the cache
        # again so this check re-queries git instead of reusing the
        # pre-commit cached diff.
        self._expire_git_cache()
        r = self._edit("regression.py")  # streak restarts at 1 -> warns
        self.assertIn("docs drift", r.stdout)

    def test_differing_session_id_resets_streak(self):
        self._edit("app.py", session_id="session-a")  # streak=1 -> warns
        self._edit("app2.py", session_id="session-a")  # streak=2 -> silent
        self._edit("app3.py", session_id="session-a")  # streak=3 -> silent
        r = self._edit("app4.py", session_id="session-b")  # new session -> reset
        self.assertIn("docs drift", r.stdout)

    def test_missing_session_id_resets_streak(self):
        self._edit("app.py", session_id="session-a")  # streak=1 -> warns
        self._edit("app2.py", session_id="session-a")  # streak=2 -> silent
        self._edit("app3.py", session_id="session-a")  # streak=3 -> silent
        r = self._edit("app4.py")  # no session_id -> treated as new -> reset
        self.assertIn("docs drift", r.stdout)

    def test_same_session_id_continues_streak(self):
        self._edit("app.py", session_id="session-a")  # 1 -> warns
        for n in (2, 3, 4):
            r = self._edit("app%d.py" % n, session_id="session-a")
            self.assertEqual(r.stdout.strip(), "", "edit #%d should be silent" % n)
        r = self._edit("app5.py", session_id="session-a")  # 5th -> warns
        self.assertIn("docs drift", r.stdout)

    def test_unreadable_state_file_fails_open(self):
        state_dir = os.path.join(self.tmp, ".atlas", ".run")
        os.makedirs(state_dir, exist_ok=True)
        state_path = os.path.join(state_dir, "docs_drift_watch.json")
        with open(state_path, "w") as f:
            f.write("{not valid json")
        r = self._edit("app.py")
        self.assertEqual(r.returncode, 0)
        # malformed state -> treated as fresh -> still warns, never crashes
        self.assertIn("docs drift", r.stdout)


class DocsDriftWatchInProcessTest(unittest.TestCase):
    """Covers behavior that requires monkeypatching in-process (git call
    counting, simulated write failure) -- unreachable via the subprocess
    harness above.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        os.makedirs(os.path.join(self.tmp, ".atlas", ".run"), exist_ok=True)
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        with open(os.path.join(self.tmp, "docs", "CHANGELOG.md"), "w") as f:
            f.write("# CHANGELOG\n")
        with open(os.path.join(self.tmp, "app.py"), "w") as f:
            f.write("0\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=GIT_ENV,
        )

    def _call(self, payload):
        old_stdin = sys.stdin
        sys.stdin = io.StringIO(json.dumps(payload))
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                dw.main()
        finally:
            sys.stdin = old_stdin
        return buf.getvalue()

    def test_git_cache_reused_within_ttl_and_refreshed_after(self):
        path = os.path.join(self.tmp, "app.py")
        payload = {
            "cwd": self.tmp,
            "tool_input": {"file_path": path},
            "session_id": "s",
        }
        calls = {"n": 0}
        real = dw.git_changed_paths

        def counting(root):
            calls["n"] += 1
            return real(root)

        with (
            mock.patch.object(dw, "git_changed_paths", side_effect=counting),
            mock.patch("time.monotonic", side_effect=[100.0, 101.5, 103.0]),
        ):
            with open(path, "w") as f:
                f.write("x\n")
            self._call(payload)  # t=100 -> cache miss -> 1 git call
            with open(path, "w") as f:
                f.write("y\n")
            self._call(payload)  # t=101.5, within 2s TTL -> cache reused
            with open(path, "w") as f:
                f.write("z\n")
            self._call(payload)  # t=103, TTL expired -> 2nd git call

        self.assertEqual(calls["n"], 2)

    def test_docs_and_atlas_paths_skip_before_git_call(self):
        calls = {"n": 0}

        def counting(_root):
            calls["n"] += 1
            return []

        with mock.patch.object(dw, "git_changed_paths", side_effect=counting):
            self._call(
                {
                    "cwd": self.tmp,
                    "tool_input": {
                        "file_path": os.path.join(self.tmp, "docs", "CHANGELOG.md")
                    },
                }
            )
            self._call(
                {
                    "cwd": self.tmp,
                    "tool_input": {
                        "file_path": os.path.join(self.tmp, ".atlas", ".run", "x.json")
                    },
                }
            )
        self.assertEqual(calls["n"], 0)

    def test_atomic_replace_leaves_no_partial_file_on_write_failure(self):
        root = Path(self.tmp)
        state_path = dw._state_path(root)
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps({"streak": 2}), encoding="utf-8")

        with mock.patch("os.replace", side_effect=OSError("boom")):
            dw._save_state(root, {"streak": 99})

        # original state is untouched -- os.replace never happened
        self.assertEqual(json.loads(state_path.read_text()), {"streak": 2})
        # no stray temp file left behind in the state directory
        leftovers = [p.name for p in state_path.parent.iterdir() if p != state_path]
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
