"""docs_drift_watch in-process contracts: return codes, debounce arithmetic, state I/O, message."""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docs_drift_watch as dw  # noqa: E402


class PathPredicateTest(unittest.TestCase):
    def test_docs_and_atlas_paths(self):
        for p in (
            "docs/a.md",
            "x/docs/a.md",
            "/abs/docs/a.md",
            ".atlas/x",
            "a/.atlas/x",
            "docs\\a.md".replace("\\", "\\"),
            "a\\docs\\b.md",
            ".atlas\\x",
        ):
            self.assertTrue(dw._is_docs_or_atlas_path(p), p)

    def test_other_paths(self):
        for p in (
            "app.py",
            "mydocs/a.md",
            "docs.md",
            "src/docsx/a",
            "atlas/x",
            "x.atlas/y",
            "",
        ):
            self.assertFalse(dw._is_docs_or_atlas_path(p), p)


class NondocsCountTest(unittest.TestCase):
    def test_counts_only_non_docs(self):
        self.assertEqual(dw._nondocs_count([]), 0)
        self.assertEqual(
            dw._nondocs_count(["a.py", "docs/x.md", "p/docs/y.md", "b.py"]), 2
        )
        self.assertEqual(dw._nondocs_count(["docs/x.md"]), 0)
        self.assertEqual(dw._nondocs_count(["mydocs/x.md", "docs.md"]), 2)


class StateIOTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def test_state_path(self):
        self.assertEqual(
            dw._state_path(self.root),
            self.root / ".atlas" / ".run" / "docs_drift_watch.json",
        )

    def test_save_creates_missing_dirs_and_roundtrips(self):
        dw._save_state(self.root, {"streak": 3, "session_id": "s"})
        self.assertEqual(dw._load_state(self.root), {"streak": 3, "session_id": "s"})

    def test_save_into_existing_dir_and_overwrite(self):
        (self.root / ".atlas" / ".run").mkdir(parents=True)
        dw._save_state(self.root, {"streak": 1})
        dw._save_state(self.root, {"streak": 2})
        self.assertEqual(dw._load_state(self.root), {"streak": 2})
        names = os.listdir(self.root / ".atlas" / ".run")
        self.assertEqual(
            names, ["docs_drift_watch.json"]
        )  # temp file replaced, none left

    def test_save_failure_is_silent(self):
        with mock.patch.object(Path, "mkdir", side_effect=PermissionError("ro")):
            self.assertIsNone(dw._save_state(self.root, {"streak": 1}))

    def test_load_missing_or_corrupt_is_empty(self):
        self.assertEqual(dw._load_state(self.root), {})
        p = dw._state_path(self.root)
        p.parent.mkdir(parents=True)
        p.write_text("{nope")
        self.assertEqual(dw._load_state(self.root), {})


class CachedPathsTest(unittest.TestCase):
    def test_ttl_boundary_and_malformed_cache(self):
        root = Path("/r")
        now = 1000.0
        with (
            mock.patch("time.monotonic", return_value=now),
            mock.patch.object(dw, "git_changed_paths", return_value=["fresh"]) as g,
        ):
            young = {"git_cache": {"ts": now - 1.9, "changed": ["cached"]}}
            self.assertEqual(dw._cached_changed_paths(root, young), ["cached"])
            self.assertEqual(g.call_count, 0)
            same = {"git_cache": {"ts": now, "changed": ["cached"]}}  # age 0 is valid
            self.assertEqual(dw._cached_changed_paths(root, same), ["cached"])
            old = {
                "git_cache": {
                    "ts": now - dw.GIT_CACHE_TTL_SECONDS,
                    "changed": ["cached"],
                }
            }
            self.assertEqual(
                dw._cached_changed_paths(root, old), ["fresh"]
            )  # age == ttl: stale
            self.assertEqual(old["git_cache"], {"ts": now, "changed": ["fresh"]})
            for bad in (
                {"ts": "x", "changed": []},
                {"ts": now, "changed": "no"},
                {"ts": None, "changed": []},
                {"changed": ["c"]},
                "str",
                [1],
            ):
                st = {"git_cache": bad}
                self.assertEqual(dw._cached_changed_paths(root, st), ["fresh"], bad)

    def test_git_error_propagates_and_leaves_state(self):
        st = {}
        with mock.patch.object(
            dw, "git_changed_paths", side_effect=RuntimeError("no git")
        ):
            with self.assertRaises(RuntimeError):
                dw._cached_changed_paths(Path("/r"), st)
        self.assertEqual(st, {})


class MainTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: None)
        env = mock.patch.dict(os.environ, {}, clear=False)
        env.start()
        os.environ.pop("ATLAS_GATE", None)
        self.addCleanup(env.stop)

    def _call(self, payload, changed=("app.py",), raw=None, find=True, git_error=None):
        stdin = raw if raw is not None else json.dumps(payload)
        sp = self.root / ".atlas" / ".run" / "docs_drift_watch.json"
        if sp.exists():  # each call sees its own diff, not the TTL cache
            st = json.loads(sp.read_text())
            if st.pop("git_cache", None) is not None:
                sp.write_text(json.dumps(st))
        out = io.StringIO()
        git = mock.patch.object(
            dw, "git_changed_paths", side_effect=git_error, return_value=list(changed)
        )
        fr = mock.patch.object(
            dw, "find_root", return_value=self.root if find else None
        )
        with (
            mock.patch.object(sys, "stdin", io.StringIO(stdin)),
            contextlib.redirect_stdout(out),
            git as g,
            fr as f,
        ):
            rc = dw.main()
        self.last = (g, f)
        return rc, out.getvalue()

    def _p(self, path="app.py", **kw):
        p = {
            "cwd": str(self.root),
            "session_id": "s",
            "tool_input": {"file_path": path},
        }
        p.update(kw)
        return p

    def _streak(self):
        return dw._load_state(self.root).get("streak")

    def test_first_edit_emits_exact_additional_context(self):
        rc, out = self._call(self._p(), changed=["a.py", "b.py", "docs/x.md"])
        self.assertEqual(rc, 0)
        doc = json.loads(out)
        self.assertEqual(doc["hookSpecificOutput"]["hookEventName"], "PostToolUse")
        msg = doc["hookSpecificOutput"]["additionalContext"]
        self.assertTrue(
            msg.startswith("[atlas] docs drift: 2 non-docs file(s) changed")
        )
        self.assertIn("atlas:docs-curator", msg)
        self.assertEqual(self._streak(), 1)

    def test_warns_on_streak_1_5_10_only(self):
        warned = []
        for n in range(1, 12):
            rc, out = self._call(self._p())
            self.assertEqual(rc, 0)
            if out:
                warned.append(n)
            self.assertEqual(self._streak(), n)
        self.assertEqual(warned, [1, 5, 10])

    def test_no_drift_clears_streak_and_saves(self):
        for _ in range(3):
            self._call(self._p())
        rc, out = self._call(self._p(), changed=["app.py", "docs/CHANGELOG.md"])
        self.assertEqual((rc, out), (0, ""))
        self.assertEqual(self._streak(), 0)
        rc, out = self._call(self._p())  # regression warns immediately
        self.assertTrue(out)
        self.assertEqual(self._streak(), 1)

    def test_empty_diff_is_not_drift(self):
        self.assertEqual(self._call(self._p(), changed=[]), (0, ""))
        self.assertEqual(self._streak(), 0)

    def test_session_change_resets_streak_and_is_recorded(self):
        self._call(self._p(session_id="a"))
        self._call(self._p(session_id="a"))
        rc, out = self._call(self._p(session_id="b"))
        self.assertTrue(out)
        self.assertEqual(self._streak(), 1)
        self.assertEqual(dw._load_state(self.root)["session_id"], "b")

    def test_non_string_session_id_counts_as_empty_session(self):
        self._call(self._p(session_id=None))
        _, out = self._call(self._p(session_id=7))
        self.assertEqual(out, "")  # both "" -> same session, streak 2
        self.assertEqual(self._streak(), 2)
        self.assertNotIn("session_id", dw._load_state(self.root))

    def test_garbage_streak_in_state_restarts_at_one(self):
        for bad in ("x", None, [1], {"a": 1}):
            dw._save_state(self.root, {"session_id": "s", "streak": bad})
            rc, out = self._call(self._p())
            self.assertEqual(rc, 0)
            self.assertEqual(self._streak(), 1, bad)
            self.assertTrue(out, bad)

    def test_numeric_string_streak_is_continued(self):
        dw._save_state(self.root, {"session_id": "s", "streak": "4"})
        _, out = self._call(self._p())
        self.assertTrue(out)  # 5th
        self.assertEqual(self._streak(), 5)

    def test_git_failure_fails_open_with_return_zero_and_no_state(self):
        rc, out = self._call(self._p(), git_error=RuntimeError("no git"))
        self.assertEqual((rc, out), (0, ""))
        self.assertFalse(dw._state_path(self.root).exists())

    def test_silent_exits_return_zero_and_never_touch_git(self):
        cases = [
            ("", None),  # empty stdin
            ("{bad", None),  # invalid json
            ("[1]", None),  # not an object
            ('"s"', None),
            (None, {"cwd": str(self.root)}),  # no tool_input
            (None, {"tool_input": None}),
            (None, {"tool_input": {}}),
            (None, self._p(path="")),
            (None, self._p(path=5)),
            (None, self._p(path=["a"])),
            (None, self._p(path="docs/a.md")),
            (None, self._p(path="x/.atlas/a.json")),
            (None, self._p(path="agent://beta")),
        ]
        faults = mock.MagicMock()
        for raw, payload in cases:
            with mock.patch.dict(sys.modules, {"atlas_faults": faults}):
                rc, out = self._call(payload, raw=raw)
            self.assertEqual((rc, out), (0, ""), (raw, payload))
            self.assertEqual(self.last[0].call_count, 0, (raw, payload))
        # a non-string path is rejected up front, not by tripping the catch-all
        faults.record.assert_not_called()
        self.assertFalse(dw._state_path(self.root).exists())

    def test_alternate_path_keys(self):
        for key in ("path", "notebook_path"):
            payload = {
                "cwd": str(self.root),
                "session_id": "s",
                "tool_input": {key: "app.py"},
            }
            dw._state_path(self.root).unlink(missing_ok=True)
            self.assertTrue(self._call(payload)[1], key)
        # file_path wins: a docs file_path suppresses even with a code path
        payload = {
            "cwd": str(self.root),
            "tool_input": {"file_path": "docs/a.md", "path": "app.py"},
        }
        self.assertEqual(self._call(payload), (0, ""))

    def test_gate_off_case_insensitive(self):
        for v in ("off", "OFF", "Off"):
            with mock.patch.dict(os.environ, {"ATLAS_GATE": v}):
                self.assertEqual(self._call(self._p()), (0, ""), v)
        with mock.patch.dict(os.environ, {"ATLAS_GATE": "on"}):
            self.assertTrue(self._call(self._p())[1])

    def test_no_project_root_is_silent_and_writes_nothing(self):
        self.assertEqual(self._call(self._p(), find=False), (0, ""))
        self.assertEqual(self.last[0].call_count, 0)

    def test_cwd_defaults_to_process_cwd(self):
        payload = {"tool_input": {"file_path": "app.py"}}
        with mock.patch.object(os, "getcwd", return_value=str(self.root)):
            self._call(payload)
        self.assertEqual(self.last[1].call_args.args[0], self.root)

    def test_cwd_from_payload_is_passed_to_find_root(self):
        self._call(self._p())
        self.assertEqual(self.last[1].call_args.args[0], self.root)

    def test_unexpected_error_is_recorded_and_returns_zero(self):
        faults = mock.MagicMock()
        with (
            mock.patch.dict(sys.modules, {"atlas_faults": faults}),
            mock.patch.object(dw, "_load_state", side_effect=ValueError("boom")),
        ):
            rc, out = self._call(self._p())
        self.assertEqual((rc, out), (0, ""))
        name, exc = faults.record.call_args.args
        self.assertEqual((name, type(exc)), ("docs_drift_watch", ValueError))

    def test_fault_recording_failure_is_swallowed(self):
        faults = mock.MagicMock()
        faults.record.side_effect = OSError("disk")
        with (
            mock.patch.dict(sys.modules, {"atlas_faults": faults}),
            mock.patch.object(dw, "_load_state", side_effect=ValueError("boom")),
        ):
            self.assertEqual(self._call(self._p()), (0, ""))

    def test_uri_in_path_defers_to_atlas_db(self):
        db = mock.MagicMock()
        db.is_uri_path.return_value = False
        with mock.patch.dict(sys.modules, {"atlas_db": db}):
            self.assertTrue(self._call(self._p(path="weird://but-not-a-uri"))[1])
        db.is_uri_path.assert_called_once_with("weird://but-not-a-uri")
        db.is_uri_path.return_value = True
        with mock.patch.dict(sys.modules, {"atlas_db": db}):
            self.assertEqual(self._call(self._p(path="agent://x")), (0, ""))

    def test_plain_paths_never_import_atlas_db(self):
        db = mock.MagicMock()
        with mock.patch.dict(sys.modules, {"atlas_db": db}):
            self._call(self._p())
        db.is_uri_path.assert_not_called()


if __name__ == "__main__":
    unittest.main()
