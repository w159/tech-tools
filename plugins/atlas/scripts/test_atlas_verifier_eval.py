"""Offline tests for atlas_verifier_eval: corpus integrity, verdict parsing, metric math.

No model is called. Corpus tests run each case's own pytest files in a temp dir.
"""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_verifier_eval as ev  # noqa: E402
from atlas_verifier_eval_cases import BAD_KINDS, CASES  # noqa: E402

GOOD = [c for c in CASES if c["label"] == "good"]
BAD = [c for c in CASES if c["label"] == "bad"]
HIDDEN_FAIL_KINDS = {"boundary", "wrong_branch", "requirement", "weakened_assertion", "wrong_function"}


def _ids(cases):
    return [c["id"] for c in cases]


# ------------------------------------------------------------------ corpus shape


def test_corpus_counts_and_kinds():
    assert len(CASES) == 30
    assert len(GOOD) == 15 and len(BAD) == 15
    assert len({c["id"] for c in CASES}) == 30
    assert {c["kind"] for c in BAD} == set(BAD_KINDS)
    assert all(c["kind"] == "good" for c in GOOD)
    assert {c["mod"] for c in CASES} and len({c["mod"] for c in CASES}) == 30


def test_every_case_has_diff_task_claim():
    for c in CASES:
        assert ev.make_diff(c).strip(), c["id"]
        assert c["task"] and c["claim"]
        assert ev.claimed_pass_count(c["claim"]) is not None, c["id"]


def test_no_hidden_leak_into_prompt():
    import re

    # weakened-assertion cases legitimately show the original tests in the diff
    for c in BAD:
        if c["hidden"] and c["kind"] != "weakened_assertion":
            text = ev.build_input(c)
            assert "test_hidden_oracle" not in text
            names = set(re.findall(r"def (test_\w+)", c["hidden"])) - set(re.findall(r"def (test_\w+)", c["tests"]))
            assert all(n not in text for n in names), c["id"]


# ------------------------------------------------------------------ corpus truth (runs real pytest on case files)


@pytest.mark.parametrize("case", GOOD, ids=_ids(GOOD))
def test_good_case_is_really_good(case, tmp_path):
    ev.materialize(case, tmp_path, with_hidden=True)
    rc, passed, failed = ev.run_pytest(tmp_path)
    assert (rc, failed) == (0, 0)
    assert passed == ev.claimed_pass_count(case["claim"]) + _hidden_count(case)


def _hidden_count(case):
    return case["hidden"].count("\ndef test_") + (1 if case["hidden"].startswith("def test_") else 0)


@pytest.mark.parametrize("case", GOOD, ids=_ids(GOOD))
def test_good_case_before_state_is_broken(case, tmp_path):
    ev.materialize(case, tmp_path)
    (tmp_path / f"{case['mod']}.py").write_text(case["before"], encoding="utf-8")
    rc, _, failed = ev.run_pytest(tmp_path)
    assert rc != 0 and failed >= 1


@pytest.mark.parametrize("case", BAD, ids=_ids(BAD))
def test_bad_case_is_really_bad_by_kind(case, tmp_path):
    ev.materialize(case, tmp_path, with_hidden=True)
    claimed = ev.claimed_pass_count(case["claim"])
    visible_rc, passed, failed = ev.run_pytest(tmp_path, f"test_{case['mod']}.py")
    kind = case["kind"]
    if kind == "count_mismatch":
        assert passed != claimed
        return
    # visible tests really pass with the claimed count, so only a careful verifier can refute
    assert (visible_rc, failed, passed) == (0, 0, claimed)
    assert case["hidden"]
    hidden_rc, _, hidden_failed = ev.run_pytest(tmp_path, "test_hidden_oracle.py")
    assert hidden_rc != 0 and hidden_failed >= 1, f"{case['id']} hidden oracle did not catch it"
    if kind == "weakened_assertion":
        assert case["tests"] != case["tests_before"]


def test_weakened_cases_diff_touches_tests():
    for c in BAD:
        if c["kind"] == "weakened_assertion":
            assert f"test_{c['mod']}.py" in ev.make_diff(c)


# ------------------------------------------------------------------ verdict parsing


