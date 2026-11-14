"""More atlas_status_segment tests: refresh_gates, main, caching, wording, root lookup."""

import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402
import atlas_status_segment as m  # noqa: E402

NOW = 1_800_000_000


def seg(**kw):
    base = dict(phase="implement", done=2, total=6, live=3, gates_failing=0,
                last_verified_age_s=240, scoring="ok", scoring_detail="")
    base.update(kw)
    return base


class TmpCase(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)
        self.tmp = Path(self._t.name)


class Age(unittest.TestCase):
    def test_units(self):
        self.assertEqual(m._age(None), "never")
        self.assertEqual(m._age(0), "0s")
        self.assertEqual(m._age(59), "59s")
        self.assertEqual(m._age(60), "1m")
        self.assertEqual(m._age(3599), "59m")
        self.assertEqual(m._age(3600), "1h")
        self.assertEqual(m._age(86399), "23h")
        self.assertEqual(m._age(86400), "1d")
        self.assertEqual(m._age(3 * 86400 + 5), "3d")

    def test_negative_clamped(self):
        self.assertEqual(m._age(-30), "0s")


class Render(unittest.TestCase):
    def test_plain_exact(self):
        self.assertEqual(
            m.render_text(seg(), color=False),
            "atlas  implement 2/6 · 3 live · gates ✔ · verified 4m · scoring ok")

    def test_no_color_has_no_escapes(self):
        self.assertNotIn("\x1b", m.render_text(seg(scoring="error", gates_failing=2), color=False))

    def test_color_wraps_pieces(self):
        t = m.render_text(seg())
        self.assertIn(m.CYAN + "implement 2/6" + m.R, t)
        self.assertIn(m.GREEN + "gates ✔" + m.R, t)
        self.assertIn(m.GREEN + "scoring ok" + m.R, t)
        self.assertIn(m.DIM + " · " + m.R, t)

    def test_unknown_gates(self):
        t = m.render_text(seg(gates_failing=None), color=True)
        self.assertIn(m.DIM + "gates ?" + m.R, t)

    def test_failing_gates_red(self):
        self.assertIn(m.RED + "gates ✖3" + m.R, m.render_text(seg(gates_failing=3)))

    def test_scoring_stale_yellow(self):
        self.assertIn(m.YELLOW + "scoring stale" + m.R, m.render_text(seg(scoring="stale")))

    def test_scoring_error_with_and_without_detail(self):
        self.assertTrue(m.render_text(
            seg(scoring="error", scoring_detail="api 500"), color=False).endswith("scoring error (api 500)"))
        self.assertTrue(m.render_text(seg(scoring="error"), color=False).endswith("scoring error"))

    def test_zero_total_shows_bare_phase(self):
        t = m.render_text(seg(total=0, done=0, phase="idle"), color=False)
        self.assertEqual(t[:21], "atlas  idle · 3 live ")

    def test_verified_never(self):
        self.assertIn("verified never", m.render_text(seg(last_verified_age_s=None), color=False))


class FindRoot(TmpCase):
    def test_walks_up_to_atlas_dir(self):
        (self.tmp / "p" / ".atlas").mkdir(parents=True)
        deep = self.tmp / "p" / "a" / "b"
        deep.mkdir(parents=True)
        self.assertEqual(m.find_root(str(deep), str(self.tmp / "h")), str((self.tmp / "p").resolve()))

    def test_none_without_atlas(self):
        (self.tmp / "q").mkdir()
        self.assertIsNone(m.find_root(str(self.tmp / "q"), str(self.tmp / "h")))

    def test_home_itself_is_skipped(self):
        (self.tmp / "h" / ".atlas").mkdir(parents=True)
        (self.tmp / "h" / "sub").mkdir()
        self.assertIsNone(m.find_root(str(self.tmp / "h" / "sub"), str(self.tmp / "h")))


