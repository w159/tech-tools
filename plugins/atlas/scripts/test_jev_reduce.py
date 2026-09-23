"""jev_reduce.py -- the arithmetic layer between typesafe_decide and a report.

Two bugs this file guards, both of which shipped in the first version of
references/jev-decisions.md:

  1. Thresholding a raw Score against a constant, which couples the threshold to
     that rubric's level count. `score >= 1.0` is "adequate" on a 3-level rubric
     and "barely off the floor" on a 10-level one.
  2. Reading `confidence` off a Noul answer. Noul answers do not carry one. A
     rule written against it is unsatisfiable, so it gets skipped or invented.

Everything else here defends the contract that Jev never blocks: a terrible
score still exits 0, and only caller-side mistakes exit non-zero.

Stdlib only.
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "jev_reduce.py"


def _run(stdin: str, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        input=stdin,
        capture_output=True,
        text=True,
    )


def _ok(stdin: str, *args):
    """Run, assert exit 0, return the parsed reduction."""
    result = _run(stdin, *args)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def score(raw, levels, confidence=0.9):
    """A ScoreAnswer as the connector returns it: legend has one entry per level."""
    return {
        "type": "score",
        "score": raw,
        "legend": {str(i): "level %d" % i for i in range(levels)},
        "probabilities": {str(i): 1.0 / levels for i in range(levels)},
        "confidence": confidence,
    }


def noul(value):
    return {"type": "noul", "noul": value}


def choice(picked, probabilities, confidence):
    return {
        "type": "choice",
        "choice": picked,
        "probabilities": probabilities,
        "confidence": confidence,
    }


class NoulHasNoConfidence(unittest.TestCase):
    """Bug 2. The reduction must never hand back a confidence for a Noul."""

    def test_reduced_noul_carries_no_confidence_key(self):
        out = _ok(json.dumps({"answers": {"dup": noul(0.82)}}))
        entry = out["answers"]["dup"]
        self.assertNotIn("confidence", entry)
        self.assertEqual(entry["value"], 0.82)
        self.assertEqual(entry["reads"], "yes")

    def test_noul_near_half_is_inconclusive_and_held(self):
        out = _ok(json.dumps({"answers": {"dup": noul(0.52)}}))
        self.assertTrue(out["answers"]["dup"]["inconclusive"])
        self.assertEqual(out["answers"]["dup"]["band"], "hold")

    def test_noul_away_from_half_is_actionable_in_both_directions(self):
        out = _ok(json.dumps({"answers": {"hi": noul(0.95), "lo": noul(0.05)}}))
        self.assertEqual(out["answers"]["hi"]["band"], "act")
        self.assertEqual(out["answers"]["hi"]["reads"], "yes")
        self.assertEqual(out["answers"]["lo"]["band"], "act")
        self.assertEqual(out["answers"]["lo"]["reads"], "no")

    def test_a_confidence_rule_cannot_be_aimed_at_a_noul(self):
        r = _run(
            json.dumps({"answers": {"dup": noul(0.8)}}),
            "--thresholds",
            json.dumps({"dup": {"normalized_below": 0.5}}),
        )
        # normalized_* on a noul produces no normalized value; it is reported, not silently passed.
        self.assertEqual(r.returncode, 0, r.stderr)
        tripped = json.loads(r.stdout)["tripped"]
        self.assertEqual(len(tripped), 1)
        self.assertIn("could not normalize", tripped[0]["note"])


class Normalization(unittest.TestCase):
    """Bug 1. The same raw score means different things at different level counts."""

    def test_same_raw_score_normalizes_differently_per_rubric(self):
        out = _ok(json.dumps({"answers": {"three": score(1, 3), "ten": score(1, 10)}}))
        self.assertAlmostEqual(out["answers"]["three"]["normalized"], 0.5)
        self.assertAlmostEqual(out["answers"]["ten"]["normalized"], 1 / 9)

    def test_top_and_bottom_levels_normalize_to_one_and_zero(self):
        out = _ok(json.dumps({"answers": {"top": score(4, 5), "bottom": score(0, 5)}}))
        self.assertAlmostEqual(out["answers"]["top"]["normalized"], 1.0)
        self.assertAlmostEqual(out["answers"]["bottom"]["normalized"], 0.0)

    def test_falls_back_to_probabilities_when_legend_is_missing(self):
        answer = score(2, 5)
        del answer["legend"]
        out = _ok(json.dumps({"answers": {"s": answer}}))
        self.assertEqual(out["answers"]["s"]["levels"], 5)
        self.assertAlmostEqual(out["answers"]["s"]["normalized"], 0.5)

    def test_unnormalizable_score_is_reported_not_guessed(self):
        out = _ok(json.dumps({"answers": {"s": {"type": "score", "score": 2}}}))
        entry = out["answers"]["s"]
        self.assertNotIn("normalized", entry)
        self.assertIn("cannot normalize", entry["reason"])


class ConfidenceBands(unittest.TestCase):
    def test_three_bands_split_on_floor_and_act(self):
        payload = json.dumps(
            {
                "answers": {
                    "low": score(1, 3, confidence=0.3),
                    "mid": score(1, 3, confidence=0.6),
                    "high": score(1, 3, confidence=0.9),
                }
            }
        )
        out = _ok(payload)
        self.assertEqual(out["answers"]["low"]["band"], "hold")
        self.assertEqual(out["answers"]["mid"]["band"], "confirm")
        self.assertEqual(out["answers"]["high"]["band"], "act")

    def test_raising_act_for_a_riskier_action_downgrades_the_band(self):
        payload = json.dumps({"answers": {"pick": choice("a", {"a": 0.8, "b": 0.2}, 0.75)}})
        self.assertEqual(_ok(payload)["answers"]["pick"]["band"], "act")
        self.assertEqual(_ok(payload, "--act", "0.85")["answers"]["pick"]["band"], "confirm")

    def test_choice_reports_separation_from_the_runner_up(self):
        out = _ok(json.dumps({"answers": {"pick": choice("a", {"a": 0.6, "b": 0.3}, 0.7)}}))
        self.assertAlmostEqual(out["answers"]["pick"]["separation"], 2.0)


class Thresholds(unittest.TestCase):
    def test_standard_set_trips_on_the_documented_conditions(self):
        payload = json.dumps(
            {
                "answers": {
                    "type_safety": score(0, 3),  # normalized 0.0 -> below 0.5
                    "duplication": noul(0.85),  # above 0.7
                    "simplicity": score(1, 3),  # normalized 0.5 -> inside 0.34..0.67
                    "frailty": score(2, 3),  # normalized 1.0 -> not below 0.5
                }
            }
        )
        tripped = {t["id"] for t in _ok(payload, "--standard")["tripped"]}
        self.assertEqual(tripped, {"type_safety", "duplication"})

    def test_standard_set_skips_ids_this_batch_did_not_ask(self):
        out = _ok(json.dumps({"answers": {"frailty": score(0, 3)}}), "--standard")
        self.assertEqual([t["id"] for t in out["tripped"]], ["frailty"])

    def test_simplicity_trips_at_both_ends_of_its_band(self):
        low = _ok(json.dumps({"answers": {"simplicity": score(0, 3)}}), "--standard")
        high = _ok(json.dumps({"answers": {"simplicity": score(2, 3)}}), "--standard")
        self.assertEqual([t["id"] for t in low["tripped"]], ["simplicity"])
        self.assertEqual([t["id"] for t in high["tripped"]], ["simplicity"])

    def test_a_tripped_threshold_still_exits_zero(self):
        """Jev never blocks. A bad score is a note, not a gate failure."""
        r = _run(json.dumps({"answers": {"frailty": score(0, 3)}}), "--standard")
        self.assertEqual(r.returncode, 0)
        self.assertTrue(json.loads(r.stdout)["tripped"])

    def test_explicit_threshold_naming_an_absent_id_is_a_caller_bug(self):
        r = _run(
            json.dumps({"answers": {"frailty": score(0, 3)}}),
            "--thresholds",
            json.dumps({"nope": {"normalized_below": 0.5}}),
        )
        self.assertEqual(r.returncode, 2)
        self.assertIn("not in the answers", r.stderr)


class Composite(unittest.TestCase):
    def test_weighted_mean_of_normalized_dimensions(self):
        payload = json.dumps({"answers": {"a": score(2, 3), "b": score(0, 3)}})
        out = _ok(payload, "--weights", json.dumps({"a": 0.75, "b": 0.25}))
        # a normalizes to 1.0, b to 0.0 -> 0.75
        self.assertAlmostEqual(out["composite"]["value"], 0.75)

    def test_weights_need_not_sum_to_one(self):
        payload = json.dumps({"answers": {"a": score(2, 3), "b": score(0, 3)}})
        out = _ok(payload, "--weights", json.dumps({"a": 3, "b": 1}))
        self.assertAlmostEqual(out["composite"]["value"], 0.75)

    def test_composite_reports_its_parts_so_it_stays_reviewable(self):
        payload = json.dumps({"answers": {"a": score(2, 3), "b": score(0, 3)}})
        out = _ok(payload, "--weights", json.dumps({"a": 1, "b": 1}))
        self.assertEqual(set(out["composite"]["parts"]), {"a", "b"})
        self.assertAlmostEqual(out["composite"]["parts"]["a"]["normalized"], 1.0)

    def test_weighting_a_noul_is_refused(self):
        r = _run(
            json.dumps({"answers": {"dup": noul(0.9)}}),
            "--weights",
            json.dumps({"dup": 1}),
        )
        self.assertEqual(r.returncode, 2)
        self.assertIn("only Score answers can be weighted", r.stderr)

    def test_weight_naming_an_absent_answer_is_refused(self):
        r = _run(
            json.dumps({"answers": {"a": score(1, 3)}}),
            "--weights",
            json.dumps({"b": 1}),
        )
        self.assertEqual(r.returncode, 2)


class InputHandling(unittest.TestCase):
    def test_accepts_the_full_typesafe_decide_envelope(self):
        payload = json.dumps(
            {
                "provider": "typesafe",
                "model": "jev-latest",
                "answers": {"a": score(1, 3)},
                "usage": {"input_tokens": 10, "output_tokens": 0},
            }
        )
        self.assertIn("a", _ok(payload)["answers"])

    def test_accepts_a_bare_answers_map(self):
        self.assertIn("a", _ok(json.dumps({"a": score(1, 3)}))["answers"])

    def test_malformed_json_exits_non_zero(self):
        r = _run("{not json")
        self.assertEqual(r.returncode, 2)
        self.assertIn("not valid JSON", r.stderr)

    def test_empty_stdin_exits_non_zero(self):
        self.assertEqual(_run("").returncode, 2)

    def test_one_unreadable_answer_does_not_sink_the_batch(self):
        payload = json.dumps({"answers": {"good": score(1, 3), "bad": {"type": "mystery"}}})
        out = _ok(payload)
        self.assertEqual(out["answers"]["bad"]["type"], "unreadable")
        self.assertAlmostEqual(out["answers"]["good"]["normalized"], 0.5)

    def test_boolean_is_not_accepted_as_a_score(self):
        """bool is an int subclass in Python; JSON `true` is malformed, not 1."""
        out = _ok(json.dumps({"answers": {"s": {"type": "score", "score": True}}}))
        self.assertEqual(out["answers"]["s"]["type"], "unreadable")


if __name__ == "__main__":
    unittest.main()
