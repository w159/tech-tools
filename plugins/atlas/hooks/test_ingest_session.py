import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

# In-process import of the hook under test, mirroring the test_completion_gate
# pattern. Subprocess end-to-end tests cover only exit codes; the coverage
# itself comes from calling ingest_session.main() in this process.
sys.path.insert(0, os.path.dirname(__file__))

import ingest_session  # noqa: E402

HOOK = os.path.join(os.path.dirname(__file__), "ingest_session.py")
SCRIPTS_DIR = os.path.join(os.path.dirname(__file__), "..", "scripts")
sys.path.insert(0, SCRIPTS_DIR)

import atlas_db  # noqa: E402


def _msg(uuid, role, content, cwd="/repo/demo", session_id="sess-ingest-test"):
    """One Claude Code transcript jsonl line."""
    return json.dumps(
        {
            "sessionId": session_id,
            "cwd": cwd,
            "gitBranch": "main",
            "type": role,
            "uuid": uuid,
            "timestamp": "2026-07-12T12:00:00Z",
            "message": {"role": role, "content": content},
        }
    )


# A minimal but valid transcript: a user prompt and an assistant reply.
FIXTURE_LINES = [
    _msg("u1", "user", [{"type": "text", "text": "Wire the callback."}]),
    _msg(
        "a1",
        "assistant",
        [{"type": "text", "text": "Done."}],
    ),
]