class FindRootBounds(TmpCase):
    def test_stray_atlas_in_system_temp_is_not_a_root(self):
        tmpd = self.tmp / "systmp"
        (tmpd / ".atlas").mkdir(parents=True)
        (tmpd / "proj").mkdir()
        with mock.patch("tempfile.gettempdir", return_value=str(tmpd)):
            self.assertIsNone(m.find_root(str(tmpd / "proj"), str(self.tmp / "h")))

    def test_system_temp_is_a_root_when_it_is_the_cwd(self):
        tmpd = self.tmp / "systmp"
        (tmpd / ".atlas").mkdir(parents=True)
        with mock.patch("tempfile.gettempdir", return_value=str(tmpd)):
            self.assertEqual(m.find_root(str(tmpd), str(self.tmp / "h")), str(tmpd.resolve()))

    def test_system_temp_with_git_marker_is_a_root(self):
        tmpd = self.tmp / "systmp"
        (tmpd / ".atlas").mkdir(parents=True)
        (tmpd / ".git").mkdir()
        (tmpd / "proj").mkdir()
        with mock.patch("tempfile.gettempdir", return_value=str(tmpd)):
            self.assertEqual(m.find_root(str(tmpd / "proj"), str(self.tmp / "h")), str(tmpd.resolve()))

    def test_search_stops_at_home(self):
        # a .atlas ABOVE home must not be found from a cwd under home
        (self.tmp / ".atlas").mkdir()
        (self.tmp / "h" / "proj").mkdir(parents=True)
        self.assertIsNone(m.find_root(str(self.tmp / "h" / "proj"), str(self.tmp / "h")))


class SegmentShapes(TmpCase):
    def proj(self, **files):
        root, home = self.tmp / "proj", self.tmp / "home"
        run = root / ".atlas" / ".run"
        run.mkdir(parents=True)
        (home / ".atlas").mkdir(parents=True)
        for name, raw in files.items():
            (run / name).write_text(raw if isinstance(raw, str) else json.dumps(raw))
        return str(root), str(home), run

    def line(self, root, home, now=NOW):
        return m.line_for(root, home=home, color=False, now=now)

    def test_todos_list(self):
        root, home, _ = self.proj(**{"todos.json": []})
        self.assertTrue(self.line(root, home).startswith("atlas  idle"))

    def test_channels_empty_list(self):
        root, home, _ = self.proj(**{"channels.json": []})
        self.assertIn("0 live", self.line(root, home))

    def test_channels_list_valued(self):
        root, home, _ = self.proj(**{"channels.json": {"channels": []}})
        self.assertIn("0 live", self.line(root, home))

    def test_members_null_and_joined_garbage(self):
        chans = {"channels": {"a": {"members": None},
                              "b": {"members": [{"role": "w", "joined": "abc"},
                                                {"role": "w", "joined": NOW - 5}]},
                              "c": None}}
        root, home, _ = self.proj(**{"channels.json": chans})
        self.assertIn("1 live", self.line(root, home))

    def test_findings_not_a_list(self):
        root, home, _ = self.proj(**{"findings.json": {"x": 1}})
        self.assertIn("verified never", self.line(root, home))

    def test_items_not_a_list(self):
        root, home, _ = self.proj(**{"todos.json": {"items": 5}})
        self.assertTrue(self.line(root, home).startswith("atlas  idle"))

    def test_truncated_todos_not_cached(self):
        root, home, run = self.proj(**{"todos.json": '{"last_session_id": "s1", "items": [{"sta'})
        self.assertTrue(self.line(root, home).startswith("atlas  idle"))
        good = {"items": [{"status": "in_progress", "phase": "implement"}]}
        (run / "todos.json").write_text(json.dumps(good))
        self.assertTrue(self.line(root, home, NOW + 1).startswith("atlas  implement"))

    def test_cache_invalidated_when_progress_changes(self):
        def todos(done):
            items = [{"status": "completed" if i < done else "pending", "session_id": "s1"} for i in range(2)]
            return {"last_session_id": "s1", "items": items}
        root, home, run = self.proj(**{"todos.json": todos(1)})
        self.assertIn("1/2", self.line(root, home))
        (run / "todos.json").write_text(json.dumps(todos(2)))
        self.assertIn("2/2", self.line(root, home, NOW + 1))


