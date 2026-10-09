"""Unit tests for atlas_scorecard: diff verdict logic, direction + threshold handling,
skipped/error handling, unstable detection, the JSON schema of a real (cheap) run."""

import _test_isolation  # noqa: F401  (must be first)

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_scorecard as sc  # noqa: E402
from scorecard import core  # noqa: E402
from scorecard.probe_hooks import (  # noqa: E402
    failing_ids,
    parse_summary,
    suite_metrics,
)

ROOT = (
    Path(__file__).resolve().parent.parent
)  # the plugins/atlas tree this file lives in


def m(value, direction="lower", thr=None, state="ok", **kw):
    d = core.metric("x", value, "u", direction, thr or {"abs": 0})
    d["state"] = state
    d.update(kw)
    return d


class VerdictTests(unittest.TestCase):
    def v(self, before, after):
        return sc.verdict(before, after)[0]

    def test_lower_is_better(self):
        self.assertEqual(self.v(m(10), m(4)), "improved")
        self.assertEqual(self.v(m(4), m(10)), "regressed")
        self.assertEqual(self.v(m(4), m(4)), "same")

    def test_higher_is_better(self):
        self.assertEqual(self.v(m(4, "higher"), m(10, "higher")), "improved")
        self.assertEqual(self.v(m(10, "higher"), m(4, "higher")), "regressed")

    def test_exact_flags_any_change_both_ways(self):
        self.assertEqual(self.v(m(533, "exact"), m(533, "exact")), "same")
        self.assertEqual(self.v(m(533, "exact"), m(534, "exact")), "regressed")
        self.assertEqual(self.v(m(533, "exact"), m(500, "exact")), "regressed")

    def test_info_is_never_judged(self):
        self.assertEqual(self.v(m(1, "info"), m(999, "info")), "same")

    def test_absolute_threshold_is_inclusive(self):
        thr = {"abs": 2}
        self.assertEqual(self.v(m(10, thr=thr), m(12, thr=thr)), "same")
        self.assertEqual(self.v(m(10, thr=thr), m(13, thr=thr)), "regressed")
        self.assertEqual(self.v(m(10, thr=thr), m(7, thr=thr)), "improved")

    def test_relative_threshold_scales_with_before(self):
        thr = {"rel": 0.25, "abs": 0}
        self.assertEqual(self.v(m(100, thr=thr), m(125, thr=thr)), "same")
        self.assertEqual(self.v(m(100, thr=thr), m(126, thr=thr)), "regressed")
        self.assertEqual(
            self.v(m(1000, thr=thr), m(1200, thr=thr)), "same"
        )  # 20% of 1000

    def test_timing_floor_absorbs_noise_on_tiny_values(self):
        a, b = (
            core.timing("t", 0.2),
            core.timing("t", 4.0),
        )  # 20x but under the 5 ms floor
        self.assertEqual(self.v(a, b), "same")
        self.assertEqual(
            self.v(core.timing("t", 100), core.timing("t", 140)), "regressed"
        )
        self.assertEqual(
            self.v(core.timing("t", 100), core.timing("t", 60)), "improved"
        )

    def test_zero_before_uses_absolute_floor(self):
        self.assertEqual(self.v(m(0), m(1)), "regressed")
        self.assertEqual(self.v(m(0, "higher"), m(1, "higher")), "improved")

    def test_skipped_is_not_a_regression(self):
        skipped = core.skipped("x", "no bun")
        self.assertEqual(self.v(m(3), skipped), "skipped")
        self.assertEqual(self.v(skipped, m(3)), "skipped")
        self.assertEqual(self.v(skipped, skipped), "skipped")

    def test_unstable_either_side_is_not_compared(self):
        self.assertEqual(self.v(m(1, state="unstable"), m(50)), "skipped")

    def test_error_after_is_always_a_regression(self):
        err = core.skipped("x", "probe crashed", state="error")
        self.assertEqual(self.v(m(3), err), "regressed")
        self.assertEqual(self.v(None, err), "regressed")
        self.assertEqual(self.v(err, err), "regressed")

    def test_missing_after_regresses_and_new_metric_does_not(self):
        self.assertEqual(self.v(m(3), None), "regressed")
        self.assertEqual(self.v(None, m(3)), "new")

    def test_non_numeric_values_compare_by_equality(self):
        self.assertEqual(self.v(m("a"), m("a")), "same")
        self.assertEqual(self.v(m("a"), m("b")), "regressed")


def write_doc(path, metrics):
    doc = {
        "schema": core.SCHEMA_VERSION,
        "meta": {},
        "probes": {},
        "metrics": {x["name"]: x for x in metrics},
    }
    Path(path).write_text(json.dumps(doc))