class _HookTestCase(unittest.TestCase):
    """Shared setUp: temp DB + temp transcript file."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.tpath = os.path.join(self.tmp, "sess-ingest-test.jsonl")
        self._write_transcript(FIXTURE_LINES)
        self._base_env = dict(os.environ, ATLAS_DB=self.dbpath, ATLAS_INGEST="on")

    def tearDown(self):
        # Drop the cached session_ingest import so a later test re-inserts the
        # scripts path cleanly; the hook re-inserts it on every main() anyway.
        sys.modules.pop("session_ingest", None)

    def _write_transcript(self, lines):
        with open(self.tpath, "w") as f:
            f.write("\n".join(lines) + "\n")

    def _run_main(self, payload, env=None):
        """Call ingest_session.main() in-process with mocked stdin/env."""
        env = env or self._base_env
        stdin = io.StringIO(json.dumps(payload) if payload is not None else "")
        with (
            mock.patch.dict(os.environ, env, clear=False),
            mock.patch("sys.stdin", new=stdin),
        ):
            ingest_session.main()

    def _exec_main_block(self, env, stdin_text):
        """Execute the hook's __main__ block in-process.

        Reads the source, compiles it with the real filename (so coverage.py
        attributes the hits to ingest_session.py), and execs it with
        __name__=='__main__'. The block ends with sys.exit(0), which raises
        SystemExit that we assert.
        """
        with open(HOOK) as f:
            source = f.read()
        with (
            mock.patch.dict(os.environ, env, clear=False),
            mock.patch("sys.stdin", new=io.StringIO(stdin_text)),
        ):
            code = compile(source, HOOK, "exec")
            namespace = {"__name__": "__main__", "__file__": HOOK}
            with self.assertRaises(SystemExit) as cm:
                exec(code, namespace)
            return cm.exception.code

    def _session_log_row(self):
        c = atlas_db.connect(self.dbpath)
        try:
            atlas_db.init(c)
            row = c.execute(
                "SELECT session_id, transcript_path, cursor_bytes, file_size, "
                "message_count FROM session_logs WHERE session_id=?",
                ("sess-ingest-test",),
            ).fetchone()
            return row
        finally:
            c.close()

    def _message_count(self):
        c = atlas_db.connect(self.dbpath)
        try:
            atlas_db.init(c)
            return c.execute(
                "SELECT COUNT(*) FROM messages WHERE session_id=?",
                ("sess-ingest-test",),
            ).fetchone()[0]
        finally:
            c.close()


class IngestDisabledTest(_HookTestCase):
    def test_atlas_ingest_off_returns_early(self):
        env = dict(self._base_env, ATLAS_INGEST="off")
        self._run_main({"transcript_path": self.tpath}, env=env)
        # No session_logs row should have been written.
        self.assertIsNone(self._session_log_row())

    def test_atlas_ingest_off_case_insensitive(self):
        env = dict(self._base_env, ATLAS_INGEST="OFF")
        self._run_main({"transcript_path": self.tpath}, env=env)
        self.assertIsNone(self._session_log_row())


class NoTranscriptTest(_HookTestCase):
    def test_empty_stdin_returns_early(self):
        self._run_main(None)
        self.assertIsNone(self._session_log_row())

    def test_no_transcript_path_key_returns_early(self):
        self._run_main({"session_id": "sess-ingest-test"})
        self.assertIsNone(self._session_log_row())

    def test_missing_transcript_file_returns_early(self):
        bogus = os.path.join(self.tmp, "does-not-exist.jsonl")
        self._run_main({"transcript_path": bogus, "session_id": "sess-ingest-test"})
        self.assertIsNone(self._session_log_row())


class HappyPathTest(_HookTestCase):
    def test_new_session_writes_session_log_and_messages(self):
        # New session: cursor starts at 0; full transcript is ingested.
        self._run_main(
            {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
        )
        row = self._session_log_row()
        self.assertIsNotNone(row, "session_logs row was not written")
        self.assertEqual(row[0], "sess-ingest-test")
        self.assertEqual(row[1], self.tpath)
        self.assertGreater(row[2], 0, "cursor_bytes should advance past 0")
        self.assertEqual(row[3], os.path.getsize(self.tpath))
        self.assertGreaterEqual(
            row[4], 2, "message_count should reflect ingested messages"
        )
        self.assertGreaterEqual(self._message_count(), 2)

    def test_incremental_call_with_existing_cursor_advances_nothing(self):
        # First call ingests everything; cursor now equals file size.
        self._run_main(
            {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
        )
        first_row = self._session_log_row()
        first_cursor = first_row[2]
        first_msg_count = self._message_count()
        # Second call: no new bytes since cursor == file_size.
        self._run_main(
            {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
        )
        second_row = self._session_log_row()
        self.assertEqual(
            second_row[2], first_cursor, "cursor must not move with no new bytes"
        )
        self.assertEqual(
            self._message_count(), first_msg_count, "no new messages on re-ingest"
        )

    def test_incremental_ingest_appends_new_lines(self):
        # First call ingests the initial fixture.
        self._run_main(
            {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
        )
        before_cursor = self._session_log_row()[2]
        before_count = self._message_count()
        # Append two more lines to the transcript.
        self._write_transcript(
            FIXTURE_LINES
            + [
                _msg("u2", "user", [{"type": "text", "text": "Second prompt."}]),
                _msg("a2", "assistant", [{"type": "text", "text": "Replied."}]),
            ]
        )
        # Second call should read only the new bytes.
        self._run_main(
            {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
        )
        after_row = self._session_log_row()
        self.assertGreater(
            after_row[2], before_cursor, "cursor must advance past previous"
        )
        self.assertEqual(after_row[3], os.path.getsize(self.tpath))
        self.assertEqual(self._message_count(), before_count + 2)


class MainBlockExecTest(_HookTestCase):
    def test_main_block_happy_path_exits_zero(self):
        code = self._exec_main_block(
            self._base_env,
            json.dumps(
                {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
            ),
        )
        self.assertEqual(code, 0)
        # And it actually ingested.
        self.assertIsNotNone(self._session_log_row())

    def test_main_block_swallows_exception_and_exits_zero(self):
        # Invalid JSON makes main() raise inside the __main__ try/except, which
        # must swallow it and still sys.exit(0). Covers the except branch.
        code = self._exec_main_block(self._base_env, "{not valid json")
        self.assertEqual(code, 0)
        self.assertIsNone(self._session_log_row())


class SubprocessExitCodeTest(_HookTestCase):
    """A few end-to-end exit-code checks via subprocess (no coverage gain)."""

    def _run_hook_subprocess(self, event_name):
        payload = json.dumps(
            {
                "hook_event_name": event_name,
                "transcript_path": self.tpath,
                "session_id": "sess-ingest-test",
            }
        )
        env = dict(self._base_env)
        return subprocess.run(
            [sys.executable, HOOK],
            input=payload,
            capture_output=True,
            text=True,
            env=env,
        )

    def test_stop_event_exits_zero(self):
        r = self._run_hook_subprocess("Stop")
        self.assertEqual(r.returncode, 0)

    def test_subagentstop_event_exits_zero(self):
        r = self._run_hook_subprocess("SubagentStop")
        self.assertEqual(r.returncode, 0)

    def test_sessionend_event_exits_zero(self):
        r = self._run_hook_subprocess("SessionEnd")
        self.assertEqual(r.returncode, 0)

    def test_precompact_event_exits_zero(self):
        r = self._run_hook_subprocess("PreCompact")
        self.assertEqual(r.returncode, 0)

    def test_exception_in_hook_exits_zero(self):
        """The hook is fail-open; even an internal error must exit 0."""
        payload = "{not valid json"
        env = dict(self._base_env)
        r = subprocess.run(
            [sys.executable, HOOK],
            input=payload,
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
