"""Tests for atlas_status_segment: segment() fields, scoring states, wording, speed."""

import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_status_segment as seg_mod  # noqa: E402
import atlas_statusline  # noqa: E402

NOW = 1_800_000_000
# The same fixture and literal live in omp/usage-statusline.test.ts (parity).
EXPECTED = "atlas  implement 2/6 · 3 live · gates ✔ · verified 4m · scoring ok"


def build(tmp, scores=(("score", "verbosity", None, NOW - 100),), gates=0):
    """Project + home under tmp matching the omp fixture; returns (root, home)."""
    root, home = Path(tmp, "proj"), Path(tmp, "home")
    run = root / ".atlas" / ".run"
    run.mkdir(parents=True)
    (home / ".atlas").mkdir(parents=True)
    item = lambda st, sid="s1", **kw: dict(status=st, session_id=sid, origin="manual", **kw)
    items = [item("completed"), item("completed"), item("in_progress", phase="implement")]
    items += [item("pending")] * 3 + [item("pending", sid="other")]
    (run / "todos.json").write_text(json.dumps({"last_session_id": "s1", "items": items}))
    members = [dict(name="lead-x", role="lead", joined=NOW - 900)]
    members += [dict(name="w%d" % i, role="subagent", joined=NOW - 60) for i in range(3)]
    members += [dict(name="done", role="subagent", joined=NOW - 60, ended_at=NOW - 5)]
    (run / "channels.json").write_text(json.dumps({"channels": {"c": {"members": members}}}))
    ts = datetime.fromtimestamp(NOW - 240, timezone.utc).isoformat()
    (run / "findings.json").write_text(json.dumps([dict(status="verified", verified_at=ts)]))
    key = hashlib.sha256(("%s|s1" % root).encode()).hexdigest()[:12]
    (home / ".atlas" / ("status-gates-%s.json" % key)).write_text(json.dumps(dict(at=NOW, failing=gates)))
    db = sqlite3.connect(str(home / ".atlas" / "atlas.db"))
    db.execute(
        "CREATE TABLE turn_scores (id INTEGER PRIMARY KEY, session_id TEXT, message_uuid TEXT, "
        "judgment TEXT, kind TEXT, label TEXT, scored_at REAL)"
    )
    for kind, judgment, label, at in scores:
        db.execute(
            "INSERT INTO turn_scores (session_id, message_uuid, judgment, kind, label, scored_at) "
            "VALUES ('s1','m',?,?,?,?)", (judgment, kind, label, at))
    db.commit()
    db.close()
    return str(root), str(home)


class StatusSegment(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)
        self.tmp = self._t.name

    def seg(self, **kw):
        root, home = build(self.tmp, **kw)
        return seg_mod.segment(root, NOW, home=home)

    def test_progress_live_gates_verified(self):
        s = self.seg()
        self.assertEqual(
            (s["phase"], s["done"], s["total"], s["live"], s["gates_failing"], s["last_verified_age_s"]),
            ("implement", 2, 6, 3, 0, 240),
        )
        self.assertEqual(s["scoring"], "ok")

    def test_failing_gates_render(self):
        text = seg_mod.render_text(self.seg(gates=2), color=False)
        self.assertIn("gates ✖2", text)

    def test_scoring_error_when_error_newer_than_good(self):
        s = self.seg(scores=(("score", "v", None, NOW - 500), ("error", "scoring_error", "TypeSafe API error 400: x", NOW - 100)))
        self.assertEqual((s["scoring"], s["scoring_detail"]), ("error", "api 400"))
        text = seg_mod.render_text(s)
        self.assertIn("\x1b[1;31mscoring error (api 400)", text)

    def test_metrics_do_not_mask_an_outage(self):
        # deterministic metrics keep landing while the API is down
        s = self.seg(scores=(("score", "v", None, NOW - 500), ("error", "scoring_error", "x", NOW - 100), ("metric", "reply_chars", None, NOW - 99)))
        self.assertEqual(s["scoring"], "error")

    def test_error_older_than_good_is_ok(self):
        s = self.seg(scores=(("error", "scoring_error", "x", NOW - 500), ("score", "v", None, NOW - 100)))
        self.assertEqual(s["scoring"], "ok")

    def test_stale_when_no_good_row_in_24h_but_sessions_ran(self):
        s = self.seg(scores=(("score", "v", None, NOW - 3 * 86400), ("metric", "reply_chars", None, NOW - 60)))
        self.assertEqual(s["scoring"], "stale")

    def test_no_rows_at_all_is_ok(self):
        self.assertEqual(self.seg(scores=())["scoring"], "ok")

    def test_no_atlas_dir_is_hidden(self):
        self.assertIsNone(seg_mod.segment(self.tmp, NOW, home=self.tmp))
        self.assertEqual(seg_mod.line_for(self.tmp, home=self.tmp), "")

    def test_empty_project_renders(self):
        root = Path(self.tmp, "p")
        (root / ".atlas").mkdir(parents=True)
        s = seg_mod.segment(str(root), NOW, home=self.tmp)
        self.assertEqual((s["phase"], s["total"], s["live"], s["last_verified_age_s"]), ("idle", 0, 0, None))
        self.assertEqual(seg_mod.render_text(s, color=False), "atlas  idle · 0 live · gates ? · verified never · scoring ok")

    def test_db_is_not_written(self):
        root, home = build(self.tmp)
        db = os.path.join(home, ".atlas", "atlas.db")
        before = os.stat(db).st_mtime_ns
        seg_mod.segment(root, NOW, home=home)
        self.assertEqual(os.stat(db).st_mtime_ns, before)

    def test_claude_statusline_has_no_segment_row(self):
        # the segment text still feeds omp (omp/usage-statusline.test.ts asserts the same EXPECTED string);
        # the Claude Code statusline no longer prints it
        root, home = build(self.tmp)
        self.assertEqual(seg_mod.render_text(seg_mod.segment(root, NOW, home=home), color=False), EXPECTED)
        with mock.patch.object(seg_mod.subprocess, "Popen"):  # real clock: gates cache is stale
            rows = atlas_statusline.render({"cwd": root, "session_id": "s1"}, 160, home)
        self.assertFalse(any(atlas_statusline.ANSI_RE.sub("", r).startswith("atlas  ") for r in rows))

    def test_statusline_has_no_segment_row_without_atlas_dir(self):
        rows = atlas_statusline.render({"cwd": self.tmp}, 160, self.tmp)
        self.assertFalse(any("atlas  " in atlas_statusline.ANSI_RE.sub("", r) for r in rows))

    def test_cached_call_under_50ms(self):
        root, home = build(self.tmp)
        seg_mod.segment(root, time.time(), home=home)  # warm the cache
        t = time.perf_counter()
        for _ in range(20):
            seg_mod.segment(root, time.time(), home=home)
        ms = (time.perf_counter() - t) / 20 * 1000
        print("cached segment() %.2f ms" % ms)
        self.assertLess(ms, 50)

    def test_cold_call_under_50ms(self):
        root, home = build(self.tmp)
        t = time.perf_counter()
        seg_mod.segment(root, NOW, home=home)
        ms = (time.perf_counter() - t) * 1000
        print("cold segment() %.2f ms" % ms)
        self.assertLess(ms, 50)


if __name__ == "__main__":
    unittest.main()