class IsoEpoch(unittest.TestCase):
    def test_parse_and_bad(self):
        self.assertEqual(m._iso_epoch("1970-01-01T00:00:10+00:00"), 10.0)
        self.assertIsNone(m._iso_epoch("garbage"))
        self.assertIsNone(m._iso_epoch(None))


class Json(TmpCase):
    def test_default_on_missing_and_bad(self):
        self.assertEqual(m._json(str(self.tmp / "no"), {"d": 1}), {"d": 1})
        (self.tmp / "bad").write_text("{")
        self.assertEqual(m._json(str(self.tmp / "bad"), []), [])
        (self.tmp / "ok").write_text('{"a": 2}')
        self.assertEqual(m._json(str(self.tmp / "ok"), None), {"a": 2})


class RefreshGates(TmpCase):
    def run_refresh(self, groups):
        out = json.dumps({"groups": groups})
        with mock.patch.object(m.subprocess, "run", return_value=mock.Mock(stdout=out)) as r, \
                mock.patch.object(m.time, "time", return_value=1234.5):
            m.refresh_gates("/proj", "sess", str(self.tmp))
        return r

    def test_counts_failing_lines_and_group_errors(self):
        groups = [
            {"lines": [{"ok": True}, {"ok": False}, {"ok": False}]},
            {"lines": [{"ok": True}], "error": "boom"},
            {"lines": []},
        ]
        r = self.run_refresh(groups)
        data = json.loads(Path(m._gates_path(str(self.tmp), "/proj", "sess")).read_text())
        self.assertEqual(data, {"at": 1234.5, "failing": 3})
        cmd = r.call_args[0][0]
        self.assertEqual(cmd[0], sys.executable)
        self.assertTrue(cmd[1].endswith("atlas_gates.py"))
        self.assertEqual(cmd[2:], ["--root", "/proj", "--session", "sess", "--json"])
        self.assertTrue(r.call_args[1]["capture_output"])
        self.assertTrue(r.call_args[1]["text"])
        self.assertEqual(r.call_args[1]["timeout"], 30)

    def test_all_ok_is_zero(self):
        self.run_refresh([{"lines": [{"ok": True}]}])
        data = json.loads(Path(m._gates_path(str(self.tmp), "/proj", "sess")).read_text())
        self.assertEqual(data["failing"], 0)

    def test_bad_output_raises(self):
        with mock.patch.object(m.subprocess, "run", return_value=mock.Mock(stdout="nope")):
            with self.assertRaises(ValueError):
                m.refresh_gates("/proj", "sess", str(self.tmp))
        self.assertFalse(Path(m._gates_path(str(self.tmp), "/proj", "sess")).exists())


