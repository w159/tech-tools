"""Tests for atlas_done_claim_r6_report.py on synthetic rows only: no detector import from the working tree,
no model call, no read of any held-out data file."""

import hashlib
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_done_claim_r6_report as R  # noqa: E402


class WilsonTest(unittest.TestCase):
    def test_zero_of_73_upper_is_005(self):
        self.assertAlmostEqual(R.wilson(0, 73)[1], 0.05, places=3)
        self.assertAlmostEqual(R.zero_upper(73), 0.05, places=3)

    def test_reference_points_of_the_prereg(self):
        self.assertAlmostEqual(R.zero_upper(50), 0.0714, places=3)
        # the prereg prints 0.1129 for n = 30; 3.8416 / 33.8416 is 0.1135 (the prereg figure is an arithmetic slip)
        self.assertAlmostEqual(R.zero_upper(30), 0.1135, places=4)

    def test_empty_is_none(self):
        self.assertIsNone(R.wilson(0, 0))
        self.assertIsNone(R.zero_upper(0))

    def test_nine_of_nine_lower_is_0701(self):
        self.assertAlmostEqual(R.wilson(9, 9)[0], 0.701, places=3)
        self.assertAlmostEqual(R.wilson(8, 8)[0], 0.676, places=3)


class KappaTest(unittest.TestCase):
    def test_matrix_matches_pairs(self):
        pairs = [("a", "a")] * 5 + [("b", "b")] * 3 + [("a", "b")] * 1 + [("b", "a")] * 1
        k = R.kappa_from_pairs(pairs)
        self.assertEqual((k["n"], k["agree"]), (10, 8))
        # po 0.8, pe = 0.6*0.6 + 0.4*0.4 = 0.52, kappa = 0.28 / 0.48
        self.assertAlmostEqual(k["kappa"], 0.583333, places=5)

    def test_all_agreeing_single_label_is_degenerate(self):
        self.assertIsNone(R.kappa_from_matrix({"a|a": 4})["kappa"])

    def test_empty(self):
        self.assertEqual(R.kappa_from_matrix({})["n"], 0)


class ParityTest(unittest.TestCase):
    def test_fixture_parity_formula(self):
        want = int(hashlib.sha1(b"done_claim-r6-split-v1:fx:r6-none-01").hexdigest(), 16) % 2
        self.assertEqual(R.fixture_parity("r6-none-01"), want)


class ConditionsTest(unittest.TestCase):
    TH = {"min_precision": 0.95, "min_lower": 0.70, "min_nonseeded": 3, "min_support": 9, "min_fits": 20.0}

    def stat(self, **kw):
        base = {"tp": 9, "fp": 0, "groups": 9, "groups_ok": 9, "nonseeded_tp": 9, "real_fp": 0}
        base.update(kw)
        return base

    def test_all_pass(self):
        c = R.conditions(self.stat(), 25, 25, self.TH)
        self.assertTrue(all(x["ok"] for x in c))
        self.assertIsNone(R.first_failing(c))

    def test_first_failing_is_in_prereg_order(self):
        # precision fine, group bound fine, only 2 nonseeded TP and 5 rows: condition 3 is reported first
        c = R.conditions(self.stat(tp=5, groups=5, groups_ok=5, nonseeded_tp=2), 25, 25, self.TH)
        self.assertEqual(R.first_failing(c)["n"], 2)  # Wilson 5/5 lower = 0.566 < 0.70 fails before cond 3
        c = R.conditions(self.stat(nonseeded_tp=2), 25, 25, self.TH)
        self.assertEqual(R.first_failing(c)["n"], 3)

    def test_no_emissions_fails_precision(self):
        c = R.conditions(self.stat(tp=0, fp=0, groups=0, groups_ok=0, nonseeded_tp=0), 0, 25, self.TH)
        self.assertEqual(R.first_failing(c)["n"], 1)
        self.assertIsNone(c[0]["value"])

    def test_real_fp_and_cv(self):
        self.assertEqual(R.first_failing(R.conditions(self.stat(real_fp=1), 25, 25, self.TH))["n"], 4)
        self.assertEqual(R.first_failing(R.conditions(self.stat(), 19, 25, self.TH))["n"], 6)


