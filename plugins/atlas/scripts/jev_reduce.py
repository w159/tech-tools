#!/usr/bin/env python3
"""Reduce a `typesafe_decide` result to normalized scores, bands, and composites.

Why this exists: TypeSafe's whole design premise is that the model makes the
judgment and *code* does the arithmetic on it. Every Jev pattern atlas uses
needs the same four operations -- normalize a Score against its own level
count, band an answer by confidence, check it against a threshold, and weight
several dimensions into one composite -- and an agent doing that in prose gets
it wrong in two specific ways:

  1. Comparing a raw `score` to a constant. The raw value is an index into that
     question's levels, so `score < 1.0` means something different the moment
     the rubric gains a level. Normalizing (score / (levels - 1)) fixes it.
  2. Reading `confidence` off a Noul answer. Noul answers do not carry one --
     only Choice and Score do. This script will not emit a confidence band for
     a Noul; it bands on distance from 0.5 instead, which is the only
     uncertainty signal a Noul has.

Contract: Jev never blocks anything in atlas, so a low score, a tripped
threshold, or an inconclusive band all still exit 0. Only malformed input --
unparseable JSON, a weight naming an answer that is not there, a weight on a
non-Score answer -- exits non-zero, because that is a caller bug worth seeing.

Usage:
    typesafe_decide ... | python3 jev_reduce.py
    python3 jev_reduce.py --standard < result.json
    python3 jev_reduce.py --weights '{"type_safety":0.4,"simplicity":0.3,"frailty":0.3}'
    python3 jev_reduce.py --thresholds '{"duplication":{"noul_above":0.7}}'

Reads the result on stdin (or --input PATH). Accepts the full
`{provider,model,answers,usage}` envelope, a bare `{answers:{...}}`, or the
answers map on its own. Writes the reduction to stdout as JSON.

See references/jev-decisions.md (the contract) and references/jev-patterns.md.

Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Confidence bands for Choice/Score. See jev-patterns.md, "Confidence-gated routing":
# these are the floor, not per-action thresholds -- a caller raises ACT for riskier acts.
DEFAULT_FLOOR = 0.5  # below this, do not act on the answer at all
DEFAULT_ACT = 0.7  # at or above this, act without asking

# A Noul has no confidence. Within this margin of 0.5 it is telling you it does not know.
DEFAULT_NOUL_MARGIN = 0.1

BAND_ACT = "act"
BAND_CONFIRM = "confirm"
BAND_HOLD = "hold"

# The standard code-quality set from jev-decisions.md, in normalized terms.
STANDARD_THRESHOLDS = {
    "type_safety": {"normalized_below": 0.5, "note": "type-safety gap"},
    "duplication": {"noul_above": 0.7, "note": "likely duplication"},
    "simplicity": {"normalized_outside": [0.34, 0.67], "note": "not proportionate"},
    "frailty": {"normalized_below": 0.5, "note": "fragile"},
}


class InputError(Exception):
    """Caller-side problem: bad JSON, or a threshold/weight naming something absent."""


def is_number(value: object) -> bool:
    """True for a real number. `bool` is an `int` subclass in Python, and a JSON
    `true` landing in a score field is malformed input, not the number 1."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def extract_answers(payload: object) -> dict:
    """Pull the answers map out of whichever envelope the caller piped in.

    `typesafe_decide` returns {provider, model, answers, usage} verbatim, but
    callers routinely hand over just the answers, or a transport wrapper around
    them. Unwrapping here beats making every caller remember which shape it has.
    """
    if not isinstance(payload, dict):
        raise InputError("expected a JSON object, got %s" % type(payload).__name__)
    answers = payload.get("answers", payload)
    if not isinstance(answers, dict):
        raise InputError("`answers` must be an object mapping question id -> answer")
    if not answers:
        raise InputError("no answers in input")
    return answers


def level_count(answer: dict) -> int | None:
    """How many levels this Score was graded against.

    `legend` is the authoritative map of level -> description. `probabilities`
    carries one entry per level too, so it is a sound fallback when a transport
    dropped the legend. Returns None when neither is usable, in which case the
    answer is reported without a normalized value rather than guessed at.
    """
    for key in ("legend", "probabilities"):
        value = answer.get(key)
        if isinstance(value, dict) and len(value) >= 2:
            return len(value)
    return None


def band_for_confidence(confidence: float, floor: float, act: float) -> str:
    if confidence < floor:
        return BAND_HOLD
    if confidence >= act:
        return BAND_ACT
    return BAND_CONFIRM


