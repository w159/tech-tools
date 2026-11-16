"""Offline tests for atlas_decision_eval.py: scoring from the stored cache makes no model call."""

import gc
import json
import os
import subprocess
import sys
import tempfile
import unittest
import warnings
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import _test_isolation  # noqa: F401,E402
import atlas_decision_eval as ev  # noqa: E402


class StatsTest(unittest.TestCase):
    def test_wilson_known_values(self):
        lo, hi = ev.wilson(25, 25)
        self.assertAlmostEqual(lo, 0.8668, places=3)
        self.assertAlmostEqual(hi, 1.0, places=6)
        lo, hi = ev.wilson(17, 25)
        self.assertAlmostEqual(lo, 0.4840, places=3)
        self.assertEqual(ev.wilson(0, 0), (0.0, 0.0))

    def test_percentile(self):
        self.assertEqual(ev.percentile([1, 2, 3, 4, 5], 50), 3)
        self.assertAlmostEqual(ev.percentile([0, 10], 95), 9.5)
        self.assertIsNone(ev.percentile([], 50))


def _cp(stdout: str, rc: int = 0):
    return subprocess.CompletedProcess([], rc, stdout=stdout, stderr="")


class ClaudeCallTest(unittest.TestCase):
    def test_prompt_goes_on_stdin_not_argv(self):
        prompt = "-rf is not a flag, fix the thing"
        ok = json.dumps({"structured_output": {"label": "fix"}, "total_cost_usd": 0.01})
        with mock.patch.object(ev.subprocess, "run", return_value=_cp(ok)) as run:
            ev.claude_call("opus", "sys", prompt, {"type": "object"})
        cmd, kw = run.call_args.args[0], run.call_args.kwargs
        self.assertNotIn(prompt, cmd)
        self.assertEqual(kw.get("input"), prompt)

    def test_failed_call_cost_is_unknown_not_zero(self):
        for side in (subprocess.TimeoutExpired("claude", 1), OSError("no claude")):
            with mock.patch.object(ev.subprocess, "run", side_effect=side):
                r = ev.claude_call("opus", "s", "u", {})
            self.assertIsNone(r["usd"])
            self.assertTrue(r["error"])
        with mock.patch.object(ev.subprocess, "run", return_value=_cp("not json", rc=1)):
            r = ev.claude_call("opus", "s", "u", {})
        self.assertIsNone(r["usd"])
        self.assertTrue(r["error"])

    def test_success_cost_is_the_cli_total(self):
        ok = json.dumps({"structured_output": {"label": "fix"}, "total_cost_usd": 0.0123})
        with mock.patch.object(ev.subprocess, "run", return_value=_cp(ok)):
            r = ev.claude_call("opus", "s", "u", {})
        self.assertEqual(r["usd"], 0.0123)
        self.assertIsNone(r["error"])

    def test_cli_error_payload_is_an_error(self):
        bad = json.dumps({"is_error": True, "result": "boom", "total_cost_usd": 0.002})
        with mock.patch.object(ev.subprocess, "run", return_value=_cp(bad)):
            r = ev.claude_call("opus", "s", "u", {})
        self.assertTrue(r["error"])
        self.assertIsNone(r["obj"])


