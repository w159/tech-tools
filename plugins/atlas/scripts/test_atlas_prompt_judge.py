"""Tests for atlas_prompt_judge: the anchor check, the judge plumbing and the exit codes.

No test starts a model: run_judge takes an injected runner and judge_command an injected `which`.
"""

from __future__ import annotations

import _test_isolation  # noqa: F401  (must be first: redirects ATLAS_HOME)

import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_prompt_judge as j  # noqa: E402


# ---- anchors ---------------------------------------------------------------------------------

def test_anchors_pick_paths_identifiers_numbers_and_quotes():
    text = ('Rename getUser to fetch_user except in `src/api/v1`, cap it at 5 attempts per minute, '
            'keep "do not touch billing", see https://example.com/x and ping @dana about /login.')
    got = j.anchors(text)
    for want in ["src/api/v1", "getUser", "fetch_user", "5 attempts", "do not touch billing",
                 "https://example.com/x", "@dana", "/login"]:
        assert want in got, (want, got)


def test_anchors_keep_first_seen_order_and_skip_substrings():
    got = j.anchors("edit `kit/cache.py` then kit/cache.py again")
    assert got.count("kit/cache.py") == 1
    assert got[0] == "kit/cache.py"


@pytest.mark.parametrize("text", ["", "   ", None, 42])
def test_anchors_of_empty_or_non_text_is_empty(text):
    assert j.anchors(text) == []


def test_anchors_ignore_latin_abbreviations():
    assert "e.g" not in j.anchors("use a cache, e.g. redis")


def test_missing_anchors_is_case_and_space_folded():
    assert j.missing_anchors("keep `Foo  Bar`", "Keep foo bar.") == []
    assert j.missing_anchors("except src/api/v1", "rename everywhere") == ["src/api/v1"]


# ---- boilerplate -----------------------------------------------------------------------------

def test_strip_boilerplate_drops_style_section_and_footer_only():
    rw = ("# Optimized Prompt\n\nDo X.\n\n## Output style\nWrite in STE.\nMore style.\n\n"
          "## Next\nkeep me\nChecked: 2/2 goals kept, 0 added (claude:sonnet)\n")
    out = j.strip_boilerplate(rw)
    assert "STE" not in out and "More style" not in out and "Checked:" not in out
    assert "Do X." in out and "## Next" in out and "keep me" in out


def test_strip_boilerplate_keeps_text_without_style_section():
    assert j.strip_boilerplate("plain rewrite") == "plain rewrite"
    assert j.strip_boilerplate(None) == ""


def test_judge_prompt_embeds_both_texts_without_boilerplate():
    p = j.judge_prompt("  orig  ", "rw\n## Output style\nSTE text\n")
    assert "<original>\norig\n</original>" in p
    assert "STE text" not in p and "rw" in p


# ---- judge command ---------------------------------------------------------------------------

def _which(*have):
    return lambda name: f"/bin/{name}" if name in have else None


def test_override_command_wins_and_is_shell_split(monkeypatch):
    cmd = j.judge_command({"ATLAS_PROMPT_JUDGE_CMD": "my-judge --flag 'two words'"}, _which("codex", "claude"))
    assert cmd == (["my-judge", "--flag", "two words"], "custom")


def test_unbalanced_override_is_unusable():
    assert j.judge_command({"ATLAS_PROMPT_JUDGE_CMD": "judge 'oops"}, _which("claude")) is None


def test_codex_preferred_outside_codex(monkeypatch):
    monkeypatch.setattr(j, "_harness", lambda env: "claude")
    argv, label = j.judge_command({}, _which("codex", "claude"))
    assert argv[:2] == ["codex", "exec"] and label == "codex"


def test_inside_codex_the_judge_is_not_codex(monkeypatch):
    monkeypatch.setattr(j, "_harness", lambda env: "codex")
    argv, label = j.judge_command({}, _which("codex", "claude"))
    assert argv[0] == "claude" and label == "claude:sonnet"


def test_claude_judge_is_isolated_and_tools_flag_cannot_swallow_prompt(monkeypatch):
    monkeypatch.setattr(j, "_harness", lambda env: "claude")
    argv, label = j.judge_command({"ATLAS_PROMPT_JUDGE_MODEL": "opus"}, _which("claude"))
    assert label == "claude:opus"
    for flag in ("--setting-sources", "--strict-mcp-config", "--max-turns"):
        assert flag in argv
    i = argv.index("--tools")
    assert argv[i + 1] == "" and argv[i + 2].startswith("--")
    assert argv[argv.index("--model") + 1] == "opus"


def test_omp_is_last_resort_and_none_when_nothing(monkeypatch):
    monkeypatch.setattr(j, "_harness", lambda env: "omp")
    assert j.judge_command({}, _which("omp")) == (["omp", "-p", "--model", "sonnet"], "omp:sonnet")
    assert j.judge_command({}, _which()) is None