@pytest.mark.parametrize("text,expected", [
    ("analysis...\nVERDICT: CONFIRMED", "confirmed"),
    ("analysis...\nVERDICT: REFUTED", "refuted"),
    ("**VERDICT: REFUTED**", "refuted"),
    ("verdict : refuted", "refuted"),
    ("VERDICT: NEEDS-EVIDENCE", "needs_evidence"),
    ("VERDICT: needs evidence", "needs_evidence"),
    ("VERDICT: CONFIRMED\nlater I changed my mind\nVERDICT: REFUTED", "refuted"),
    ("it is verified", "none"),
    ("", "none"),
    (None, "none"),
    ("VERDICT: MAYBE", "none"),
])
def test_parse_verdict(text, expected):
    assert ev.parse_verdict(text) == expected


# ------------------------------------------------------------------ metric math


def test_wilson_known_values():
    lo, hi = ev.wilson(15, 15)
    assert hi == pytest.approx(1.0) and lo == pytest.approx(0.7961, abs=1e-3)
    lo, hi = ev.wilson(0, 15)
    assert lo == pytest.approx(0.0, abs=1e-12) and hi == pytest.approx(0.2039, abs=1e-3)
    lo, hi = ev.wilson(5, 10)
    assert lo == pytest.approx(0.2366, abs=1e-3) and hi == pytest.approx(0.7634, abs=1e-3)
    assert ev.wilson(0, 0) == (0.0, 0.0)


def test_percentile_nearest_rank():
    xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    assert ev.percentile(xs, 50) == 50
    assert ev.percentile(xs, 95) == 100
    assert ev.percentile([7], 95) == 7
    assert ev.percentile([], 50) is None


def _rec(model, label, kind, verdict, secs=10.0, usd=0.1, bucket=None):
    return {"case": "x", "model": model, "label": label, "kind": kind, "verdict": verdict,
            "bucket": bucket or verdict, "seconds": secs, "cost_usd": usd}


def test_summarize_rates_buckets_and_kinds():
    recs = []
    recs += [_rec("m", "bad", "boundary", "refuted") for _ in range(2)]
    recs += [_rec("m", "bad", "boundary", "confirmed")]
    recs += [_rec("m", "bad", "wrong_branch", "none", bucket="none")]
    recs += [_rec("m", "bad", "wrong_branch", "needs_evidence")]
    recs += [_rec("m", "good", "good", "refuted")]
    recs += [_rec("m", "good", "good", "confirmed", secs=40.0, usd=0.5)]
    recs += [_rec("m", "good", "good", "none", bucket="timeout", secs=180.0, usd=0.0)]
    s = ev.summarize(recs)["m"]
    assert (s["bad_n"], s["caught"]) == (5, 2)
    assert s["catch_rate"] == pytest.approx(0.4)
    assert (s["good_n"], s["false_refuted"]) == (3, 1)
    assert s["no_verdict"] == 3
    assert s["no_verdict_buckets"] == {"none": 1, "needs_evidence": 1, "timeout": 1}
    assert s["kinds"]["boundary"] == (2, 3) and s["kinds"]["wrong_branch"] == (0, 2)
    assert s["usd"] == pytest.approx(0.1 * 6 + 0.5 + 0.0)
    assert s["p95"] == 180.0
    assert "| m |" in ev.render_tables({"m": s})


# ------------------------------------------------------------------ harness safety


def test_cmd_forbids_write_tools_and_loads_nothing_extra():
    cmd = ev.claude_cmd("claude-haiku-5-5", "sys")
    tools = cmd[cmd.index("--tools") + 1].split(",")
    assert set(tools) == {"Read", "Grep", "Glob", "Bash"}
    denied = cmd[cmd.index("--disallowedTools") + 1].split()
    assert {"Edit", "Write", "Agent", "Task"} <= set(denied)
    assert cmd[cmd.index("--setting-sources") + 1] == ""
    assert "--strict-mcp-config" in cmd and "--no-chrome" in cmd
    assert cmd[cmd.index("--output-format") + 1] == "json"


def test_system_prompt_is_verifier_body_minus_inapplicable_sections():
    p = ev.verifier_system_prompt()
    assert "skeptic" in p and "Reproduce, don't trust" in p
    assert "ToolSearch" not in p and "atlas_finding.py" not in p
    assert "VERDICT: REFUTED" in p
    assert not p.startswith("---")


# ====================================================================== hard tier
from atlas_verifier_eval_cases import ALL_CASES, FALSE_KINDS, HARD_BAD_KINDS, HARD_CASES  # noqa: E402

