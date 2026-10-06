import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

HOOKS_DIR = os.path.dirname(__file__)
HOOK = os.path.join(HOOKS_DIR, "dispatch_tripwire.py")
sys.path.insert(0, HOOKS_DIR)
sys.path.insert(0, os.path.join(HOOKS_DIR, "..", "scripts"))

import atlas_todo  # noqa: E402
import dispatch_tripwire  # noqa: E402
import worker_inbox  # noqa: E402


class _Root(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.root = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.root, ".atlas", ".run"))
        self.env = {"ATLAS_WORKER_NAME": "Alpha", "ATLAS_PROJECT_ROOT": self.root}

    def note(self, owner, to, text, ts=None):
        rec = atlas_todo.note(self.root, owner, text, to=to)
        if ts is not None:
            # rewrite the single record with a chosen ts (deterministic ordering)
            path = Path(atlas_todo.notes_dir(self.root)) / f"{owner}.jsonl"
            rows = [json.loads(x) for x in path.read_text().splitlines() if x]
            rows[-1]["ts"] = ts
            path.write_text("".join(json.dumps(r) + "\n" for r in rows))
            rec["ts"] = ts
        return rec


class DrainTest(_Root):
    def test_not_a_worker_is_a_noop(self):
        self.note("human", "Alpha", "hello")
        self.assertIsNone(worker_inbox.worker_env({}))
        self.assertIsNone(worker_inbox.worker_env({"ATLAS_WORKER_NAME": "Alpha"}))
        self.assertIsNone(worker_inbox.worker_env({"ATLAS_PROJECT_ROOT": self.root}))
        self.assertEqual(worker_inbox.context_for_post_tool_use({}), "")
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), 0.0)

    def test_delivers_once_and_advances_cursor(self):
        rec = self.note("human", "Alpha", "please run the tests")
        out = worker_inbox.context_for_post_tool_use(self.env)
        doc = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(doc["hookEventName"], "PostToolUse")
        self.assertIn("please run the tests", doc["additionalContext"])
        self.assertIn("from human", doc["additionalContext"])
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), rec["ts"])
        self.assertTrue(worker_inbox.is_read(self.root, "Alpha", rec["ts"]))
        # a second run delivers nothing and leaves the cursor alone
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), rec["ts"])

    def test_only_notes_addressed_to_the_worker(self):
        self.note("human", "Beta", "for beta")
        self.note("human", "all", "broadcast")
        self.note("Alpha", "lead", "alpha's own output")
        self.note("Alpha", "Alpha", "self note")
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), 0.0)
        mine = self.note("human", "Alpha", "for alpha")
        text = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn("for alpha", text)
        for other in ("for beta", "broadcast", "alpha's own output", "self note"):
            self.assertNotIn(other, text)
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), mine["ts"])

    def test_notes_arriving_later_are_delivered_in_order(self):
        base = time.time() - 100
        self.note("human", "Alpha", "first", ts=base)
        self.note("lead", "Alpha", "second", ts=base + 1)
        text = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertLess(text.index("first"), text.index("second"))
        self.note("human", "Alpha", "third", ts=base + 2)
        text = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn("third", text)
        self.assertNotIn("first", text)
        self.assertNotIn("second", text)

    def test_backlog_is_capped_and_resumes(self):
        base = time.time() - 1000
        for i in range(worker_inbox.MAX_NOTES + 3):
            self.note("human", "Alpha", f"msg-{i:02d}", ts=base + i)
        first = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn("msg-00", first)
        self.assertNotIn(f"msg-{worker_inbox.MAX_NOTES:02d}", first)
        rest = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn(f"msg-{worker_inbox.MAX_NOTES:02d}", rest)
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")

    def test_long_body_is_clipped(self):
        self.note("human", "Alpha", "x" * (worker_inbox.MAX_BODY + 500))
        text = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn("[truncated]", text)
        self.assertLess(len(text), worker_inbox.MAX_BODY + 300)

    def test_future_dated_note_cannot_poison_the_cursor(self):
        self.note("human", "Alpha", "from the future", ts=time.time() + 86400)
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), 0.0)
        real = self.note("human", "Alpha", "real")
        self.assertIn("real", worker_inbox.context_for_post_tool_use(self.env))
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), real["ts"])

    def test_cursors_are_per_worker(self):
        a = self.note("human", "Alpha", "to alpha")
        self.note("human", "Beta", "to beta")
        worker_inbox.context_for_post_tool_use(self.env)
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), a["ts"])
        self.assertEqual(worker_inbox.read_cursor(self.root, "Beta"), 0.0)
        beta_env = dict(self.env, ATLAS_WORKER_NAME="Beta")
        self.assertIn("to beta", worker_inbox.context_for_post_tool_use(beta_env))

    def test_unsafe_worker_name_cannot_escape_the_inbox_dir(self):
        path = worker_inbox.cursor_path(self.root, "../../evil")
        inbox = Path(self.root) / ".atlas" / ".run" / "inbox"
        self.assertEqual(path.parent, inbox)

    def test_corrupt_cursor_reads_as_unread(self):
        self.note("human", "Alpha", "hi")
        path = worker_inbox.cursor_path(self.root, "Alpha")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json")
        self.assertIn("hi", worker_inbox.context_for_post_tool_use(self.env))

    def test_is_read_memoises_cursor_reads(self):
        rec = self.note("human", "Alpha", "hi")
        worker_inbox.context_for_post_tool_use(self.env)
        memo = {}
        self.assertTrue(worker_inbox.is_read(self.root, "Alpha", rec["ts"], memo))
        self.assertEqual(memo, {"Alpha": rec["ts"]})
        self.assertFalse(worker_inbox.is_read(self.root, "Alpha", rec["ts"] + 5, memo))
        self.assertTrue(worker_inbox.is_read(self.root, "Alpha", "junk", memo))