def named(name, value, **kw):
    out = m(value, **kw)
    out["name"] = name
    return out


class DiffCliTests(unittest.TestCase):
    def run_diff(self, a, b, *extra):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = sc.main(["diff", str(a), str(b), *extra])
        return rc, buf.getvalue()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sc-test-"))
        self.addCleanup(
            lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True)
        )
        self.a, self.b = self.tmp / "a.json", self.tmp / "b.json"

    def test_identical_files_are_all_same_and_exit_zero(self):
        ms = [
            named("fails", 3),
            named("passes", 10, direction="higher"),
            core.skipped("later", "no tmux"),
        ]
        write_doc(self.a, ms)
        rc, out = self.run_diff(self.a, self.a)
        self.assertEqual(rc, 0)
        self.assertNotIn("regressed", out)
        self.assertNotIn("improved", out)
        self.assertIn("same=2", out)
        self.assertIn("skipped=1", out)

    def test_regression_exits_one_and_names_the_metric(self):
        write_doc(self.a, [named("fails", 0), named("passes", 10, direction="higher")])
        write_doc(self.b, [named("fails", 2), named("passes", 12, direction="higher")])
        rc, out = self.run_diff(self.a, self.b)
        self.assertEqual(rc, 1)
        line = next(ln for ln in out.splitlines() if ln.startswith("fails"))
        self.assertIn("regressed", line)
        self.assertIn(
            "improved", next(ln for ln in out.splitlines() if ln.startswith("passes"))
        )

    def test_improvement_alone_exits_zero(self):
        write_doc(self.a, [named("fails", 5)])
        write_doc(self.b, [named("fails", 1)])
        rc, out = self.run_diff(self.a, self.b)
        self.assertEqual(rc, 0)
        self.assertIn("improved=1", out)

    def test_dropped_metric_is_a_regression(self):
        write_doc(self.a, [named("a", 1), named("b", 1)])
        write_doc(self.b, [named("a", 1)])
        rc, out = self.run_diff(self.a, self.b)
        self.assertEqual(rc, 1)
        self.assertIn("metric missing in after", out)

    def test_quiet_prints_only_regressions(self):
        write_doc(self.a, [named("ok", 1), named("bad", 0)])
        write_doc(self.b, [named("ok", 1), named("bad", 4)])
        rc, out = self.run_diff(self.a, self.b, "--quiet")
        self.assertEqual(rc, 1)
        self.assertIn("bad", out)
        self.assertNotIn("ok  ", out)


class RunProbeTests(unittest.TestCase):
    def setUp(self):
        self.ctx = core.Ctx(ROOT, quick=True)
        self.addCleanup(self.ctx.close)

    def test_crashing_probe_becomes_error_metrics_not_a_pass(self):
        def boom(_ctx):
            raise RuntimeError("probe exploded")

        res, _ = sc.run_probe("boom", boom, ["declared_metric"], self.ctx, 1)
        self.assertEqual(res["probe_error.boom"]["state"], "error")
        self.assertIn("probe exploded", res["probe_error.boom"]["reason"])
        self.assertEqual(res["declared_metric"]["state"], "error")
        self.assertIsNone(res["declared_metric"]["value"])

    def test_missing_prerequisite_reports_skipped_with_reason(self):
        def probe(_ctx):
            return [core.skipped("needs_bun", "bun not installed", "tests", "higher")]

        res, _ = sc.run_probe("p", probe, [], self.ctx, 1)
        self.assertEqual(res["needs_bun"]["state"], "skipped")
        self.assertEqual(res["needs_bun"]["reason"], "bun not installed")
        self.assertIsNone(res["needs_bun"]["value"])

    def test_deterministic_disagreement_is_flagged_unstable_with_variance(self):
        calls = iter([3, 5])
        res, _ = sc.run_probe(
            "p", lambda _c: [core.metric("n", next(calls), "u")], [], self.ctx, 2
        )
        self.assertEqual(res["n"]["state"], "unstable")
        self.assertEqual(res["n"]["detail"]["observed"], [3, 5])
        self.assertEqual(res["n"]["detail"]["variance"], 2)

    def test_deterministic_agreement_stays_ok(self):
        res, _ = sc.run_probe(
            "p", lambda _c: [core.metric("n", 7, "u")], [], self.ctx, 3
        )
        self.assertEqual(res["n"]["state"], "ok")

    def test_timing_repeats_take_the_median(self):
        calls = iter([10.0, 90.0, 12.0])
        res, _ = sc.run_probe(
            "p", lambda _c: [core.timing("t", next(calls))], [], self.ctx, 3
        )
        self.assertEqual(res["t"]["value"], 12.0)
        self.assertEqual(res["t"]["detail"]["repeats"], [10.0, 90.0, 12.0])