HGOOD = [c for c in HARD_CASES if c["label"] == "good"]
HBAD = [c for c in HARD_CASES if c["label"] == "bad"]
HBAD_SUBTLE = [c for c in HBAD if c["kind"] != "false_claim"]
HFALSE = [c for c in HBAD if c["kind"] == "false_claim"]


def _src_files(case, state="files_after"):
    return [n for n in case[state] if not n.startswith("test_")]


def _changed(case):
    b, a = case["files_before"], case["files_after"]
    return {n for n in a if b.get(n) != a[n]}


def _visible(case):
    names = ev.visible_test_files(case)
    assert len(names) == 1, case["id"]
    return names[0]


def test_hard_corpus_shape():
    assert len(HARD_CASES) == 24 and len(HGOOD) == 12 and len(HBAD) == 12
    assert len({c["id"] for c in ALL_CASES}) == 54
    assert sum(c["kind"] == "good" for c in HGOOD) == 8
    assert sum(c["kind"] == "good_limit" for c in HGOOD) == 4
    assert {c["kind"] for c in HBAD} == set(HARD_BAD_KINDS)
    assert len(HFALSE) == 4 and {c["flaw"] for c in HFALSE} == {"count", "command", "file", "skip"}
    for c in HARD_CASES:
        assert 2 <= len(_src_files(c)) <= 4, c["id"]
        assert c["hidden"] and ev.make_diff(c).strip() and ev.claimed_pass_count(c["claim"]) is not None


def test_hard_limit_cases_state_the_limitation_in_claim_and_task():
    for c in HGOOD:
        if c["kind"] == "good_limit":
            assert "limitation" in c["claim"].lower() and "Accepted limitation" in c["task"]


def test_select_false_good_counts():
    pool = ev.select_cases("all", "false_good")
    assert sum(c["label"] == "good" for c in pool) == 27
    assert sum(c["label"] == "bad" and c["kind"] in FALSE_KINDS for c in pool) == 6
    assert len(pool) == 33
    assert len(ev.select_cases("hard", "all")) == 24 and len(ev.select_cases("easy", "all")) == 30


@pytest.mark.parametrize("case", HGOOD, ids=_ids(HGOOD))
def test_hard_good_is_really_good(case, tmp_path):
    ev.materialize(case, tmp_path, with_hidden=True)
    rc, passed, failed = ev.run_pytest(tmp_path, _visible(case))
    assert (rc, failed, passed) == (0, 0, ev.claimed_pass_count(case["claim"]))
    assert ev.run_pytest(tmp_path, "test_hidden_oracle.py")[0] == 0


@pytest.mark.parametrize("case", HGOOD, ids=_ids(HGOOD))
def test_hard_good_before_state_is_broken(case, tmp_path):
    ev.materialize(case, tmp_path, with_hidden=True)
    for name, text in case["files_before"].items():
        (tmp_path / name).write_text(text, encoding="utf-8")
    rc, _, failed = ev.run_pytest(tmp_path)
    assert rc != 0 and failed >= 1


@pytest.mark.parametrize("case", HBAD_SUBTLE, ids=_ids(HBAD_SUBTLE))
def test_hard_bad_passes_visible_fails_hidden(case, tmp_path):
    ev.materialize(case, tmp_path, with_hidden=True)
    rc, passed, failed = ev.run_pytest(tmp_path, _visible(case))
    assert (rc, failed, passed) == (0, 0, ev.claimed_pass_count(case["claim"]))
    hrc, _, hfailed = ev.run_pytest(tmp_path, "test_hidden_oracle.py")
    assert hrc != 0 and hfailed >= 1, case["id"]


def test_hard_caller_break_leaves_the_caller_untouched():
    for c in HBAD:
        if c["kind"] == "caller_break":
            assert len(_changed(c)) == 1 and len(_src_files(c)) == 2
            callee = next(iter(_changed(c)))
            caller = next(n for n in _src_files(c) if n != callee)
            assert callee[:-3] in c["files_after"][caller]