class PruneStaleCaches(TmpCase):
    DAY = 86400

    def touch(self, name, age_days):
        d = self.tmp / ".atlas"
        d.mkdir(exist_ok=True)
        f = d / name
        f.write_text("{}")
        t = m.time.time() - age_days * self.DAY
        m.os.utime(f, (t, t))
        return f

    def refresh(self):
        out = json.dumps({"groups": []})
        with mock.patch.object(m.subprocess, "run", return_value=mock.Mock(stdout=out)):
            m.refresh_gates("/proj", "sess", str(self.tmp))

    def test_old_caches_pruned_fresh_and_unrelated_kept(self):
        old_g = self.touch("status-gates-aaaaaaaaaaaa.json", 30)
        old_s = self.touch("status-segment-bbbbbbbbbbbb.json", 30)
        new_g = self.touch("status-gates-cccccccccccc.json", 1)
        new_s = self.touch("status-segment-dddddddddddd.json", 1)
        db = self.touch("atlas.db", 30)
        other = self.touch("status-other.json", 30)
        note = self.touch("status-gates-notes.txt", 30)
        self.refresh()
        self.assertFalse(old_g.exists())
        self.assertFalse(old_s.exists())
        for keep in (new_g, new_s, db, other, note):
            self.assertTrue(keep.exists(), keep.name)

    def test_file_being_written_survives_even_if_old_mtime_race(self):
        mine = Path(m._gates_path(str(self.tmp), "/proj", "sess"))
        self.touch(mine.name, 30)
        self.refresh()
        self.assertTrue(mine.exists())
        self.assertEqual(json.loads(mine.read_text())["failing"], 0)

    def test_races_and_errors_tolerated(self):
        self.touch("status-gates-aaaaaaaaaaaa.json", 30)
        with mock.patch.object(m.os, "remove", side_effect=PermissionError):
            self.refresh()
        with mock.patch.object(m.os, "scandir", side_effect=OSError):
            self.refresh()
        self.assertTrue(Path(m._gates_path(str(self.tmp), "/proj", "sess")).exists())

    def test_hot_path_never_prunes(self):
        old = self.touch("status-gates-aaaaaaaaaaaa.json", 30)
        with mock.patch.object(m.subprocess, "Popen"):
            m.segment(str(self.tmp), 1e9, session="s", home=str(self.tmp))
            m._gates(str(self.tmp), "/proj", "s", 1e9)
        self.assertTrue(old.exists())


class GatesPath(unittest.TestCase):
    def test_key_is_sha_of_root_and_session(self):
        k = hashlib.sha256(b"/r|s").hexdigest()[:12]
        self.assertEqual(m._gates_path("/h", "/r", "s"), "/h/.atlas/status-gates-%s.json" % k)
        self.assertNotEqual(m._gates_path("/h", "/r", "s"), m._gates_path("/h", "/r", "t"))


class Gates(TmpCase):
    def test_no_session_is_unknown_without_spawn(self):
        with mock.patch.object(m.subprocess, "Popen") as p:
            self.assertIsNone(m._gates(str(self.tmp), "/r", None, NOW))
        p.assert_not_called()

    def test_fresh_cache_returns_value_no_spawn(self):
        path = Path(m._gates_path(str(self.tmp), "/r", "s"))
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"at": NOW - 59, "failing": 4}))
        with mock.patch.object(m.subprocess, "Popen") as p:
            self.assertEqual(m._gates(str(self.tmp), "/r", "s", NOW), 4)
        p.assert_not_called()

    def test_stale_cache_spawns_detached_refresh(self):
        path = Path(m._gates_path(str(self.tmp), "/r", "s"))
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"at": NOW - 60, "failing": 1}))
        with mock.patch.object(m.subprocess, "Popen") as p:
            self.assertEqual(m._gates(str(self.tmp), "/r", "s", NOW), 1)
        cmd = p.call_args[0][0]
        self.assertEqual(cmd[2:], ["--refresh-gates", "/r", "s", "--home", str(self.tmp)])
        self.assertTrue(p.call_args[1]["start_new_session"])
        self.assertEqual(p.call_args[1]["stdout"], subprocess.DEVNULL)

    def test_missing_cache_unknown_and_spawns(self):
        with mock.patch.object(m.subprocess, "Popen") as p:
            self.assertIsNone(m._gates(str(self.tmp), "/r", "s", NOW))
        p.assert_called_once()

    def test_spawn_failure_swallowed(self):
        with mock.patch.object(m.subprocess, "Popen", side_effect=OSError):
            self.assertIsNone(m._gates(str(self.tmp), "/r", "s", NOW))

    def test_non_int_failing_is_unknown(self):
        path = Path(m._gates_path(str(self.tmp), "/r", "s"))
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"at": NOW, "failing": "2"}))
        self.assertIsNone(m._gates(str(self.tmp), "/r", "s", NOW))