class CoreTests(unittest.TestCase):
    def test_pct_nearest_rank(self):
        xs = list(range(1, 101))
        self.assertEqual(core.pct(xs, 50), 51)
        self.assertEqual(core.pct(xs, 95), 95)
        self.assertEqual(core.pct([7], 95), 7)
        self.assertIsNone(core.pct([], 50))

    def test_bool_values_are_stored_as_ints(self):
        self.assertEqual(core.metric("b", True, "bool")["value"], 1)

    def test_hook_decision_normalisation(self):
        self.assertEqual(core.hook_decision(""), "allow")
        deny = json.dumps({"hookSpecificOutput": {"permissionDecision": "deny"}})
        self.assertEqual(core.hook_decision(deny), "deny")
        self.assertEqual(core.hook_decision(json.dumps({"decision": "block"})), "block")
        self.assertEqual(
            core.hook_decision(
                json.dumps({"hookSpecificOutput": {"additionalContext": "x"}})
            ),
            "context",
        )
        self.assertTrue(core.hook_decision("not json").startswith("other"))

    def test_safe_project_dir_is_outside_system_temp_roots(self):
        ctx = core.Ctx(ROOT, quick=True)
        self.addCleanup(ctx.close)
        p = core.safe_project_dir(ctx)
        if p is None:
            self.skipTest("no non-temp dir available on this host")
        self.assertFalse(str(p).startswith(("/tmp", "/private/tmp")), p)
        self.assertTrue(p.is_dir())

    def test_iso_env_never_inherits_state_pointers(self):
        import os

        old = {
            k: os.environ.get(k) for k in ("ATLAS_FAKE_LEAK", "HERDR_PANE_ID", "TMUX")
        }
        os.environ.update(ATLAS_FAKE_LEAK="1", HERDR_PANE_ID="w:p1", TMUX="/tmp/x,1,0")
        self.addCleanup(
            lambda: [
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
                for k, v in old.items()
            ]
        )
        ctx = core.Ctx(ROOT, quick=True)
        self.addCleanup(ctx.close)
        env, atlas, home = core.iso_env(ctx, "t")
        for k in ("ATLAS_FAKE_LEAK", "HERDR_PANE_ID", "TMUX"):
            self.assertNotIn(k, env)
        for k in (
            "ATLAS_HOME",
            "ATLAS_DB",
            "ATLAS_DASHBOARD_DB",
            "ATLAS_DOCTOR_STATE",
            "ATLAS_HOOKSTATE_DIR",
            "HOME",
            "TMPDIR",
        ):
            self.assertTrue(env[k].startswith(str(ctx.work)), (k, env[k]))
        self.assertEqual(
            env["ATLAS_DASHBOARD"], "off"
        )  # session_boot must not start a daemon


class ParseSummaryTests(unittest.TestCase):
    def test_pytest_summary(self):
        self.assertEqual(
            parse_summary("====== 3 failed, 1079 passed, 3 skipped in 51.50s ======"),
            (1079, 3, 3, 51.5),
        )
        self.assertEqual(parse_summary("1232 passed in 12.34s"), (1232, 0, 0, 12.34))

    def test_unittest_summary(self):
        text = "Ran 10 tests in 1.500s\n\nFAILED (failures=2, errors=1, skipped=3)\n"
        self.assertEqual(parse_summary(text), (4, 3, 3, 1.5))
        self.assertEqual(parse_summary("Ran 5 tests in 0.1s\n\nOK\n"), (5, 0, 0, 0.1))

    def test_garbage_is_none(self):
        self.assertIsNone(parse_summary("segfault"))

    def test_failing_ids_recorded_and_capped(self):
        out = "FAILED test_a.py::T::t1 - boom\nFAIL: t2 (mod.Cls.t2)\n(fail) bun case\nok\n"
        self.assertEqual(
            failing_ids(out), ["test_a.py::T::t1", "t2 (mod.Cls.t2)", "bun case"]
        )
        many = "\n".join(f"FAILED t{i}" for i in range(50))
        self.assertEqual(len(failing_ids(many)), 20)
        r = {
            "rc": 1,
            "out": "FAILED t.py::x - e\n=== 1 failed, 2 passed in 1.0s ===",
            "err": "",
        }
        fail = next(m for m in suite_metrics("x", r, "c") if m["name"] == "x_fail")
        self.assertEqual(fail["detail"], ["t.py::x"])


