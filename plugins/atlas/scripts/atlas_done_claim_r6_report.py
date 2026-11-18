#!/usr/bin/env python3
"""Round-6 supplement: the pre-registered results the round-6 report was missing, plus the post-score descriptive
analyses two outside critics asked for. Protocol: docs/audits/2026-11-18_atlas-round6-preregistration.md sections 2, 4,
6, 7, 8, 9, 11, 12, 15. Nothing here is a new test: every number is a count, a Wilson interval or a table.

    python3 atlas_done_claim_r6_report.py [--scratch DIR] [--out PATH]

Access rules this script keeps (phase L):
  * The detector is NEVER imported from the working tree. `git show <commit>:plugins/atlas/hooks/done_claim.py` is
    written to --scratch and imported by path (module __file__ points into the repo so its data paths resolve). The
    freeze module (16a3bfd4) and the baseline (0da40153) run only on TRAIN and legacy files.
  * evals/done_claim/r6_heldout.jsonl is only hashed (and its `_header` line read). Held-out facts come from the
    score file docs/audits/2026-11-18_atlas-round6-fresh-score.json.
  * No model call, no download. It never runs the scorer or the freezer.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
DATA_DIR = os.path.join(REPO_ROOT, "evals", "done_claim")
FIX_DIR = os.path.join(DATA_DIR, "fixtures")
AUDITS = os.path.join(REPO_ROOT, "docs", "audits")
HOOK_REL = "plugins/atlas/hooks/done_claim.py"
SCORE_PATH = os.path.join(AUDITS, "2026-11-18_atlas-round6-fresh-score.json")
FREEZE_PATH = os.path.join(AUDITS, "2026-11-18_atlas-round6-freeze.json")
OUT_PATH = os.path.join(AUDITS, "2026-11-18_atlas-round6-supplement.json")
DEFAULT_SCRATCH = "/tmp/claude-0/-home-user-tech-tools/9f8d0ae0-7987-56fa-be27-2c6022afd1b8/scratchpad/r6l"

BASELINE = "0da40153"
FREEZE_COMMIT = "16a3bfd4"
SCORE_COMMIT = "c0d435d1"
SPLIT_SALT = "done_claim-r6-split-v1:"
ATTAINABLE_N = 73  # 0 false blocks in 73 gives a Wilson upper bound of 0.05
SIBLING_GENERIC_MAX = 6  # a source file shared by more fixtures than this is boilerplate and links nothing
TARGETS = {"gen": 5.0, "label": 8.0, "reserve": 2.0, "pilot": 1.0, "total": 15.0}  # prereg sec 6 and Amendment 2a


# ------------------------------------------------------------------ small pure helpers


def wilson(k: int, n: int, z: float = 1.96) -> list[float] | None:
    """Wilson score interval as in the scorer (centre -/+ half-width, clipped to [0, 1]); None when n is 0."""
    if n <= 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / denom
    return [round(max(0.0, centre - half), 6), round(min(1.0, centre + half), 6)]


def zero_upper(n: int, z: float = 1.96) -> float | None:
    """Wilson upper bound for 0 events in n trials: z^2 / (n + z^2)."""
    return None if n <= 0 else round(z * z / (n + z * z), 6)


def kn(k: int, n: int) -> dict:
    return {"k": k, "n": n, "rate": (k / n if n else None), "wilson95": wilson(k, n)}


def sha1_bytes(b: bytes) -> str:
    return hashlib.sha1(b).hexdigest()


def sha1_file(path: str) -> str:
    with open(path, "rb") as fh:
        return sha1_bytes(fh.read())


def fixture_parity(fixture_id: str) -> int:
    """Prereg sec 4: parity 1 = HELDOUT. Key of a generated row is fx:<id>."""
    return int(hashlib.sha1((SPLIT_SALT + "fx:" + fixture_id).encode()).hexdigest(), 16) % 2


def read_jsonl(path: str) -> tuple[dict | None, list[dict]]:
    """(header or None, rows). Used for TRAIN and legacy files only."""
    header, rows = None, []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            obj = json.loads(line)
            if "_header" in obj:
                header = obj["_header"]
            else:
                rows.append(obj)
    return header, rows


def read_header_only(path: str) -> dict:
    """First line of a file that holds a `_header` record (the only part of HELDOUT this script reads)."""
    with open(path, encoding="utf-8") as fh:
        first = fh.readline()
    return json.loads(first)["_header"]


def is_neg(row: dict) -> bool:
    return (row.get("label") or row.get("gold")) != "unsupported_done"


def kappa_from_matrix(matrix: dict) -> dict:
    """Cohen's kappa from a 'a|b' -> count matrix (sonnet|opus). agreement = diagonal / total."""
    cells = {tuple(k.split("|")): c for k, c in matrix.items()}
    total = sum(cells.values())
    if not total:
        return {"n": 0, "agree": 0, "agreement": None, "kappa": None}
    labels = sorted({a for a, _ in cells} | {b for _, b in cells})
    agree = sum(c for (a, b), c in cells.items() if a == b)
    po = agree / total
    pe = sum((sum(c for (a, _b), c in cells.items() if a == x) / total) * (sum(c for (_a, b), c in cells.items() if b == x) / total) for x in labels)
    kappa = None if pe >= 1 else (po - pe) / (1 - pe)
    return {"n": total, "agree": agree, "agreement": round(po, 6), "kappa": None if kappa is None else round(kappa, 6)}


def kappa_from_pairs(pairs: list[tuple[str, str]]) -> dict:
    m: dict[str, int] = {}
    for a, b in pairs:
        m[f"{a}|{b}"] = m.get(f"{a}|{b}", 0) + 1
    return kappa_from_matrix(m)


# ------------------------------------------------------------------ detector modules (git blobs, never the working tree)


def git_show(commit: str, rel: str) -> bytes:
    return subprocess.run(["git", "show", f"{commit}:{rel}"], cwd=REPO_ROOT, capture_output=True, check=True).stdout


def load_detector(commit: str, scratch: str):
    """Writes the detector at `commit` to scratch and imports it by path. __file__ is set to the repo hook path so
    the module's script-relative data paths resolve to the repo; the working-tree copy is never imported."""
    os.makedirs(scratch, exist_ok=True)
    src = git_show(commit, HOOK_REL)
    path = os.path.join(scratch, f"dc_{commit}.py")
    with open(path, "wb") as fh:
        fh.write(src)
    sys.dont_write_bytecode = True
    name = f"done_claim_{commit}"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    mod.__file__ = os.path.join(REPO_ROOT, HOOK_REL)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    mod.__r6_blob_sha1__ = sha1_bytes(src)
    return mod


# ------------------------------------------------------------------ item 1: H6 tier table


def conditions(m: dict, fit_count: int, n_fits: int, th: dict) -> list[dict]:
    """The six conditions of prereg sec 7 for one kind, in order, with value, threshold and ok."""
    n = m["tp"] + m["fp"]
    prec = (m["tp"] / n) if n else None
    glo = (wilson(m["groups_ok"], m["groups"]) or [0.0, 0.0])[0]
    return [
        {"n": 1, "name": "row precision", "value": prec, "threshold": th["min_precision"], "ok": prec is not None and prec >= th["min_precision"]},
        {"n": 2, "name": "group Wilson lower bound", "value": glo, "threshold": th["min_lower"], "ok": glo >= th["min_lower"], "groups_ok": m["groups_ok"], "groups": m["groups"]},
        {"n": 3, "name": "real or generated TP", "value": m.get("nonseeded_tp", 0), "threshold": th["min_nonseeded"], "ok": m.get("nonseeded_tp", 0) >= th["min_nonseeded"]},
        {"n": 4, "name": "false emissions on real rows", "value": m.get("real_fp", 0), "threshold": 0, "ok": not m.get("real_fp", 0)},
        {"n": 5, "name": "rows with an emission", "value": n, "threshold": th["min_support"], "ok": n >= th["min_support"]},
        {"n": 6, "name": "CV fits selecting the kind", "value": fit_count, "threshold": th["min_fits"], "ok": fit_count >= th["min_fits"], "of": n_fits},
    ]


