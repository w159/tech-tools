"""ingest_session unit contracts: the SessionEnd detach, the scoring spawn, the temp-leak
predicate and the cwd handling of the lead/sweep helpers. Complements test_ingest_session.py."""

import io
import json
import os
import sys
import types
import unittest
from unittest import mock

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ingest_session  # noqa: E402

SESSION_END = json.dumps({"hook_event_name": "SessionEnd", "session_id": "s-1"})


class _Stdin:
    """Swap sys.stdin for the duration of a test and give back whatever the hook left there."""

    def __init__(self, text):
        self.text = text

    def __enter__(self):
        self.old = sys.stdin
        sys.stdin = io.StringIO(self.text)
        return self

    def __exit__(self, *exc):
        sys.stdin = self.old


def _env(**kw):
    base = {
        k: v
        for k, v in os.environ.items()
        if k not in (ingest_session.DETACHED_ENV, "ATLAS_INGEST_SYNC")
    }
    base.update(kw)
    return mock.patch.dict(os.environ, base, clear=True)


class DetachSessionEndTest(unittest.TestCase):
    def test_session_end_hands_the_payload_to_a_detached_child(self):
        with _Stdin(SESSION_END), _env(), mock.patch.object(
            ingest_session.subprocess, "Popen"
        ) as popen:
            self.assertIs(ingest_session._detach_session_end(), True)
        args, kw = popen.call_args
        self.assertEqual(args[0][0], sys.executable)
        self.assertEqual(args[0][-1], os.path.abspath(ingest_session.__file__))
        self.assertEqual(kw["env"][ingest_session.DETACHED_ENV], "1")
        self.assertIs(kw["start_new_session"], True)
        self.assertIs(kw["stdin"], ingest_session.subprocess.PIPE)
        self.assertIs(kw["stdout"], ingest_session.subprocess.DEVNULL)
        self.assertIs(kw["stderr"], ingest_session.subprocess.DEVNULL)
        stdin = popen.return_value.stdin
        stdin.write.assert_called_once_with(SESSION_END.encode("utf-8"))
        stdin.close.assert_called_once_with()

    def test_no_site_interpreter_keeps_the_dash_s_flag(self):
        for no_site, want in ((1, True), (0, False)):
            with _Stdin(SESSION_END), _env(), mock.patch.object(
                ingest_session.subprocess, "Popen"
            ) as popen, mock.patch.object(
                ingest_session.sys, "flags", types.SimpleNamespace(no_site=no_site)
            ):
                ingest_session._detach_session_end()
            argv = popen.call_args[0][0]
            self.assertEqual("-S" in argv, want)
            if want:
                self.assertEqual(argv[:2], [sys.executable, "-S"])

    def test_other_events_run_inline_and_stdin_is_replayable(self):
        stop = json.dumps({"hook_event_name": "Stop", "session_id": "s-1"})
        with _Stdin(stop), _env(), mock.patch.object(
            ingest_session.subprocess, "Popen"
        ) as popen:
            self.assertIs(ingest_session._detach_session_end(), False)
            self.assertEqual(sys.stdin.read(), stop)
        popen.assert_not_called()

    def test_child_and_sync_modes_stay_inline(self):
        for name in (ingest_session.DETACHED_ENV, "ATLAS_INGEST_SYNC"):
            with _Stdin(SESSION_END), _env(**{name: "1"}), mock.patch.object(
                ingest_session.subprocess, "Popen"
            ) as popen:
                self.assertIs(ingest_session._detach_session_end(), False)
                self.assertEqual(sys.stdin.read(), SESSION_END)
            popen.assert_not_called()

    def test_other_values_of_the_env_switches_do_not_block_the_detach(self):
        for name in (ingest_session.DETACHED_ENV, "ATLAS_INGEST_SYNC"):
            with _Stdin(SESSION_END), _env(**{name: "0"}), mock.patch.object(
                ingest_session.subprocess, "Popen"
            ) as popen:
                self.assertIs(ingest_session._detach_session_end(), True)
            popen.assert_called_once()

    def test_unparseable_or_non_object_stdin_runs_inline_without_a_fault(self):
        for raw in ("", "not json", "[1, 2]", '"SessionEnd"'):
            with _Stdin(raw), _env(), mock.patch.object(
                ingest_session.subprocess, "Popen"
            ) as popen, mock.patch.object(ingest_session.atlas_faults, "record") as rec:
                self.assertIs(ingest_session._detach_session_end(), False, raw)
                self.assertEqual(sys.stdin.read(), raw)
            popen.assert_not_called()
            rec.assert_not_called()

    def test_unreadable_stdin_is_treated_as_empty(self):
        class Broken:
            def read(self):
                raise OSError("closed")

        old = sys.stdin
        sys.stdin = Broken()
        try:
            with _env():
                self.assertIs(ingest_session._detach_session_end(), False)
            self.assertEqual(sys.stdin.read(), "")
        finally:
            sys.stdin = old

    def test_failed_spawn_is_a_fault_row_and_falls_back_inline(self):
        with _Stdin(SESSION_END), _env(), mock.patch.object(
            ingest_session.subprocess, "Popen", side_effect=OSError("no fork")
        ), mock.patch.object(ingest_session.atlas_faults, "record") as rec:
            self.assertIs(ingest_session._detach_session_end(), False)
            self.assertEqual(sys.stdin.read(), SESSION_END)
        self.assertEqual(rec.call_args[0][0], "ingest_session.detach")
        self.assertIsInstance(rec.call_args[0][1], OSError)