# ---- parse -----------------------------------------------------------------------------------

def test_parse_judge_finds_first_object_with_items_after_prose():
    text = 'noise {"x": 1} then {"items": [{"item": "a", "verdict": "kept", "quote": "q"}], "added": ["z", " "]}'
    got = j.parse_judge(text)
    assert got == {"items": [{"item": "a", "verdict": "KEPT", "quote": "q"}], "added": ["z"]}


def test_parse_judge_coerces_unknown_verdicts_and_skips_junk_items():
    got = j.parse_judge('{"items": [{"item": "a", "verdict": "maybe"}, "junk"], "added": "notalist"}')
    assert got == {"items": [{"item": "a", "verdict": "UNKNOWN", "quote": ""}], "added": []}


@pytest.mark.parametrize("text", ["", "no json", '{"verdict": "KEPT"}', None])
def test_parse_judge_none_without_items(text):
    assert j.parse_judge(text) is None


# ---- run_judge -------------------------------------------------------------------------------

def test_run_judge_runs_in_scratch_dir_with_prompt_last(monkeypatch):
    monkeypatch.setattr(j, "judge_command", lambda env: (["fake"], "fake"))
    seen = {}

    def runner(argv, **kw):
        seen.update(argv=argv, **kw)
        return SimpleNamespace(stdout='{"items": [], "added": []}', returncode=0)

    parsed, label = j.run_judge("o", "r", env={"ATLAS_PROMPT_JUDGE_TIMEOUT": "7"}, runner=runner)
    assert parsed == {"items": [], "added": []} and label == "fake"
    assert seen["argv"][0] == "fake" and "<original>\no\n</original>" in seen["argv"][-1]
    assert seen["timeout"] == 7 and "atlas-judge-" in seen["cwd"]
    assert not Path(seen["cwd"]).exists()


def test_run_judge_bad_timeout_falls_back(monkeypatch):
    monkeypatch.setattr(j, "judge_command", lambda env: (["fake"], "fake"))
    seen = {}

    def runner(argv, **kw):
        seen.update(kw)
        return SimpleNamespace(stdout="", returncode=1)

    parsed, label = j.run_judge("o", "r", env={"ATLAS_PROMPT_JUDGE_TIMEOUT": "soon"}, runner=runner)
    assert parsed is None and "no verdict (rc 1)" in label
    assert seen["timeout"] == j.DEFAULT_TIMEOUT


@pytest.mark.parametrize("exc", [OSError("gone"), subprocess.TimeoutExpired("fake", 1)])
def test_run_judge_unavailable_on_error(monkeypatch, exc):
    monkeypatch.setattr(j, "judge_command", lambda env: (["fake"], "fake"))

    def runner(argv, **kw):
        raise exc

    parsed, label = j.run_judge("o", "r", env={}, runner=runner)
    assert parsed is None and label == f"unavailable: fake {type(exc).__name__}"


def test_run_judge_unavailable_without_command(monkeypatch):
    monkeypatch.setattr(j, "judge_command", lambda env: None)
    assert j.run_judge("o", "r", env={}) == (None, "unavailable: no codex, claude or omp on PATH")


# ---- verdict and footer ----------------------------------------------------------------------

ORIG = "rename getUser everywhere except src/api/v1"


def _judged(*verdicts, added=()):
    return {"items": [{"item": f"i{n}", "verdict": v, "quote": ""} for n, v in enumerate(verdicts)],
            "added": list(added)}


def test_verdict_passes_only_when_all_kept_nothing_added_no_anchor_missing():
    ok = j.verdict(ORIG, "rename getUser except src/api/v1", _judged("KEPT", "KEPT"), "x")
    assert ok["passed"] and ok["kept"] == 2 and ok["total"] == 2
    assert not j.verdict(ORIG, "rename getUser except src/api/v1", _judged("KEPT", "WEAKENED"), "x")["passed"]
    assert not j.verdict(ORIG, "rename getUser except src/api/v1", _judged("DROPPED"), "x")["passed"]
    assert not j.verdict(ORIG, "rename getUser except src/api/v1", _judged("KEPT", added=["docs"]), "x")["passed"]
    miss = j.verdict(ORIG, "rename getUser", _judged("KEPT"), "x")
    assert not miss["passed"] and miss["anchors_missing"] == ["src/api/v1"]


def test_verdict_unknown_does_not_fail():
    assert j.verdict(ORIG, ORIG, _judged("KEPT", "UNKNOWN"), "x")["passed"]


def test_verdict_without_judge_is_anchor_only():
    assert j.verdict(ORIG, ORIG, None, "anchors-only")["passed"]
    assert not j.verdict(ORIG, "rename", None, "anchors-only")["passed"]


