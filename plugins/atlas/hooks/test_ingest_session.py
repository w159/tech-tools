import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
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
        self._base_env = dict(
            os.environ,
            ATLAS_DB=self.dbpath,
            ATLAS_INGEST="on",
            # Fresh hookstate per test: the same session_id repeats across many
            # calls in this file, and must never touch real ~/.atlas or trip
            # the circuit breaker across unrelated test methods.
            ATLAS_HOOKSTATE_DIR=os.path.join(self.tmp, "hookstate"),
        )

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


class TmpLeakGuardTest(_HookTestCase):
    """A temp-dir transcript must not reach the default ~/.atlas DB (252 test
    sessions polluted the real one); explicit isolation or opt-in still ingests."""

    def _env(self, **extra):
        home = os.path.join(self.tmp, "fakehome")
        os.makedirs(home, exist_ok=True)
        env = {
            k: v
            for k, v in self._base_env.items()
            if k not in ("ATLAS_DB", "ATLAS_HOME", "ATLAS_ALLOW_TMP_INGEST")
        }
        env.update(HOME=home, **extra)
        return env, os.path.join(home, ".atlas", "atlas.db")

    def _run_clear(self, env):
        payload = {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch("sys.stdin", new=io.StringIO(json.dumps(payload))),
        ):
            ingest_session.main()

    def test_tmp_transcript_is_not_ingested_into_the_default_db(self):
        env, default_db = self._env()
        self._run_clear(env)
        self.assertFalse(os.path.exists(os.path.dirname(default_db)))

    def test_opt_in_and_explicit_isolation_still_ingest(self):
        env, default_db = self._env(ATLAS_ALLOW_TMP_INGEST="1")
        self._run_clear(env)
        self.assertTrue(os.path.exists(default_db))
        env, _ = self._env(ATLAS_HOME=os.path.join(self.tmp, "ah"))
        self._run_clear(env)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "ah", "atlas.db")))

    def test_omp_conversion_of_a_real_session_ingests_into_the_default_db(self):
        # omp's bridge always converts into the temp dir; the retained source decides.
        env, default_db = self._env(ATLAS_SOURCE_TRANSCRIPT=os.path.abspath(__file__))
        self._run_clear(env)
        self.assertTrue(os.path.exists(default_db))

    def test_omp_conversion_of_a_temp_source_is_still_refused(self):
        env, default_db = self._env(ATLAS_SOURCE_TRANSCRIPT=self.tpath)
        self._run_clear(env)
        self.assertFalse(os.path.exists(os.path.dirname(default_db)))

    def test_is_tmp_path(self):
        self.assertTrue(atlas_db.is_tmp_path(self.tpath))
        self.assertFalse(atlas_db.is_tmp_path("/home/u/.claude/projects/x/s.jsonl"))