def first_failing(conds: list[dict]) -> dict | None:
    for c in conds:
        if not c["ok"]:
            return c
    return None


def tier_table(mod, rows: list[dict]) -> dict:
    kinds = mod._row_kinds(rows)
    per = mod.kind_metrics(rows, kinds)
    _runs, fits = mod.cv_runs(rows, kinds)
    n_fits = mod.CV_REPEATS * mod.CV_FOLDS
    th = {
        "min_precision": mod.BLOCKING_MIN_PRECISION, "min_lower": mod.BLOCKING_MIN_LOWER, "min_nonseeded": mod.BLOCKING_MIN_NONSEEDED_TP,
        "min_support": mod.BLOCKING_MIN_SUPPORT, "min_fits": mod.CV_STABLE_FRACTION * n_fits,
    }
    out = {}
    for kind in mod.FINDING_KINDS:
        m = per[kind]
        n = m["tp"] + m["fp"]
        conds = conditions(m, fits[kind], n_fits, th)
        ff = first_failing(conds)
        out[kind] = {
            "rows": n, "tp": m["tp"], "fp": m["fp"],
            "real_tp": m["real_tp"], "real_fp": m["real_fp"], "generated_tp": m["generated_tp"], "generated_fp": m["generated_fp"],
            "seeded_tp": m["seeded_tp"], "seeded_fp": m["seeded_fp"], "nonseeded_tp": m["nonseeded_tp"],
            "groups": m["groups"], "groups_ok": m["groups_ok"],
            "row_precision": (m["tp"] / n if n else None), "group_wilson_lower": (wilson(m["groups_ok"], m["groups"]) or [0.0])[0],
            "cv_fits": fits[kind], "cv_fits_of": n_fits,
            "tier": "blocking" if all(c["ok"] for c in conds) else "advisory",
            "first_failing": None if ff is None else {k: v for k, v in ff.items() if k != "ok"},
            "failing_all": [c["n"] for c in conds if not c["ok"]],
            "conditions": conds,
        }
    return out


def h6(mod, scratch_note: str) -> dict:
    corpus = mod.load_corpus(os.path.join(DATA_DIR, "done_claim_corpus.jsonl"))
    gtrain = mod.load_gtrain(os.path.join(DATA_DIR, "done_claim_gtrain.jsonl"))
    r6 = mod.load_r6_train(os.path.join(DATA_DIR, "r6_train.jsonl"))
    pool, dropped = mod.pool_split(corpus + gtrain + r6)
    table = tier_table(mod, pool)
    derived = frozenset(k for k, v in table.items() if v["tier"] == "blocking")
    shipped = mod.shipped_selection(pool)
    by_src: dict[str, int] = {}
    for r in pool:
        s = r.get("source") if r.get("source") in ("real", "generated") else "seeded"
        by_src[s] = by_src.get(s, 0) + 1
    return {
        "module": f"{FREEZE_COMMIT} (blob sha1 {mod.__r6_blob_sha1__})",
        "pool": {"files": {"corpus": len(corpus), "gtrain": len(gtrain), "r6_train": len(r6)}, "kept": len(pool), "dropped": dropped, "by_source": by_src},
        "table": table,
        "blocking_kinds_constant": sorted(mod.BLOCKING_KINDS),
        "shipped_selection": sorted(shipped),
        "derived_from_conditions": sorted(derived),
        "constant_equals_recomputed": frozenset(mod.BLOCKING_KINDS) == shipped == derived,
        "max_groups_with_an_emission": max((v["groups"] for v in table.values()), default=0),
        "kinds_with_9_or_more_groups": sorted(k for k, v in table.items() if v["groups"] >= 9),
        "note": scratch_note,
    }


# ------------------------------------------------------------------ items 2 and 3: before/after on legacy files


def per_row(mod, rows: list[dict]) -> dict:
    """Production path per row: blocked kinds under the module's own tier, and would-block kinds with every kind blocking."""
    allk = frozenset(mod.FINDING_KINDS)
    out = {}
    for r in rows:
        tools = mod.row_tools(r)
        a = mod.analyze(r["text"], tools)
        b = mod.analyze(r["text"], tools, allk)
        out[r["id"]] = {"gold": r["label"], "source": r.get("source"), "blocked": sorted(a["finding_kinds"]), "would_block": sorted(b["finding_kinds"])}
    return out


def eval_numbers(mod, rows: list[dict], by_source: bool) -> dict:
    """--eval-equivalent numbers: text+tools metrics, blocking path (module tier) and all-kinds path, per subset."""
    allk = frozenset(mod.FINDING_KINDS)
    subsets = [("all", rows)]
    if by_source:
        subsets += [("real", [r for r in rows if r.get("source") == "real"]), ("seeded", [r for r in rows if r.get("source") == "seeded"])]
    out = {}
    for name, sub in subsets:
        m = mod.metrics(sub)
        b = mod.blocking_metrics(sub)
        a = mod.blocking_metrics(sub, allk)
        pick = lambda d: {k: d[k] for k in ("tp", "fp", "fn")}  # noqa: E731
        out[name] = {"n": len(sub), "text_and_tools": pick(m), "blocking_path": pick(b), "all_kinds": pick(a)}
    return out


def flips(before: dict, after: dict) -> list[dict]:
    """Rows whose blocked or would-block kinds differ between two per_row dumps (ids present in both)."""
    out = []
    for rid in sorted(set(before) & set(after)):
        b, a = before[rid], after[rid]
        if b["blocked"] != a["blocked"] or b["would_block"] != a["would_block"]:
            out.append({"id": rid, "gold": a["gold"], "source": a["source"], "before": {"blocked": b["blocked"], "would_block": b["would_block"]},
                        "after": {"blocked": a["blocked"], "would_block": a["would_block"]}})
    return out


def false_alarms(dump: dict) -> dict:
    """Gold negatives on which any kind would block (all-kinds path): count, ids, per-kind counts."""
    ids = sorted(i for i, v in dump.items() if v["gold"] != "unsupported_done" and v["would_block"])
    per: dict[str, int] = {}
    for i in ids:
        for k in dump[i]["would_block"]:
            per[k] = per.get(k, 0) + 1
    n_neg = sum(1 for v in dump.values() if v["gold"] != "unsupported_done")
    return {"n_negatives": n_neg, "count": len(ids), "ids": ids, "per_kind_rows": dict(sorted(per.items()))}


def per_kind_tp_fp(dump: dict) -> dict:
    out: dict[str, dict] = {}
    for v in dump.values():
        for k in v["would_block"]:
            d = out.setdefault(k, {"tp": 0, "fp": 0})
            d["tp" if v["gold"] == "unsupported_done" else "fp"] += 1
    return dict(sorted(out.items()))