def test_verdict_skip():
    r = j.verdict("thanks", "  SKIP\n", None, "anchors-only")
    assert r["passed"] and r["reason"] == "SKIP" and j.format_footer(r) == ""


def test_footer_texts():
    r = j.verdict(ORIG, ORIG, _judged("KEPT", "DROPPED", added=["a"]), "claude:sonnet")
    assert j.format_footer(r) == "Checked: 1/2 goals kept, 1 added (claude:sonnet)"
    assert j.format_footer(j.verdict(ORIG, ORIG, None, "anchors-only")) == "Checked: anchors kept (anchors-only)"
    assert j.format_footer(j.verdict(ORIG, "x", None, "anchors-only")) == "Checked: anchors missing (anchors-only)"


# ---- main / exit codes -----------------------------------------------------------------------

def _files(tmp_path, original, rewrite):
    o, r = tmp_path / "o.txt", tmp_path / "r.txt"
    o.write_text(original)
    r.write_text(rewrite)
    return ["--original", str(o), "--rewrite", str(r)]


def test_main_usage_error_on_missing_file(tmp_path, capsys):
    assert j.main(["--original", str(tmp_path / "nope"), "--rewrite", str(tmp_path / "nope")]) == 3
    assert "error" in json.loads(capsys.readouterr().out)


def test_main_anchors_only_pass_and_fail(tmp_path, capsys):
    assert j.main(_files(tmp_path, ORIG, ORIG) + ["--anchors-only"]) == 0
    assert j.main(_files(tmp_path, ORIG, "rename it") + ["--anchors-only"]) == 1
    out = capsys.readouterr().out
    assert '"footer"' in out


def test_main_skip_needs_no_judge(tmp_path, monkeypatch):
    monkeypatch.setattr(j, "run_judge", lambda *a, **k: pytest.fail("judge must not run on SKIP"))
    assert j.main(_files(tmp_path, "thanks!", "SKIP")) == 0


def test_main_exit_2_when_judge_unavailable_but_anchors_hold(tmp_path, monkeypatch):
    monkeypatch.setattr(j, "run_judge", lambda *a, **k: (None, "unavailable: none"))
    assert j.main(_files(tmp_path, ORIG, ORIG)) == 2


def test_main_judge_pass_and_fail(tmp_path, monkeypatch):
    monkeypatch.setattr(j, "run_judge", lambda *a, **k: (_judged("KEPT"), "fake"))
    assert j.main(_files(tmp_path, ORIG, ORIG)) == 0
    monkeypatch.setattr(j, "run_judge", lambda *a, **k: (_judged("DROPPED"), "fake"))
    assert j.main(_files(tmp_path, ORIG, ORIG)) == 1


def test_cli_help_runs():
    r = subprocess.run([sys.executable, str(Path(j.__file__)), "--help"], capture_output=True, text=True)
    assert r.returncode == 0 and "--original" in r.stdout


# ---- cases added from surviving mutants (scripts/atlas_mutate.py) ------------------------------

def test_anchors_skip_a_token_that_is_part_of_a_longer_one():
    got = j.anchors("edit `src/api/v1/users.py`, nothing else in src/api/v1")
    assert got == ["src/api/v1/users.py"]


def test_anchors_keep_two_character_tokens_and_single_quoted_text():
    got = j.anchors("listen on port 80 and keep 'never log tokens' as is")
    assert "80" in got and "never log tokens" in got


def test_parse_judge_skips_a_broken_brace_and_a_junk_item_before_good_ones():
    got = j.parse_judge('{oops {"items": ["junk", {"item": "a", "verdict": "DROPPED"}]}')
    assert got["items"] == [{"item": "a", "verdict": "DROPPED", "quote": ""}]


def test_run_judge_captures_text_output():
    seen = {}

    def runner(argv, **kw):
        seen.update(kw)
        return SimpleNamespace(stdout='{"items": []}', returncode=0)

    j.run_judge("o", "r", env={"ATLAS_PROMPT_JUDGE_CMD": "fake"}, runner=runner)
    assert seen["capture_output"] is True and seen["text"] is True


def test_skip_report_counts_nothing():
    r = j.verdict("thanks", "SKIP", None, "anchors-only")
    assert (r["kept"], r["total"]) == (0, 0)


def test_main_requires_both_files():
    with pytest.raises(SystemExit) as exc:
        j.main(["--original", "x"])
    assert exc.value.code == 2


@pytest.mark.parametrize("env,want", [({"ATLAS_HARNESS": "codex"}, "codex"), ({"OMPCODE": "1"}, "omp"),
                                      ({"CLAUDECODE": "1"}, "claude"), ({}, "unknown")])
def test_harness_detection_is_wired(env, want):
    assert j._harness(env) == want
