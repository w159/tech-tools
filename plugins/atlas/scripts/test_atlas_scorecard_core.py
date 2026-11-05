"""scorecard.core: spread, latency percentiles, run(), suite_env, free_port, make_project,
db seeding and jsonl_last."""

import _test_isolation  # noqa: F401  (must be first)

import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from scorecard import core  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


class CtxTest(unittest.TestCase):
    def ctx(self, **kw):
        c = core.Ctx(ROOT, **kw)
        self.addCleanup(c.close)
        return c

    def test_default_run_counts(self):
        self.assertEqual(self.ctx(quick=True).n, 5)
        self.assertEqual(self.ctx(quick=False).n, 15)
        self.assertEqual(self.ctx(quick=True, runs=7).n, 7)
        self.assertEqual(self.ctx(runs="3").n, 3)


class StatsTest(unittest.TestCase):
    def test_exact_threshold_is_zero_abs(self):
        self.assertEqual(core.EXACT, {"abs": 0})
        self.assertEqual(core.metric("n", 1, "u")["threshold"], {"abs": 0})
        self.assertEqual(core.skipped("n", "why")["threshold"], {"abs": 0})

    def test_spread(self):
        self.assertEqual(core.spread([]), 0.0)
        self.assertEqual(core.spread([5]), 0.0)
        self.assertEqual(core.spread([10, 10, 10]), 0.0)
        self.assertAlmostEqual(core.spread([10, 12, 20]), (20 - 10) / 12)
        self.assertAlmostEqual(core.spread([20, 10, 12]), (20 - 10) / 12)
        self.assertGreater(core.spread([0, 0, 5]), 1e6)  # zero median guarded, not a ZeroDivisionError

    def test_latency_metrics_use_p50_and_p95(self):
        samples = list(range(101))
        p50, p95 = core.latency_metrics("probe", samples, "g", "cmd", unit_note="n")
        self.assertEqual((p50["name"], p50["value"]), ("probe_p50_ms", 50))
        self.assertEqual((p95["name"], p95["value"]), ("probe_p95_ms", 95))
        self.assertEqual(p50["detail"], {"n": 101})
        self.assertEqual(p50["note"], "n")
        self.assertEqual((p50["group"], p50["remeasure"], p50["unit"]), ("g", "cmd", "ms"))
        self.assertNotIn("note", p95)

    def test_latency_metrics_without_samples_are_skipped(self):
        a, b = core.latency_metrics("probe", [], "g", "cmd")
        self.assertEqual([a["state"], b["state"]], ["skipped", "skipped"])
        self.assertEqual([a["name"], b["name"]], ["probe_p50_ms", "probe_p95_ms"])
        self.assertEqual(a["reason"], "no samples")

    def test_finite(self):
        self.assertTrue(core.finite(3))
        self.assertTrue(core.finite(2.5))
        self.assertFalse(core.finite(float("nan")))
        self.assertFalse(core.finite(float("inf")))
        self.assertFalse(core.finite("3"))


class RunTest(unittest.TestCase):
    def test_captures_streams_rc_and_positive_elapsed_ms(self):
        code = "import sys,time; time.sleep(0.05); print('o'); print('e', file=sys.stderr); sys.exit(4)"
        r = core.run([sys.executable, "-c", code])
        self.assertEqual((r["rc"], r["out"], r["err"]), (4, "o\n", "e\n"))
        self.assertGreater(r["ms"], 30)
        self.assertLess(r["ms"], 5000)

    def test_input_forms(self):
        echo = "import sys; sys.stdout.write(sys.stdin.read())"
        for given, want in (("txt", "txt"), ({"a": 1}, '{"a": 1}'), ([1, 2], "[1, 2]"), (b"raw", "raw")):
            self.assertEqual(core.run([sys.executable, "-c", echo], input=given)["out"], want)

    def test_cwd_and_env(self):
        d = tempfile.mkdtemp()
        r = core.run(
            [sys.executable, "-c", "import os; print(os.getcwd(), os.environ['K'])"],
            env={"K": "v"},
            cwd=d,
        )
        self.assertEqual(r["out"].split(), [os.path.realpath(d), "v"])

    def test_timeout_and_oserror_never_raise(self):
        r = core.run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.2)
        self.assertEqual((r["rc"], r["err"]), ("TIMEOUT", ""))
        r = core.run(["/nonexistent/binary"])
        self.assertEqual((r["rc"], r["out"]), ("OSERROR", ""))
        self.assertTrue(r["err"])

    def test_timeout_keeps_partial_stdout(self):
        code = "import sys,time; print('part', flush=True); time.sleep(5)"
        r = core.run([sys.executable, "-c", code], timeout=1)
        self.assertEqual(r["rc"], "TIMEOUT")
        self.assertIn(r["out"], ("part\n", ""))  # partial output is platform-dependent