def legacy_before_after(old, new, files: dict[str, list[dict]]) -> dict:
    res = {}
    for name, rows in files.items():
        d0, d1 = per_row(old, rows), per_row(new, rows)
        fa0, fa1 = false_alarms(d0), false_alarms(d1)
        res[name] = {
            "n_rows": len(rows),
            "before": {"module": BASELINE, "numbers": eval_numbers(old, rows, name == "corpus"), "per_kind_all_kinds": per_kind_tp_fp(d0), "false_alarms": fa0},
            "after": {"module": FREEZE_COMMIT, "numbers": eval_numbers(new, rows, name == "corpus"), "per_kind_all_kinds": per_kind_tp_fp(d1), "false_alarms": fa1},
            "flips": flips(d0, d1),
            "false_alarm_ids_fixed": sorted(set(fa0["ids"]) - set(fa1["ids"])),
            "false_alarm_ids_new": sorted(set(fa1["ids"]) - set(fa0["ids"])),
            "false_alarm_ids_kept": sorted(set(fa0["ids"]) & set(fa1["ids"])),
            "_dump_before": d0, "_dump_after": d1,
        }
    return res


def b2(ba: dict) -> dict:
    """False blocks on D1 real rows (original labels), freeze module: blocking path and all-kinds path."""
    c = ba["corpus"]
    real0 = {i: v for i, v in c["_dump_before"].items() if v["source"] == "real"}
    real1 = {i: v for i, v in c["_dump_after"].items() if v["source"] == "real"}
    fb1 = sorted(i for i, v in real1.items() if v["gold"] != "unsupported_done" and v["blocked"])
    fb0 = sorted(i for i, v in real0.items() if v["gold"] != "unsupported_done" and v["blocked"])
    fa1, fa0 = false_alarms(real1), false_alarms(real0)
    return {
        "real_rows": len(real1), "real_gold_negatives": sum(1 for v in real1.values() if v["gold"] != "unsupported_done"),
        "blocking_path_false_blocks_after": {"count": len(fb1), "ids": fb1}, "blocking_path_false_blocks_before": {"count": len(fb0), "ids": fb0},
        "all_kinds_false_alarms_after": fa1, "all_kinds_false_alarms_before": fa0,
        "all_kinds_false_alarm_ids_new_after": sorted(set(fa1["ids"]) - set(fa0["ids"])),
        "bar_B2_blocking_path_zero": len(fb1) == 0,
        "bar_B2_note": "B2 also needs the two test files to pass; that is run separately (pytest), not here",
    }


# ------------------------------------------------------------------ item 5 and 6: score file only


def pool_group_stats(rows: list[dict], flag_key: str) -> dict:
    """Distinct groups that contain a gold negative; a group is a false block when any of its negatives is flagged."""
    neg = [r for r in rows if r["gold"] != "unsupported_done"]
    groups: dict[str, bool] = {}
    for r in neg:
        groups[r["group"]] = groups.get(r["group"], False) or bool(r[flag_key])
    n, k = len(groups), sum(groups.values())
    return {
        "negative_rows": len(neg), "negative_rows_flagged": sum(1 for r in neg if r[flag_key]),
        "n_groups": n, "false_groups": k, "rate": (k / n if n else None), "wilson95": wilson(k, n),
        "zero_false_upper_bound_at_n": zero_upper(n) if k == 0 else None,
        "attainability_threshold": ATTAINABLE_N, "attainable_on_groups": n >= ATTAINABLE_N,
        "false_group_ids": sorted(g for g, v in groups.items() if v),
    }


def group_bounds(score: dict) -> dict:
    rows = score["rows"]
    pools = {
        "real": [r for r in rows if r["source"] == "real"],
        "generated": [r for r in rows if r["source"] == "generated"],
        "real_plus_generated": [r for r in rows if r["source"] in ("real", "generated")],
    }
    strata = {s: [r for r in pools["real"] if r.get("stratum") == s] for s in ("N", "B", "F")}
    fams = sorted({r["family"] for r in rows if r.get("family")})
    vacuous = not score.get("blocking_kinds")
    h1 = {n: pool_group_stats(p, "blocked_kinds") for n, p in pools.items()}
    h1["real_by_stratum"] = {s: pool_group_stats(p, "blocked_kinds") for s, p in strata.items()}
    if vacuous:
        for v in list(h1.values()) + list(h1["real_by_stratum"].values()):
            if isinstance(v, dict) and "n_groups" in v:
                v["status"] = "vacuous (BLOCKING_KINDS empty)"
    h3 = {n: pool_group_stats(p, "would_block_kinds") for n, p in pools.items()}
    h3["by_family"] = {f: pool_group_stats([r for r in rows if r.get("family") == f], "would_block_kinds") for f in fams}
    return {"H1_shipped_path": h1, "H3_all_kinds": h3, "blocking_kinds": score.get("blocking_kinds"),
            "source": "docs/audits/2026-11-18_atlas-round6-fresh-score.json rows (id, source, group, family, gold, blocked_kinds, would_block_kinds)"}


def negative_split(score: dict) -> dict:
    """Gold negatives split supported_done vs no_claim per pool and family, with blocked and would-block counts."""
    def tab(rows):
        out = {}
        for lab in ("supported_done", "no_claim"):
            sub = [r for r in rows if r["gold"] == lab]
            out[lab] = {"rows": len(sub), "groups": len({r["group"] for r in sub}), "blocked": sum(1 for r in sub if r["blocked_kinds"]),
                        "would_block": sum(1 for r in sub if r["would_block_kinds"])}
        out["unsupported_done_rows"] = sum(1 for r in rows if r["gold"] == "unsupported_done")
        return out
    rows = score["rows"]
    res = {"by_pool": {n: tab([r for r in rows if r["source"] in srcs]) for n, srcs in
                       (("real", ("real",)), ("generated", ("generated",)), ("real_plus_generated", ("real", "generated")))}}
    res["by_family"] = {f: tab([r for r in rows if r.get("family") == f]) for f in sorted({r["family"] for r in rows if r.get("family")})}
    return res


def by_model(score: dict, train_rows: list[dict], train_header: dict, held_header: dict) -> dict:
    """Gold counts by generator model (score file for HELDOUT scored rows, r6_train.jsonl for TRAIN scored rows).
    Agreement and kappa by model are computed from stored votes where a file has them: r6_train rows carry votes
    (scored rows only, so every one of them is an agreed row); the score file has no votes."""
    def gold_counts(rows, key):
        out: dict[str, dict] = {}
        for r in rows:
            d = out.setdefault(r.get("model") or "unknown", {"rows": 0, "supported_done": 0, "no_claim": 0, "unsupported_done": 0})
            d["rows"] += 1
            d[r[key]] += 1
        return dict(sorted(out.items()))
    pairs: dict[str, list] = {}
    for r in train_rows:
        v = r.get("votes") or {}
        if "sonnet" in v and "opus" in v:
            pairs.setdefault(r.get("model") or "unknown", []).append((v["sonnet"], v["opus"]))
    return {
        "heldout_scored_gold_by_model": {"source_file": "score file rows", **{"counts": gold_counts(score["rows"], "gold")}},
        "train_scored_gold_by_model": {"source_file": "evals/done_claim/r6_train.jsonl rows (split=train, scored rows only)", "counts": gold_counts(train_rows, "label")},
        "train_vote_agreement_by_model": {m: kappa_from_pairs(p) for m, p in sorted(pairs.items())},
        "train_vote_agreement_note": "r6_train.jsonl holds votes only for SCORED rows, which are agreed rows by construction, so agreement is 1.0 by selection and kappa is degenerate here; it is not the labeler agreement.",
        "excluded_rows_have_no_model": "the _header excluded lists carry id, source, split, reason only; the excluded rows (disagreement, construction conflict) are not in any row file, so agreement, kappa and exclusion rates BY GENERATOR MODEL are not computable from committed data.",
        "overall_from_header_vote_matrices": {
            "train": kappa_from_matrix(train_header["vote_matrix_sonnet_opus"]),
            "heldout": kappa_from_matrix(held_header["vote_matrix_sonnet_opus"]),
            "train_plus_heldout": kappa_from_matrix({k: train_header["vote_matrix_sonnet_opus"].get(k, 0) + held_header["vote_matrix_sonnet_opus"].get(k, 0)
                                                     for k in set(train_header["vote_matrix_sonnet_opus"]) | set(held_header["vote_matrix_sonnet_opus"])}),
            "source_file": "_header.vote_matrix_sonnet_opus of r6_train.jsonl and r6_heldout.jsonl",
        },
        "score_file_H4": score["H4"],
    }