class SpawnScoringTest(unittest.TestCase):
    def _call(self, payload, available=True):
        import typesafe_client

        with mock.patch.object(
            ingest_session.subprocess, "Popen"
        ) as popen, mock.patch.object(
            typesafe_client, "available", return_value=available
        ):
            ingest_session._spawn_scoring(payload)
        return popen

    def test_session_end_spawns_the_scorer_detached(self):
        popen = self._call({"hook_event_name": "SessionEnd", "session_id": "s-9"})
        args, kw = popen.call_args
        argv = args[0]
        self.assertEqual(argv[0], sys.executable)
        self.assertEqual(os.path.basename(argv[1]), "turn_scoring.py")
        self.assertTrue(os.path.isfile(argv[1]))
        self.assertEqual(argv[2:], ["--session", "s-9"])
        self.assertIs(kw["start_new_session"], True)
        self.assertIs(kw["stdin"], ingest_session.subprocess.DEVNULL)
        self.assertIs(kw["stdout"], ingest_session.subprocess.DEVNULL)
        self.assertIs(kw["stderr"], ingest_session.subprocess.DEVNULL)

    def test_only_session_end_with_a_session_id_scores(self):
        for payload in (
            {"hook_event_name": "Stop", "session_id": "s-9"},
            {"hook_event_name": "SessionEnd"},
            {"hook_event_name": "SessionEnd", "session_id": ""},
            {},
        ):
            self._call(payload).assert_not_called()

    def test_no_scorer_when_the_client_is_unavailable(self):
        self._call(
            {"hook_event_name": "SessionEnd", "session_id": "s-9"}, available=False
        ).assert_not_called()

    def test_spawn_failure_is_recorded_not_raised(self):
        import typesafe_client

        with mock.patch.object(
            ingest_session.subprocess, "Popen", side_effect=OSError("boom")
        ), mock.patch.object(
            typesafe_client, "available", return_value=True
        ), mock.patch.object(ingest_session.atlas_faults, "record") as rec:
            ingest_session._spawn_scoring(
                {"hook_event_name": "SessionEnd", "session_id": "s-9"}
            )
        self.assertEqual(rec.call_args[0][0], "ingest_session.scoring")


class _FakeDb:
    @staticmethod
    def is_tmp_path(p):
        return os.path.basename(p) == "a.jsonl"


