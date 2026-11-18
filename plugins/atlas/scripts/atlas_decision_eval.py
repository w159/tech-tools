#!/usr/bin/env python3
"""Held-out evaluation of the decision model's task-class routing.

The hook sends one request (system prompt + user prompt + JSON schema, built by
prompt_decision.decision_request) to a local Ollama model. Ollama models cannot be downloaded in every
environment, so this tool answers the SAME request through `claude -p --model haiku|sonnet` as stand-in
backends and scores them against the keyword router (prompt_optimizer_core.classify_scope) on a held-out
set of real user prompts. Stand-in numbers say nothing about llama3.2:3b; they bound what a strong model
can do with this prompt and schema.

Subcommands (data files sit next to this script):
  mine                 build decision_eval_set.json from ~/.claude/projects/**/*.jsonl user messages
  label --labeler opus --help-source router|matrix
                       one independent label per prompt; "router" uses the class help the hook sends,
                       "matrix" uses class descriptions written from contracts/scope-matrix.json
  adjudicate           a third opus call breaks the router/matrix disagreements; both votes are kept
  run --backend M      ask backend M the decision request per prompt, store answers in the cache
  report               OFFLINE: score keyword router + cached backends (default; no model calls)

Rerun offline: python3 plugins/atlas/scripts/atlas_decision_eval.py report
Spend is logged per call in the cache file; model calls stop at --cap USD (default 1.5).
The prompt goes to `claude -p` on stdin, never as a trailing argument.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import math
import os
import random
import re
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS = os.path.join(HERE, "..", "hooks")
SET_PATH = os.path.join(HERE, "decision_eval_set.json")
CACHE_PATH = os.path.join(HERE, "decision_eval_cache.json")
MATRIX_PATH = os.path.join(HERE, "..", "contracts", "scope-matrix.json")
TARGET_N = 150
SEED = 20261116
BACKENDS = ("haiku", "sonnet")
LABELERS = ("opus",)
HELP_SOURCES = ("router", "matrix")

if HOOKS not in sys.path:
    sys.path.insert(0, HOOKS)
import done_claim  # noqa: E402  (owner of the Wilson interval)
import prompt_decision  # noqa: E402  (owner of ROUTE_CONFIDENCE_MIN and TIMEOUT_S)
import prompt_optimizer_core  # noqa: E402

# One definition of the Wilson interval, shared with the done-claim gate.
wilson = done_claim.wilson_interval


def _hooks():
    return prompt_decision, prompt_optimizer_core


def _load(path: str, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _save(path: str, data) -> None:
    """Atomic write: a unique temp file in the same directory, fsync, then rename over the target. A failed
    dump leaves the previous file untouched and no temp file behind."""
    fd, tmp = tempfile.mkstemp(prefix=os.path.basename(path) + ".", suffix=".tmp", dir=os.path.dirname(path) or ".")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=1, ensure_ascii=True, sort_keys=True)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------- statistics


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact McNemar p-value: binomial(b + c, 0.5) on the discordant pairs, doubled and capped at 1."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    return min(1.0, 2.0 * sum(math.comb(n, i) for i in range(k + 1)) / 2.0**n)


def holm_adjust(pvals: list[float]) -> list[float]:
    """Holm-Bonferroni adjusted p-values, returned in input order: sort ascending, scale p_(i) by (m - i + 1),
    enforce monotone non-decrease, cap at 1."""
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    out = [0.0] * m
    run = 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (m - rank) * pvals[i]))
        out[i] = run
    return out


def paired(rows: list, labels: dict, a: dict, b: dict) -> dict:
    """Discordant pairs of predictions a vs b: a_only = a right and b wrong, b_only the reverse."""
    a_only = sum(1 for r in rows if a.get(r["id"]) == labels[r["id"]] and b.get(r["id"]) != labels[r["id"]])
    b_only = sum(1 for r in rows if b.get(r["id"]) == labels[r["id"]] and a.get(r["id"]) != labels[r["id"]])
    return {"model_only": a_only, "keyword_only": b_only, "p": mcnemar_exact(a_only, b_only)}


def percentile(values: list[float], q: float) -> float | None:
    """Linear-interpolated percentile (q in 0..100)."""
    if not values:
        return None
    s = sorted(values)
    pos = (len(s) - 1) * q / 100.0
    lo, hi = int(math.floor(pos)), int(math.ceil(pos))
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


# -------------------------------------------------------------------- mining

_SKIP_START = ("#", "<", "TOOLS:", "This session", "You are ", "Work alone", "GOAL:", "SCOPE:")
_PROBE = re.compile(r"^(say|reply|run exactly)\b", re.IGNORECASE)
_SECRET = re.compile(r"(sk-[A-Za-z0-9]{10,}|ghp_\w+|[\w.+-]+@[\w-]+\.\w+|AKIA\w{8,}|password\s*[:=])", re.IGNORECASE)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip()


def tuning_text() -> str:
    """Normalized text of everything the router was tuned or tested on that is readable from the repo:
    routing_corpus.jsonl, the router and decision tests, prompt_decision.py, the contracts."""
    paths = [
        os.path.join(HOOKS, n)
        for n in (
            "routing_corpus.jsonl",
            "test_prompt_decision.py",
            "test_prompt_optimizer.py",
            "prompt_decision.py",
            "prompt_optimizer_core.py",
        )
    ]
    paths += glob.glob(os.path.join(HERE, "..", "contracts", "*.json"))
    parts = []
    for p in paths:
        try:
            with open(p, encoding="utf-8", errors="ignore") as fh:
                parts.append(_norm(fh.read()))
        except OSError:
            continue
    return " ".join(parts)


def _user_text(obj: dict) -> str | None:
    if obj.get("type") != "user" or obj.get("isMeta") or obj.get("isSidechain"):
        return None
    content = (obj.get("message") or {}).get("content")
    if isinstance(content, list):
        if any(not isinstance(b, dict) or b.get("type") != "text" for b in content):
            return None  # tool results and images are not typed prompts
        content = " ".join(b.get("text", "") for b in content)
    return content.strip() if isinstance(content, str) else None


# A hex run only counts as an id when it holds a digit, so words like "decade" or "facade" stay words.
_HEXID = re.compile(r"\b(?=[0-9a-f]*\d)[0-9a-f]{6,}\b|\d+")


def _dedup_key(text: str) -> str:
    return _HEXID.sub("N", text.lower())[:45]


def _src_hash(path: str) -> str:
    """Short stable hash of the project directory name (the name itself can identify a person or project)."""
    return hashlib.sha256(os.path.basename(os.path.dirname(path)).encode("utf-8")).hexdigest()[:8]


def mine(root: str, limit: int = TARGET_N, seed: int = SEED) -> dict:
    """Unique human-typed prompts from Claude Code transcripts under `root`, minus harness templates,
    dispatch briefs, probes ("say ok") and anything contained in the tuning text. When more than `limit`
    candidates remain, a random sample drawn with `seed` (recorded in the result) is kept."""
    seen_keys: set = set()
    cands: list = []
    stats = {"user_messages": 0, "templated_or_brief": 0, "probe": 0, "secret": 0, "tuning_overlap": 0, "duplicate": 0}
    tuned = tuning_text()
    for path in sorted(glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True)):
        if "/subagents/" in path:
            continue
        try:
            fh = open(path, encoding="utf-8", errors="ignore")
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    text = _user_text(json.loads(line))
                except ValueError:
                    continue
                if not text:
                    continue
                stats["user_messages"] += 1
                if text.startswith(_SKIP_START) or not (12 <= len(text) <= 1200):
                    if _PROBE.match(text) or len(text) < 12:
                        stats["probe"] += 1
                    else:
                        stats["templated_or_brief"] += 1
                    continue
                if _PROBE.match(text):
                    stats["probe"] += 1
                    continue
                if _SECRET.search(text):
                    stats["secret"] += 1
                    continue
                key = _dedup_key(text)
                if key in seen_keys:
                    stats["duplicate"] += 1
                    continue
                seen_keys.add(key)
                if _norm(text) in tuned:
                    stats["tuning_overlap"] += 1
                    continue
                cands.append({"prompt": text, "src": _src_hash(path)})
    pool = len(cands)
    if pool > limit:
        cands = random.Random(seed).sample(cands, limit)
    rows = [{"id": "dp-%03d" % (i + 1), "prompt": c["prompt"], "src": c["src"]} for i, c in enumerate(cands)]
    return {"target": limit, "mined": len(rows), "pool": pool, "seed": seed, "stats": stats, "rows": rows}


# ---------------------------------------------------------------- model calls


class Spend:
    def __init__(self, cache: dict, cap: float):
        self.cache, self.cap = cache, cap

    def total(self) -> float:
        """Known spend; a call whose cost is unknown (usd null) adds nothing here and is counted by unknown()."""
        return sum(e.get("usd") or 0.0 for e in self.cache.get("spend", []))

    def unknown(self) -> int:
        return sum(1 for e in self.cache.get("spend", []) if e.get("usd") is None)

    def log(self, kind: str, model: str, pid: str, usd: float | None) -> None:
        self.cache.setdefault("spend", []).append({"kind": kind, "model": model, "id": pid, "usd": usd})

    def ok(self) -> bool:
        return self.total() < self.cap


def claude_call(model: str, system: str, user: str, schema: dict, timeout: float = 120.0) -> dict:
    """One `claude -p` call, structured output. {"obj", "latency_s", "usd", "error"}. The prompt goes on
    stdin so a prompt that starts with "-" is never parsed as a flag. Runs in a temp cwd with no settings
    sources and no tools so project hooks and CLAUDE.md never enter the prompt. usd is the CLI's
    total_cost_usd, or None (unknown) when the call produced no readable result: never 0.0 on failure."""
    cmd = [
        "claude", "-p", "--model", model, "--output-format", "json", "--tools", "",
        "--no-session-persistence", "--setting-sources", "", "--system-prompt", system,
        "--json-schema", json.dumps(schema),
    ]
    t0 = time.monotonic()
    try:
        r = subprocess.run(cmd, input=user, capture_output=True, text=True, timeout=timeout, cwd=tempfile.gettempdir())
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"obj": None, "latency_s": time.monotonic() - t0, "usd": None, "error": type(exc).__name__}
    lat = time.monotonic() - t0
    try:
        out = json.loads(r.stdout)
    except ValueError:
        return {"obj": None, "latency_s": lat, "usd": None, "error": "bad_json rc=%s %s" % (r.returncode, r.stderr[:120])}
    if not isinstance(out, dict):
        return {"obj": None, "latency_s": lat, "usd": None, "error": "bad_json not an object"}
    cost = out.get("total_cost_usd")
    usd = float(cost) if isinstance(cost, (int, float)) and not isinstance(cost, bool) else None
    obj = out.get("structured_output")
    if obj is None and isinstance(out.get("result"), str):
        try:
            obj = json.loads(out["result"])
        except ValueError:
            obj = None
    err = None
    if out.get("is_error"):
        err, obj = "cli_error", None
    elif obj is None:
        err = "no_structured_output"
    return {"obj": obj, "latency_s": lat, "usd": usd, "error": err}


def _classes() -> list[str]:
    pd, _ = _hooks()
    return pd.scope_classes()


# Class descriptions written from contracts/scope-matrix.json, not from the hook's _CLASS_HELP: each lead-in
# says what the matrix staffs that class to do (its roles and their tool profiles); the roles line is
# generated from the matrix at call time.
_MATRIX_LEAD = {
    "implement": "Work that edits product code to build or change behavior.",
    "fix": "Work that first traces a defect with read-only explorers, then edits code to repair it.",
    "verify": "Work that only runs checks to confirm finished work; verifiers, no edits.",
    "audit": "Read-only investigation of existing material by explorers and a completeness critic; nothing is edited.",
    "docs": "Work on documentation, written by a docs curator and checked by a docs auditor.",
    "db": "Work on a database by probers with read access, with a verifier for the largest jobs.",
    "ui-test": "Runtime testing of a user interface by testers that drive it and report failures.",
    "test": "Test engineering: a test engineer writes and runs automated tests.",
    "db-audit": "Read-only audit of a live database by probers, with an explorer and critic at high effort.",
}


def matrix_help() -> dict:
    """{class: description} built from the scope matrix: a lead-in plus the roles and tool profiles it staffs."""
    with open(MATRIX_PATH, encoding="utf-8") as fh:
        classes = (json.load(fh).get("classes") or {})
    out = {}
    for c, efforts in classes.items():
        roles: dict = {}
        for spec in efforts.values():
            for t in spec.get("team", []):
                roles.setdefault(t["role"], t.get("tools_profile", "?"))
        shape = "; ".join("%s (%s)" % kv for kv in sorted(roles.items()))
        out[c] = "%s Team roles: %s." % (_MATRIX_LEAD.get(c, "Work of class %s." % c), shape)
    return out


def _help_for(source: str) -> dict:
    if source == "router":
        return dict(_hooks()[0]._CLASS_HELP)
    if source == "matrix":
        return matrix_help()
    raise ValueError("unknown help source %r" % source)


def label_call(model: str, prompt: str, help_source: str = "router") -> dict:
    classes = _classes()
    desc = _help_for(help_source)
    system = "\n".join(
        ["Classify the user's prompt into exactly one task class. Reply with JSON only.", "Classes:"]
        + ["- %s: %s" % (c, desc.get(c, "")) for c in classes]
        + ["If the prompt names a kind of work to avoid, ignore that kind and pick what is asked for."]
    )
    schema = {"type": "object", "properties": {"label": {"type": "string", "enum": classes}}, "required": ["label"]}
    return claude_call(model, system, prompt, schema)


def adjudicate_call(prompt: str, a: str, b: str) -> dict:
    """Third opus call on a disagreement. Uses the matrix descriptions, the neutral side of the two votes."""
    desc = matrix_help()
    system = "\n".join(
        ["Two labelers disagree on the task class of a user prompt. Pick the correct one of the two. JSON only."]
        + ["- %s: %s" % (c, desc.get(c, "")) for c in (a, b)]
    )
    schema = {"type": "object", "properties": {"label": {"type": "string", "enum": [a, b]}}, "required": ["label"]}
    return claude_call("opus", system, prompt, schema)


def decision_call(model: str, prompt: str) -> dict:
    """The decision request of the ollama path, answered by a stand-in backend."""
    pd, _ = _hooks()
    messages, schema, questions = pd.decision_request(prompt)
    system = next(m["content"] for m in messages if m["role"] == "system")
    user = next(m["content"] for m in messages if m["role"] == "user")
    res = claude_call(model, system, user, schema)
    res["answers"] = pd.validate_answer(json.dumps(res["obj"]), questions) if res["obj"] is not None else None
    res.pop("obj", None)
    return res


# -------------------------------------------------------------------- scoring


def final_labels(dset: dict) -> dict:
    out = {}
    for r in dset.get("rows", []):
        v = r.get("votes") or {}
        if r.get("label"):
            out[r["id"]] = r["label"]
        elif len(v) == 2 and len(set(v.values())) == 1:
            out[r["id"]] = next(iter(v.values()))
    return out


def score(dset: dict, cache: dict) -> dict:
    """{backend: metrics} for "keyword" and every cached backend, over rows that have a final label.
    A row a backend has no cached answer for counts as incorrect for it."""
    pd, poc = _hooks()
    labels = final_labels(dset)
    rows = [r for r in dset.get("rows", []) if r["id"] in labels]
    classes = _classes()
    conf_min, timeout_s = pd.ROUTE_CONFIDENCE_MIN, pd.TIMEOUT_S
    res: dict = {"n": len(rows), "classes": classes, "label_counts": {}, "timeout_s": timeout_s, "backends": {}}
    for r in rows:
        res["label_counts"][labels[r["id"]]] = res["label_counts"].get(labels[r["id"]], 0) + 1

    def summarize(preds: dict, lats: list[float]) -> dict:
        n = len(rows)
        k = sum(1 for r in rows if preds.get(r["id"]) == labels[r["id"]])
        conf: dict = {}
        for r in rows:
            conf.setdefault(labels[r["id"]], {}).setdefault(preds.get(r["id"]) or "none", 0)
            conf[labels[r["id"]]][preds.get(r["id"]) or "none"] += 1
        lo, hi = wilson(k, n)
        return {
            "correct": k, "n": n, "accuracy": k / n if n else None, "wilson95": [lo, hi],
            "confusion": conf, "latency_p50_s": percentile(lats, 50), "latency_p95_s": percentile(lats, 95),
        }

    kw = {r["id"]: poc.classify_scope(r["prompt"])[0] for r in rows}
    t = []
    for r in rows:
        t0 = time.perf_counter()
        poc.classify_scope(r["prompt"])
        t.append(time.perf_counter() - t0)
    res["backends"]["keyword"] = summarize(kw, t)
    for name, entries in sorted((cache.get("answers") or {}).items()):
        preds, lats, conf_preds, answered, slow = {}, [], {}, 0, set()
        for r in rows:
            e = entries.get(r["id"])
            if not e:
                continue
            lats.append(e["latency_s"])
            if e["latency_s"] > timeout_s:
                slow.add(r["id"])
            ans = e.get("answers") or {}
            tc = ans.get("task_class")
            if tc:
                preds[r["id"]] = tc["choice"]
                answered += 1
                if tc["confidence"] >= conf_min:
                    conf_preds[r["id"]] = tc["choice"]
        m = summarize(preds, lats)
        m["answered"] = answered
        m["mcnemar_vs_keyword"] = paired(rows, labels, preds, kw)
        # hook behavior: model class when confident (>= ROUTE_CONFIDENCE_MIN), else the keyword class
        combined = {r["id"]: conf_preds.get(r["id"], kw[r["id"]]) for r in rows}
        ck = sum(1 for r in rows if combined[r["id"]] == labels[r["id"]])
        m["confident"] = len(conf_preds)
        m["confident_correct"] = sum(1 for i, c in conf_preds.items() if c == labels[i])
        m["combined_correct"] = ck
        m["combined_wilson95"] = list(wilson(ck, len(rows)))
        m["combined_mcnemar_vs_keyword"] = paired(rows, labels, combined, kw)
        # a call slower than the hook's TIMEOUT_S would return nothing: the keyword class stands
        timed = {r["id"]: (kw[r["id"]] if r["id"] in slow else combined[r["id"]]) for r in rows}
        tk = sum(1 for r in rows if timed[r["id"]] == labels[r["id"]])
        m["over_timeout"] = len(slow)
        m["calls"] = len(lats)
        m["combined_timeout_correct"] = tk
        m["combined_timeout_wilson95"] = list(wilson(tk, len(rows)))
        m["combined_timeout_mcnemar_vs_keyword"] = paired(rows, labels, timed, kw)
        res["backends"][name] = m
    return res


def _mc(d: dict) -> str:
    return "model-only correct %d, keyword-only correct %d, exact p=%.4f" % (d["model_only"], d["keyword_only"], d["p"])


MC_KEYS = (("mcnemar_vs_keyword", "%s vs keyword"),
           ("combined_mcnemar_vs_keyword", "hook-combined %s vs keyword"),
           ("combined_timeout_mcnemar_vs_keyword", "timeout-aware hook-combined %s vs keyword"))


def mcnemar_family(res: dict) -> list[dict]:
    """Every McNemar test in the report as one family, with Holm-Bonferroni adjusted p-values."""
    fam = [{"name": fmt % name, "model_only": m[key]["model_only"], "keyword_only": m[key]["keyword_only"], "p": m[key]["p"]}
           for name, m in res["backends"].items() if "combined_correct" in m for key, fmt in MC_KEYS]
    for row, adj in zip(fam, holm_adjust([r["p"] for r in fam])):
        row["p_holm"] = adj
    return fam


def label_agreement(dset: dict) -> dict:
    rows = dset.get("rows", [])
    two = [r for r in rows if len(r.get("votes") or {}) == 2]
    agree = sum(1 for r in two if len(set(r["votes"].values())) == 1)
    return {"rows": len(rows), "two_votes": len(two), "agree": agree, "adjudicated": sum(1 for r in rows if r.get("adjudicated"))}


def format_report(res: dict, dset: dict, cache: dict) -> str:
    out = ["decision eval: n=%d labeled prompts (target %s, mined %s)" % (res["n"], dset.get("target"), dset.get("mined"))]
    out.append("label counts: " + ", ".join("%s=%d" % kv for kv in sorted(res["label_counts"].items())))
    ag = label_agreement(dset)
    out.append(
        "labelers opus(router help) / opus(matrix help) agreed on %d of %d (%.3f); %d disagreements adjudicated by a third opus call"
        % (ag["agree"], ag["two_votes"], ag["agree"] / ag["two_votes"] if ag["two_votes"] else 0.0, ag["adjudicated"])
    )
    unlabeled = [r["id"] for r in dset.get("rows", []) if r["id"] not in final_labels(dset)]
    if unlabeled:
        out.append("not scored (no final label, disagreement not yet adjudicated): %s" % ", ".join(unlabeled))
    spend = cache.get("spend", [])
    out.append(
        "spend: USD %.4f over %d calls (%d with unknown cost)"
        % (sum(e.get("usd") or 0.0 for e in spend), len(spend), sum(1 for e in spend if e.get("usd") is None))
    )
    conf_min = _hooks()[0].ROUTE_CONFIDENCE_MIN
    for name, m in res["backends"].items():
        lo, hi = m["wilson95"]
        out.append("")
        out.append("[%s] accuracy %d/%d = %.3f  Wilson95 [%.3f, %.3f]" % (name, m["correct"], m["n"], m["accuracy"] or 0, lo, hi))
        p50, p95 = m["latency_p50_s"], m["latency_p95_s"]
        out.append("  latency p50 %s s  p95 %s s" % ("n/a" if p50 is None else "%.4f" % p50, "n/a" if p95 is None else "%.4f" % p95))
        if "combined_correct" in m:
            clo, chi = m["combined_wilson95"]
            tlo, thi = m["combined_timeout_wilson95"]
            out.append(
                "  answered %d, confident(>=%.1f) %d (%d correct); hook-combined %d/%d = %.3f Wilson95 [%.3f, %.3f]"
                % (m["answered"], conf_min, m["confident"], m["confident_correct"],
                   m["combined_correct"], m["n"], m["combined_correct"] / m["n"] if m["n"] else 0, clo, chi)
            )
            out.append("  McNemar exact, %s vs keyword: %s" % (name, _mc(m["mcnemar_vs_keyword"])))
            out.append("  McNemar exact, hook-combined %s vs keyword: %s" % (name, _mc(m["combined_mcnemar_vs_keyword"])))
            out.append(
                "  calls over hook TIMEOUT_S (%.1f s): %d/%d = %.3f"
                % (res["timeout_s"], m["over_timeout"], m["calls"], m["over_timeout"] / m["calls"] if m["calls"] else 0.0)
            )
            out.append(
                "  hook-combined with calls over %.1f s falling back to keyword: %d/%d = %.3f Wilson95 [%.3f, %.3f]"
                % (res["timeout_s"], m["combined_timeout_correct"], m["n"],
                   m["combined_timeout_correct"] / m["n"] if m["n"] else 0.0, tlo, thi)
            )
            out.append("  McNemar exact, timeout-aware hook-combined %s vs keyword: %s" % (name, _mc(m["combined_timeout_mcnemar_vs_keyword"])))
        out.append("  confusion (rows = label, cols = predicted):")
        for want in sorted(m["confusion"]):
            out.append("    %-10s " % want + " ".join("%s:%d" % kv for kv in sorted(m["confusion"][want].items())))
    fam = mcnemar_family(res)
    if fam:
        out.append("")
        out.append("McNemar family of %d tests, Holm-Bonferroni adjusted (raw p kept):" % len(fam))
        for r in fam:
            out.append("  %-45s model-only %d, keyword-only %d  raw p=%.4f  Holm p=%.4f"
                       % (r["name"], r["model_only"], r["keyword_only"], r["p"], r["p_holm"]))
    return "\n".join(out)


# ------------------------------------------------------------------------ CLI


def _need_budget(spend: Spend) -> bool:
    if not spend.ok():
        print("spend cap reached: USD %.4f >= %.2f" % (spend.total(), spend.cap), file=sys.stderr)
        return False
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", nargs="?", default="report", choices=["mine", "label", "adjudicate", "run", "report"])
    ap.add_argument("--labeler", choices=LABELERS)
    ap.add_argument("--help-source", choices=HELP_SOURCES, help="class descriptions the labeler sees (label)")
    ap.add_argument("--backend", choices=BACKENDS)
    ap.add_argument("--cap", type=float, default=1.5, help="USD cap on cached spend (default 1.5)")
    ap.add_argument("--seed", type=int, default=SEED, help="sampling seed for mine (default %d)" % SEED)
    ap.add_argument("--root", default=os.path.expanduser("~/.claude/projects"))
    ap.add_argument("--set", default=SET_PATH)
    ap.add_argument("--cache", default=CACHE_PATH)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    if a.cmd == "mine":
        dset = mine(a.root, seed=a.seed)
        _save(a.set, dset)
        print("mined %d of target %d (pool %d, seed %d); stats %s" % (dset["mined"], dset["target"], dset["pool"], dset["seed"], dset["stats"]))
        return 0
    dset, cache = _load(a.set, {"rows": []}), _load(a.cache, {"answers": {}, "spend": []})
    spend = Spend(cache, a.cap)
    if a.cmd == "report":
        res = score(dset, cache)
        print(json.dumps(res, indent=1, sort_keys=True) if a.json else format_report(res, dset, cache))
        return 0
    if a.cmd == "label":
        if not a.labeler or not a.help_source:
            ap.error("--labeler and --help-source required")
        key = "%s-%s" % (a.labeler, a.help_source)
        classes = _classes()
        for r in dset["rows"]:
            if key in r.setdefault("votes", {}) or not _need_budget(spend):
                continue
            res = label_call(a.labeler, r["prompt"], a.help_source)
            spend.log("label", key, r["id"], res["usd"])
            label = (res["obj"] or {}).get("label") if not res["error"] else None
            if label in classes:
                r["votes"][key] = label
            else:
                print("label failed for %s: %s" % (r["id"], res["error"]), file=sys.stderr)
            _save(a.set, dset)
            _save(a.cache, cache)
        return 0
    if a.cmd == "adjudicate":
        for r in dset["rows"]:
            v = r.get("votes") or {}
            if len(v) == 2 and len(set(v.values())) == 2 and not r.get("label") and _need_budget(spend):
                x, y = (v[k] for k in sorted(v))
                res = adjudicate_call(r["prompt"], x, y)
                spend.log("adjudicate", "opus", r["id"], res["usd"])
                if not res["error"] and res["obj"] and res["obj"].get("label") in (x, y):
                    r["label"], r["adjudicated"] = res["obj"]["label"], True
                else:
                    print("adjudication failed for %s: %s" % (r["id"], res["error"]), file=sys.stderr)
            _save(a.set, dset)
            _save(a.cache, cache)
        return 0
    if not a.backend:
        ap.error("--backend required")
    store = cache.setdefault("answers", {}).setdefault(a.backend, {})
    labels = final_labels(dset)
    for r in dset["rows"]:
        if r["id"] in store or r["id"] not in labels or not _need_budget(spend):
            continue
        res = decision_call(a.backend, r["prompt"])
        spend.log("decision", a.backend, r["id"], res["usd"])
        if res["error"]:
            # a failed call is never cached as an answer: the next run asks again
            print("decision call failed for %s: %s" % (r["id"], res["error"]), file=sys.stderr)
        else:
            store[r["id"]] = {"answers": res["answers"], "latency_s": res["latency_s"], "usd": res["usd"], "error": None}
        _save(a.cache, cache)
    return 0


if __name__ == "__main__":
    sys.exit(main())