class RealRunSchemaTests(unittest.TestCase):
    """Runs the cheap static probes against this tree and validates the output document."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="sc-run-"))
        cls.out = cls.tmp / "out.json"
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            cls.rc = sc.main(
                [
                    "run",
                    "--root",
                    str(ROOT),
                    "--out",
                    str(cls.out),
                    "--only",
                    "hook_drift,mcp_drift,lint",
                ]
            )
        cls.doc = json.loads(cls.out.read_text())

    @classmethod
    def tearDownClass(cls):
        __import__("shutil").rmtree(cls.tmp, ignore_errors=True)

    def test_exit_zero_and_document_shape(self):
        self.assertEqual(self.rc, 0)
        self.assertEqual(self.doc["schema"], core.SCHEMA_VERSION)
        for key in ("root", "python", "wall_s", "metric_count", "states", "started_at"):
            self.assertIn(key, self.doc["meta"])
        self.assertEqual(self.doc["meta"]["metric_count"], len(self.doc["metrics"]))
        self.assertEqual(set(self.doc["probes"]), {"hook_drift", "mcp_drift", "lint"})

    def test_every_metric_has_the_full_schema(self):
        self.assertGreater(len(self.doc["metrics"]), 10)
        for name, mt in self.doc["metrics"].items():
            self.assertEqual(mt["name"], name)
            self.assertEqual(
                {
                    "name",
                    "value",
                    "unit",
                    "direction",
                    "threshold",
                    "remeasure",
                    "state",
                    "group",
                    "deterministic",
                }
                - set(mt),
                set(),
                name,
            )
            self.assertIn(mt["direction"], ("lower", "higher", "exact", "info"), name)
            self.assertIn(mt["state"], ("ok", "skipped", "unstable", "error"), name)
            self.assertIsInstance(mt["threshold"], dict, name)
            self.assertTrue(mt["remeasure"], f"{name} has no remeasure command")
            if mt["state"] == "ok":
                self.assertTrue(core.finite(mt["value"]), name)
            else:
                self.assertTrue(mt.get("reason") or mt.get("detail") is not None, name)

    def test_self_diff_is_all_same(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = sc.main(["diff", str(self.out), str(self.out)])
        self.assertEqual(rc, 0)
        self.assertNotIn("regressed", buf.getvalue())
        self.assertNotIn("improved", buf.getvalue())

    def test_unknown_probe_is_rejected(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            rc = sc.main(
                [
                    "run",
                    "--root",
                    str(ROOT),
                    "--out",
                    str(self.tmp / "x.json"),
                    "--only",
                    "nope",
                ]
            )
        self.assertEqual(rc, 2)
        self.assertIn("unknown probe", err.getvalue())

    def test_root_without_hooks_is_rejected(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            rc = sc.main(
                ["run", "--root", str(self.tmp), "--out", str(self.tmp / "y.json")]
            )
        self.assertEqual(rc, 2)

    def test_merge_updates_only_the_selected_probes(self):
        out = self.tmp / "merge.json"
        doc = json.loads(self.out.read_text())
        doc["metrics"]["sentinel_metric"] = named("sentinel_metric", 1)
        out.write_text(json.dumps(doc))
        with contextlib.redirect_stderr(io.StringIO()):
            rc = sc.main(
                [
                    "run",
                    "--root",
                    str(ROOT),
                    "--out",
                    str(out),
                    "--only",
                    "lint",
                    "--merge",
                ]
            )
        merged = json.loads(out.read_text())
        self.assertEqual(rc, 0)
        self.assertIn("sentinel_metric", merged["metrics"])
        self.assertIn("hook_drift", merged["probes"])


class RegistryTests(unittest.TestCase):
    def test_every_declared_metric_name_is_unique_per_probe_and_probes_resolve(self):
        probes = sc.load_probes()
        self.assertGreaterEqual(len(probes), 20)
        for name, (fn, declared, mod, slow) in probes.items():
            self.assertTrue(callable(fn), name)
            self.assertIn(mod, sc.PROBE_MODULES)
            self.assertEqual(len(declared), len(set(declared)), name)

    def test_every_surface_in_the_brief_has_a_probe(self):
        have = set(sc.load_probes())
        for needed in (
            "hook_latency",
            "failopen_grid",
            "gate_correctness",
            "hook_suite",
            "bun_suite",
            "typecheck",
            "bridge_latency",
            "bridge_hang",
            "dispatch_spec",
            "report_gate",
            "irc_delivery",
            "colony_accuracy",
            "parallel_spawn",
            "board_concurrency",
            "connector_boot",
            "connector_configured_truth",
            "dashboard_api",
            "herd",
            "doctor",
            "mcp_drift",
            "lint",
        ):
            self.assertIn(needed, have)


if __name__ == "__main__":
    unittest.main()