def reduce_answer(qid: str, answer: object, opts: argparse.Namespace) -> dict:
    """One answer -> its reduced form. Never raises on answer content; an answer
    it cannot read comes back marked `unreadable` so one odd entry cannot take
    down a whole batch."""
    if not isinstance(answer, dict):
        return {"id": qid, "type": "unreadable", "reason": "answer is not an object"}

    kind = answer.get("type")

    if kind == "noul":
        value = answer.get("noul")
        if not is_number(value):
            return {"id": qid, "type": "unreadable", "reason": "noul is not a number"}
        value = float(value)
        inconclusive = abs(value - 0.5) < opts.noul_margin
        # Deliberately no `confidence` key: a Noul answer does not carry one, and
        # emitting a placeholder is how callers end up thresholding on a fiction.
        # The band is two-valued here for the same reason -- distance from 0.5 says
        # "known" or "not known", and there is no third signal to justify `confirm`.
        return {
            "id": qid,
            "type": "noul",
            "value": value,
            "band": BAND_HOLD if inconclusive else BAND_ACT,
            "reads": "yes" if value > 0.5 else "no",
            "inconclusive": inconclusive,
        }

    if kind == "choice":
        confidence = answer.get("confidence")
        out = {
            "id": qid,
            "type": "choice",
            "choice": answer.get("choice"),
            "confidence": confidence,
        }
        if is_number(confidence):
            out["band"] = band_for_confidence(float(confidence), opts.floor, opts.act)
        else:
            out["band"] = BAND_HOLD
            out["reason"] = "no confidence on the answer"
        probabilities = answer.get("probabilities")
        if isinstance(probabilities, dict) and len(probabilities) >= 2:
            ranked = sorted(probabilities.values(), reverse=True)
            # How decisively the winner beat the runner-up. Near 1.0 means the
            # options did not actually discriminate, even if confidence looks fine.
            out["separation"] = (ranked[0] / ranked[1]) if ranked[1] else None
        return out

    if kind == "score":
        raw = answer.get("score")
        if not is_number(raw):
            return {"id": qid, "type": "unreadable", "reason": "score is not a number"}
        levels = level_count(answer)
        confidence = answer.get("confidence")
        out = {
            "id": qid,
            "type": "score",
            "raw": float(raw),
            "levels": levels,
            "confidence": confidence,
        }
        if levels:
            out["normalized"] = float(raw) / (levels - 1)
        else:
            out["reason"] = "no legend or probabilities; cannot normalize"
        if is_number(confidence):
            out["band"] = band_for_confidence(float(confidence), opts.floor, opts.act)
        else:
            out["band"] = BAND_HOLD
        return out

    return {"id": qid, "type": "unreadable", "reason": "unknown answer type %r" % kind}


def check_thresholds(reduced: dict, thresholds: dict) -> list:
    """Which thresholds tripped. A trip is a note for a human, never a failure."""
    tripped = []
    for qid, rule in thresholds.items():
        if not isinstance(rule, dict):
            raise InputError("threshold for %r must be an object" % qid)
        entry = reduced.get(qid)
        if entry is None:
            raise InputError("threshold names %r, which is not in the answers" % qid)
        note = rule.get("note", "")

        if "noul_above" in rule:
            if entry["type"] != "noul":
                raise InputError("`noul_above` on %r, which is a %s" % (qid, entry["type"]))
            if entry["value"] > rule["noul_above"]:
                tripped.append(
                    {"id": qid, "rule": "noul_above", "limit": rule["noul_above"],
                     "value": entry["value"], "note": note}
                )

        if "noul_below" in rule:
            if entry["type"] != "noul":
                raise InputError("`noul_below` on %r, which is a %s" % (qid, entry["type"]))
            if entry["value"] < rule["noul_below"]:
                tripped.append(
                    {"id": qid, "rule": "noul_below", "limit": rule["noul_below"],
                     "value": entry["value"], "note": note}
                )

        for key in ("normalized_below", "normalized_above", "normalized_outside"):
            if key not in rule:
                continue
            if "normalized" not in entry:
                # Unnormalizable answer: report it rather than silently passing.
                tripped.append(
                    {"id": qid, "rule": key, "value": None,
                     "note": "could not normalize; threshold not evaluated"}
                )
                continue
            value = entry["normalized"]
            limit = rule[key]
            if key == "normalized_below" and value < limit:
                tripped.append({"id": qid, "rule": key, "limit": limit, "value": value, "note": note})
            elif key == "normalized_above" and value > limit:
                tripped.append({"id": qid, "rule": key, "limit": limit, "value": value, "note": note})
            elif key == "normalized_outside":
                if not (isinstance(limit, (list, tuple)) and len(limit) == 2):
                    raise InputError("`normalized_outside` on %r must be [low, high]" % qid)
                low, high = limit
                if value < low or value > high:
                    tripped.append({"id": qid, "rule": key, "limit": [low, high],
                                    "value": value, "note": note})
    return tripped