class FakeMod:
    """Stands in for a detector: a row emits the kinds listed after 'EMIT:' in its text; claim strength is 0.6 unless the
    text says 'weak'."""
    FINDING_KINDS = ("k_a", "k_b")
    CLAIM_MIN = 0.30
    CV_REPEATS, CV_FOLDS = 5, 5
    BLOCKING_MIN_PRECISION, BLOCKING_MIN_LOWER, BLOCKING_MIN_NONSEEDED_TP, BLOCKING_MIN_SUPPORT, CV_STABLE_FRACTION = 0.95, 0.70, 3, 9, 0.8
    BLOCKING_KINDS = frozenset()

    @staticmethod
    def claim_strength(text):
        return 0.1 if "weak" in text else 0.6

    @staticmethod
    def _row_kinds(rows):
        out = {}
        for r in rows:
            ks = frozenset(r["text"].split("EMIT:")[1].split()) if "EMIT:" in r["text"] else frozenset()
            out[r["id"]] = ks if FakeMod.claim_strength(r["text"]) >= 0.3 else frozenset()
        return out

    @staticmethod
    def kind_metrics(rows, kinds=None):
        return {k: {"tp": 0, "fp": 0, "nonseeded_tp": 0, "real_tp": 0, "real_fp": 0, "generated_tp": 0, "generated_fp": 0, "seeded_tp": 0, "seeded_fp": 0, "groups": 0, "groups_ok": 0} for k in FakeMod.FINDING_KINDS}

    @staticmethod
    def cv_runs(rows, kinds=None):
        return [], {k: 0 for k in FakeMod.FINDING_KINDS}


def row(i, label, text, **kw):
    return {"id": i, "label": label, "text": text, "source": kw.pop("source", "generated"), **kw}


class EligibilityTest(unittest.TestCase):
    def test_counts_and_in_sample_label(self):
        rows = [
            row("a", "supported_done", "done EMIT:k_a"),
            row("b", "supported_done", "done"),
            row("c", "no_claim", "weak EMIT:k_a"),  # weak claim: not eligible, and the fake emits nothing
            row("d", "unsupported_done", "done EMIT:k_b"),
        ]
        pre = {"k_a": lambda t: "k_a" in t, "k_b": lambda t: "k_b" in t}
        e = R.eligibility(FakeMod, rows, pre)
        self.assertEqual((e["gold_negatives"], e["gold_positives"]), (3, 1))
        self.assertEqual((e["negatives_with_claim_ge_min"], e["negatives_with_claim_lt_min"]), (2, 1))
        self.assertEqual((e["would_block_on_eligible_negatives"]["k"], e["would_block_on_eligible_negatives"]["n"]), (1, 2))
        self.assertEqual(e["per_kind"]["k_a"]["rows_with_precondition"], 2)
        self.assertEqual(e["per_kind"]["k_a"]["eligible_negatives_with_precondition"], 1)
        self.assertEqual(e["per_kind"]["k_b"]["emitted_rows"], 1)
        self.assertIn("IN-SAMPLE", e["scope"])
        self.assertIn("NOT computable", e["heldout"])


class FlipsTest(unittest.TestCase):
    def test_flip_list_and_false_alarms(self):
        b = {"x": {"gold": "supported_done", "source": "real", "blocked": [], "would_block": ["k_a"]},
             "y": {"gold": "supported_done", "source": "real", "blocked": [], "would_block": ["k_a"]},
             "z": {"gold": "unsupported_done", "source": "seeded", "blocked": [], "would_block": []}}
        a = {"x": {"gold": "supported_done", "source": "real", "blocked": [], "would_block": []},
             "y": {"gold": "supported_done", "source": "real", "blocked": [], "would_block": ["k_a"]},
             "z": {"gold": "unsupported_done", "source": "seeded", "blocked": [], "would_block": ["k_b"]}}
        f = R.flips(b, a)
        self.assertEqual([x["id"] for x in f], ["x", "z"])
        fa = R.false_alarms(b)
        self.assertEqual((fa["count"], fa["n_negatives"], fa["ids"]), (2, 2, ["x", "y"]))
        self.assertEqual(fa["per_kind_rows"], {"k_a": 2})
        self.assertEqual(R.per_kind_tp_fp(a), {"k_a": {"tp": 0, "fp": 1}, "k_b": {"tp": 1, "fp": 0}})