class TripwireIntegrationTest(_Root):
    def _run_main(self, payload, env=None):
        e = {"ATLAS_DB": os.path.join(self.tmp, "atlas.db"), "ATLAS_TRIPWIRE": "off"}
        e.update(env or {})
        out = io.StringIO()
        with (
            patch.dict(os.environ, e),
            patch("sys.stdin", new=io.StringIO(json.dumps(payload))),
            contextlib.redirect_stdout(out),
        ):
            dispatch_tripwire.main()
        return out.getvalue()

    def _post(self, tool="Read"):
        return {
            "hook_event_name": "PostToolUse",
            "session_id": "s",
            "cwd": self.root,
            "tool_name": tool,
            "tool_input": {"file_path": "a.py"},
        }

    def test_worker_post_tool_use_emits_one_json_document(self):
        self.note("human", "Alpha", "ping from the dashboard")
        out = self._run_main(self._post(), self.env)
        doc = json.loads(out)  # one document: a second one would raise here
        self.assertIn(
            "ping from the dashboard", doc["hookSpecificOutput"]["additionalContext"]
        )
        self.assertEqual(self._run_main(self._post(), self.env), "")

    def test_non_worker_session_is_untouched(self):
        self.note("human", "Alpha", "ping")
        env = {"ATLAS_WORKER_NAME": "", "ATLAS_PROJECT_ROOT": ""}
        self.assertEqual(self._run_main(self._post(), env), "")
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), 0.0)

    def test_pre_tool_use_never_drains(self):
        self.note("human", "Alpha", "ping")
        pre = dict(self._post(), hook_event_name="PreToolUse")
        self._run_main(pre, self.env)
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), 0.0)

    def test_inbox_merges_into_the_tripwire_message(self):
        # the tripwire's own PostToolUse context and the inbox share ONE document
        merged = dispatch_tripwire._merge_context(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PostToolUse",
                        "additionalContext": "STOP - route this",
                    }
                }
            ),
            worker_inbox.json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PostToolUse",
                        "additionalContext": "[atlas] 1 message for you",
                    }
                }
            ),
        )
        ctx = json.loads(merged)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("[atlas] 1 message for you", ctx)
        self.assertIn("STOP - route this", ctx)

    def test_a_deny_wins_over_the_inbox_text(self):
        deny = json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "no",
                }
            }
        )
        self.assertEqual(dispatch_tripwire._merge_context(deny, "{}"), deny)

    def test_unrecognised_output_is_kept_intact(self):
        self.assertEqual(dispatch_tripwire._merge_context("garbage", "{}"), "garbage")