class FaultsAndDecisionTest(unittest.TestCase):
    def test_faults_reads_jsonl_skipping_blanks_and_is_empty_on_error(self):
        d = Path(tempfile.mkdtemp())
        self.assertEqual(core.faults(d), [])
        (d / "hook-faults.jsonl").write_text('{"a": 1}\n\n{"b": 2}\n')
        self.assertEqual(core.faults(d), [{"a": 1}, {"b": 2}])
        (d / "hook-faults.jsonl").write_text('{"a": 1}\nnot json\n')
        self.assertEqual(core.faults(d), [])

    def test_hook_decision_non_dict_and_blank_branches(self):
        self.assertEqual(core.hook_decision("[1]"), "other")
        self.assertEqual(core.hook_decision("   "), "allow")
        self.assertEqual(core.hook_decision(None), "allow")
        self.assertEqual(core.hook_decision(json.dumps({"x": 1})), "other")
        self.assertEqual(core.hook_decision("zzz" * 40), "other:" + "zzz" * 20)


class SuiteEnvTest(unittest.TestCase):
    def test_keeps_real_home_and_tmpdir_and_drops_gate_override(self):
        ctx = core.Ctx(ROOT, quick=True)
        self.addCleanup(ctx.close)
        with mock.patch.dict(os.environ, {"HOME": "/real/home", "TMPDIR": "/real/tmp"}):
            env, atlas, home = core.suite_env(ctx, "s")
        self.assertEqual((env["HOME"], env["TMPDIR"]), ("/real/home", "/real/tmp"))
        self.assertNotIn("ATLAS_GATES", env)
        self.assertTrue(env["ATLAS_HOME"].startswith(str(ctx.work)))
        self.assertTrue(str(atlas).startswith(str(ctx.work)))
        self.assertTrue(str(home).startswith(str(ctx.work)))

    def test_unset_real_vars_are_removed_rather_than_left_isolated(self):
        ctx = core.Ctx(ROOT, quick=True)
        self.addCleanup(ctx.close)
        with mock.patch.dict(os.environ):
            os.environ.pop("HOME", None)
            os.environ.pop("TMPDIR", None)
            env, _, _ = core.suite_env(ctx, "s2")
        self.assertNotIn("HOME", env)
        self.assertNotIn("TMPDIR", env)


class FreePortTest(unittest.TestCase):
    def test_returns_a_bindable_ephemeral_port(self):
        port = core.free_port()
        self.assertIsInstance(port, int)
        self.assertGreater(port, 0)
        with socket.socket() as s:
            s.bind(("127.0.0.1", port))


class MakeProjectTest(unittest.TestCase):
    def test_default_is_a_git_repo_with_one_baseline_commit(self):
        root = Path(tempfile.mkdtemp()) / "p"
        root.mkdir()
        self.assertEqual(core.make_project(root), root)
        self.assertTrue((root / ".git").is_dir())
        log = subprocess.run(
            ["git", "-C", str(root), "log", "--format=%s"], capture_output=True, text=True
        ).stdout.split()
        self.assertEqual(log, ["fixture", "baseline"])
        self.assertEqual((root / ".gitignore").read_text(), ".atlas/\n")
        self.assertEqual((root / "src/app.py").read_text(), "x = 1\n")
        mcp = json.loads((root / ".mcp.json").read_text())
        self.assertIn("claude-mem", mcp["mcpServers"])
        status = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain"], capture_output=True, text=True
        ).stdout
        self.assertEqual(status, "")

    def test_rerun_on_existing_tree_is_idempotent(self):
        root = Path(tempfile.mkdtemp()) / "p"
        root.mkdir()
        (root / "src").mkdir()
        core.make_project(root, with_git=False)
        core.make_project(root, with_git=False)
        self.assertTrue((root / ".atlas/evidence").is_dir())

    def test_git_setup_output_never_leaks_to_the_caller(self):
        fake = Path(tempfile.mkdtemp())
        git = fake / "git"
        git.write_text("#!/bin/sh\necho NOISE\necho NOISE >&2\nexit 0\n")
        git.chmod(0o755)
        root = Path(tempfile.mkdtemp()) / "p"
        root.mkdir()
        code = (
            "import sys; from pathlib import Path; sys.path.insert(0, %r); "
            "from scorecard import core; core.make_project(Path(%r))" % (str(Path(__file__).parent), str(root))
        )
        r = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            env={**os.environ, "PATH": f"{fake}{os.pathsep}{os.environ['PATH']}"},
        )
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))

    def test_without_git_has_files_but_no_repo(self):
        root = Path(tempfile.mkdtemp()) / "p"
        root.mkdir()
        core.make_project(root, with_git=False)
        self.assertFalse((root / ".git").exists())
        self.assertTrue((root / "docs/CHANGELOG.md").is_file())
        self.assertTrue((root / ".atlas/.run").is_dir())