def tag_class(line: dict) -> str:
    tag = str(line.get("tag", ""))
    if tag.startswith("pilot-"):
        return "pilot"
    return "label" if line.get("kind") == "label" else "gen"


def spend(lines: list[dict]) -> dict:
    cats: dict[str, dict] = {c: {"lines": 0, "usd": 0.0, "no_cost_lines": 0, "failed_tag_lines": 0, "by_model": {}} for c in ("gen", "label", "pilot")}
    for ln in lines:
        c = cats[tag_class(ln)]
        c["lines"] += 1
        cost = ln.get("total_cost_usd")
        if isinstance(cost, (int, float)):
            c["usd"] += cost
            c["by_model"][ln.get("model")] = c["by_model"].get(ln.get("model"), 0.0) + cost
        else:
            c["no_cost_lines"] += 1
        if str(ln.get("tag", "")).endswith(" failed"):
            c["failed_tag_lines"] += 1
    total = sum(c["usd"] for c in cats.values())
    for c in cats.values():
        c["usd"] = round(c["usd"], 6)
        c["by_model"] = {k: round(v, 6) for k, v in sorted(c["by_model"].items(), key=lambda kv: str(kv[0]))}
    return {
        "categories": cats, "total_usd": round(total, 6), "lines": len(lines),
        "targets_usd": TARGETS,
        "vs_targets": {
            "gen_within_5_0": cats["gen"]["usd"] <= TARGETS["gen"], "label_within_8_0": cats["label"]["usd"] <= TARGETS["label"],
            "pilot_within_1_0": cats["pilot"]["usd"] <= TARGETS["pilot"], "total_within_15_0": total <= TARGETS["total"],
            "gen_headroom": round(TARGETS["gen"] - cats["gen"]["usd"], 6), "label_headroom": round(TARGETS["label"] - cats["label"]["usd"], 6),
            "reserve_left_of_cap": round(TARGETS["total"] - total, 6),
        },
        "note": "pilot = tag starts with 'pilot-' (Amendment 2a, cap 1.00); the prereg sec 6 split (gen 5.0, label 8.0, reserve 2.0) counts pilot lines inside gen; shown both ways: gen_plus_pilot_usd",
        "gen_plus_pilot_usd": round(cats["gen"]["usd"] + cats["pilot"]["usd"], 6),
    }


# ------------------------------------------------------------------ item 7: eligibility on TRAIN


def default_preconditions(mod) -> dict:
    """kind -> callable(text) -> bool: does a sentence its claim pattern matches exist (mirrors crosscheck_kinds)."""
    def sents(text):
        body = mod._strip_fences(text)
        return [s for s in mod._sentences(body) if not mod._hedged(s)]

    def count_claim(text):
        for m in mod._COUNT_CLAIM.finditer(text):
            n = next((g for g in m.groups() if g), "").replace(",", "")
            if n and int(n) >= 3:
                return True
        return False

    return {
        "count_not_in_results": count_claim, "count_nowhere": count_claim,
        "pass_after_failing_run": lambda t: any(mod._suite_pass_claim(s) for s in sents(t)),
        "narrow_as_full_suite": lambda t: any(mod._FULL_CLAIM.search(s) for s in sents(t)),
        "push_unbacked": lambda t: any(mod._PUSH_CLAIM.search(s) for s in sents(t)),
        "ci_unbacked": lambda t: any(mod._CI_CLAIM.search(s) for s in sents(t)),
        "ci_contradicted": lambda t: any(mod._CI_PASS_CLAIM.search(s) for s in sents(t)),
    }


def eligibility(mod, rows: list[dict], pre: dict | None = None) -> dict:
    pre = default_preconditions(mod) if pre is None else pre
    kinds = mod._row_kinds(rows)
    cmin = mod.CLAIM_MIN
    per_row_ = []
    for r in rows:
        cs = mod.claim_strength(r["text"])
        per_row_.append({"id": r["id"], "neg": is_neg(r), "claim": round(cs, 3), "eligible": cs >= cmin, "emits": sorted(kinds[r["id"]]),
                         "pre": {k: bool(f(r["text"])) for k, f in pre.items()}})
    neg = [x for x in per_row_ if x["neg"]]
    elig = [x for x in neg if x["eligible"]]
    hist: dict[str, int] = {}
    for x in neg:
        b = "0" if x["claim"] == 0 else ("<0.30" if x["claim"] < cmin else (">=0.30,<0.60" if x["claim"] < 0.6 else ">=0.60"))
        hist[b] = hist.get(b, 0) + 1
    per_kind = {}
    for k in pre:
        has = [x for x in per_row_ if x["pre"][k]]
        hn = [x for x in has if x["neg"]]
        he = [x for x in hn if x["eligible"]]
        per_kind[k] = {
            "rows_with_precondition": len(has), "negatives_with_precondition": len(hn), "eligible_negatives_with_precondition": len(he),
            "emitted_rows": sum(1 for x in per_row_ if k in x["emits"]),
            "emitted_on_eligible_negatives": sum(1 for x in elig if k in x["emits"]),
            "emitted_on_ineligible_rows": sum(1 for x in per_row_ if k in x["emits"] and not x["eligible"]),
        }
    kk = sum(1 for x in elig if x["emits"])
    return {
        "scope": "r6_train.jsonl rows only, freeze module; IN-SAMPLE (TRAIN: rules were written after reading these rows)",
        "claim_min": cmin, "rows": len(per_row_), "gold_negatives": len(neg), "gold_positives": len(per_row_) - len(neg),
        "negatives_with_claim_ge_min": len(elig), "negatives_with_claim_lt_min": len(neg) - len(elig),
        "negative_claim_strength_histogram": dict(sorted(hist.items())),
        "would_block_on_eligible_negatives": kn(kk, len(elig)),
        "would_block_on_all_negatives": kn(sum(1 for x in neg if x["emits"]), len(neg)),
        "per_kind": per_kind,
        "heldout": "NOT computable: the score file has no claim strength per row and the held-out file contents stay closed; the same breakdown for HELDOUT is therefore not reported.",
    }


# ------------------------------------------------------------------ item 8: reconciliation


def id_class(rid: str) -> str:
    return "m2" if rid.startswith("dcm2-") else ("m1" if rid.startswith("dcp-") else "other")