def composite(reduced: dict, weights: dict) -> dict:
    """Weighted mean of normalized Scores. Weights live here, in atlas, on purpose --
    the model supplies the dimensions, the caller supplies their relative importance."""
    total_weight = 0.0
    accumulated = 0.0
    parts = {}
    for qid, weight in weights.items():
        if not is_number(weight):
            raise InputError("weight for %r is not a number" % qid)
        entry = reduced.get(qid)
        if entry is None:
            raise InputError("weight names %r, which is not in the answers" % qid)
        if entry["type"] != "score":
            raise InputError(
                "weight on %r, which is a %s; only Score answers can be weighted"
                % (qid, entry["type"])
            )
        if "normalized" not in entry:
            raise InputError("weight on %r, which could not be normalized" % qid)
        parts[qid] = {"normalized": entry["normalized"], "weight": float(weight)}
        accumulated += entry["normalized"] * float(weight)
        total_weight += float(weight)
    if total_weight <= 0:
        raise InputError("weights must sum to a positive number")
    # Normalized by total weight so callers do not have to make their weights sum to 1.
    return {"value": accumulated / total_weight, "parts": parts}


def parse_json_arg(raw: str | None, label: str) -> dict:
    if raw is None:
        return {}
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise InputError("--%s is not valid JSON: %s" % (label, exc)) from exc
    if not isinstance(value, dict):
        raise InputError("--%s must be a JSON object" % label)
    return value


def main(argv: list | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Reduce a typesafe_decide result to normalized scores, bands, and composites."
    )
    p.add_argument("--input", help="read the result from this path instead of stdin")
    p.add_argument("--weights", help='JSON map of Score id -> weight, e.g. \'{"frailty":0.5}\'')
    p.add_argument("--thresholds", help="JSON map of id -> rule object")
    p.add_argument(
        "--standard",
        action="store_true",
        help="apply the standard code-quality thresholds from jev-decisions.md",
    )
    p.add_argument("--floor", type=float, default=DEFAULT_FLOOR,
                   help="confidence below this is band=hold (default %(default)s)")
    p.add_argument("--act", type=float, default=DEFAULT_ACT,
                   help="confidence at or above this is band=act (default %(default)s)")
    p.add_argument("--noul-margin", dest="noul_margin", type=float,
                   default=DEFAULT_NOUL_MARGIN,
                   help="a noul within this of 0.5 is inconclusive (default %(default)s)")
    p.add_argument("--compact", action="store_true", help="single-line JSON output")
    args = p.parse_args(argv)

    try:
        if args.input:
            raw = Path(args.input).read_text(encoding="utf-8")
        else:
            raw = sys.stdin.read()
        if not raw.strip():
            raise InputError("no input on stdin")
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise InputError("input is not valid JSON: %s" % exc) from exc

        answers = extract_answers(payload)
        reduced = {qid: reduce_answer(qid, a, args) for qid, a in answers.items()}

        # --standard is a convenience over four known ids, so it silently skips the
        # ones this particular call did not ask -- that is what lets it compose with
        # any batch. An explicit --thresholds entry gets no such leniency: naming an
        # absent id there is a caller bug, and check_thresholds raises on it.
        thresholds = (
            {k: v for k, v in STANDARD_THRESHOLDS.items() if k in reduced}
            if args.standard
            else {}
        )
        thresholds.update(parse_json_arg(args.thresholds, "thresholds"))

        result = {
            "answers": reduced,
            "tripped": check_thresholds(reduced, thresholds) if thresholds else [],
            "bands": {"floor": args.floor, "act": args.act, "noul_margin": args.noul_margin},
        }
        if args.weights:
            result["composite"] = composite(reduced, parse_json_arg(args.weights, "weights"))
    except InputError as exc:
        print("jev_reduce: %s" % exc, file=sys.stderr)
        return 2
    except OSError as exc:
        print("jev_reduce: could not read input: %s" % exc, file=sys.stderr)
        return 2

    print(json.dumps(result, separators=(",", ":")) if args.compact
          else json.dumps(result, indent=2))
    # Always 0 on a well-formed result. A tripped threshold is a note, not a gate.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
