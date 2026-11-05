"""atlas_colony_model: pid probes, omp transcript lookup edge cases, role titles."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_colony_model as model  # noqa: E402


def _dead_pid():
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    return p.pid


class PidProbeTest(unittest.TestCase):
    def test_pid_gone(self):
        self.assertIs(model._pid_gone(os.getpid()), False)
        self.assertIs(model._pid_gone(_dead_pid()), True)
        for bad in (0, -3, None, "", "abc"):
            self.assertIs(model._pid_gone(bad), False, bad)
        self.assertIs(model._pid_gone(str(os.getpid())), False)

    def test_pid_gone_false_on_other_oserror(self):
        with mock.patch.object(model.os, "kill", side_effect=PermissionError("eperm")):
            self.assertIs(model._pid_gone(123), False)
        with mock.patch.object(model.os, "kill", side_effect=OSError("other")):
            self.assertIs(model._pid_gone(123), False)

    def test_pid_alive(self):
        self.assertIs(model._pid_alive(os.getpid()), True)
        self.assertIs(model._pid_alive(_dead_pid()), False)
        self.assertIs(model._pid_alive(0), False)
        self.assertIs(model._pid_alive(-1), False)

    def test_pid_alive_eperm_counts_alive_other_oserror_does_not(self):
        with mock.patch.object(model.os, "kill", side_effect=PermissionError("eperm")):
            self.assertIs(model._pid_alive(123), True)
        with mock.patch.object(model.os, "kill", side_effect=OSError("other")):
            self.assertIs(model._pid_alive(123), False)
        with mock.patch.object(model.os, "kill", side_effect=ProcessLookupError()):
            self.assertIs(model._pid_alive(123), False)


class OmpTranscriptTest(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp())
        model._TRANSCRIPTS.clear()
        self.addCleanup(model._TRANSCRIPTS.clear)
        p = mock.patch.object(model, "_omp_sessions_root", return_value=self.base)
        p.start()
        self.addCleanup(p.stop)

    def session(self, slug="-x-proj", sid="abcdef11", name="TuiX"):
        f = self.base / slug / f"2026-10-19T17-24-15-712Z_{sid}-0000" / f"{name}.jsonl"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("{}\n")
        return f

    def test_empty_sid_never_matches_any_session(self):
        self.session()
        self.assertEqual(model._omp_transcript("/x/proj", "TuiX", ""), "")

    def test_missing_sessions_dir_gives_empty(self):
        with mock.patch.object(model, "_omp_sessions_root", return_value=self.base / "nope"):
            self.assertEqual(model._omp_transcript("/x/proj", "TuiX", "abcdef11"), "")

    def test_result_is_cached_until_ttl_expires(self):
        f = self.session()
        self.assertEqual(model._omp_transcript("/x/proj", "TuiX", "abcdef11"), str(f))
        f.unlink()
        self.assertEqual(model._omp_transcript("/x/proj", "TuiX", "abcdef11"), str(f))
        key = ("omp", "abcdef11", "TuiX")
        model._TRANSCRIPTS[key] = (0.0, str(f))  # expired
        self.assertEqual(model._omp_transcript("/x/proj", "TuiX", "abcdef11"), "")

    def test_only_exact_member_name_matches(self):
        self.session(name="TuiXY")
        self.assertEqual(model._omp_transcript("/x/proj", "TuiX", "abcdef11"), "")


class RoleTitleTest(unittest.TestCase):
    SPECS = [
        {"kind": "skill", "name": "explorer", "description": "WRONG kind"},
        {"kind": "agent", "name": "other", "description": "WRONG name"},
        {"kind": "agent", "name": "explorer", "description": "Maps the codebase"},
    ]

    def test_picks_agent_spec_with_matching_label(self):
        self.assertEqual(model._role_title("atlas:explorer", self.SPECS), "Maps the codebase")

    def test_kind_and_name_must_both_match(self):
        self.assertEqual(model._role_title("explorer", self.SPECS[:1]), "")
        self.assertEqual(model._role_title("explorer", self.SPECS[1:2]), "")
        self.assertEqual(model._role_title("nobody", self.SPECS), "")

    def test_description_clipped_to_forty_chars_with_ellipsis(self):
        spec = [{"kind": "agent", "name": "explorer", "description": "x" * 40}]
        self.assertEqual(model._role_title("explorer", spec), "x" * 40)
        spec = [{"kind": "agent", "name": "explorer", "description": "y" * 41}]
        self.assertEqual(model._role_title("explorer", spec), "y" * 39 + "…")


class TeamsTest(unittest.TestCase):
    def test_sorted_by_created_missing_created_first_and_junk_dropped(self):
        root = Path(tempfile.mkdtemp())
        d = root / ".atlas" / ".run" / "teams"
        d.mkdir(parents=True)
        (d / "a.json").write_text(json.dumps({"team_id": "a", "created": 0.5}))
        (d / "b.json").write_text(json.dumps({"team_id": "b"}))
        (d / "c.json").write_text(json.dumps({"team_id": "c", "created": 7}))
        (d / "d.json").write_text(json.dumps({"created": 1}))  # no team_id
        (d / "e.json").write_text("[1, 2]")
        (d / "f.json").write_text("{bad")
        recs = model._teams(str(root))
        self.assertEqual([r["team_id"] for r in recs], ["b", "a", "c"])
        for r in recs:
            self.assertGreater(r["_mtime"], 0)

    def test_no_teams_dir_is_empty(self):
        self.assertEqual(model._teams(tempfile.mkdtemp()), [])


class ClaudeTranscriptTest(unittest.TestCase):
    def setUp(self):
        self.cfg = Path(tempfile.mkdtemp())
        p = mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.cfg)})
        p.start()
        self.addCleanup(p.stop)
        model._TRANSCRIPTS.clear()
        self.addCleanup(model._TRANSCRIPTS.clear)

    def agent_file(self, proj, aid, mtime):
        f = self.cfg / "projects" / proj / "sess1" / "subagents" / f"agent-{aid}.jsonl"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("{}\n")
        os.utime(f, (mtime, mtime))
        return f

    def test_newest_matching_file_wins_and_empty_id_is_empty(self):
        self.agent_file("p1", "abc", 100)
        want = self.agent_file("p2", "abc", 200)
        self.agent_file("p3", "abcd", 900)
        self.assertEqual(model._claude_transcript({"agent_id": "abc"}), str(want))
        self.assertEqual(model._claude_transcript({}), "")
        self.assertEqual(model._claude_transcript({"agent_id": "zzz"}), "")

    def test_cache_hit_until_expiry(self):
        key = ("claude", "abc", "")
        model._TRANSCRIPTS[key] = (time.time() + 100, "cached")
        self.assertEqual(model._claude_transcript({"agent_id": "abc"}), "cached")
        model._TRANSCRIPTS[key] = (time.time() - 1, "stale")
        self.assertEqual(model._claude_transcript({"agent_id": "abc"}), "")
        self.assertGreater(model._TRANSCRIPTS[key][0], time.time())


class ResultTextTest(unittest.TestCase):
    def test_shapes(self):
        self.assertEqual(model._result_text("plain"), "plain")
        self.assertEqual(
            model._result_text([{"text": "a"}, {"other": 1}, "raw", 5]), "a\n\nraw\n5"
        )
        self.assertEqual(model._result_text(None), "")
        self.assertEqual(model._result_text(0), "")
        self.assertEqual(model._result_text(42), "42")
        self.assertEqual(model._result_text({"k": 1}), "{'k': 1}")


class RecentNotesTest(unittest.TestCase):
    def test_stops_reading_files_once_feed_max_reached_and_sorts_by_ts(self):
        calls = []

        def fake_tail(p):
            calls.append(p)
            return {"new": [{"ts": 5, "seq": 1}, {"ts": 2, "seq": 2}], "old": [{"ts": 1, "seq": 3}]}[p]

        files = [(1, "old"), (9, "new")]
        with (
            mock.patch.object(model, "_tail_notes", fake_tail),
            mock.patch.object(model, "FEED_MAX", 2),
        ):
            recs = model._recent_notes(files)
        self.assertEqual(calls, ["new"])  # newest file first; exactly FEED_MAX is enough
        self.assertEqual([r["ts"] for r in recs], [2, 5])
        with (
            mock.patch.object(model, "_tail_notes", fake_tail),
            mock.patch.object(model, "FEED_MAX", 3),
        ):
            calls.clear()
            recs = model._recent_notes(files)
        self.assertEqual(calls, ["new", "old"])
        self.assertEqual([r["ts"] for r in recs], [1, 2, 5])


if __name__ == "__main__":
    unittest.main()