class SubprocessTest(_Root):
    """The shipped entry point: a real process, env pinned like atlas_mux does."""

    def _run(self, env):
        payload = {
            "hook_event_name": "PostToolUse",
            "session_id": "s",
            "cwd": self.root,
            "tool_name": "Read",
            "tool_input": {"file_path": "a.py"},
        }
        base = {k: v for k, v in os.environ.items() if not k.startswith("ATLAS_")}
        base.update(ATLAS_DB=os.path.join(self.tmp, "atlas.db"), ATLAS_TRIPWIRE="off")
        base.update(env)
        return subprocess.run(
            [sys.executable, HOOK],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=base,
        )

    def test_end_to_end_delivery_then_silence(self):
        rec = self.note("human", "Alpha", "ship it")
        first = self._run(self.env)
        self.assertEqual(first.returncode, 0, first.stderr)
        doc = json.loads(first.stdout)
        self.assertIn("ship it", doc["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), rec["ts"])
        second = self._run(self.env)
        self.assertEqual((second.returncode, second.stdout), (0, ""))


class RealCollisionTest(_Root):
    """A worker whose tripwire body prints its own STOP message in the same call
    as an inbox delivery must still emit ONE parseable JSON document."""

    def setUp(self):
        super().setUp()
        import atlas_db

        self.db_path = os.path.join(self.tmp, "atlas.db")
        conn = atlas_db.connect(self.db_path)
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, self.root)
        atlas_db.start_run(conn, pid, "sess-1")
        atlas_db.mark_orchestrating(conn, "sess-1")
        conn.close()

    def _call(self, env):
        # A relative path: the tripwire exempts anything under the system temp dir
        # (where this fixture's project lives) as an orchestration path.
        payload = {
            "hook_event_name": "PostToolUse",
            "session_id": "sess-1",
            "cwd": self.root,
            "tool_name": "Edit",
            "tool_input": {"file_path": "a.py"},
        }
        e = {
            "ATLAS_DB": self.db_path,
            "ATLAS_TRIPWIRE": "on",
            "ATLAS_TRIPWIRE_HARD": "on",
        }
        e.update(env)
        out = io.StringIO()
        with (
            patch.dict(os.environ, e),
            patch("sys.stdin", new=io.StringIO(json.dumps(payload))),
            contextlib.redirect_stdout(out),
        ):
            dispatch_tripwire.main()
        return out.getvalue()

    def test_stop_message_and_inbox_share_one_document(self):
        # baseline: without the worker env the tripwire speaks alone
        alone = json.loads(
            self._call({"ATLAS_WORKER_NAME": "", "ATLAS_PROJECT_ROOT": ""})
        )
        self.assertIn("STOP", alone["hookSpecificOutput"]["additionalContext"])
        self.note("human", "Alpha", "ping during an edit")
        both = json.loads(self._call(self.env))  # raises if two documents were printed
        ctx = both["hookSpecificOutput"]["additionalContext"]
        self.assertIn("ping during an edit", ctx)
        self.assertIn("STOP", ctx)
        self.assertEqual(both["hookSpecificOutput"]["hookEventName"], "PostToolUse")


if __name__ == "__main__":
    unittest.main()