def ledger_runs(lines: list[dict]) -> dict:
    """(fixture, model) -> {ok, failed} for non-pilot generation lines; pilot lines counted apart."""
    out: dict[tuple, dict] = {}
    pilot = 0
    for ln in lines:
        if ln.get("kind") != "gen":
            continue
        tag = str(ln.get("tag", ""))
        if tag.startswith("pilot-"):
            pilot += 1
            continue
        failed = tag.endswith(" failed")
        fid = tag[: -len(" failed")] if failed else tag
        d = out.setdefault((fid, ln.get("model")), {"ok": 0, "failed": 0})
        d["failed" if failed else "ok"] += 1
    return {"runs": out, "pilot_lines": pilot}


def reconcile(train_rows: list[dict], train_header: dict, held_header: dict, score_rows: list[dict], ledger: list[dict], manifest_ids: set) -> dict:
    lr = ledger_runs(ledger)
    runs = lr["runs"]
    ok_total = sum(v["ok"] for v in runs.values())
    failed_total = sum(v["failed"] for v in runs.values())

    def split_ids(header, scored_ids):
        exc = header["excluded"]
        res = {}
        for cls in ("m1", "m2"):
            res[cls] = {"scored": sum(1 for i in scored_ids if id_class(i) == cls), "excluded": sum(1 for e in exc if id_class(e["id"]) == cls)}
            res[cls]["built"] = res[cls]["scored"] + res[cls]["excluded"]
        return res

    t_ids = [r["id"] for r in train_rows]
    h_ids = [r["id"] for r in score_rows]
    ts, hs = split_ids(train_header, t_ids), split_ids(held_header, h_ids)

    def explain(header, s):
        return {
            "rows_built_header": header["rows_built"], "rows_m1_carried_header": header["rows_m1_carried"], "rows_m2_built_header": header["rows_m2_built"],
            "m1_excluded_ids_in_header": s["m1"]["excluded"], "m2_excluded_ids_in_header": s["m2"]["excluded"],
            "m1_scored_ids": s["m1"]["scored"], "m2_scored_ids": s["m2"]["scored"],
            "carried_plus_m2_built": header["rows_m1_carried"] + header["rows_m2_built"],
            "carried_plus_m1_excluded_plus_m2_built": header["rows_m1_carried"] + s["m1"]["excluded"] + header["rows_m2_built"],
            "gap_rows_built_minus_carried_plus_m2_built": header["rows_built"] - (header["rows_m1_carried"] + header["rows_m2_built"]),
            "gap_explained_by_m1_excluded": header["rows_built"] - (header["rows_m1_carried"] + header["rows_m2_built"]) == s["m1"]["excluded"],
            "m1_carried_equals_m1_scored_ids": header["rows_m1_carried"] == s["m1"]["scored"],
            "m2_built_equals_m2_scored_plus_excluded_ids": header["rows_m2_built"] == s["m2"]["built"],
        }

    # TRAIN rows -> fixture and ledger lines
    by_fx: dict[tuple, int] = {}
    for r in train_rows:
        key = (r.get("fixture"), r.get("model"))
        by_fx[key] = by_fx.get(key, 0) + 1
    train_join = {"rows": len(train_rows), "rows_without_fixture": [r["id"] for r in train_rows if not r.get("fixture")], "fixtures_not_in_manifest": sorted({r["fixture"] for r in train_rows if r.get("fixture") not in manifest_ids}),
                  "rows_with_no_ledger_ok_line": [], "rows_whose_fixture_has_only_failed_lines": [], "more_rows_than_ok_lines": []}
    for (fx, model), n in sorted(by_fx.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]))):
        d = runs.get((fx, model), {"ok": 0, "failed": 0})
        ids = sorted(r["id"] for r in train_rows if r.get("fixture") == fx and r.get("model") == model)
        if d["ok"] == 0 and d["failed"] > 0:
            train_join["rows_whose_fixture_has_only_failed_lines"] += ids
        if d["ok"] == 0:
            train_join["rows_with_no_ledger_ok_line"] += ids
        if n > d["ok"]:
            train_join["more_rows_than_ok_lines"].append({"fixture": fx, "model": model, "rows": n, "ok_lines": d["ok"]})
    # HELDOUT scored rows: fixture from the score file group field only
    held_by: dict[tuple, int] = {}
    for r in score_rows:
        held_by[(r["group"][3:], r.get("model"))] = held_by.get((r["group"][3:], r.get("model")), 0) + 1
    held_join = {"scored_rows": len(score_rows), "rows_whose_fixture_has_only_failed_lines": [], "rows_with_no_ledger_ok_line": [], "more_rows_than_ok_lines": []}
    for (fx, model), n in sorted(held_by.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]))):
        d = runs.get((fx, model), {"ok": 0, "failed": 0})
        ids = sorted(r["id"] for r in score_rows if r["group"][3:] == fx and r.get("model") == model)
        if d["ok"] == 0 and d["failed"] > 0:
            held_join["rows_whose_fixture_has_only_failed_lines"] += ids
        if d["ok"] == 0:
            held_join["rows_with_no_ledger_ok_line"] += ids
        if n > d["ok"]:
            held_join["more_rows_than_ok_lines"].append({"fixture": fx, "model": model, "rows": n, "ok_lines": d["ok"]})
    # aggregate: ok ledger lines by fixture-key parity against rows_built per split
    par = {0: 0, 1: 0}
    for (fx, _m), d in runs.items():
        par[fixture_parity(fx)] += d["ok"]
    unknown = sorted({fx for (fx, _m) in runs if fx not in manifest_ids})
    return {
        "ledger": {"gen_ok_lines": ok_total, "gen_failed_lines": failed_total, "pilot_gen_lines": lr["pilot_lines"], "tags_not_in_manifest": unknown,
                   "ok_lines_by_fixture_key_parity": {"parity0_TRAIN": par[0], "parity1_HELDOUT": par[1]}},
        "rows_built_header_sum": train_header["rows_built"] + held_header["rows_built"],
        "ledger_ok_lines_equal_rows_built_sum": ok_total == train_header["rows_built"] + held_header["rows_built"],
        "train": {"header": explain(train_header, ts), "ids": ts, "join": train_join},
        "heldout": {"header": explain(held_header, hs), "ids": hs, "join": held_join,
                    "note": "HELDOUT scored ids and fixtures from the score file; excluded ids from the _header excluded list (id, source, split, reason only), so excluded HELDOUT rows have no fixture or model here"},
        "parity_note": "the split of a row is the parity of its connected component's smallest key, so a row's split can differ from its own fixture key parity; the parity columns are a check, not an identity",
    }


# ------------------------------------------------------------------ item 9: sibling fixtures


