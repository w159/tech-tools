"""Claude Code dispatch -> IRC channel registry (dispatch_tripwire._channel_dispatch via the real hook)."""

import os as _os
import sys as _sys

_sys.path.insert(
    0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch_tripwire.py")
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_todo as todo  # noqa: E402


def git(cwd, *args):
    subprocess.run(
        ["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", *args],
        check=True,
        capture_output=True,
    )


class ChannelDispatchHook(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = os.path.realpath(self._tmp.name)
        git(self.root, "init", "-q", "-b", "feature/x")
        git(self.root, "commit", "-q", "--allow-empty", "-m", "i")
        self.env = {
            k: v
            for k, v in os.environ.items()
            if k
            not in (
                "ATLAS_CHANNELS",
                "ATLAS_HARNESS",
                "ATLAS_CHANNEL",
                "ATLAS_WORKER_NAME",
                "ATLAS_LEAD_NAME",
            )
        }
        home = os.path.join(
            self.root, ".atlas-test-home"
        )  # private: faults must not leak into the shared one
        os.makedirs(home)
        self.env.update(
            ATLAS_DASHBOARD="off",
            ATLAS_COLONY="off",
            ATLAS_DASHBOARD_PORT="17969",
            ATLAS_HOME=home,
            ATLAS_DB=os.path.join(home, "atlas.db"),
            ATLAS_DASHBOARD_DB=os.path.join(home, "atlas.db"),
        )

    def pre(
        self, name, cwd=None, session="sess123456", tool="Task", env=None, extra=None
    ):
        payload = {
            "hook_event_name": "PreToolUse",
            "tool_name": tool,
            "session_id": session,
            "cwd": cwd or self.root,
            "tool_input": {
                "subagent_type": "atlas:implementer",
                "name": name,
                "description": "d",
                "prompt": "TOOLS: x\nGOAL: y",
            },
            **(extra or {}),
        }
        p = subprocess.run(
            [sys.executable, HOOK],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=env or self.env,
        )
        return p, payload

    def test_dispatch_opens_lead_subchannel_and_registers_each_subagent_once(self):
        main = f"{os.path.basename(self.root)}@feature/x"
        for name in ("A1", "A2", "A3", "A1"):  # repeat A1: idempotent
            p, _ = self.pre(name)
            self.assertEqual(p.stderr, "")
            out = json.loads(p.stdout)["hookSpecificOutput"]
            self.assertIn(f"CHANNEL: {main}/lead-sess12", out["updatedInput"]["prompt"])
        sub = todo.get_channel(self.root, f"{main}/lead-sess12")
        assert sub is not None
        self.assertEqual(
            [(m["name"], m["role"], m["parent"]) for m in sub["members"]],
            [
                ("lead-sess12", "lead", None),
                ("A1", "subagent", "lead-sess12"),
                ("A2", "subagent", "lead-sess12"),
                ("A3", "subagent", "lead-sess12"),
            ],
        )
        main_channel = todo.get_channel(self.root, main)
        assert main_channel is not None
        self.assertEqual(main_channel["kind"], "main")

    def test_dispatch_from_a_subdirectory_uses_the_project_root(self):
        sub = os.path.join(self.root, "pkg", "deep")
        os.makedirs(sub)
        self.pre("A1", cwd=sub)
        self.assertTrue((Path(self.root) / ".atlas/.run/channels.json").exists())
        self.assertFalse((Path(sub) / ".atlas").exists())

    def test_detached_head_and_non_git_naming(self):
        git(self.root, "checkout", "-q", "--detach")
        sha = subprocess.run(
            ["git", "-C", self.root, "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        p, _ = self.pre("A1")
        self.assertIn(f"{os.path.basename(self.root)}@{sha}/lead-sess12", p.stdout)
        with tempfile.TemporaryDirectory() as plain:
            plain = os.path.realpath(plain)
            os.mkdir(os.path.join(plain, "docs"))  # a project root marker without git
            p, _ = self.pre("A1", cwd=plain)
            self.assertIn(f"CHANNEL: {os.path.basename(plain)}/lead-sess12", p.stdout)

    def test_subagent_and_omp_and_off_do_not_register(self):
        main = f"{os.path.basename(self.root)}@feature/x"
        nested = {"transcript_path": "/x/subagents/agent-1.jsonl"}
        self.pre("Nested", extra=nested)
        self.pre("Omp", env={**self.env, "ATLAS_HARNESS": "omp"})
        self.pre("Off", env={**self.env, "ATLAS_CHANNELS": "off"})
        self.assertIsNone(todo.get_channel(self.root, f"{main}/lead-sess12"))

    def test_registry_failure_fails_open_with_recorded_fault_and_no_stderr(self):
        board = Path(self.root) / ".atlas/.run"
        board.mkdir(parents=True)
        (board / "channels.json.tmp").mkdir()  # the registry's tmp-file write now fails
        faults = Path(self.env["ATLAS_HOME"]) / "hook-faults.jsonl"
        before = faults.read_text() if faults.exists() else ""
        p, _ = self.pre("A1")
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stderr, "")
        self.assertNotIn("updatedInput", p.stdout)  # the dispatch itself is untouched
        self.assertIn("dispatch_tripwire", faults.read_text()[len(before) :])

    def _hold_registry_lock(self, seconds):
        """Another process holds the registry flock for `seconds`; returns once held."""
        lock = Path(self.root) / ".atlas/.run/channels.json.lock"
        lock.parent.mkdir(parents=True, exist_ok=True)
        code = (
            "import fcntl,sys,time;"
            f"f=open({str(lock)!r},'a+');fcntl.flock(f,fcntl.LOCK_EX);"
            "print('held',flush=True);"
            f"time.sleep({seconds})"
        )
        holder = subprocess.Popen(
            [sys.executable, "-c", code], stdout=subprocess.PIPE, text=True
        )
        assert holder.stdout is not None
        self.addCleanup(holder.stdout.close)
        self.addCleanup(holder.wait)
        self.addCleanup(holder.kill)
        self.assertEqual(holder.stdout.readline().strip(), "held")
        return holder

    def test_held_registry_lock_never_hangs_the_dispatch(self):
        self._hold_registry_lock(6)
        faults = Path(self.env["ATLAS_HOME"]) / "hook-faults.jsonl"
        t0 = time.monotonic()
        p, _ = self.pre("A1")
        self.assertLess(time.monotonic() - t0, 4)
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stderr, "")
        self.assertNotIn("updatedInput", p.stdout)  # dispatch untouched, not blocked
        self.assertIn("channel_lock_timeout", faults.read_text())

    def _orchestrating_env(self):
        """Seed the private DB so the real deny tier runs for session sess123456."""
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        atlas_db.start_run(
            conn, atlas_db.register_project(conn, self.root), "sess123456"
        )
        atlas_db.mark_orchestrating(conn, "sess123456")
        conn.close()
        return {**self.env, "ATLAS_GATES": "always"}

    def test_denied_dispatch_opens_no_channel(self):
        env = self._orchestrating_env()
        p, _ = self.pre("A1", env=env)  # prompt has no DELIVERABLE/spec blocks
        self.assertEqual(p.stderr, "")
        spec = json.loads(p.stdout)["hookSpecificOutput"]
        self.assertEqual(spec["permissionDecision"], "deny")
        self.assertNotIn("updatedInput", spec)
        self.assertFalse((Path(self.root) / ".atlas/.run/channels.json").exists())

    def test_is_deny_recognises_any_json_format(self):
        sys.path.insert(0, os.path.dirname(HOOK))
        import dispatch_tripwire as dt

        doc = {"hookSpecificOutput": {"permissionDecision": "deny", "x": 1}}
        self.assertTrue(dt._is_deny(json.dumps(doc)))  # spaced
        self.assertTrue(dt._is_deny(json.dumps(doc, separators=(",", ":"))))  # compact
        self.assertTrue(dt._is_deny(json.dumps(doc, indent=2) + "\n"))
        allow = {"hookSpecificOutput": {"permissionDecision": "allow"}}
        for out in ("", "not json", json.dumps(allow), json.dumps([1])):
            self.assertFalse(dt._is_deny(out))


if __name__ == "__main__":
    unittest.main()