class LeaksToRealDbTest(unittest.TestCase):
    def check(self, path="/tmp/a.jsonl", **env):
        keep = {
            k: v
            for k, v in os.environ.items()
            if k
            not in ("ATLAS_ALLOW_TMP_INGEST", "ATLAS_DB", "ATLAS_HOME", "ATLAS_SOURCE_TRANSCRIPT")
        }
        keep.update(env)
        with mock.patch.dict(os.environ, keep, clear=True):
            return ingest_session._leaks_to_real_db(path, _FakeDb)

    def test_plain_temp_transcript_leaks(self):
        self.assertIs(self.check(), True)
        self.assertIs(self.check("/home/u/s.jsonl"), False)

    def test_opt_in_and_isolation_return_exactly_false(self):
        self.assertIs(self.check(ATLAS_ALLOW_TMP_INGEST="1"), False)
        self.assertIs(self.check(ATLAS_DB="/x/atlas.db"), False)
        self.assertIs(self.check(ATLAS_HOME="/x"), False)

    def test_opt_in_needs_the_exact_value_one(self):
        self.assertIs(self.check(ATLAS_ALLOW_TMP_INGEST="0"), True)

    def test_existing_source_decides_over_the_converted_path(self):
        here = os.path.abspath(__file__)
        self.assertIs(self.check("/tmp/a.jsonl", ATLAS_SOURCE_TRANSCRIPT=here), False)
        with mock.patch.object(_FakeDb, "is_tmp_path", return_value=True):
            self.assertIs(
                self.check("/home/u/s.jsonl", ATLAS_SOURCE_TRANSCRIPT=here), True
            )

    def test_missing_source_falls_back_to_the_transcript_path(self):
        self.assertIs(
            self.check("/tmp/a.jsonl", ATLAS_SOURCE_TRANSCRIPT="/nope/gone.jsonl"), True
        )


class CwdHandlingTest(unittest.TestCase):
    def test_finish_lead_only_trusts_a_non_empty_string_cwd(self):
        import atlas_todo

        for cwd, want in (("", None), (5, None), (None, None), ("/r", "/r")):
            with mock.patch.object(atlas_todo, "find_root", return_value="/root") as fr, \
                    mock.patch.object(atlas_todo, "mark_finished"), \
                    mock.patch.object(atlas_todo, "reap_channels"):
                ingest_session._finish_lead(
                    {"hook_event_name": "SessionEnd", "session_id": "s", "cwd": cwd}
                )
            fr.assert_called_once_with(want)

    def test_sweep_only_trusts_a_non_empty_string_cwd(self):
        import atlas_todo

        for cwd, want in (("", None), (5, None), (None, None), ("/r", "/r")):
            with mock.patch.object(atlas_todo, "find_root", return_value="/root") as fr, \
                    mock.patch.object(atlas_todo, "sweep") as sw:
                ingest_session._sweep_todos({"hook_event_name": "Stop", "cwd": cwd})
            fr.assert_called_once_with(want)
            sw.assert_called_once_with("/root")

    def test_finish_lead_marks_the_lead_with_exit_zero(self):
        import atlas_todo

        with mock.patch.object(atlas_todo, "find_root", return_value="/root"), \
                mock.patch.object(atlas_todo, "lead_name", return_value="lead-x") as ln, \
                mock.patch.object(atlas_todo, "mark_finished") as mf, \
                mock.patch.object(atlas_todo, "reap_channels"):
            ingest_session._finish_lead(
                {"hook_event_name": "SessionEnd", "session_id": "sid"}
            )
        ln.assert_called_once_with("sid")
        mf.assert_called_once_with("/root", "lead-x", 0)


class RefreshFacetSessionIdTest(unittest.TestCase):
    def _refresh(self, session_id, read_id, **env):
        import chronicle_facet

        fake = types.SimpleNamespace(_read_session_id=mock.Mock(return_value=read_id))
        with mock.patch.dict(os.environ, env), mock.patch.object(
            chronicle_facet, "refresh"
        ) as refresh:
            ingest_session._refresh_facet("/x/from-file.jsonl", session_id, fake)
        return refresh, fake

    def test_payload_session_id_wins_without_reading_the_file(self):
        refresh, fake = self._refresh("payload-id", "file-id")
        refresh.assert_called_once_with("payload-id")
        fake._read_session_id.assert_not_called()

    def test_transcript_session_id_is_next(self):
        refresh, _ = self._refresh(None, "file-id")
        refresh.assert_called_once_with("file-id")

    def test_file_stem_is_the_last_resort(self):
        refresh, _ = self._refresh("", None)
        refresh.assert_called_once_with("from-file")

    def test_chronicle_off_skips_the_refresh(self):
        refresh, _ = self._refresh("payload-id", None, ATLAS_CHRONICLE="OFF")
        refresh.assert_not_called()


if __name__ == "__main__":
    unittest.main()