def sibling_components(hashes: dict[str, dict[str, str]], generic_max: int | None) -> dict:
    """hashes: fixture id -> {relative path: sha1}. Fixtures sharing an identical source file are siblings; a hash held by
    more than generic_max fixtures is boilerplate and links nothing (None = no limit). Returns components with the
    shared files."""
    holders: dict[str, set] = {}
    names: dict[str, set] = {}
    for fid, files in hashes.items():
        for rel, h in files.items():
            holders.setdefault(h, set()).add(fid)
            names.setdefault(h, set()).add(rel)
    parent = {f: f for f in hashes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    shared = {h: f for h, f in holders.items() if len(f) > 1}
    generic = {h: f for h, f in shared.items() if generic_max is not None and len(f) > generic_max}
    for h, f in shared.items():
        if h in generic:
            continue
        fl = sorted(f)
        for o in fl[1:]:
            parent[find(o)] = find(fl[0])
    comps: dict[str, list] = {}
    for f in hashes:
        comps.setdefault(find(f), []).append(f)
    out = []
    for members in comps.values():
        if len(members) < 2:
            continue
        files = sorted({rel for h, f in shared.items() if h not in generic and len(set(members) & f) > 1 for rel in names[h]})
        out.append({"members": sorted(members), "shared_files": files})
    out.sort(key=lambda c: c["members"][0])
    return {"sets": out, "generic_files": [{"names": sorted(names[h]), "fixtures": len(f)} for h, f in sorted(generic.items(), key=lambda kv: sorted(names[kv[0]]))],
            "shared_hashes": len(shared)}


def fixture_hashes() -> dict[str, dict[str, str]]:
    out = {}
    for fid in sorted(os.listdir(FIX_DIR)):
        base = os.path.join(FIX_DIR, fid, "files")
        if not os.path.isdir(base):
            continue
        files = {}
        for dp, _dn, fs in os.walk(base):
            for f in fs:
                p = os.path.join(dp, f)
                files[os.path.relpath(p, base).replace(os.sep, "/")] = sha1_file(p)
        out[fid] = files
    return out


def siblings(hashes: dict, manifests: dict[str, list[dict]], train_groups: set, score_rows: list[dict]) -> dict:
    meta = {}
    for man, fx in manifests.items():
        for f in fx:
            meta[f["id"]] = {"family": f["family"], "manifest": man, "variant": f.get("variant"), "twin_of": f.get("twin_of")}
    held_neg = [r for r in score_rows if r["gold"] != "unsupported_done"]
    held_groups = {r["group"][3:] for r in score_rows}
    res = {"generic_max_default": SIBLING_GENERIC_MAX, "fixtures_hashed": len(hashes), "n_heldout_negative_rows": len(held_neg),
           "n_heldout_negative_groups": len({r["group"] for r in held_neg})}
    for label, gmax in (("generic_files_excluded", SIBLING_GENERIC_MAX), ("no_limit_sensitivity", None)):
        comp = sibling_components(hashes, gmax)
        sets = []
        member_of = {}
        for i, c in enumerate(comp["sets"]):
            members = []
            for fid in c["members"]:
                p = fixture_parity(fid)
                members.append({"id": fid, **meta.get(fid, {}), "key_parity": p, "key_parity_means": "HELDOUT" if p else "TRAIN",
                                "has_train_rows": ("fx:" + fid) in train_groups, "has_scored_heldout_rows": fid in held_groups})
                member_of[fid] = i
            sets.append({"set": i, "size": len(members), "shared_files": c["shared_files"], "members": members,
                         "parity_split": {"TRAIN(0)": sum(1 for m in members if m["key_parity"] == 0), "HELDOUT(1)": sum(1 for m in members if m["key_parity"] == 1)},
                         "mixed_parity": len({m["key_parity"] for m in members}) > 1})
        by_par, by_rows = [], []
        for r in held_neg:
            fid = r["group"][3:]
            if fid not in member_of:
                continue
            s = sets[member_of[fid]]["members"]
            others = [m for m in s if m["id"] != fid]
            if any(m["key_parity"] == 0 for m in others):
                by_par.append(r["id"])
            if any(m["has_train_rows"] for m in others):
                by_rows.append(r["id"])
        res[label] = {
            "sets": sets, "n_sets": len(sets), "fixtures_in_sets": len(member_of), "mixed_parity_sets": sum(1 for s in sets if s["mixed_parity"]),
            "generic_files": comp["generic_files"], "shared_hashes": comp["shared_hashes"],
            "heldout_negative_rows_with_a_train_sibling_by_key_parity": {"rows": len(by_par), "groups": len({r["group"] for r in held_neg if r["id"] in set(by_par)}), "of_rows": len(held_neg)},
            "heldout_negative_rows_with_a_train_sibling_by_train_rows": {"rows": len(by_rows), "groups": len({r["group"] for r in held_neg if r["id"] in set(by_rows)}), "of_rows": len(held_neg)},
            "heldout_negative_ids_with_train_sibling_by_train_rows": sorted(by_rows),
        }
    return res


# ------------------------------------------------------------------ item 10: construction conflicts


def conflict_replies(train_header: dict, repo_root: str = REPO_ROOT, home: str | None = None) -> dict:
    home = home or os.path.expanduser("~")
    ids = sorted(e["id"] for e in train_header["excluded"] if e["reason"] == "construction_conflict")
    cands = [os.path.join(repo_root, ".atlas", ".run", "r6pos", n) for n in ("runs.jsonl", "label_cache.json", "mined.jsonl")]
    found = {p: (os.path.getsize(p) if os.path.exists(p) else None) for p in cands}
    projects = os.path.join(home, ".claude", "projects")
    r6pos_dirs = sorted(d for d in (os.listdir(projects) if os.path.isdir(projects) else []) if "r6pos" in d)
    n_files = sum(len([f for f in os.listdir(os.path.join(projects, d)) if f.endswith(".jsonl")]) for d in r6pos_dirs)
    raw = [p for p, s in found.items() if s and not p.endswith("mined.jsonl")]
    return {
        "train_construction_conflict_ids": ids, "n": len(ids), "by_prefix": {"dcp": sum(1 for i in ids if i.startswith("dcp-")), "dcm2": sum(1 for i in ids if i.startswith("dcm2-"))},
        "paths_searched": [os.path.relpath(p, repo_root) + (" (exists, %d bytes)" % s if s is not None else " (absent)") for p, s in found.items()]
        + [f"{projects}/*r6pos* ({len(r6pos_dirs)} matching project dirs, {n_files} jsonl files)"],
        "builder_raw_run_file_on_disk": bool(raw),
        "run_transcripts_on_disk": bool(r6pos_dirs),
        "reply_records_on_disk": bool(raw or r6pos_dirs),
        "emissions_computed": False,
        "result": ("the builder's raw run file (runs.jsonl) and label cache are absent and mined.jsonl is empty, but the transcripts of the claude -p runs exist under "
                   "~/.claude/projects (dirs with r6pos in the name). They were NOT processed: a row id (dcm2-NNN) is the rank of the row's digest among ALL raw rows, "
                   "HELDOUT-parity ones included, so attributing a transcript to a conflict id means reading the HELDOUT fixtures' replies, which the access rule forbids. "
                   "All-kinds emissions on the 32 TRAIN conflict replies per family are therefore NOT reported; r6_train.jsonl keeps only scored rows."
                   if (raw or r6pos_dirs) else
                   "NOT on disk: no raw run file, no label cache, no r6pos transcript directory; r6_train.jsonl keeps only scored rows."),
    }


# ------------------------------------------------------------------ checks C1 to C13 that need no model


def resolve_frozen(key: str) -> tuple[str, str | None]:
    """freeze-record key -> (path, git relpath for the detector)."""
    if key == "done_claim.py":
        return os.path.join(REPO_ROOT, HOOK_REL), HOOK_REL
    if key == "atlas_done_claim_fresh.py":
        return os.path.join(HERE, key), None
    if key == "done_claim_rubric.md":
        return os.path.join(REPO_ROOT, "plugins", "atlas", "hooks", key), None
    if key.endswith("preregistration.md"):
        return os.path.join(AUDITS, key), None
    return os.path.join(DATA_DIR, key), None


def check_hashes(freeze: dict, score: dict) -> dict:
    mism, missing = [], []
    ok = 0
    for key, want in freeze["sha1"].items():
        path, gitrel = resolve_frozen(key)
        if gitrel:
            have = sha1_bytes(git_show(FREEZE_COMMIT, gitrel))
        elif os.path.exists(path):
            have = sha1_file(path)
        else:
            missing.append(key)
            continue
        if have == want:
            ok += 1
        else:
            mism.append({"key": key, "freeze": want, "now": have})
    anc = subprocess.run(["git", "merge-base", "--is-ancestor", FREEZE_COMMIT, SCORE_COMMIT], cwd=REPO_ROOT).returncode == 0
    return {"files_in_freeze_record": len(freeze["sha1"]), "equal": ok, "mismatched": mism, "missing": missing,
            "score_file_hashes_equal_freeze": score["hashes"]["sha1"] == freeze["sha1"], "freeze_commit_is_ancestor_of_score_commit": anc,
            "note": "done_claim.py is compared to the git blob at the freeze commit (the working tree copy may be under edit); every other file is hashed in the working tree"}


def check_recount(score: dict) -> dict:
    """C3 and C4: k, n and Wilson recomputed from the per-row list against the score file's stated H1/H3 values."""
    rows = score["rows"]
    out = {}
    for name, srcs in (("real", ("real",)), ("generated", ("generated",)), ("real_plus_generated", ("real", "generated"))):
        sub = [r for r in rows if r["source"] in srcs]
        neg = [r for r in sub if r["gold"] != "unsupported_done"]
        pos = [r for r in sub if r["gold"] == "unsupported_done"]
        k1 = sum(1 for r in neg if r["blocked_kinds"])
        k3 = sum(1 for r in neg if r["would_block_kinds"])
        r3 = sum(1 for r in pos if r["would_block_kinds"])
        s1, s3 = score["H1"][name], score["H3"][name]
        out[name] = {
            "H1_false_blocks": {"recount": [k1, len(neg)], "score_file": [s1["false_blocks"], s1["n_gold_negative"]], "match": [k1, len(neg)] == [s1["false_blocks"], s1["n_gold_negative"]],
                                "wilson_recount": wilson(k1, len(neg)), "wilson_score_file": s1["wilson95"]},
            "H3_would_block_on_negatives": {"recount": [k3, len(neg)], "score_file": [s3["would_block_on_negatives"]["k"], s3["would_block_on_negatives"]["n"]]},
            "H3_recall": {"recount": [r3, len(pos)], "score_file": [s3["recall"]["k"], s3["recall"]["n"]], "wilson_recount": wilson(r3, len(pos)), "wilson_score_file": s3["recall"]["wilson95"]},
            "n_groups_all_rows": len({r["group"] for r in sub}), "n_groups_score_file_H1": s1["n_groups"],
        }
    return out


def check_shipped_data() -> dict:
    p = subprocess.run(["git", "ls-files", "plugins"], cwd=REPO_ROOT, capture_output=True, text=True, check=True)
    bad = [l for l in p.stdout.splitlines() if re.search(r"done_claim_.*\.jsonl", l)]
    q = subprocess.run(["git", "ls-files", "evals/done_claim"], cwd=REPO_ROOT, capture_output=True, text=True, check=True)
    legacy = [l for l in q.stdout.splitlines() if l.count("/") == 2]
    return {"C12_plugin_done_claim_jsonl_files": bad, "C12_empty": not bad, "evals_done_claim_top_level_files": legacy}


def check_votes(train_rows: list[dict], train_header: dict, held_header: dict, score: dict) -> dict:
    adjud = [r["id"] for r in train_rows if "adjudicated" in (r.get("votes") or {})]
    disagree = [r["id"] for r in train_rows if (r.get("votes") or {}).get("sonnet") != (r.get("votes") or {}).get("opus")]
    h = kappa_from_matrix(held_header["vote_matrix_sonnet_opus"])
    s = score["H4"]
    return {
        "train_rows_with_adjudicated_vote": adjud, "train_rows_with_sonnet_opus_disagreement": disagree,
        "train_header_adjudicator": train_header.get("adjudicator"), "heldout_header_adjudicator": held_header.get("adjudicator"),
        "heldout_recount_from_header_matrix": h, "score_file_H4": {"n_voted": s["n_voted"], "agree": s["agree"], "agreement": s["agreement"], "cohen_kappa": s["cohen_kappa"]},
        "heldout_matrix_matches_H4": h["n"] == s["n_voted"] and h["agree"] == s["agree"] and abs((h["kappa"] or 0) - s["cohen_kappa"]) < 1e-5,
        "excluded_by_reason": {"train": train_header["excluded_by_reason"], "heldout": held_header["excluded_by_reason"], "score_file": s["excluded_by_reason"]},
    }


def check_real_positives(train_rows: list[dict], score: dict) -> dict:
    tr = [r for r in train_rows if r.get("source") == "real" and r["label"] == "unsupported_done"]
    he = [r for r in score["rows"] if r["source"] == "real" and r["gold"] == "unsupported_done"]
    return {"C9_train_real_gold_positives": {"rows": len(tr), "groups": len({r["group"] for r in tr})},
            "C9_heldout_real_gold_positives_from_score_file": {"rows": len(he), "groups": len({r["group"] for r in he})},
            "C9_train_real_rows_in_r6_train": sum(1 for r in train_rows if r.get("source") == "real")}


# ------------------------------------------------------------------ driver


def answers(rep: dict) -> dict:
    """Section 2 questions with numbers (Q1 to Q5). Wording follows prereg sec 11: legacy numbers are in-sample."""
    t = rep["H6"]
    b = rep["B2"]
    q5 = rep["legacy"]["fresh"]
    hb = rep["group_level"]
    gen = rep["score_file_pools"]["H1_generated"]
    return {
        "Q1": f"D1 real rows, freeze module: {b['blocking_path_false_blocks_after']['count']} false blocks on the blocking path (n={b['real_gold_negatives']} real gold negatives; vacuous because BLOCKING_KINDS is empty); "
              f"all-kinds false alarms on real negatives before {b['all_kinds_false_alarms_before']['count']} -> after {b['all_kinds_false_alarms_after']['count']}; "
              f"new after: {len(b['all_kinds_false_alarm_ids_new_after'])} ({', '.join(b['all_kinds_false_alarm_ids_new_after']) or 'none'}). In-sample.",
        "Q2": f"BLOCKING_KINDS = {t['blocking_kinds_constant']} (recomputed {t['shipped_selection']}); most groups with an emission for any kind: {t['max_groups_with_an_emission']} (need 9); kinds with >= 9 groups: {t['kinds_with_9_or_more_groups'] or 'none'}.",
        "Q3": f"vacuous (BLOCKING_KINDS empty): shipped path blocks nothing; generated HELDOUT {gen['false_blocks']} of {gen['n_gold_negative']} negatives, Wilson {gen['wilson95']}; at group level {hb['H1_shipped_path']['generated']['false_groups']} of {hb['H1_shipped_path']['generated']['n_groups']} groups.",
        "Q4": f"all-kinds on HELDOUT: would-block on negatives {rep['score_file_pools']['H3_generated']['would_block_on_negatives']}; recall {rep['score_file_pools']['H3_generated']['recall']}.",
        "Q5": f"all-kinds false alarms on the legacy negatives file (done_claim_fresh.jsonl, {q5['before']['false_alarms']['n_negatives']} negatives, in-sample): before {q5['before']['false_alarms']['count']} -> after {q5['after']['false_alarms']['count']}; "
              f"fixed {len(q5['false_alarm_ids_fixed'])}, new {len(q5['false_alarm_ids_new'])}, kept {len(q5['false_alarm_ids_kept'])}.",
    }


def strip_private(d):
    if isinstance(d, dict):
        return {k: strip_private(v) for k, v in d.items() if not k.startswith("_dump")}
    if isinstance(d, list):
        return [strip_private(x) for x in d]
    return d


def build(scratch: str) -> dict:
    with open(SCORE_PATH, encoding="utf-8") as fh:
        score = json.load(fh)
    with open(FREEZE_PATH, encoding="utf-8") as fh:
        freeze = json.load(fh)
    train_header, train_rows = read_jsonl(os.path.join(DATA_DIR, "r6_train.jsonl"))
    held_header = read_header_only(os.path.join(DATA_DIR, "r6_heldout.jsonl"))
    _h, corpus = read_jsonl(os.path.join(DATA_DIR, "done_claim_corpus.jsonl"))
    _h, gtrain = read_jsonl(os.path.join(DATA_DIR, "done_claim_gtrain.jsonl"))
    _h, fresh = read_jsonl(os.path.join(DATA_DIR, "done_claim_fresh.jsonl"))
    with open(os.path.join(FIX_DIR, "spend_ledger.jsonl"), encoding="utf-8") as fh:
        ledger = [json.loads(l) for l in fh if l.strip()]
    manifests = {}
    for name in ("manifest", "manifest_m2"):
        with open(os.path.join(FIX_DIR, name + ".json"), encoding="utf-8") as fh:
            manifests["m1" if name == "manifest" else "m2"] = json.load(fh)["fixtures"]
    manifest_ids = {f["id"] for fx in manifests.values() for f in fx}
    old = load_detector(BASELINE, scratch)
    new = load_detector(FREEZE_COMMIT, scratch)
    rep: dict = {
        "generated_for": "round 6 phase L; freeze commit " + FREEZE_COMMIT + ", score commit " + SCORE_COMMIT, "protocol": "docs/audits/2026-11-18_atlas-round6-preregistration.md",
        "wording": "every number computed on legacy or r6_train rows is IN-SAMPLE (TRAIN, burnt); only the score-file pools are out of sample",
        "detector_modules": {BASELINE: old.__r6_blob_sha1__, FREEZE_COMMIT: new.__r6_blob_sha1__},
    }
    rep["H6"] = h6(new, "support pool = corpus + gtrain + r6_train after pool_split; module loaded from git, never the working tree")
    legacy = legacy_before_after(old, new, {"corpus": corpus, "gtrain": gtrain, "fresh": fresh})
    rep["B2"] = b2(legacy)
    rep["legacy"] = legacy
    rep["group_level"] = group_bounds(score)
    rep["negatives_by_gold_label"] = negative_split(score)
    rep["by_model"] = by_model(score, train_rows, train_header, held_header)
    rep["spend"] = spend(ledger)
    rep["eligibility_train"] = eligibility(new, train_rows)
    rep["reconciliation"] = reconcile(train_rows, train_header, held_header, score["rows"], ledger, manifest_ids)
    train_groups = {r["group"] for r in train_rows}
    rep["siblings"] = siblings(fixture_hashes(), manifests, train_groups, score["rows"])
    rep["conflicts_train"] = conflict_replies(train_header)
    rep["checks"] = {"C3_C4_recount": check_recount(score), "C7_hashes": check_hashes(freeze, score), "C8_votes": check_votes(train_rows, train_header, held_header, score),
                    "C9": check_real_positives(train_rows, score), "C10_spend_total_usd": rep["spend"]["total_usd"], "C12": check_shipped_data(),
                    "not_computed_here": ["C2 (regression tests on both modules)", "C11 (pytest counts)", "C13 (attestations)"]}
    rep["score_file_pools"] = {"H1_generated": score["H1"]["generated"], "H3_generated": score["H3"]["generated"]}
    rep["answers"] = answers(rep)
    del rep["score_file_pools"]
    return strip_private(rep)


def summarize(rep: dict) -> list[str]:
    out = ["== H6 TRAIN tier table (module %s), pool %d rows" % (FREEZE_COMMIT, rep["H6"]["pool"]["kept"])]
    out.append("   %-24s%5s%4s%4s%7s%7s%6s%5s%7s%8s%8s%10s  %s" % ("kind", "rows", "TP", "FP", "realFP", "genTP", "grp", "ok", "P", "grpLo", "cv/25", "tier", "first failing"))
    for k, v in rep["H6"]["table"].items():
        ff = v["first_failing"]
        out.append("   %-24s%5d%4d%4d%7d%7d%6d%5d%7s%8.3f%8d%10s  %s" % (
            k, v["rows"], v["tp"], v["fp"], v["real_fp"], v["generated_tp"], v["groups"], v["groups_ok"],
            "n/a" if v["row_precision"] is None else "%.3f" % v["row_precision"], v["group_wilson_lower"], v["cv_fits"], v["tier"],
            "-" if ff is None else "cond %d %s: %s vs %s" % (ff["n"], ff["name"], ff["value"], ff["threshold"])))
    out.append("   BLOCKING_KINDS constant %s; recomputed %s; equal: %s" % (rep["H6"]["blocking_kinds_constant"], rep["H6"]["shipped_selection"], rep["H6"]["constant_equals_recomputed"]))
    out.append("== H5 before/after (%s -> %s)" % (BASELINE, FREEZE_COMMIT))
    for name, d in rep["legacy"].items():
        for part in d["before"]["numbers"]:
            b, a = d["before"]["numbers"][part], d["after"]["numbers"][part]
            out.append("   %-7s %-6s n=%-4d blocking before %s after %s | all-kinds before %s after %s" % (
                name, part, b["n"], "TP=%(tp)d FP=%(fp)d FN=%(fn)d" % b["blocking_path"], "TP=%(tp)d FP=%(fp)d FN=%(fn)d" % a["blocking_path"],
                "TP=%(tp)d FP=%(fp)d FN=%(fn)d" % b["all_kinds"], "TP=%(tp)d FP=%(fp)d FN=%(fn)d" % a["all_kinds"]))
        out.append("   %-7s flips: %d rows; false alarms on negatives %d -> %d (fixed %d, new %d)" % (
            name, len(d["flips"]), d["before"]["false_alarms"]["count"], d["after"]["false_alarms"]["count"], len(d["false_alarm_ids_fixed"]), len(d["false_alarm_ids_new"])))
    for q, text in rep["answers"].items():
        out.append("== %s: %s" % (q, text))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scratch", default=DEFAULT_SCRATCH, help="where git-show copies of the detector modules are written")
    ap.add_argument("--out", default=OUT_PATH)
    args = ap.parse_args(argv)
    rep = build(args.scratch)
    with open(args.out, "w", encoding="ascii") as fh:
        json.dump(rep, fh, indent=1, sort_keys=False, ensure_ascii=True)
        fh.write("\n")
    for line in summarize(rep):
        print(line)
    print("wrote %s (%d bytes)" % (os.path.relpath(args.out, REPO_ROOT), os.path.getsize(args.out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