class SegmentCache(TmpCase):
    def project(self, items=None, channels=None, findings=None):
        run = self.tmp / "proj" / ".atlas" / ".run"
        run.mkdir(parents=True)
        (run / "todos.json").write_text(json.dumps({"last_session_id": "s1", "items": items or []}))
        if channels is not None:
            (run / "channels.json").write_text(json.dumps({"channels": channels}))
        if findings is not None:
            (run / "findings.json").write_text(json.dumps(findings))
        return str(self.tmp / "proj"), str(self.tmp / "home")

    def test_cache_hit_returns_cached_seg_within_60s_when_inputs_unchanged(self):
        root, home = self.project()
        first = m.segment(root, NOW, home=home)
        with mock.patch.object(m, "_scoring", side_effect=AssertionError("recomputed")):
            self.assertEqual(m.segment(root, NOW + 59, home=home), first)

    def test_changed_input_invalidates_cache_within_60s(self):
        root, home = self.project()
        m.segment(root, NOW, home=home)
        (Path(root) / ".atlas" / ".run" / "todos.json").write_text(json.dumps(
            {"last_session_id": "s1", "items": [{"status": "completed", "session_id": "s1"}]}))
        self.assertEqual(m.segment(root, NOW + 59, home=home)["total"], 1)

    def test_cache_expires_at_60s(self):
        root, home = self.project()
        m.segment(root, NOW, home=home)
        (Path(root) / ".atlas" / ".run" / "todos.json").write_text(json.dumps(
            {"last_session_id": "s1", "items": [{"status": "completed", "session_id": "s1"}]}))
        self.assertEqual(m.segment(root, NOW + 60, home=home)["total"], 1)

    def test_cache_written_with_timestamp(self):
        root, home = self.project()
        s = m.segment(root, NOW, home=home)
        key = hashlib.sha256(("%s|s1" % root).encode()).hexdigest()[:12]
        data = json.loads((Path(home) / ".atlas" / ("status-segment-%s.json" % key)).read_text())
        self.assertEqual(data["at"], NOW)
        self.assertEqual(data["seg"], s)
        self.assertIn("sig", data)

    def test_unwritable_cache_does_not_raise(self):
        root, home = self.project()
        with mock.patch.object(m.os, "makedirs", side_effect=OSError):
            self.assertEqual(m.segment(root, NOW, home=home)["phase"], "idle")

    def test_filters_archived_advisor_and_other_session(self):
        mk = lambda **kw: {**dict(status="completed", session_id="s1", origin="manual"), **kw}
        items = [mk(), mk(archived=True), mk(origin="advisor"), mk(session_id="zzz"),
                 dict(status="pending", session_id="s1", origin="manual")]
        root, home = self.project(items)
        s = m.segment(root, NOW, home=home)
        self.assertEqual((s["done"], s["total"]), (1, 2))

    def test_explicit_session_overrides_last_session(self):
        items = [dict(status="completed", session_id="s2", origin="x"),
                 dict(status="completed", session_id="s1", origin="x")]
        root, home = self.project(items)
        self.assertEqual(m.segment(root, NOW, session="s2", home=home)["total"], 1)

    def test_no_session_counts_all_sessions(self):
        run = self.tmp / "proj" / ".atlas" / ".run"
        run.mkdir(parents=True)
        (run / "todos.json").write_text(json.dumps({"items": [
            dict(status="completed", session_id="a"), dict(status="pending", session_id="b")]}))
        with mock.patch.object(m.subprocess, "Popen"):
            s = m.segment(str(self.tmp / "proj"), NOW, home=str(self.tmp / "home"))
        self.assertEqual(s["total"], 2)
        self.assertIsNone(s["gates_failing"])

    def test_phase_defaults_idle_when_in_progress_has_no_phase(self):
        root, home = self.project([dict(status="in_progress", session_id="s1")])
        self.assertEqual(m.segment(root, NOW, home=home)["phase"], "idle")

    def test_first_in_progress_phase_wins(self):
        items = [dict(status="in_progress", session_id="s1", phase="plan"),
                 dict(status="in_progress", session_id="s1", phase="test")]
        root, home = self.project(items)
        self.assertEqual(m.segment(root, NOW, home=home)["phase"], "plan")

    def test_live_counts_only_recent_unended_non_leads(self):
        members = [
            dict(role="lead", joined=NOW - 10),
            dict(role="subagent", joined=NOW - 10),
            dict(role="subagent", joined=NOW - 10, ended_at=NOW - 1),
            dict(role="subagent", joined=NOW - 21600),       # exactly at limit: crashed
            dict(role="subagent", joined=NOW - 21600 + 1),   # just inside
            dict(role="subagent"),                                  # joined 0: ancient
        ]
        root, home = self.project(channels={"c": {"members": members}})
        self.assertEqual(m.segment(root, NOW, home=home)["live"], 2)

    def test_live_sums_across_channels(self):
        mem = [dict(role="subagent", joined=NOW - 5)]
        root, home = self.project(channels={"a": {"members": mem}, "b": {"members": mem}})
        self.assertEqual(m.segment(root, NOW, home=home)["live"], 2)

    def test_last_verified_uses_newest_verified_only(self):
        from datetime import datetime, timezone
        iso = lambda age: datetime.fromtimestamp(NOW - age, timezone.utc).isoformat()
        findings = [dict(status="verified", verified_at=iso(500)),
                    dict(status="verified", verified_at=iso(100)),
                    dict(status="open", verified_at=iso(5)),
                    dict(status="verified", verified_at="junk"),
                    "not a dict"]
        root, home = self.project(findings=findings)
        self.assertEqual(m.segment(root, NOW, home=home)["last_verified_age_s"], 100)


