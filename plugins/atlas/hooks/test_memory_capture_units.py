"""memory_capture unit contracts for the small helpers: fault trace, seen-hash file, scope
resolution and word-boundary clipping. Complements test_memory_capture.py."""

import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import _test_isolation  # noqa: F401,E402

sys.path.insert(0, HERE)
import atlas_db  # noqa: E402
import atlas_hook_guard  # noqa: E402
import memory_capture  # noqa: E402


class TraceTest(unittest.TestCase):
    def test_cwd_is_passed_through_when_present(self):
        exc = RuntimeError("x")
        with mock.patch.object(memory_capture.atlas_faults, "record") as rec:
            memory_capture._trace(exc, "/repo/a")
        rec.assert_called_once_with("memory_capture", exc, "/repo/a")

    def test_missing_or_empty_cwd_becomes_none(self):
        exc = RuntimeError("x")
        for cwd in (None, ""):
            with mock.patch.object(memory_capture.atlas_faults, "record") as rec:
                memory_capture._trace(exc, cwd)
            rec.assert_called_once_with("memory_capture", exc, None)


class SeenHashesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "seen")

    def test_load_returns_the_stripped_non_blank_lines_as_a_set(self):
        with open(self.path, "w") as f:
            f.write("aaa\n  bbb  \n\n   \naaa\n")
        got = memory_capture._load_seen_hashes(self.path)
        self.assertEqual(got, {"aaa", "bbb"})
        self.assertIsInstance(got, set)

    def test_missing_file_is_an_empty_set(self):
        self.assertEqual(memory_capture._load_seen_hashes(self.path), set())

    def test_append_then_load_round_trips_and_dedupes(self):
        memory_capture._append_seen_hashes(self.path, ["h1", "h2"])
        memory_capture._append_seen_hashes(self.path, ["h2", "h3"])
        self.assertEqual(memory_capture._load_seen_hashes(self.path), {"h1", "h2", "h3"})
        with open(self.path) as f:
            self.assertEqual(f.read().split(), ["h1", "h2", "h3"])

    def test_append_keeps_only_the_newest_cap_lines(self):
        cap = memory_capture.SEEN_MAX_LINES
        memory_capture._append_seen_hashes(self.path, [f"h{i}" for i in range(cap + 5)])
        with open(self.path) as f:
            lines = f.read().split()
        self.assertEqual(len(lines), cap)
        self.assertEqual(lines[0], "h5")
        self.assertEqual(lines[-1], f"h{cap + 4}")

    def test_seen_path_follows_atlas_home_then_the_home_dir(self):
        with mock.patch.dict(os.environ, {"ATLAS_HOME": "/x/ah"}):
            self.assertEqual(
                memory_capture._seen_hashes_path(), "/x/ah/.memory_capture_seen"
            )
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_HOME"}
        env["HOME"] = "/x/home"
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(
                memory_capture._seen_hashes_path(), "/x/home/.atlas/.memory_capture_seen"
            )


class ResolveScopeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "atlas.db"))
        atlas_db.init(self.conn)
        self.pid = atlas_db.register_project(self.conn, "/repo/atlas")

    def tearDown(self):
        self.conn.close()

    def test_a_lone_run_resolves_to_its_own_session_and_id_only(self):
        rid = atlas_db.start_run(self.conn, self.pid, "own-sess")
        self.conn.commit()
        session_ids, run_ids = memory_capture._resolve_scope(self.conn, "own-sess")
        self.assertEqual(session_ids, {"own-sess"})
        self.assertEqual(run_ids, {rid})

    def test_unknown_session_collapses_to_itself(self):
        session_ids, run_ids = memory_capture._resolve_scope(self.conn, "nobody")
        self.assertEqual(session_ids, {"nobody"})
        self.assertEqual(run_ids, set())


class ClipTest(unittest.TestCase):
    def test_text_at_the_limit_is_returned_whole(self):
        text = ("ab " * 70)[:200].rstrip()
        text = text + "x" * (200 - len(text))
        self.assertEqual(len(text), 200)
        self.assertEqual(memory_capture._clip(text), text)

    def test_one_char_over_the_limit_is_clipped_on_a_word_boundary(self):
        text = "word " * 40 + "z"
        text = text[:201]
        self.assertEqual(len(text), 201)
        out = memory_capture._clip(text)
        self.assertTrue(out.endswith("..."))
        self.assertLessEqual(len(out), 203)
        self.assertEqual(out, ("word " * 40).rstrip() + "...")

    def test_limit_is_the_default_two_hundred(self):
        # The 200-char window ends inside the second word; a 201-char window would take the
        # space after it and keep that whole word.
        text = "a" * 100 + " " + "b" * 99 + " " + "c" * 20
        self.assertEqual(memory_capture._clip(text), "a" * 100 + "...")

    def test_whitespace_is_collapsed_and_trailing_punctuation_dropped(self):
        self.assertEqual(memory_capture._clip("a   b\n\tc"), "a b c")
        self.assertEqual(memory_capture._clip("aaa, bbb ccc", limit=6), "aaa...")

    def test_explicit_limit_and_a_single_overlong_word(self):
        self.assertEqual(memory_capture._clip("x" * 30, limit=10), "x" * 10 + "...")