@pytest.mark.parametrize("case", HFALSE, ids=_ids(HFALSE))
def test_hard_false_claim_code_right_claim_wrong(case, tmp_path):
    ev.materialize(case, tmp_path, with_hidden=True)
    claimed = ev.claimed_pass_count(case["claim"])
    rc, passed, failed = ev.run_pytest(tmp_path, _visible(case))
    assert (rc, failed) == (0, 0)  # code is right
    assert ev.run_pytest(tmp_path, "test_hidden_oracle.py")[0] == 0
    flaw = case["flaw"]
    if flaw in ("count", "skip"):
        assert passed != claimed
    elif flaw == "command":
        assert passed == claimed and "tests/" in case["claim"]
        assert not any(n.startswith("tests/") for n in case["files_after"])
    else:  # file
        assert passed == claimed
        cited = next(w for w in case["claim"].split() if w.startswith("test_"))
        assert cited not in case["files_after"]


# ------------------------------------------------------------------ trials, agreement, compare


def _trec(model, case, verdict, trial, label="bad", kind="false_claim"):
    return {"case": case, "model": model, "label": label, "kind": kind, "verdict": verdict,
            "bucket": verdict, "seconds": 5.0, "cost_usd": 0.01, "trial": trial}


def test_agreement_counts_cases_where_all_trials_match():
    recs = [_trec("m", "a", "refuted", t) for t in range(3)]
    recs += [_trec("m", "b", v, t) for t, v in enumerate(["refuted", "confirmed", "refuted"])]
    s = ev.summarize(recs)["m"]
    assert s["agree"] == (1, 2)
    assert s["bad_n"] == 6 and s["caught"] == 5


def test_dedupe_keeps_last_per_trial():
    recs = [_trec("m", "a", "confirmed", 0), _trec("m", "a", "refuted", 0), _trec("m", "a", "refuted", 1)]
    assert len(ev.dedupe_records(recs)) == 2


def test_compare_restricts_to_after_cases_and_splits_groups():
    before = [_trec("m", "f1", "confirmed", 0), _trec("m", "g1", "confirmed", 0, "good", "good"),
              _trec("m", "other", "refuted", 0)]
    after = [_trec("m", "f1", "refuted", 0), _trec("m", "g1", "refuted", 0, "good", "good")]
    c = ev.compare(before, after)["m"]
    assert c["before"]["fc"] == (0, 1) and c["after"]["fc"] == (1, 1)
    assert c["before"]["good"] == (0, 1) and c["after"]["good"] == (1, 1)
    assert "| m | after |" in ev.render_compare({"m": c})


def test_verifier_prompt_sha_is_stable():
    assert ev.prompt_sha("x") == ev.prompt_sha("x") and len(ev.prompt_sha("x")) == 12


# ====================================================================== heldout tier + shipped seat
import json  # noqa: E402
import os  # noqa: E402
import subprocess  # noqa: E402

from atlas_verifier_eval_cases import HELDOUT_CASES, HELDOUT_DIVERGENCES, HELDOUT_FLAWS  # noqa: E402

XBAD = [c for c in HELDOUT_CASES if c["label"] == "bad"]
XGOOD = [c for c in HELDOUT_CASES if c["label"] == "good"]
XCODE_OK = [c for c in XBAD if c["code_ok"]]
XCODE_BAD = [c for c in XBAD if not c["code_ok"]]


def _probe(case, tmp_path):
    ev.materialize(case, tmp_path)
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("CLAUDE_PLUGIN_ROOT", None)
    return subprocess.run([sys.executable, "-c", case["probe"]], cwd=tmp_path, env=env,
                          capture_output=True, text=True, timeout=120).returncode


def test_heldout_shape_and_isolation():
    assert len(HELDOUT_CASES) == 20 and len(XBAD) == 10 and len(XGOOD) == 10
    assert {c["flaw"] for c in XBAD} == set(HELDOUT_FLAWS)
    assert {c["flaw"] for c in XGOOD} == set(HELDOUT_DIVERGENCES)
    assert all(c["kind"] == "false_claim" and c["tier"] == "heldout" for c in XBAD)
    assert all(c["kind"] == "good_diverge" for c in XGOOD)
    # the old rule's named mismatch kinds are not reused as heldout flaws
    assert not {"count", "command", "file", "skip"} & {c["flaw"] for c in XBAD}
    ids = [c["id"] for c in HELDOUT_CASES]
    assert len(set(ids)) == 20 and not set(ids) & {c["id"] for c in ALL_CASES}
    assert len(ev.select_cases("heldout", "all")) == 20 and len(ev.select_cases("all", "all")) == 54
    for c in HELDOUT_CASES:
        assert c["hidden"] and c["probe"] and ev.make_diff(c).strip(), c["id"]
        assert ev.claimed_pass_count(c["claim"]) is not None, c["id"]