class ScoringNoDb(TmpCase):
    def test_missing_db_ok(self):
        self.assertEqual(m._scoring(str(self.tmp), NOW), ("ok", ""))

    def test_unreadable_db_ok(self):
        (self.tmp / ".atlas").mkdir()
        (self.tmp / ".atlas" / "atlas.db").write_text("not sqlite")
        self.assertEqual(m._scoring(str(self.tmp), NOW), ("ok", ""))

    def test_error_without_status_code_uses_label_truncated(self):
        import sqlite3
        (self.tmp / ".atlas").mkdir()
        c = sqlite3.connect(str(self.tmp / ".atlas" / "atlas.db"))
        c.execute("CREATE TABLE turn_scores (scored_at REAL, label TEXT, judgment TEXT, kind TEXT)")
        c.execute("INSERT INTO turn_scores VALUES (?,?,?,?)", (NOW - 1, "x" * 40, "scoring_error", "error"))
        c.commit(); c.close()
        self.assertEqual(m._scoring(str(self.tmp), NOW), ("error", "x" * 24))

    def test_error_with_no_good_rows_at_all(self):
        import sqlite3
        (self.tmp / ".atlas").mkdir()
        c = sqlite3.connect(str(self.tmp / ".atlas" / "atlas.db"))
        c.execute("CREATE TABLE turn_scores (scored_at REAL, label TEXT, judgment TEXT, kind TEXT)")
        c.execute("INSERT INTO turn_scores VALUES (?,?,?,?)", (NOW - 1, "error 503 x", "scoring_error", "error"))
        c.commit(); c.close()
        self.assertEqual(m._scoring(str(self.tmp), NOW), ("error", "api 503"))

    def test_stale_boundary(self):
        import sqlite3
        (self.tmp / ".atlas").mkdir()
        c = sqlite3.connect(str(self.tmp / ".atlas" / "atlas.db"))
        c.execute("CREATE TABLE turn_scores (scored_at REAL, label TEXT, judgment TEXT, kind TEXT)")
        c.execute("INSERT INTO turn_scores VALUES (?,?,?,?)", (NOW - 86400, None, "v", "score"))
        c.commit(); c.close()
        self.assertEqual(m._scoring(str(self.tmp), NOW), ("ok", ""))
        c = sqlite3.connect(str(self.tmp / ".atlas" / "atlas.db"))
        c.execute("UPDATE turn_scores SET scored_at = ?", (NOW - 86400 - 1,))
        c.execute("INSERT INTO turn_scores VALUES (?,?,?,?)", (NOW - 10, None, "r", "metric"))
        c.commit(); c.close()
        self.assertEqual(m._scoring(str(self.tmp), NOW), ("stale", "no score in 24h"))


