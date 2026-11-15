"""Deterministic parts of atlas_history_bench: no model calls, no network."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_history_bench as hb  # noqa: E402


def task(**kw):
    t = {
        "id": "t1",
        "fail_to_pass": ["a/test_x.py::T::test_one"],
        "test_files": ["a/test_x.py"],
    }
    t.update(kw)
    return t


class ClassifyTests(unittest.TestCase):
    def test_splits_src_and_tests(self):
        rows = [
            "M\tplugins/atlas/hooks/gate.py",
            "M\tplugins/atlas/scripts/test_gate.py",
            "A\tplugins/atlas/hooks/test_new.py",
            "M\tplugins/atlas/README.md",
            "A\tplugins/atlas/scripts/new_module.py",
            "M\tplugins/atlas/scripts/nested/deep.py",
        ]
        src, tests, other = hb.classify_files(rows)
        self.assertEqual(src, ["plugins/atlas/hooks/gate.py"])
        self.assertEqual(
            tests,
            ["plugins/atlas/scripts/test_gate.py", "plugins/atlas/hooks/test_new.py"],
        )
        self.assertEqual(other, 3)

    def test_is_test_path(self):
        for p in ("a/test_x.py", "a/x_test.py", "conftest.py", "a/tests/helper.py"):
            self.assertTrue(hb.is_test_path(p), p)
        for p in ("a/x.py", "a/contest.py", "a/testing_utils.py"):
            self.assertFalse(hb.is_test_path(p), p)


class ParseTests(unittest.TestCase):
    def test_parse_pytest_summary(self):
        text = "\n".join(
            [
                "PASSED a/test_x.py::T::test_one",
                "FAILED a/test_x.py::T::test_two - AssertionError: nope",
                "ERROR a/test_y.py - ImportError",
                "SKIPPED [1] a/test_x.py:9: reason",
                "random noise",
                "3 passed in 0.1s",
            ]
        )
        got = hb.parse_pytest(text)
        self.assertEqual(got["a/test_x.py::T::test_one"], "PASSED")
        self.assertEqual(got["a/test_x.py::T::test_two"], "FAILED")
        self.assertEqual(got["a/test_y.py"], "ERROR")
        self.assertNotIn("3", got)

    def test_fail_to_pass_and_breakage(self):
        before = {"t::a": "FAILED", "t::b": "PASSED", "t::c": "PASSED"}
        after = {"t::a": "PASSED", "t::b": "PASSED", "t::c": "FAILED", "t::d": "PASSED"}
        self.assertEqual(hb.fail_to_pass(before, after), ["t::a", "t::d"])
        self.assertEqual(hb.tests_that_break(before, after), ["t::c"])


class ScoreTests(unittest.TestCase):
    def test_resolved(self):
        out = {
            "a/test_x.py::T::test_one": "PASSED",
            "a/test_x.py::T::test_two": "PASSED",
        }
        r = hb.decide(task(), out, [])
        self.assertTrue(r["resolved"])
        self.assertEqual(r["reasons"], [])

    def test_target_still_failing(self):
        out = {
            "a/test_x.py::T::test_one": "FAILED",
            "a/test_x.py::T::test_two": "PASSED",
        }
        r = hb.decide(task(), out, [])
        self.assertFalse(r["resolved"])
        self.assertEqual(r["f2p_bad"], ["a/test_x.py::T::test_one"])

    def test_other_test_in_touched_file_regressed(self):
        out = {
            "a/test_x.py::T::test_one": "PASSED",
            "a/test_x.py::T::test_two": "FAILED",
        }
        r = hb.decide(task(), out, [])
        self.assertFalse(r["resolved"])
        self.assertEqual(r["file_bad"], ["a/test_x.py::T::test_two"])

    def test_tampering_blocks_resolution_even_when_green(self):
        out = {"a/test_x.py::T::test_one": "PASSED"}
        r = hb.decide(task(), out, ["a/test_x.py"])
        self.assertFalse(r["resolved"])
        self.assertIn("test file modified", r["reasons"][0])

    def test_missing_target_or_empty_run_is_unresolved(self):
        self.assertFalse(hb.decide(task(), {}, [])["resolved"])
        self.assertFalse(
            hb.decide(task(), {"a/test_x.py::T::other": "PASSED"}, [])["resolved"]
        )


class TamperTests(unittest.TestCase):
    def test_manifest_detects_change_add_delete_and_ignores_caches_and_source(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            p = root / "plugins" / "atlas" / "scripts"
            p.mkdir(parents=True)
            (p / "test_a.py").write_text("x = 1\n")
            (p / "test_b.py").write_text("y = 1\n")
            (p / "mod.py").write_text("z = 1\n")
            (p / "__pycache__").mkdir()
            (p / "__pycache__" / "test_c.py").write_text("cache\n")
            base = hb.manifest(root)
            self.assertEqual(
                sorted(base),
                ["plugins/atlas/scripts/test_a.py", "plugins/atlas/scripts/test_b.py"],
            )
            self.assertEqual(hb.modified_tests(base, hb.manifest(root)), [])
            (p / "mod.py").write_text("z = 2\n")
            (p / "__pycache__" / "test_d.py").write_text("more\n")
            self.assertEqual(hb.modified_tests(base, hb.manifest(root)), [])
            (p / "test_a.py").write_text("x = 2\n")
            (p / "test_b.py").unlink()
            (p / "test_new.py").write_text("n = 1\n")
            self.assertEqual(
                hb.modified_tests(base, hb.manifest(root)),
                [
                    "plugins/atlas/scripts/test_a.py",
                    "plugins/atlas/scripts/test_b.py",
                    "plugins/atlas/scripts/test_new.py",
                ],
            )


class StatsTests(unittest.TestCase):
    def test_wilson(self):
        lo, hi = hb.wilson(12, 24)
        self.assertAlmostEqual(lo, 0.3144, places=3)
        self.assertAlmostEqual(hi, 0.6856, places=3)
        self.assertEqual(hb.wilson(0, 0), (0.0, 0.0))
        lo, hi = hb.wilson(24, 24)
        self.assertLess(lo, 1.0)
        self.assertAlmostEqual(hi, 1.0, places=6)

    def test_percentile(self):
        self.assertEqual(hb.percentile([1, 2, 3, 4, 5], 50), 3)
        self.assertAlmostEqual(hb.percentile(list(range(1, 11)), 90), 9.1)
        self.assertIsNone(hb.percentile([], 50))
        self.assertEqual(hb.percentile([7], 90), 7)

    def test_summary_and_paired(self):
        rows = [
            {
                "task": "a",
                "arm": "plain",
                "resolved": True,
                "wall_s": 100,
                "usd": 1.0,
                "tokens": {"input": 1, "cache_read": 2, "cache_write": 3, "output": 4},
            },
            {
                "task": "a",
                "arm": "plain",
                "resolved": False,
                "wall_s": 300,
                "usd": 3.0,
                "timeout": True,
                "tokens": {},
            },
            {
                "task": "a",
                "arm": "atlas",
                "resolved": True,
                "wall_s": 200,
                "usd": 2.0,
                "gate_blocks": 2,
                "tokens": {},
            },
            {
                "task": "a",
                "arm": "atlas",
                "resolved": True,
                "wall_s": 200,
                "usd": 2.0,
                "tokens": {},
            },
            {
                "task": "b",
                "arm": "plain",
                "resolved": True,
                "wall_s": 10,
                "usd": 1.0,
                "tokens": {},
            },
            {
                "task": "b",
                "arm": "atlas",
                "resolved": True,
                "wall_s": 10,
                "usd": 1.0,
                "tokens": {},
            },
        ]
        s = hb.summarize_arm([r for r in rows if r["arm"] == "plain"])
        self.assertEqual((s["n"], s["resolved"], s["timeouts"]), (3, 2, 1))
        self.assertEqual(
            s["tokens"], {"input": 1, "cache_read": 2, "cache_write": 3, "output": 4}
        )
        self.assertAlmostEqual(s["usd_per_resolved"], 2.5)
        s2 = hb.summarize_arm([r for r in rows if r["arm"] == "atlas"])
        self.assertEqual((s2["gate_block_runs"], s2["gate_blocks"]), (1, 2))
        p = {x["task"]: x for x in hb.paired(rows)}
        self.assertEqual(p["a"]["winner"], "atlas")
        self.assertEqual(p["b"]["winner"], "tie")
        self.assertIn("Wilson95", hb.render_report(rows))


class ClaudeParsingTests(unittest.TestCase):
    def stream(self):
        evs = [
            {
                "type": "system",
                "subtype": "init",
                "model": "claude-sonnet-5-5",
                "plugins": [{"name": "cc-x", "path": "builtin"}],
            },
            {
                "type": "assistant",
                "message": {
                    "content": [
                        {"type": "tool_use", "name": "Task"},
                        {"type": "tool_use", "name": "Bash"},
                    ]
                },
            },
            {
                "type": "user",
                "message": {
                    "content": [
                        {
                            "type": "tool_result",
                            "is_error": True,
                            "content": "dispatch_denied:toolkit",
                        }
                    ]
                },
            },
            {
                "type": "user",
                "message": {
                    "content": [
                        {
                            "type": "tool_result",
                            "is_error": True,
                            "content": "plain error",
                        }
                    ]
                },
            },
            {
                "type": "result",
                "total_cost_usd": 0.5,
                "is_error": False,
                "num_turns": 3,
                "usage": {
                    "input_tokens": 1,
                    "cache_read_input_tokens": 2,
                    "cache_creation_input_tokens": 3,
                    "output_tokens": 4,
                },
            },
        ]
        return "\n".join(json.dumps(e) for e in evs) + "\nnot json\n"

    def test_parse_stream(self):
        st = hb.parse_stream(self.stream())
        self.assertEqual(
            (st["tool_calls"], st["agent_calls"], st["gate_blocks"]), (2, 1, 1)
        )
        self.assertEqual(
            hb.tokens_from(st["result"]),
            {"input": 1, "cache_read": 2, "cache_write": 3, "output": 4},
        )

    def test_tokens_prefer_model_usage_across_subagents(self):
        res = {
            "modelUsage": {
                "m1": {
                    "inputTokens": 1,
                    "outputTokens": 2,
                    "cacheReadInputTokens": 3,
                    "cacheCreationInputTokens": 4,
                },
                "m2": {
                    "inputTokens": 10,
                    "outputTokens": 20,
                    "cacheReadInputTokens": 30,
                    "cacheCreationInputTokens": 40,
                },
            },
            "usage": {"input_tokens": 999},
        }
        self.assertEqual(
            hb.tokens_from(res),
            {"input": 11, "cache_read": 33, "cache_write": 44, "output": 22},
        )

    def test_arm_init_checks(self):
        plain_ok = {
            "model": "claude-sonnet-5-5",
            "plugins": [{"name": "cc", "path": "builtin"}],
        }
        self.assertIsNone(hb.assert_arm_init("plain", plain_ok))
        leak = {
            "model": "claude-sonnet-5-5",
            "plugins": [{"name": "atlas", "path": "/x/cache/atlas"}],
        }
        self.assertIn("plain arm loaded", hb.assert_arm_init("plain", leak))
        atlas_ok = {
            "model": "claude-sonnet-5-5",
            "plugins": [
                {"name": "atlas", "path": "/r/plugins/atlas"},
                {"name": "cc", "path": "builtin"},
            ],
        }
        self.assertIsNone(hb.assert_arm_init("atlas", atlas_ok))
        self.assertIn("atlas arm", hb.assert_arm_init("atlas", plain_ok))
        wrong_model = dict(plain_ok, model="claude-opus-9")
        self.assertIn("model", hb.assert_arm_init("plain", wrong_model))


class CommandTests(unittest.TestCase):
    def test_arms_differ_only_by_plugin_dir_and_share_model_and_prompt(self):
        prompt = hb.build_prompt({"statement": "Bug X happens. "})
        self.assertTrue(prompt.endswith(hb.PROMPT_SUFFIX))
        a = hb.arm_cmd("plain", prompt, Path("/r/plugins/atlas"))
        b = hb.arm_cmd("atlas", prompt, Path("/r/plugins/atlas"))
        self.assertEqual(b[: len(a)], a)
        self.assertEqual(b[len(a) :], ["--plugin-dir", "/r/plugins/atlas"])
        self.assertIn(hb.MODEL, a)
        self.assertNotIn("--plugin-dir", a)
        with self.assertRaises(ValueError):
            hb.arm_cmd("other", prompt, Path("/x"))

    def test_env_strips_session_vars_and_sets_isolated_config(self):
        import os

        old = dict(os.environ)
        try:
            os.environ.update(
                {
                    "CLAUDE_CODE_SESSION_ID": "s",
                    "ATLAS_DEPT": "x",
                    "CLAUDE_CODE_PLUGIN_SEED_DIR": "/seed",
                    "KEEPME": "1",
                }
            )
            env = hb.arm_env("plain", Path("/scratch/cfg"), Path("/scratch/state"))
        finally:
            os.environ.clear()
            os.environ.update(old)
        self.assertEqual(env["CLAUDE_CONFIG_DIR"], "/scratch/cfg")
        self.assertEqual(env["CLAUDE_CODE_SYNC_PLUGINS"], "0")
        self.assertEqual(env["ATLAS_HOME"], "/scratch/state")
        self.assertEqual(env["ATLAS_DB"], "/scratch/state/atlas.db")
        self.assertNotIn("CLAUDE_CODE_SESSION_ID", env)
        self.assertNotIn("ATLAS_DEPT", env)
        self.assertNotIn("CLAUDE_CODE_PLUGIN_SEED_DIR", env)
        self.assertEqual(env["KEEPME"], "1")

    def test_plan_order_is_trial_major_and_budget_gate(self):
        runs = hb.plan_runs([{"id": "a"}, {"id": "b"}], ["plain", "atlas"], 2)
        self.assertEqual(
            [(t["id"], a, n) for t, a, n in runs][:4],
            [
                ("a", "plain", 1),
                ("a", "atlas", 1),
                ("b", "plain", 1),
                ("b", "atlas", 1),
            ],
        )
        self.assertEqual(len(runs), 8)
        self.assertTrue(hb.may_launch(0, 2, 40, 2.0))
        self.assertTrue(hb.may_launch(38, 0, 40, 2.0))
        self.assertFalse(hb.may_launch(38.5, 0, 40, 2.0))
        self.assertFalse(hb.may_launch(35, 2, 40, 2.0))


class ValidateTaskTests(unittest.TestCase):
    """validate_task against a throwaway git repo: proves failing-before, passing-after, and the invalid shapes."""

    def make_repo(self, fixed_src, test_src):
        d = Path(tempfile.mkdtemp())
        run = lambda *a: subprocess.run(
            a, cwd=d, check=True, capture_output=True, text=True
        )  # noqa: E731
        run("git", "init", "-q")
        run("git", "config", "user.email", "t@example.com")
        run("git", "config", "user.name", "t")
        mod = d / "plugins/atlas/scripts"
        mod.mkdir(parents=True)
        (mod / "m.py").write_text("def f():\n    return 1\n")
        run("git", "add", "-A")
        run("git", "commit", "-qm", "base")
        parent = run("git", "rev-parse", "HEAD").stdout.strip()
        (mod / "m.py").write_text(fixed_src)
        (mod / "test_m.py").write_text(test_src)
        run("git", "add", "-A")
        run("git", "commit", "-qm", "fix: f returns 2")
        commit = run("git", "rev-parse", "HEAD").stdout.strip()
        return d, parent, commit

    def fake_runner(self, cwd, targets, timeout=0, tmpdir=None):
        src = (Path(cwd) / "plugins/atlas/scripts/m.py").read_text()
        ok = "return 2" in src
        n = "plugins/atlas/scripts/test_m.py::test_f"
        return {
            "rc": 0 if ok else 1,
            "outcomes": {
                n: "PASSED" if ok else "FAILED",
                "plugins/atlas/scripts/test_m.py::test_keep": "PASSED",
            },
            "timeout": False,
            "tail": "",
        }

    def test_valid_and_invalid(self):
        d, parent, commit = self.make_repo(
            "def f():\n    return 2\n", "def test_f():\n    assert 1\n"
        )
        t = {
            "id": "x",
            "commit": commit,
            "parent": parent,
            "src_files": ["plugins/atlas/scripts/m.py"],
            "test_files": ["plugins/atlas/scripts/test_m.py"],
        }
        with tempfile.TemporaryDirectory() as w:
            ev = hb.validate_task(t, Path(w), repo=d, runner=self.fake_runner)
            self.assertTrue(ev["ok"], ev)
            self.assertEqual(
                ev["fail_to_pass"], ["plugins/atlas/scripts/test_m.py::test_f"]
            )
            self.assertEqual(
                ev["before_failed"], ["plugins/atlas/scripts/test_m.py::test_f"]
            )
            wl = subprocess.run(
                ["git", "worktree", "list"], cwd=d, capture_output=True, text=True
            ).stdout
            self.assertEqual(len(wl.strip().splitlines()), 1)

            # a fix that does not change the source: nothing flips, so the task is invalid
            t2 = dict(t, src_files=[])
            ev2 = hb.validate_task(t2, Path(w), repo=d, runner=self.fake_runner)
            self.assertFalse(ev2["ok"])
            self.assertEqual(ev2["fail_to_pass"], [])

    def test_task_file_shape(self):
        data = (
            json.loads(hb.TASKS_FILE.read_text())
            if hb.TASKS_FILE.exists()
            else {"tasks": []}
        )
        ids = [t["id"] for t in data["tasks"]]
        self.assertEqual(len(ids), len(set(ids)))
        for t in data["tasks"]:
            for k in (
                "id",
                "commit",
                "parent",
                "src_files",
                "test_files",
                "fail_to_pass",
                "statement",
            ):
                self.assertTrue(t.get(k), (t.get("id"), k))
            for f in t["src_files"]:
                self.assertRegex(f, hb.SRC_RE)
            for f in t["test_files"]:
                self.assertTrue(hb.is_test_path(f), f)
            self.assertNotIn(t["commit"][:8], t["statement"])


class PluginLeakTests(unittest.TestCase):
    """The atlas arm must load plugins/atlas as of the task's parent commit, never the working tree."""

    def _repo(self, tmp):
        repo = Path(tmp, "repo")
        (repo / "plugins" / "atlas").mkdir(parents=True)
        (repo / "plugins" / "atlas" / "gate.py").write_text("BUG = True\n")
        (repo / "plugins" / "atlas" / "test_gate.py").write_text("def test_x():\n    assert True\n")

        def g(*a):
            return subprocess.run(
                ["git", "-C", str(repo), "-c", "user.name=b", "-c", "user.email=b@b", *a],
                check=True, capture_output=True, text=True,
            ).stdout.strip()

        g("init", "-q", "-b", "main")
        g("add", ".")
        g("commit", "-q", "-m", "parent")
        parent = g("rev-parse", "HEAD")
        (repo / "plugins" / "atlas" / "gate.py").write_text("BUG = False\n")
        g("commit", "-q", "-am", "fix")
        return repo, parent, g("rev-parse", "HEAD")

    def test_export_has_parent_source_not_fix(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, parent, fix = self._repo(tmp)
            out = hb.export_plugin({"parent": parent}, Path(tmp, "x"), repo)
            self.assertEqual((out / "gate.py").read_text(), "BUG = True\n")
            self.assertEqual((repo / "plugins" / "atlas" / "gate.py").read_text(), "BUG = False\n")

    def test_run_one_passes_parent_export_outside_working_tree_and_cleans_up(self):
        seen = {}

        def fake_claude(arm, prompt, wt, cfg, plugin_dir, timeout, log, state_dir=None):
            seen["dir"] = Path(plugin_dir)
            seen["src"] = (Path(plugin_dir) / "gate.py").read_text()
            seen["cmd"] = hb.arm_cmd(arm, prompt, plugin_dir)
            return {}

        with tempfile.TemporaryDirectory() as tmp:
            repo, parent, fix = self._repo(tmp)
            t = task(parent=parent, commit=fix, test_files=[], statement="Bug. ")
            orig = (hb.run_claude, hb.run_pytest)
            hb.run_claude = fake_claude
            hb.run_pytest = lambda *a, **k: {"outcomes": {}}
            try:
                row = hb.run_one(t, "atlas", 1, Path(tmp, "work"), 5, repo)
                self.assertNotIn("error", row)
            finally:
                hb.run_claude, hb.run_pytest = orig
            d = seen["dir"].resolve()
            for root in (repo.resolve(), hb.REPO.resolve()):
                self.assertNotIn(root, [d, *d.parents])
            self.assertEqual(seen["src"], "BUG = True\n")  # parent's source: the fix is absent
            self.assertEqual(seen["cmd"][seen["cmd"].index("--plugin-dir") + 1], str(seen["dir"]))
            self.assertFalse(seen["dir"].exists())  # export removed after the run


if __name__ == "__main__":
    unittest.main()