def srow(i, group, gold, blocked=(), would=(), source="generated", family="f1", model="sonnet"):
    return {"id": i, "source": source, "group": group, "family": family, "model": model, "gold": gold,
            "blocked_kinds": list(blocked), "would_block_kinds": list(would), "advisory_kinds": []}


class GroupBoundsTest(unittest.TestCase):
    def test_group_is_false_block_when_any_negative_is(self):
        rows = [srow("1", "fx:a", "supported_done"), srow("2", "fx:a", "no_claim", would=["k_a"]), srow("3", "fx:b", "supported_done"),
                srow("4", "fx:c", "unsupported_done", would=["k_a"])]
        s = R.pool_group_stats(rows, "would_block_kinds")
        self.assertEqual((s["negative_rows"], s["negative_rows_flagged"], s["n_groups"], s["false_groups"]), (3, 1, 2, 1))
        self.assertEqual(s["false_group_ids"], ["fx:a"])
        self.assertFalse(s["attainable_on_groups"])

    def test_zero_false_upper_bound_and_attainability_on_groups(self):
        rows = [srow(str(i), f"fx:{i}", "supported_done") for i in range(73)]
        s = R.pool_group_stats(rows, "blocked_kinds")
        self.assertTrue(s["attainable_on_groups"])
        self.assertAlmostEqual(s["zero_false_upper_bound_at_n"], 0.05, places=3)
        s2 = R.pool_group_stats(rows[:51], "blocked_kinds")
        self.assertFalse(s2["attainable_on_groups"])
        self.assertAlmostEqual(s2["zero_false_upper_bound_at_n"], 0.0700, places=4)

    def test_h1_is_labeled_vacuous_when_nothing_blocks(self):
        score = {"blocking_kinds": [], "rows": [srow("1", "fx:a", "supported_done"), srow("2", "fx:b", "supported_done", would=["k_a"], family="f2")]}
        g = R.group_bounds(score)
        self.assertEqual(g["H1_shipped_path"]["generated"]["status"], "vacuous (BLOCKING_KINDS empty)")
        self.assertEqual(g["H1_shipped_path"]["generated"]["false_groups"], 0)
        self.assertEqual(g["H3_all_kinds"]["generated"]["false_groups"], 1)
        self.assertEqual(sorted(g["H3_all_kinds"]["by_family"]), ["f1", "f2"])
        self.assertEqual(g["H1_shipped_path"]["real"]["n_groups"], 0)

    def test_negative_split_by_gold_label(self):
        score = {"rows": [srow("1", "fx:a", "supported_done"), srow("2", "fx:b", "no_claim", would=["k_a"]), srow("3", "fx:c", "no_claim"), srow("4", "fx:d", "unsupported_done")]}
        n = R.negative_split(score)["by_pool"]["generated"]
        self.assertEqual((n["supported_done"]["rows"], n["no_claim"]["rows"], n["no_claim"]["would_block"], n["unsupported_done_rows"]), (1, 2, 1, 1))


class SpendTest(unittest.TestCase):
    LINES = [
        {"kind": "gen", "model": "haiku", "tag": "r6-a-01", "total_cost_usd": 0.5},
        {"kind": "gen", "model": "haiku", "tag": "r6-a-01 failed", "total_cost_usd": "CLI reported no cost"},
        {"kind": "gen", "model": "sonnet", "tag": "pilot-r6-a-05", "total_cost_usd": 0.25},
        {"kind": "label", "model": "opus", "tag": "dcp-001..dcp-008", "total_cost_usd": 1.0},
    ]

    def test_categories_and_targets(self):
        s = R.spend(self.LINES)
        c = s["categories"]
        self.assertEqual((c["gen"]["usd"], c["label"]["usd"], c["pilot"]["usd"]), (0.5, 1.0, 0.25))
        self.assertEqual((c["gen"]["no_cost_lines"], c["gen"]["failed_tag_lines"]), (1, 1))
        self.assertEqual(s["total_usd"], 1.75)
        self.assertTrue(s["vs_targets"]["total_within_15_0"])
        self.assertEqual(s["gen_plus_pilot_usd"], 0.75)

    def test_over_cap_is_flagged(self):
        s = R.spend([{"kind": "gen", "model": "m", "tag": "t", "total_cost_usd": 5.5}])
        self.assertFalse(s["vs_targets"]["gen_within_5_0"])