class RunCacheTest(unittest.TestCase):
    def _files(self, tmp):
        dset = {"rows": [{"id": "x1", "prompt": "fix the crash", "votes": {"a": "fix", "b": "fix"}}]}
        sp, cp = os.path.join(tmp, "set.json"), os.path.join(tmp, "cache.json")
        ev._save(sp, dset)
        ev._save(cp, {"answers": {}, "spend": []})
        return sp, cp

    def test_failed_call_is_not_cached_and_cost_stays_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            sp, cp = self._files(tmp)
            fail = {"answers": None, "latency_s": 9.0, "usd": None, "error": "TimeoutExpired"}
            with mock.patch.object(ev, "decision_call", return_value=fail):
                ev.main(["run", "--backend", "haiku", "--set", sp, "--cache", cp])
            cache = ev._load(cp, None)
        self.assertNotIn("x1", cache["answers"].get("haiku", {}))
        self.assertEqual(len(cache["spend"]), 1)
        self.assertIsNone(cache["spend"][0]["usd"])

    def test_successful_call_is_cached(self):
        with tempfile.TemporaryDirectory() as tmp:
            sp, cp = self._files(tmp)
            ok = {"answers": {"task_class": {"choice": "fix", "confidence": 0.9}}, "latency_s": 1.0, "usd": 0.01, "error": None}
            with mock.patch.object(ev, "decision_call", return_value=ok):
                ev.main(["run", "--backend", "haiku", "--set", sp, "--cache", cp])
            cache = ev._load(cp, None)
        self.assertEqual(cache["answers"]["haiku"]["x1"]["usd"], 0.01)


class OwnersAndIoTest(unittest.TestCase):
    def test_wilson_and_threshold_come_from_their_owners(self):
        import done_claim
        import prompt_decision

        self.assertIs(ev.wilson, done_claim.wilson_interval)
        self.assertFalse(hasattr(ev, "ROUTE_CONFIDENCE_MIN"), "local copy of the threshold")
        dset = {"rows": [{"id": "a", "prompt": "fix the crash in a.py", "label": "fix"}]}
        cache = {"answers": {"m": {"a": {"answers": {"task_class": {"choice": "fix", "confidence": 0.6}}, "latency_s": 1.0}}}}
        self.assertEqual(ev.score(dset, cache)["backends"]["m"]["confident"], 0)
        with mock.patch.object(prompt_decision, "ROUTE_CONFIDENCE_MIN", 0.5):
            self.assertEqual(ev.score(dset, cache)["backends"]["m"]["confident"], 1)

    def test_save_is_atomic_and_leaves_no_temp_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "c.json")
            ev._save(path, {"v": 1})
            with mock.patch.object(ev.json, "dump", side_effect=RuntimeError("disk full")):
                with self.assertRaises(RuntimeError):
                    ev._save(path, {"v": 2})
            self.assertEqual(ev._load(path, None), {"v": 1})
            self.assertEqual(os.listdir(tmp), ["c.json"])

    def test_no_unclosed_file_handles(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write_transcript(tmp, "projA", ["Please review the billing module for races"])
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                ev.tuning_text()
                ev.mine(tmp)
                gc.collect()
        self.assertEqual([w for w in caught if issubclass(w.category, ResourceWarning)], [])


def _write_transcript(root: str, project: str, texts: list) -> None:
    d = os.path.join(root, project)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "s.jsonl"), "w", encoding="utf-8") as fh:
        for t in texts:
            fh.write(json.dumps({"type": "user", "message": {"content": t}}) + "\n")


