"""Chronicle card: which transcripts count as 'missed' by the stop-time ingest."""

import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_dash_insights as ins  # noqa: E402


def _write(path, lines, age_h: float = 5.0):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.writelines(json.dumps(x) + "\n" for x in lines)
    t = time.time() - age_h * 3600
    os.utime(path, (t, t))


def _omp(
    root, sid, cwd="/repo/app", parent=None, msgs=True, age_h: float = 5.0, name=None
):
    head = {"type": "session", "id": sid, "cwd": cwd}
    if parent:
        head["parentSession"] = parent
    body = [{"type": "message", "message": {"role": "user"}}] if msgs else []
    p = os.path.join(root, "omp", "-repo", name or f"2026-10-08T00-00-00Z_{sid}.jsonl")
    _write(p, [{"type": "title"}, head, *body], age_h)
    return p


class UnloggedTranscriptsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute("CREATE TABLE session_logs (session_id TEXT)")
        self.conn.execute("CREATE TABLE ingest_files (session_id TEXT)")

    def run_scan(self):
        # the agent is told apart by ".claude" in the glob
        g = (
            os.path.join(self.tmp, ".claude", "*", "*.jsonl"),
            os.path.join(self.tmp, "omp", "*", "*.jsonl"),
        )
        with mock.patch.object(ins, "_TRANSCRIPT_GLOBS", g):
            return ins._unlogged_transcripts(
                ins._Db(self.conn), time.time(), time.time() - 7 * 86400
            )

    def test_classification(self):
        self.conn.execute("INSERT INTO session_logs VALUES ('sid-recorded')")
        self.conn.execute("INSERT INTO ingest_files VALUES ('hdr-recorded')")
        _omp(self.tmp, "sid-recorded")  # recorded by filename id
        _omp(self.tmp, "hdr-recorded", name="renamed.jsonl")  # recorded by header id
        _omp(self.tmp, "sid-missed")  # genuinely missed
        _omp(self.tmp, "sid-sub", parent="sid-missed")  # subagent
        _omp(self.tmp, "sid-empty", msgs=False)  # no messages
        scratch_cwd = tempfile.mkdtemp()  # a temp-dir cwd, never the bare temp root
        _omp(self.tmp, "sid-scratch", cwd=scratch_cwd)
        _omp(self.tmp, "sid-live", age_h=0.5)  # still active
        _write(
            os.path.join(self.tmp, ".claude", "-p", "claude-sid.jsonl"),
            [{"type": "user", "cwd": "/repo/app"}],
        )
        _write(
            os.path.join(
                self.tmp, ".claude", "-claude-mem-observer-sessions", "o.jsonl"
            ),
            [{"type": "user", "cwd": "/x"}],
        )
        out = self.run_scan()
        self.assertEqual((out["omp"], out["claude"]), (1, 1))
        self.assertEqual(out["excluded"], {"subagent": 1, "empty": 1, "scratch": 2})

    def test_fixture_cwds_are_scratch_not_missed(self):
        home = os.path.expanduser("~")
        fixtures = {
            "f-tmp": "/private/tmp/atlas-demo/repo",
            "f-tmp2": "/tmp/anything",
            "f-var": "/var/folders/zz/T/x",
            "f-scratch": f"{home}/proj/.scratch/mux-bench",
            "f-e2e": f"{home}/atlas-e2e-colony2",
        }
        for sid, cwd in fixtures.items():
            _omp(self.tmp, sid, cwd=cwd)
        _omp(self.tmp, "sid-real", cwd="/repo/app")
        out = self.run_scan()
        self.assertEqual((out["omp"], out["claude"]), (1, 0))
        self.assertEqual(out["excluded"], {"scratch": len(fixtures)})

    def test_next_command_only_for_harness_with_misses(self):
        _omp(self.tmp, "sid-missed")

        class Ctx:
            query = {"window": "7d"}

        with mock.patch.object(ins, "_open", lambda ctx: ins._Db(self.conn)):
            g = (
                os.path.join(self.tmp, ".claude", "*", "*.jsonl"),
                os.path.join(self.tmp, "omp", "*", "*.jsonl"),
            )
            with mock.patch.object(ins, "_TRANSCRIPT_GLOBS", g):
                card = {s["id"]: s for s in ins._health_payload(Ctx())["subsystems"]}
        nxt = card["chronicle"]["next"]
        self.assertIn("--backfill-agent omp", nxt)
        self.assertNotIn("(Claude)", nxt)
        self.assertFalse(
            [e for e in card["chronicle"]["evidence"] if "Claude sessions missed" in e]
        )


class BackfillScopeTest(unittest.TestCase):
    """Backfill uses the card's classifier: fixtures, empty and subagent files are skipped."""

    def test_claude_backfill_skips_fixture_and_empty(self):
        import session_ingest as si

        tmp = tempfile.mkdtemp()
        real = os.path.join(tmp, "-p", "real.jsonl")
        _write(real, [{"type": "user", "cwd": "/repo/app"}])
        _write(
            os.path.join(tmp, "-q", "fixture.jsonl"),
            [{"type": "user", "cwd": "/private/tmp/atlas-demo/r"}],
        )
        _write(os.path.join(tmp, "-p", "empty.jsonl"), [{"type": "summary"}])
        seen = []
        with mock.patch.object(
            si, "ingest_transcript", lambda p, conn=None: seen.append(p) or {}
        ):
            si.backfill(root=tmp, conn=object())
        self.assertEqual(seen, [real])

    def test_omp_backfill_skips_subagent_fixture_and_empty(self):
        import session_ingest as si

        tmp = tempfile.mkdtemp()
        ok = _omp(tmp, "sid-ok")
        _omp(tmp, "sid-sub", parent="sid-ok")
        _omp(tmp, "sid-empty", msgs=False)
        _omp(tmp, "sid-fx", cwd="/tmp/x")
        seen = []
        with mock.patch.object(
            si,
            "ingest_agent_session",
            lambda p, adapter, conn=None, **kw: seen.append(p) or {},
        ):
            si.backfill_agent("omp", root=os.path.join(tmp, "omp"), conn=object())
        self.assertEqual(seen, [ok])


if __name__ == "__main__":
    unittest.main()