class HashKeyTest(unittest.TestCase):
    def test_is_sixteen_hex_chars_of_the_stripped_content(self):
        h = memory_capture._hash_key("  some lesson \n")
        self.assertEqual(len(h), 16)
        int(h, 16)
        self.assertEqual(h, memory_capture._hash_key("some lesson"))
        self.assertNotEqual(h, memory_capture._hash_key("other lesson"))


class RecordDropTest(unittest.TestCase):
    def test_snippet_is_kind_and_reason_clipped_to_two_hundred(self):
        conn = mock.Mock()
        with mock.patch.object(atlas_db, "connect", return_value=conn), mock.patch.object(
            atlas_db, "record_friction"
        ) as rf, mock.patch("sys.stderr", new=io.StringIO()) as err:
            memory_capture._record_drop("s-1", "memory", {"error": "e" * 500})
        args, kw = rf.call_args
        self.assertEqual(args[1:3], ("s-1", "memory_drop"))
        self.assertEqual(kw["snippet"], ("memory: " + "e" * 500)[:200])
        self.assertEqual(len(kw["snippet"]), 200)
        conn.commit.assert_called_once_with()
        conn.close.assert_called_once_with()
        self.assertIn("dropped a memory lesson", err.getvalue())

    def test_missing_reason_is_unknown(self):
        with mock.patch.object(atlas_db, "connect", return_value=mock.Mock()), mock.patch.object(
            atlas_db, "record_friction"
        ) as rf, mock.patch("sys.stderr", new=io.StringIO()):
            memory_capture._record_drop("s-1", "project", None)
        self.assertEqual(rf.call_args[1]["snippet"], "project: unknown")


class FreshFactsTest(unittest.TestCase):
    """main() announces only facts whose content hash was not seen; a seen fact in the middle of
    a batch must not hide the new ones after it."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        sqlite3.connect(self.db).close()
        self.seen = os.path.join(self.tmp, "seen")
        env = mock.patch.dict(
            os.environ, {"ATLAS_DB": self.db, "ATLAS_MEMORY_CAPTURE": "on"}
        )
        env.start()
        self.addCleanup(env.stop)
        for p in (
            mock.patch.object(atlas_hook_guard, "_state_dir", lambda: self.tmp),
            mock.patch.object(memory_capture, "_seen_hashes_path", lambda: self.seen),
            mock.patch.object(
                memory_capture, "_should_capture", return_value=(True, "test")
            ),
        ):
            p.start()
            self.addCleanup(p.stop)
        import atlas_memory

        self.calls = []

        def add(target, content, root=None):
            self.calls.append((target, str(content)))
            return {"success": True}

        p = mock.patch.object(atlas_memory, "add", add)
        p.start()
        self.addCleanup(p.stop)

    def _main(self, memory, project, sid="s-f"):
        with mock.patch.object(
            memory_capture, "_extract_facts", return_value=(memory, project)
        ), mock.patch("sys.stdin", new=io.StringIO(json.dumps({"session_id": sid, "cwd": "/r"}))):
            with self.assertRaises(SystemExit) as cm:
                memory_capture.main()
        self.assertEqual(cm.exception.code, 0)

    @staticmethod
    def _f(text, key=None):
        return memory_capture._Fact(text, key or text)

    def test_seen_facts_are_skipped_and_later_new_ones_still_captured(self):
        with open(self.seen, "w") as f:
            f.write(memory_capture._hash_key("old-m") + "\n")
            f.write(memory_capture._hash_key("old-p") + "\n")
        self._main(
            [self._f("old-m"), self._f("new-m1"), self._f("new-m1"), self._f("new-m2")],
            [self._f("old-p"), self._f("new-p")],
        )
        self.assertEqual(
            self.calls,
            [("memory", "new-m1"), ("memory", "new-m2"), ("project", "new-p")],
        )
        seen = memory_capture._load_seen_hashes(self.seen)
        for key in ("old-m", "new-m1", "new-m2", "old-p", "new-p"):
            self.assertIn(memory_capture._hash_key(key), seen)

    def test_dedupe_uses_the_raw_key_not_the_per_cwd_display_text(self):
        self._main([self._f("[a] shown", key="raw lesson")], [])
        self._main([self._f("[b] shown", key="raw lesson")], [], sid="s-g")
        self.assertEqual(self.calls, [("memory", "[a] shown")])

    def test_nothing_new_writes_nothing(self):
        with open(self.seen, "w") as f:
            f.write(memory_capture._hash_key("old-m") + "\n")
        self._main([self._f("old-m")], [])
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