class WriteTranscriptTest(unittest.TestCase):
    def test_two_records_with_extra_tools_appended(self):
        p = Path(tempfile.mkdtemp()) / "t.jsonl"
        tool = {"type": "tool_use", "id": "x", "name": "Edit", "input": {}}
        self.assertEqual(core.write_transcript(p, [tool]), str(p))
        rows = [json.loads(x) for x in p.read_text().splitlines()]
        self.assertEqual([r["type"] for r in rows], ["user", "assistant"])
        self.assertEqual(rows[1]["message"]["content"][-1], tool)


class DbSeedTest(unittest.TestCase):
    def setUp(self):
        self.ctx = core.Ctx(ROOT, quick=True)
        self.addCleanup(self.ctx.close)
        self.tmp = Path(tempfile.mkdtemp())

    def test_fill_defaults_only_adds_required_columns_without_default(self):
        conn = sqlite3.connect(":memory:")
        conn.execute(
            "create table t (a integer not null, b text not null, c real not null, "
            "d text, e integer not null default 7, f numeric not null)"
        )
        row = core._fill_defaults(conn, "t", {"a": 9})
        self.assertEqual(row, {"a": 9, "b": "", "c": 0, "f": 0})

    def test_insert_adds_rows_ignores_duplicates_and_no_ops_on_empty(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("create table t (k text primary key, v integer not null, w text not null)")
        core._insert(conn, "t", [])
        core._insert(conn, "t", [{"k": "a", "v": 1}])
        core._insert(conn, "t", [{"k": "a", "v": 2}, {"k": "b", "v": 3}])
        self.assertEqual(
            conn.execute("select k, v, w from t order by k").fetchall(),
            [("a", 1, ""), ("b", 3, "")],
        )

    def test_seed_copy_backs_up_given_db_read_only(self):
        src = self.tmp / "src.db"
        c = sqlite3.connect(src)
        c.execute("create table messages (id integer)")
        c.executemany("insert into messages values (?)", [(1,), (2,), (3,)])
        c.commit()
        c.close()
        ctx = core.Ctx(ROOT, quick=True, db=src)
        self.addCleanup(ctx.close)
        dest = self.tmp / "sub" / "dest.db"
        out = core.seed_db(ctx, dest, self.tmp)
        self.assertEqual(out, {"kind": "copy", "source": str(src.resolve()), "messages": 3})
        self.assertEqual(
            sqlite3.connect(dest).execute("select count(*) from messages").fetchone()[0], 3
        )

    def test_seed_synthetic_builds_deterministic_schema_db(self):
        project = self.tmp / "proj"
        project.mkdir()
        dest = self.tmp / "synthetic.db"
        out = core.seed_db(self.ctx, dest, project)
        self.assertEqual(out, {"kind": "synthetic", "messages": 160 * 40})
        conn = sqlite3.connect(dest)
        count = lambda t: conn.execute(f"select count(*) from {t}").fetchone()[0]
        self.assertEqual(count("session_logs"), 160)
        self.assertEqual(count("tool_calls"), 160 * 30)
        self.assertEqual(count("user_prompts"), 160 * 5)
        self.assertEqual(count("turn_scores"), 80)
        self.assertEqual(count("facets"), 80)
        self.assertEqual(
            conn.execute("select count(distinct agent) from session_logs").fetchone()[0], 2
        )
        self.assertGreaterEqual(count("projects"), 1)

    def test_seed_helper_failure_raises_with_stderr_tail(self):
        project = self.tmp / "proj"
        project.mkdir()
        with mock.patch.object(core, "run", return_value={"rc": 1, "out": "", "err": "kaboom"}):
            with self.assertRaisesRegex(RuntimeError, "seed helper failed: kaboom"):
                core.seed_db(self.ctx, self.tmp / "d.db", project)


class JsonlLastTest(unittest.TestCase):
    def test_last_parseable_line_wins_skipping_trailing_garbage(self):
        self.assertEqual(core.jsonl_last('{"a": 1}\n{"a": 2}\n'), {"a": 2})
        self.assertEqual(core.jsonl_last('{"a": 1}\n{"a": 2}\nnot json\n\n'), {"a": 2})
        self.assertEqual(core.jsonl_last('{"a": 1}\nbad\nworse'), {"a": 1})

    def test_none_when_nothing_parses(self):
        self.assertIsNone(core.jsonl_last(""))
        self.assertIsNone(core.jsonl_last(None))
        self.assertIsNone(core.jsonl_last("nope\nnada"))


if __name__ == "__main__":
    unittest.main()