class LineFor(TmpCase):
    def project(self):
        (self.tmp / "p" / ".atlas" / ".run").mkdir(parents=True)
        return str(self.tmp / "p"), str(self.tmp / "home")

    def test_color_flag_respected(self):
        root, home = self.project()
        plain = m.line_for(root, home=home, color=False, now=NOW)
        colored = m.line_for(root, home=home, color=True, now=NOW)
        self.assertEqual(plain, "atlas  idle · 0 live · gates ? · verified never · scoring ok")
        self.assertIn("\x1b[", colored)

    def test_default_is_colored(self):
        root, home = self.project()
        self.assertIn("\x1b[", m.line_for(root, home=home, now=NOW))

    def test_never_raises(self):
        with mock.patch.object(m, "find_root", side_effect=RuntimeError):
            self.assertEqual(m.line_for("/x"), "")

    def test_empty_when_no_atlas(self):
        self.assertEqual(m.line_for(str(self.tmp), home=str(self.tmp)), "")


class Main(TmpCase):
    def test_text_prints_line(self):
        (self.tmp / "p" / ".atlas").mkdir(parents=True)
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = m.main(["--text", str(self.tmp / "p"), "--home", str(self.tmp / "h"),
                         "--plain", "--now", str(NOW)])
        self.assertEqual(rc, 0)
        self.assertEqual(buf.getvalue(),
                         "atlas  idle · 0 live · gates ? · verified never · scoring ok\n")

    def test_text_without_atlas_prints_nothing(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = m.main(["--text", str(self.tmp), "--home", str(self.tmp), "--plain"])
        self.assertEqual((rc, buf.getvalue()), (0, ""))

    def test_text_colored_by_default(self):
        (self.tmp / "p" / ".atlas").mkdir(parents=True)
        buf = io.StringIO()
        with redirect_stdout(buf):
            m.main(["--text", str(self.tmp / "p"), "--home", str(self.tmp / "h"), "--now", str(NOW)])
        self.assertIn("\x1b[", buf.getvalue())

    def test_session_passed_through(self):
        with mock.patch.object(m, "line_for", return_value="X") as lf, redirect_stdout(io.StringIO()):
            m.main(["--text", "/c", "--session", "S", "--home", "/h", "--plain", "--now", "5"])
        lf.assert_called_once_with("/c", "S", "/h", False, 5.0)

    def test_refresh_gates_success_and_failure(self):
        with mock.patch.object(m, "refresh_gates") as rg:
            self.assertEqual(m.main(["--refresh-gates", "/r", "S", "--home", "/h"]), 0)
        rg.assert_called_once_with("/r", "S", "/h")
        with mock.patch.object(m, "refresh_gates", side_effect=RuntimeError):
            self.assertEqual(m.main(["--refresh-gates", "/r", "S", "--home", "/h"]), 1)

    def test_no_args_is_noop_zero(self):
        self.assertEqual(m.main([]), 0)


if __name__ == "__main__":
    unittest.main()