class MineTest(unittest.TestCase):
    def test_seeded_sample_is_reproducible_and_not_the_first_n(self):
        texts = ["%s task %s: please look at module %s" % (w, w * 2, w[::-1]) for w in
                 ["omega", "sigma", "kappa", "theta", "gamma", "lambda", "zeta", "eta", "iota", "nu", "mu", "xi",
                  "pi", "rho", "tau", "phi", "chi", "psi", "upsilon", "beta"]]
        with tempfile.TemporaryDirectory() as tmp:
            _write_transcript(tmp, "p1", texts)
            a = ev.mine(tmp, limit=5, seed=1)
            b = ev.mine(tmp, limit=5, seed=1)
            c = ev.mine(tmp, limit=5, seed=2)
            full = ev.mine(tmp, limit=50, seed=1)
        self.assertEqual(a["seed"], 1)
        self.assertEqual([r["prompt"] for r in a["rows"]], [r["prompt"] for r in b["rows"]])
        self.assertNotEqual([r["prompt"] for r in a["rows"]], [r["prompt"] for r in c["rows"]])
        self.assertNotEqual([r["prompt"] for r in a["rows"]], [r["prompt"] for r in full["rows"][:5]])
        self.assertEqual(a["pool"], 20)

    def test_hex_dedup_needs_a_digit(self):
        a = "Compare the decade of results against the baseline numbers"
        b = "Compare the facade of results against the baseline numbers"
        c = "Fix bug abc123def in the module that handles the big queue"
        d = "Fix bug 9f8e7d6c in the module that handles the big queue"
        with tempfile.TemporaryDirectory() as tmp:
            _write_transcript(tmp, "p1", [a, b, c, d])
            res = ev.mine(tmp)
        prompts = [r["prompt"] for r in res["rows"]]
        self.assertIn(a, prompts)
        self.assertIn(b, prompts, "facade collapsed into decade")
        self.assertEqual(sum(1 for p in prompts if p.startswith("Fix bug")), 1)

    def test_src_is_a_short_hash_of_the_project_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write_transcript(tmp, "-home-user-secret-project", ["Please review the billing module for races"])
            res = ev.mine(tmp)
        src = res["rows"][0]["src"]
        self.assertRegex(src, r"^[0-9a-f]{8}$")
        self.assertNotIn("secret", src)

    def test_committed_set_has_hashed_src(self):
        for r in ev._load(ev.SET_PATH, {"rows": []})["rows"]:
            self.assertRegex(r["src"], r"^[0-9a-f]{8}$", r["id"])


class McNemarTest(unittest.TestCase):
    def test_exact_values(self):
        self.assertEqual(ev.mcnemar_exact(0, 0), 1.0)
        self.assertEqual(ev.mcnemar_exact(3, 3), 1.0)
        self.assertAlmostEqual(ev.mcnemar_exact(5, 0), 0.0625)
        self.assertAlmostEqual(ev.mcnemar_exact(2, 8), 0.109375)
        self.assertAlmostEqual(ev.mcnemar_exact(8, 2), 0.109375)

    def test_report_prints_mcnemar_for_each_backend(self):
        dset, cache = ev._load(ev.SET_PATH, None), ev._load(ev.CACHE_PATH, None)
        res = ev.score(dset, cache)
        text = ev.format_report(res, dset, cache)
        for name in ("haiku", "sonnet"):
            m = res["backends"][name]
            self.assertIn("p", m["mcnemar_vs_keyword"])
            self.assertIn("p", m["combined_mcnemar_vs_keyword"])
            self.assertIn("McNemar exact, %s vs keyword" % name, text)
            self.assertIn("McNemar exact, hook-combined %s vs keyword" % name, text)


class TimeoutTest(unittest.TestCase):
    def test_slow_calls_fall_back_to_keyword(self):
        pd, poc = ev._hooks()
        prompt = "fix the crash in a.py"
        kw = poc.classify_scope(prompt)[0]
        label = next(c for c in pd.scope_classes() if c != kw)
        dset = {"rows": [{"id": "a", "prompt": prompt, "label": label}, {"id": "b", "prompt": prompt, "label": label}]}
        ans = {"task_class": {"choice": label, "confidence": 0.95}}
        cache = {"answers": {"m": {
            "a": {"answers": ans, "latency_s": 1.0}, "b": {"answers": ans, "latency_s": pd.TIMEOUT_S + 0.5}}}}
        m = ev.score(dset, cache)["backends"]["m"]
        self.assertEqual(m["over_timeout"], 1)
        self.assertEqual(m["calls"], 2)
        self.assertEqual(m["combined_correct"], 2)
        self.assertEqual(m["combined_timeout_correct"], 1)
        text = ev.format_report(ev.score(dset, cache), dset, {"spend": []})
        self.assertIn("calls over hook TIMEOUT_S (4.0 s): 1/2 = 0.500", text)