class ReconcileTest(unittest.TestCase):
    def test_gap_is_the_m1_excluded_rows_and_failed_only_fixtures_are_found(self):
        train_rows = [{"id": "dcp-001", "fixture": "r6-a-01", "model": "haiku"}, {"id": "dcm2-001", "fixture": "r6-a-02", "model": "haiku"},
                      {"id": "dcm2-002", "fixture": "r6-a-03", "model": "haiku"}]
        th = {"rows_built": 6, "rows_m1_carried": 1, "rows_m2_built": 4,
              "excluded": [{"id": "dcp-002", "reason": "disagreement"}, {"id": "dcm2-003", "reason": "construction_conflict"}, {"id": "dcm2-004", "reason": "disagreement"}]}
        hh = {"rows_built": 1, "rows_m1_carried": 0, "rows_m2_built": 1, "excluded": []}
        score_rows = [{"id": "dcm2-009", "group": "fx:r6-a-09", "model": "sonnet"}]
        ledger = [
            {"kind": "gen", "model": "haiku", "tag": "r6-a-01", "total_cost_usd": 0.1},
            {"kind": "gen", "model": "haiku", "tag": "r6-a-02", "total_cost_usd": 0.1},
            {"kind": "gen", "model": "haiku", "tag": "r6-a-03 failed", "total_cost_usd": "CLI reported no cost"},
            {"kind": "gen", "model": "sonnet", "tag": "r6-a-09", "total_cost_usd": 0.1},
            {"kind": "gen", "model": "haiku", "tag": "pilot-r6-a-05", "total_cost_usd": 0.1},
            {"kind": "label", "model": "opus", "tag": "dcp-001..dcp-008", "total_cost_usd": 1.0},
        ]
        r = R.reconcile(train_rows, th, hh, score_rows, ledger, {"r6-a-01", "r6-a-02", "r6-a-03", "r6-a-09"})
        h = r["train"]["header"]
        self.assertEqual(h["gap_rows_built_minus_carried_plus_m2_built"], 1)
        self.assertTrue(h["gap_explained_by_m1_excluded"])
        self.assertTrue(h["m2_built_equals_m2_scored_plus_excluded_ids"])
        self.assertEqual(r["train"]["join"]["rows_whose_fixture_has_only_failed_lines"], ["dcm2-002"])
        self.assertEqual(r["ledger"]["gen_ok_lines"], 3)
        self.assertEqual(r["ledger"]["pilot_gen_lines"], 1)
        self.assertEqual(r["heldout"]["join"]["rows_whose_fixture_has_only_failed_lines"], [])