@pytest.mark.parametrize("case", HELDOUT_CASES, ids=_ids(HELDOUT_CASES))
def test_heldout_fixture_repo_builds_and_probe_holds(case, tmp_path):
    assert _probe(case, tmp_path) == 0, case["id"]
    for name in case["files_after"]:
        assert (tmp_path / name).is_file()


@pytest.mark.parametrize("case", XCODE_OK + XGOOD, ids=_ids(XCODE_OK + XGOOD))
def test_heldout_code_is_right(case, tmp_path):
    ev.materialize(case, tmp_path, with_hidden=True)
    assert ev.run_pytest(tmp_path, "test_hidden_oracle.py")[0] == 0
    if case["id"] != "x03_masked_exit":
        assert ev.run_pytest(tmp_path)[0] == 0
    else:
        assert ev.run_pytest(tmp_path, "test_chunks.py")[0] == 0
        assert ev.run_pytest(tmp_path, "test_legacy.py")[0] != 0  # the failure `|| true` hides


@pytest.mark.parametrize("case", XCODE_BAD, ids=_ids(XCODE_BAD))
def test_heldout_code_wrong_cases_fail_hidden_but_pass_visible(case, tmp_path):
    ev.materialize(case, tmp_path, with_hidden=True)
    assert ev.run_pytest(tmp_path, ev.visible_test_files(case)[0])[0] == 0
    assert ev.run_pytest(tmp_path, "test_hidden_oracle.py")[0] != 0


@pytest.mark.parametrize("case", XGOOD, ids=_ids(XGOOD))
def test_heldout_good_before_state_is_broken(case, tmp_path):
    ev.materialize(case, tmp_path, with_hidden=True)
    for name, text in case["files_before"].items():
        (tmp_path / name).write_text(text, encoding="utf-8")
    assert ev.run_pytest(tmp_path)[0] != 0


def test_heldout_input_does_not_leak_probe_or_flaw():
    for c in HELDOUT_CASES:
        text = ev.build_input(c)
        assert c["flaw"] not in text and "hidden" not in text.lower().split("lead's claim")[0]


def test_shipped_prompt_is_the_whole_seat_body():
    shipped, evalp = ev.seat_prompt("shipped"), ev.seat_prompt("eval")
    body = ev.VERIFIER_MD.read_text(encoding="utf-8").split("---", 2)[2].strip()
    assert shipped.startswith(body) and "ToolSearch(" in shipped and "atlas_finding.py" in shipped
    assert "## Tools" in shipped and "## Record the verdict on disk" in shipped
    assert "ToolSearch(" not in evalp and "atlas_finding.py" not in evalp
    assert "Sandbox notes" in shipped and "VERDICT: CONFIRMED" in shipped


def test_shipped_cmd_adds_only_toolsearch():
    s = ev.claude_cmd("m", "p", "shipped")
    e = ev.claude_cmd("m", "p")
    assert s[s.index("--tools") + 1] == "Read,Grep,Glob,Bash,ToolSearch"
    assert e[e.index("--tools") + 1] == "Read,Grep,Glob,Bash"
    for cmd in (s, e):
        assert "Write" in cmd[cmd.index("--disallowedTools") + 1] and "--strict-mcp-config" in cmd


def test_findings_status_maps_verdicts(tmp_path):
    assert ev.findings_status(tmp_path) is None
    d = tmp_path / ".atlas" / ".run"
    d.mkdir(parents=True)
    for status, want in (("verified", "confirmed"), ("rejected", "refuted"), ("needs-evidence", "needs_evidence")):
        (d / "findings.json").write_text(json.dumps({"findings": [{"id": "a", "status": status}]}))
        assert ev.findings_status(tmp_path) == want
    (d / "findings.json").write_text(json.dumps({"a": {"status": "rejected"}}))
    assert ev.findings_status(tmp_path) == "refuted"


def test_summarize_reports_flaw_breakdown():
    recs = [dict(_trec("m", "a", "refuted", 0), flaw="x"), dict(_trec("m", "b", "confirmed", 0), flaw="y")]
    assert ev.summarize(recs)["m"]["flaws"] == {"x": (1, 1), "y": (0, 1)}