class LabelingTest(unittest.TestCase):
    def test_sonnet_is_not_a_labeler(self):
        self.assertNotIn("sonnet", ev.LABELERS)

    def test_matrix_help_covers_every_class_and_is_not_the_router_help(self):
        pd, _ = ev._hooks()
        mh = ev.matrix_help()
        self.assertEqual(set(mh), set(pd.scope_classes()))
        for c, text in mh.items():
            self.assertTrue(text)
            self.assertNotEqual(text, pd._CLASS_HELP.get(c))

    def test_label_prompts_use_the_requested_help_source(self):
        pd, _ = ev._hooks()
        seen = {}

        def fake(model, system, user, schema, timeout=120.0):
            seen["system"] = system
            return {"obj": {"label": "fix"}, "latency_s": 0.1, "usd": 0.0, "error": None}

        with mock.patch.object(ev, "claude_call", fake):
            ev.label_call("opus", "p", "router")
            self.assertIn(pd._CLASS_HELP["fix"], seen["system"])
            ev.label_call("opus", "p", "matrix")
            self.assertNotIn(pd._CLASS_HELP["fix"], seen["system"])
            self.assertIn(ev.matrix_help()["fix"], seen["system"])

    def test_adjudication_keeps_both_votes(self):
        with tempfile.TemporaryDirectory() as tmp:
            sp, cp = os.path.join(tmp, "s.json"), os.path.join(tmp, "c.json")
            ev._save(sp, {"rows": [{"id": "x", "prompt": "p", "votes": {"opus-router": "fix", "opus-matrix": "audit"}}]})
            ev._save(cp, {"answers": {}, "spend": []})
            ok = {"obj": {"label": "audit"}, "latency_s": 0.1, "usd": 0.01, "error": None}
            with mock.patch.object(ev, "adjudicate_call", return_value=ok):
                ev.main(["adjudicate", "--set", sp, "--cache", cp])
            row = ev._load(sp, None)["rows"][0]
        self.assertEqual(row["votes"], {"opus-router": "fix", "opus-matrix": "audit"})
        self.assertEqual((row["label"], row["adjudicated"]), ("audit", True))


class CacheReportTest(unittest.TestCase):
    def test_report_from_stored_cache_makes_no_model_call(self):
        dset, cache = ev._load(ev.SET_PATH, None), ev._load(ev.CACHE_PATH, None)
        self.assertIsNotNone(dset, "decision_eval_set.json missing")
        self.assertIsNotNone(cache, "decision_eval_cache.json missing")
        with mock.patch.object(ev.subprocess, "run", side_effect=AssertionError("model call")):
            res = ev.score(dset, cache)
            text = ev.format_report(res, dset, cache)
        self.assertGreater(res["n"], 0)
        self.assertIn("keyword", res["backends"])
        for name in ("haiku", "sonnet"):
            m = res["backends"][name]
            self.assertEqual(m["n"], res["n"])
            self.assertLessEqual(m["wilson95"][0], m["accuracy"])
            self.assertGreaterEqual(m["wilson95"][1], m["accuracy"])
            self.assertGreater(m["latency_p95_s"], 0)
        self.assertIn("Wilson95", text)
        self.assertIn("confusion", text)

    def test_cli_report_exits_zero(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "atlas_decision_eval.py"), "report"],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("[keyword] accuracy", r.stdout)

    def test_labels_come_from_agreement_or_adjudication(self):
        dset = {"rows": [
            {"id": "a", "votes": {"sonnet": "fix", "opus": "fix"}},
            {"id": "b", "votes": {"sonnet": "fix", "opus": "audit"}},
            {"id": "c", "votes": {"sonnet": "fix", "opus": "audit"}, "label": "audit"},
        ]}
        self.assertEqual(ev.final_labels(dset), {"a": "fix", "c": "audit"})

    def test_set_excludes_tuning_corpus(self):
        dset = ev._load(ev.SET_PATH, {"rows": []})
        tuned = ev.tuning_text()
        for r in dset["rows"]:
            self.assertNotIn(ev._norm(r["prompt"]), tuned, r["id"])

    def test_spend_cap(self):
        s = ev.Spend({"spend": [{"usd": 5.9}]}, 6.0)
        self.assertTrue(s.ok())
        s.log("x", "m", "i", 0.2)
        self.assertFalse(s.ok())


if __name__ == "__main__":
    unittest.main()