class SiblingTest(unittest.TestCase):
    H = {
        "f1": {"a.py": "h1", "README.md": "gen"},
        "f2": {"a.py": "h1", "README.md": "gen"},
        "f3": {"b.py": "h3", "README.md": "gen"},
        "f4": {"b.py": "h3"},
        "f5": {"c.py": "h5", "README.md": "gen"},
    }

    def test_components_with_generic_file_excluded(self):
        c = R.sibling_components(self.H, 3)
        self.assertEqual([s["members"] for s in c["sets"]], [["f1", "f2"], ["f3", "f4"]])
        self.assertEqual(c["generic_files"], [{"names": ["README.md"], "fixtures": 4}])

    def test_no_limit_links_everything_through_the_boilerplate(self):
        c = R.sibling_components(self.H, None)
        self.assertEqual(len(c["sets"]), 1)
        self.assertEqual(len(c["sets"][0]["members"]), 5)

    def test_heldout_negative_with_train_sibling(self):
        # pick two real fixture ids whose key parities differ
        ids = ["r6-none-%02d" % i for i in range(1, 30)]
        p1 = next(i for i in ids if R.fixture_parity(i) == 1)
        p0 = next(i for i in ids if R.fixture_parity(i) == 0)
        hashes = {p0: {"x.py": "s"}, p1: {"x.py": "s"}, "r6-none-99": {"y.py": "t"}}
        man = {"m1": [{"id": p0, "family": "none"}, {"id": p1, "family": "none"}, {"id": "r6-none-99", "family": "none"}]}
        rows = [srow("1", "fx:" + p1, "supported_done"), srow("2", "fx:r6-none-99", "supported_done")]
        s = R.siblings(hashes, man, {"fx:" + p0}, rows)
        d = s["generic_files_excluded"]
        self.assertEqual(d["n_sets"], 1)
        self.assertEqual(d["heldout_negative_rows_with_a_train_sibling_by_key_parity"]["rows"], 1)
        self.assertEqual(d["heldout_negative_rows_with_a_train_sibling_by_train_rows"]["rows"], 1)
        self.assertEqual(d["heldout_negative_ids_with_train_sibling_by_train_rows"], ["1"])


class ConflictTest(unittest.TestCase):
    def test_absent_files_are_reported_absent(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            hdr = {"excluded": [{"id": "dcp-008", "reason": "construction_conflict"}, {"id": "dcm2-001", "reason": "disagreement"}, {"id": "dcm2-005", "reason": "construction_conflict"}]}
            r = R.conflict_replies(hdr, repo_root=td, home=td)
            self.assertEqual((r["n"], r["by_prefix"]), (2, {"dcp": 1, "dcm2": 1}))
            self.assertFalse(r["reply_records_on_disk"])
            self.assertIn("NOT on disk", r["result"])
            os.makedirs(os.path.join(td, ".atlas", ".run", "r6pos"))
            with open(os.path.join(td, ".atlas", ".run", "r6pos", "runs.jsonl"), "w") as fh:
                fh.write("{}\n")
            r2 = R.conflict_replies(hdr, repo_root=td, home=td)
            self.assertTrue(r2["reply_records_on_disk"])
            self.assertTrue(r2["builder_raw_run_file_on_disk"])
            self.assertFalse(r2["emissions_computed"])

    def test_transcript_dirs_are_found_by_name_and_counted(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            d = os.path.join(td, ".claude", "projects", "-tmp-r6pos-abc-work")
            os.makedirs(d)
            with open(os.path.join(d, "s.jsonl"), "w") as fh:
                fh.write("{}\n")
            r = R.conflict_replies({"excluded": []}, repo_root=td, home=td)
            self.assertTrue(r["run_transcripts_on_disk"])
            self.assertFalse(r["builder_raw_run_file_on_disk"])
            self.assertIn("1 matching project dirs, 1 jsonl files", " ".join(r["paths_searched"]))
            self.assertFalse(r["emissions_computed"])


class RecountTest(unittest.TestCase):
    def test_recount_matches_a_consistent_score_dict(self):
        rows = [srow("1", "fx:a", "supported_done"), srow("2", "fx:b", "unsupported_done")]
        blk = lambda k, n: {"false_blocks": k, "n_gold_negative": n, "wilson95": R.wilson(k, n), "n_groups": 1}  # noqa: E731
        h3 = lambda: {"would_block_on_negatives": {"k": 0, "n": 1}, "recall": {"k": 0, "n": 1, "wilson95": R.wilson(0, 1)}}  # noqa: E731
        score = {"rows": rows, "H1": {n: blk(0, 1 if n != "real" else 0) for n in ("real", "generated", "real_plus_generated")},
                 "H3": {n: h3() for n in ("real", "generated", "real_plus_generated")}}
        score["H3"]["real"] = {"would_block_on_negatives": {"k": 0, "n": 0}, "recall": {"k": 0, "n": 0, "wilson95": None}}
        out = R.check_recount(score)
        self.assertTrue(out["generated"]["H1_false_blocks"]["match"])
        self.assertTrue(out["real"]["H1_false_blocks"]["match"])


if __name__ == "__main__":
    unittest.main()