class FacetFreshnessTest(_HookTestCase):
    """The facet row follows session_logs after EVERY ingest, not just Stop."""

    def _counters(self):
        c = atlas_db.connect(self.dbpath)
        try:
            logs = c.execute(
                "SELECT message_count, tool_call_count, user_prompt_count "
                "FROM session_logs WHERE session_id='sess-ingest-test'"
            ).fetchone()
            facet = c.execute(
                "SELECT message_count, tool_call_count, user_prompt_count "
                "FROM facets WHERE session_id='sess-ingest-test'"
            ).fetchone()
            return logs, facet
        finally:
            c.close()

    def test_facet_counters_equal_session_logs_after_each_ingest(self):
        payload = {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
        self._run_main(payload)
        logs, facet = self._counters()
        self.assertEqual(logs, facet)
        self.assertEqual(logs[0], 2)
        self._write_transcript(
            FIXTURE_LINES
            + [
                _msg("u2", "user", [{"type": "text", "text": "Again."}]),
                _msg("a2", "assistant", [{"type": "text", "text": "Done again."}]),
            ]
        )
        self._run_main(
            payload
        )  # a SubagentStop/SessionEnd-style ingest: no chronicle hook
        logs, facet = self._counters()
        self.assertEqual(logs[0], 4)
        self.assertEqual(logs, facet)

    def test_facet_refresh_failure_never_breaks_ingest(self):
        import chronicle_facet

        with mock.patch.object(
            chronicle_facet, "refresh", side_effect=RuntimeError("x")
        ):
            self._run_main(
                {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
            )
        self.assertEqual(self._message_count(), 2)


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


class HarnessAgentLabelTest(_HookTestCase):
    """session_logs.agent labeling from the harness environment.

    omp's bridge spawns the same hook command with ATLAS_HARNESS=omp in the
    child environment (omp/hook-bridge.ts hookEnv() for the synchronous
    hooks; omp/stop-bridge.ts for the detached ingest it spawns at
    session_shutdown/PreCompact, which merges opts.env over process.env).
    Claude Code spawns the hook without that variable. The pytest process
    itself may run under either harness, so each case pins ATLAS_HARNESS
    explicitly: set to the value under test, or removed with clear=True so a
    harness-exported ambient value cannot leak into the claude-default case.
    """

    def _agent_label(self):
        c = atlas_db.connect(self.dbpath)
        try:
            atlas_db.init(c)
            return c.execute(
                "SELECT agent FROM session_logs WHERE session_id=?",
                ("sess-ingest-test",),
            ).fetchone()[0]
        finally:
            c.close()

    def _run_main_without_atlas_harness(self, payload):
        # clear=True restores exactly `env`, so the ambient ATLAS_HARNESS of
        # the process running the tests is dropped rather than merged in.
        env = {
            k: v
            for k, v in dict(os.environ, **self._base_env).items()
            if k != "ATLAS_HARNESS"
        }
        stdin = io.StringIO(json.dumps(payload))
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch("sys.stdin", new=stdin),
        ):
            ingest_session.main()

    def test_atlas_harness_omp_records_omp(self):
        self._run_main(
            {"transcript_path": self.tpath, "session_id": "sess-ingest-test"},
            env=dict(self._base_env, ATLAS_HARNESS="omp"),
        )
        self.assertIsNotNone(self._session_log_row())
        self.assertEqual(self._agent_label(), "omp")

    def test_no_atlas_harness_defaults_claude(self):
        self._run_main_without_atlas_harness(
            {"transcript_path": self.tpath, "session_id": "sess-ingest-test"}
        )
        self.assertIsNotNone(self._session_log_row())
        self.assertEqual(self._agent_label(), "claude")

    def test_unknown_atlas_harness_defaults_claude(self):
        self._run_main(
            {"transcript_path": self.tpath, "session_id": "sess-ingest-test"},
            env=dict(self._base_env, ATLAS_HARNESS="gemini"),
        )
        self.assertEqual(self._agent_label(), "claude")


class DurableTranscriptPathTest(_HookTestCase):
    """omp's bridge ingests a temp conversion; the row must keep the retained original."""

    SID = "sess-ingest-test"

    def setUp(self):
        super().setUp()
        import shutil

        # The durable source must live OUTSIDE the OS temp dir, so it sits beside this test.
        self.durable = tempfile.mkdtemp(dir=os.path.dirname(os.path.abspath(__file__)))
        self.addCleanup(shutil.rmtree, self.durable, True)
        self.src = os.path.join(self.durable, "omp-session.jsonl")
        with open(self.src, "w") as f:
            f.write(
                json.dumps({"type": "session", "id": self.SID}, separators=(",", ":"))
                + "\nORIGINAL-OMP-BODY\n"
            )
        self.payload = {"transcript_path": self.tpath, "session_id": self.SID}

    def _tpath_in_db(self):
        return self._session_log_row()[1]

    def test_conversion_ingest_records_the_durable_source(self):
        env = dict(
            self._base_env, ATLAS_HARNESS="omp", ATLAS_SOURCE_TRANSCRIPT=self.src
        )
        self._run_main(self.payload, env=env)
        recorded = self._tpath_in_db()
        self.assertEqual(recorded, self.src)
        self.assertFalse(atlas_db.is_tmp_path(recorded))

    def test_tmp_or_missing_source_is_ignored(self):
        tmp_src = os.path.join(self.tmp, "src.jsonl")
        open(tmp_src, "w").close()
        for bad in (tmp_src, os.path.join(self.durable, "gone.jsonl"), ""):
            self._run_main(
                self.payload, env=dict(self._base_env, ATLAS_SOURCE_TRANSCRIPT=bad)
            )
            self.assertEqual(self._tpath_in_db(), self.tpath)

    def test_transcript_endpoint_serves_it_after_the_temp_copy_is_gone(self):
        import importlib.util
        import threading
        import urllib.error
        import urllib.request
        from http.server import ThreadingHTTPServer

        env = dict(
            self._base_env, ATLAS_HARNESS="omp", ATLAS_SOURCE_TRANSCRIPT=self.src
        )
        self._run_main(self.payload, env=env)
        os.remove(self.tpath)  # the bridge's exit trap deletes the conversion
        spec = importlib.util.spec_from_file_location(
            "atlas_dashboard_durable", os.path.join(SCRIPTS_DIR, "atlas_dashboard.py")
        )
        dash = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(dash)
        httpd = ThreadingHTTPServer((dash.LOOPBACK, 0), dash.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        base = f"http://{dash.LOOPBACK}:{httpd.server_address[1]}"

        def get(path):
            req = urllib.request.Request(
                base + path, headers={"X-Atlas-Token": dash.DASH_TOKEN}
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    return r.status, json.loads(r.read().decode())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read().decode())

        with mock.patch.dict(os.environ, {"ATLAS_DASHBOARD_DB": self.dbpath}):
            for path in (
                f"/api/sessions/{self.SID}/transcript",
                f"/api/v2/{self.SID}/transcript",
            ):
                code, body = get(path)
                self.assertEqual(code, 200, path)
                self.assertEqual(body["path"], self.src)
                self.assertIn("ORIGINAL-OMP-BODY", body["text"])
            self.assertEqual(get("/api/sessions/nope/transcript")[0], 404)

    def test_repair_dry_run_then_apply(self):
        import session_ingest

        c = atlas_db.connect(self.dbpath)
        atlas_db.init(c)
        atlas_db.upsert_session_log(c, self.SID, transcript_path=self.tpath)
        atlas_db.upsert_session_log(c, "orphan", transcript_path=self.tpath + ".x")
        c.commit()
        c.close()
        with mock.patch.dict(os.environ, {"ATLAS_DB": self.dbpath}):
            dry = session_ingest.repair_tmp_transcript_paths(root=self.durable)
            self.assertEqual(
                (dry["tmp_rows"], dry["repointable"], dry["applied"]), (2, 1, 0)
            )
            self.assertEqual(self._tpath_in_db(), self.tpath)  # dry run wrote nothing
            done = session_ingest.repair_tmp_transcript_paths(
                apply=True, root=self.durable
            )
            self.assertEqual(done["applied"], 1)
        self.assertEqual(self._tpath_in_db(), self.src)

    def _later_copy(self):
        """Rewrite the temp copy as a fresh conversion carrying a later turn."""
        late = json.loads(_msg("a2", "assistant", [{"type": "text", "text": "More."}]))
        late["timestamp"] = "2026-07-12T13:00:00Z"
        self._write_transcript(FIXTURE_LINES + [json.dumps(late)])

    def _meta(self):
        c = atlas_db.connect(self.dbpath)
        try:
            return c.execute(
                "SELECT transcript_path, ended_at, file_size FROM session_logs "
                "WHERE session_id=?",
                (self.SID,),
            ).fetchone()
        finally:
            c.close()

    def _later_temp_copy_updates_durable_row(self, env):
        self._run_main(
            self.payload, env=dict(self._base_env, ATLAS_SOURCE_TRANSCRIPT=self.src)
        )
        before = self._meta()
        self.assertEqual(before[0], self.src)
        self._later_copy()
        self._run_main(self.payload, env=env)
        after = self._meta()
        self.assertEqual(after[0], self.src)  # durable path kept
        self.assertNotEqual(after[1], before[1])  # ended_at advanced
        self.assertEqual(after[2], os.path.getsize(self.tpath))  # file_size updated

    def test_later_temp_copy_without_source_env_updates_row(self):
        self._later_temp_copy_updates_durable_row(self._base_env)

    def test_later_temp_copy_with_source_env_updates_row(self):
        self._later_temp_copy_updates_durable_row(
            dict(self._base_env, ATLAS_SOURCE_TRANSCRIPT=self.src)
        )

    def test_foreign_durable_path_is_still_non_owner(self):
        self._run_main(
            self.payload, env=dict(self._base_env, ATLAS_SOURCE_TRANSCRIPT=self.src)
        )
        before = self._meta()
        other = os.path.join(self.durable, "subagent.jsonl")
        with open(other, "w") as f:
            f.write("\n".join(FIXTURE_LINES) + "\n")
        late = json.loads(_msg("a2", "assistant", [{"type": "text", "text": "More."}]))
        late["timestamp"] = "2026-07-12T13:00:00Z"
        with open(other, "a") as f:
            f.write(json.dumps(late) + "\n")
        self._run_main({"transcript_path": other, "session_id": self.SID})
        self.assertEqual(self._meta(), before)

    def test_temp_sidecar_sharing_session_id_is_not_owner(self):
        import session_ingest

        self._run_main(
            self.payload, env=dict(self._base_env, ATLAS_SOURCE_TRANSCRIPT=self.src)
        )
        before = self._meta()
        sub = os.path.join(self.tmp, "subagents")
        os.makedirs(sub)
        side = os.path.join(sub, "agent-advisor.jsonl")
        late = json.loads(_msg("s1", "assistant", [{"type": "text", "text": "Hi."}]))
        late["timestamp"] = "2026-07-12T14:00:00Z"
        late["cwd"] = "/elsewhere"
        with open(side, "w") as f:
            f.write(json.dumps(late) + "\n")
        with mock.patch.dict(
            os.environ, {"ATLAS_DB": self.dbpath, "ATLAS_SOURCE_TRANSCRIPT": self.src}
        ):
            session_ingest.ingest_transcript(side, session_id=self.SID)
        self.assertEqual(self._meta(), before)


if __name__ == "__main__":
    unittest.main()
