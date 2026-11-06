"""Tests for run_eval.py. The `claude` CLI (sessions and the judge) is mocked at subprocess.run /
run_session / ask_judge; everything around it is real: stream-json parsing, plugin scaffolding,
grading flow, trigger tallies, summary arithmetic and the CLI dispatcher."""

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

_SRC = Path(__file__).resolve().parent / "run_eval.py"
_spec = importlib.util.spec_from_file_location("run_eval_under_test", _SRC)
ev = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ev)


def stream(*events):
    return "\n".join(json.dumps(e) for e in events)


def skill_use(name):
    return {"type": "assistant", "message": {"content": [
        {"type": "text", "text": "hi"}, {"type": "tool_use", "name": "Skill", "input": {"skill": name}}]}}


class CaptureStdout:
    def __enter__(self):
        self.buf = io.StringIO()
        self._cm = contextlib.redirect_stdout(self.buf)
        self._cm.__enter__()
        return self

    def __exit__(self, *a):
        self._cm.__exit__(*a)

    @property
    def text(self):
        return self.buf.getvalue()


class PureHelperTests(unittest.TestCase):
    def test_extract_prompt_drops_checked_footer_and_trims(self):
        txt = "\n  Do the thing.\nWith care.\nChecked: all goals kept\n"
        self.assertEqual(ev.extract_prompt(txt), "Do the thing.\nWith care.")

    def test_extract_prompt_only_drops_lines_starting_with_checked(self):
        self.assertEqual(ev.extract_prompt("a\n  Checked: indented stays\nb"), "a\n  Checked: indented stays\nb")

    def test_extract_prompt_none_and_empty(self):
        self.assertEqual(ev.extract_prompt(None), "")
        self.assertEqual(ev.extract_prompt(""), "")
        self.assertEqual(ev.extract_prompt("Checked: x"), "")

    def test_first_json_finds_dict_with_key_amid_noise(self):
        text = 'blah {"other": 1} more {"items": [1, 2]} tail {"items": [3]}'
        self.assertEqual(ev.first_json(text, "items"), [1, 2])

    def test_first_json_skips_invalid_and_non_dict_candidates(self):
        self.assertEqual(ev.first_json('{bad json {"added": ["x"]}', "added"), ["x"])
        self.assertIsNone(ev.first_json('[{"items": 1}]', "nokey"))
        self.assertEqual(ev.first_json('[{"items": 1}]', "items"), 1)  # dict nested in a list is still found

    def test_first_json_handles_empty_input(self):
        self.assertIsNone(ev.first_json("", "k"))
        self.assertIsNone(ev.first_json(None, "k"))
        self.assertIsNone(ev.first_json("no braces here", "k"))

    def test_first_json_falsy_value_returned(self):
        self.assertEqual(ev.first_json('{"added": []}', "added"), [])

    def test_load_reads_the_cases_wrapper(self):
        cases = ev.load("cases.json")
        self.assertTrue(cases)
        for c in cases:
            self.assertIn("id", c)
            self.assertIn("prompt", c)
            self.assertIn("gold", c)
        self.assertEqual(len({c["id"] for c in cases}), len(cases))
        trig = ev.load("trigger_cases.json")
        self.assertTrue(all("fire" in c and "id" in c for c in trig))

    def test_base_argv_isolates_user_config(self):
        b = ev.BASE
        self.assertEqual(b[:2], ["claude", "-p"])
        i = b.index("--setting-sources")
        self.assertEqual(b[i + 1], "")
        self.assertIn("--strict-mcp-config", b)
        self.assertIn("--no-session-persistence", b)


class RunSessionTests(unittest.TestCase):
    def _run(self, stdout, **kw):
        with mock.patch.object(ev.subprocess, "run", return_value=SimpleNamespace(stdout=stdout)) as sr:
            r = ev.run_session(["claude", "x"], Path("/w"), 7, **kw) if kw else ev.run_session(["claude", "x"], Path("/w"), 7)
        return r, sr

    def test_parses_result_skills_and_usage(self):
        out = stream(
            {"type": "system"}, skill_use("atlas-prompt"), skill_use("other"),
            {"type": "result", "result": "REWRITTEN", "num_turns": 3, "total_cost_usd": 0.5,
             "usage": {"output_tokens": 42}, "is_error": False},
        )
        r, sr = self._run(out)
        self.assertEqual(r["result"], "REWRITTEN")
        self.assertEqual(r["skills"], ["atlas-prompt", "other"])
        self.assertEqual((r["turns"], r["cost"], r["output_tokens"], r["is_error"]), (3, 0.5, 42, False))
        self.assertIsInstance(r["seconds"], float)
        args, kw = sr.call_args
        self.assertEqual(args[0], ["claude", "x"])
        self.assertEqual(kw["timeout"], 7)
        self.assertEqual(kw["cwd"], Path("/w"))

    def test_last_result_event_wins(self):
        out = stream({"type": "result", "result": "first"}, {"type": "result", "result": "second"})
        r, _ = self._run(out)
        self.assertEqual(r["result"], "second")

    def test_garbage_lines_ignored_and_no_result_marks_error(self):
        r, _ = self._run("not json\n\n{broken\n" + json.dumps(skill_use("s")))
        self.assertEqual(r["result"], "")
        self.assertEqual(r["skills"], ["s"])
        self.assertIs(r["is_error"], True)
        self.assertIsNone(r["turns"])
        self.assertIsNone(r["output_tokens"])

    def test_result_without_is_error_is_not_an_error(self):
        r, _ = self._run(stream({"type": "result", "result": "ok"}))
        self.assertIs(r["is_error"], False)

    def test_non_skill_tool_uses_ignored(self):
        ev_ = {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"skill": "x"}}]}}
        r, _ = self._run(stream(ev_))
        self.assertEqual(r["skills"], [])

    def test_timeout_salvages_partial_bytes_stdout(self):
        exc = ev.subprocess.TimeoutExpired("claude", 7, output=None)
        exc.stdout = stream(skill_use("atlas-prompt")).encode()
        with mock.patch.object(ev.subprocess, "run", side_effect=exc):
            r = ev.run_session(["claude"], Path("/w"), 7)
        self.assertEqual(r["skills"], ["atlas-prompt"])
        self.assertIs(r["is_error"], True)

    def test_timeout_with_text_or_missing_stdout(self):
        exc = ev.subprocess.TimeoutExpired("claude", 7)
        exc.stdout = stream({"type": "result", "result": "partial"})
        with mock.patch.object(ev.subprocess, "run", side_effect=exc):
            self.assertEqual(ev.run_session(["c"], Path("/w"), 1)["result"], "partial")
        exc2 = ev.subprocess.TimeoutExpired("claude", 7)
        exc2.stdout = None
        with mock.patch.object(ev.subprocess, "run", side_effect=exc2):
            self.assertEqual(ev.run_session(["c"], Path("/w"), 1)["result"], "")


class ScaffoldTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dest = Path(self.tmp.name)
        self.skill = self.dest / "my-skill.md"
        self.skill.write_text("---\nname: atlas-prompt\n---\nbody")

    def test_build_plugin_minimal(self):
        root = ev.build_plugin(self.skill, self.dest / "p", all_skills=False)
        self.assertEqual(root, self.dest / "p" / "atlas")
        self.assertEqual((root / "skills" / "atlas-prompt" / "SKILL.md").read_text(), self.skill.read_text())
        meta = json.loads((root / ".claude-plugin" / "plugin.json").read_text())
        self.assertTrue(set(meta) <= {"name", "version", "description"})
        self.assertEqual(meta["name"], "atlas")
        self.assertTrue((root / "scripts" / "atlas_prompt_judge.py").is_file())
        self.assertTrue((root / "scripts" / "atlas_harness.py").is_file())
        others = [p.name for p in (root / "skills").iterdir() if p.name != "atlas-prompt"]
        self.assertEqual(others, [])

    def test_build_plugin_copies_references_when_present(self):
        root = ev.build_plugin(self.skill, self.dest / "p", all_skills=False)
        src_refs = ev.SKILL_DIR / "references"
        if src_refs.exists():
            self.assertTrue((root / "skills" / "atlas-prompt" / "references").is_dir())
        else:
            self.assertFalse((root / "skills" / "atlas-prompt" / "references").exists())

    def test_build_plugin_all_skills_uses_override_and_skips_original(self):
        root = ev.build_plugin(self.skill, self.dest / "p", all_skills=True)
        names = sorted(p.name for p in (root / "skills").iterdir())
        self.assertIn("atlas-prompt", names)
        self.assertGreater(len(names), 5)
        # the atlas-prompt dir holds the file under test, not the shipped SKILL.md
        self.assertEqual((root / "skills" / "atlas-prompt" / "SKILL.md").read_text(), "---\nname: atlas-prompt\n---\nbody")
        for n in names:
            self.assertTrue((root / "skills" / n / "SKILL.md").is_file(), n)

    def test_fixture_builds_small_python_project(self):
        with mock.patch.object(ev.subprocess, "run") as sr:
            proj = ev.fixture(self.dest)
        self.assertEqual(proj, self.dest / "proj")
        self.assertIn("pytest -q", (proj / "CLAUDE.md").read_text())
        self.assertEqual((proj / "kit" / "__init__.py").read_text(), "from .cache import LRU\n")
        self.assertIn("class LRU", (proj / "kit" / "cache.py").read_text())
        self.assertIn("def test_lru", (proj / "tests" / "test_cache.py").read_text())
        args, kw = sr.call_args
        self.assertEqual(args[0], ["git", "init", "-q"])
        self.assertEqual(kw["cwd"], proj)
        self.assertIs(kw["check"], False)


class AskJudgeTests(unittest.TestCase):
    def test_ask_judge_runs_toolless_claude_and_returns_stdout(self):
        with mock.patch.object(ev.subprocess, "run", return_value=SimpleNamespace(stdout="VERDICT")) as sr:
            out = ev.ask_judge("PROMPT", "opus", 12)
        self.assertEqual(out, "VERDICT")
        argv = sr.call_args[0][0]
        self.assertEqual(argv[:2], ["claude", "-p"])
        self.assertEqual(argv[argv.index("--tools") + 1], "")
        self.assertEqual(argv[argv.index("--model") + 1], "opus")
        self.assertEqual(argv[argv.index("--max-turns") + 1], "1")
        self.assertEqual(argv[-1], "PROMPT")
        self.assertEqual(sr.call_args[1]["timeout"], 12)


CASES = [
    {"id": "c1", "size": "simple", "prompt": "fix bug", "gold": ["keep tests", "no new deps"]},
    {"id": "c2", "size": "skip", "skip": True, "prompt": "thanks", "gold": []},
    {"id": "c3", "size": "complex", "prompt": "big job", "gold": ["one"]},
]


class CmdTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name) / "out"
        self.out.mkdir()

    def ns(self, **kw):
        base = dict(out=str(self.out), label="new", skill=str(Path(self.tmp.name) / "s.md"), model="sonnet",
                    jobs=1, timeout=5, max_turns=9, reps=1, judge_model="opus", labels="new")
        base.update(kw)
        return SimpleNamespace(**base)

    def test_cmd_rewrite_writes_one_json_per_case_with_command_line(self):
        (Path(self.tmp.name) / "s.md").write_text("skill")
        seen = []

        plugin_skills = []

        def fake_run(argv, cwd, timeout):
            seen.append((argv, cwd, timeout))
            plug = Path(argv[argv.index("--plugin-dir") + 1])
            plugin_skills.append(sorted(p.name for p in (plug / "skills").iterdir()))
            return {"result": "R", "skills": [], "seconds": 1.5}

        with mock.patch.object(ev, "load", return_value=CASES), mock.patch.object(
            ev, "run_session", fake_run
        ), mock.patch.object(ev.subprocess, "run"), CaptureStdout() as cap:
            rc = ev.cmd_rewrite(self.ns())
        self.assertEqual(rc, 0)
        files = sorted(p.name for p in (self.out / "new").iterdir())
        self.assertEqual(files, ["c1.json", "c2.json", "c3.json"])
        d = json.loads((self.out / "new" / "c1.json").read_text())
        self.assertEqual((d["id"], d["result"]), ("c1", "R"))
        argv = seen[0][0]
        self.assertEqual(argv[-1], "/atlas-prompt fix bug")
        self.assertEqual(argv[argv.index("--model") + 1], "sonnet")
        self.assertEqual(argv[argv.index("--max-turns") + 1], "9")
        self.assertIn("--plugin-dir", argv)
        self.assertEqual(seen[0][2], 5)
        # rewrite runs load only the skill under test, not the other atlas skills
        self.assertEqual(plugin_skills[0], ["atlas-prompt"])
        self.assertIn("new c1: 1 words, 1.5s", cap.text)

    def _write_run(self, cid, result):
        d = self.out / "new"
        d.mkdir(exist_ok=True)
        (d / f"{cid}.json").write_text(json.dumps({"result": result, "seconds": 1.0, "output_tokens": 10, "cost": 0.1}))

    def _judge_stub(self):
        j = mock.MagicMock()
        j.strip_boilerplate.side_effect = lambda t: t.replace("BOILER", "").strip()
        j.missing_anchors.side_effect = lambda orig, rw: ["anchor"] if "fix bug" in orig else []
        return j

    def test_cmd_grade_full_flow(self):
        self._write_run("c1", "Fix the bug BOILER\nChecked: ok")
        self._write_run("c2", "SKIP")
        self._write_run("c3", "")
        replies = iter([
            'x {"items": [{"n": 1, "verdict": "kept"}, {"n": 2, "verdict": "WEAKENED"}]}',
            '{"added": ["new file", "docs"]}',
        ])
        prompts = []

        def fake_judge(prompt, model, timeout):
            prompts.append((prompt, model, timeout))
            return next(replies)

        with mock.patch.object(ev, "load", return_value=CASES), mock.patch.object(
            ev, "judge", self._judge_stub()
        ), mock.patch.object(ev, "ask_judge", fake_judge), CaptureStdout() as cap:
            rc = ev.cmd_grade(self.ns())
        self.assertEqual(rc, 0)
        g1 = json.loads((self.out / "new" / "c1.grade.json").read_text())
        self.assertEqual(g1["verdicts"], ["KEPT", "WEAKENED"])
        self.assertEqual(g1["added"], ["new file", "docs"])
        self.assertEqual(g1["anchors_missing"], ["anchor"])
        self.assertEqual(g1["footer"], "Checked: ok")
        self.assertEqual((g1["words"], g1["words_core"], g1["size"]), (4, 3, "simple"))
        self.assertFalse(g1["skip_expected"] or g1["skip_got"])
        # the judge saw the stripped rewrite (no boilerplate, no footer), the gold list, and the chosen model
        self.assertIn("Fix the bug", prompts[0][0])
        self.assertNotIn("BOILER", prompts[0][0])
        self.assertNotIn("Checked:", prompts[0][0])
        self.assertIn("1. keep tests\n2. no new deps", prompts[0][0])
        self.assertEqual(prompts[0][1:], ("opus", 5))
        self.assertEqual(len(prompts), 2)
        g2 = json.loads((self.out / "new" / "c2.grade.json").read_text())
        self.assertTrue(g2["skip_expected"] and g2["skip_got"])
        self.assertEqual((g2["verdicts"], g2["anchors_missing"]), ([], []))
        # empty rewrite with gold items: every item counts as dropped, judge not asked
        g3 = json.loads((self.out / "new" / "c3.grade.json").read_text())
        self.assertEqual(g3["verdicts"], ["DROPPED"])
        self.assertEqual(g3["words"], 0)
        self.assertIn("new c1: 1/2 kept, 2 added, 4 words", cap.text)

    def test_cmd_grade_skip_output_for_non_skip_case_is_dropped(self):
        self._write_run("c1", "SKIP")
        with mock.patch.object(ev, "load", return_value=CASES[:1]), mock.patch.object(
            ev, "judge", self._judge_stub()
        ), mock.patch.object(ev, "ask_judge") as aj, CaptureStdout():
            ev.cmd_grade(self.ns())
        g = json.loads((self.out / "new" / "c1.grade.json").read_text())
        self.assertEqual(g["verdicts"], ["DROPPED", "DROPPED"])
        self.assertTrue(g["skip_got"] and not g["skip_expected"])
        aj.assert_not_called()

    def test_cmd_grade_unparseable_judge_gives_unknown(self):
        self._write_run("c1", "Fix the bug")
        with mock.patch.object(ev, "load", return_value=CASES[:1]), mock.patch.object(
            ev, "judge", self._judge_stub()
        ), mock.patch.object(ev, "ask_judge", return_value="garbage"), CaptureStdout():
            ev.cmd_grade(self.ns())
        g = json.loads((self.out / "new" / "c1.grade.json").read_text())
        self.assertEqual(g["verdicts"], ["UNKNOWN", "UNKNOWN"])
        self.assertEqual(g["added"], [])

    def test_cmd_grade_partial_verdicts_fill_unknown(self):
        self._write_run("c1", "Fix the bug")
        replies = iter(['{"items": [{"n": 2, "verdict": "kept"}, "junk"]}', '{"added": []}'])
        with mock.patch.object(ev, "load", return_value=CASES[:1]), mock.patch.object(
            ev, "judge", self._judge_stub()
        ), mock.patch.object(ev, "ask_judge", lambda *a: next(replies)), CaptureStdout():
            ev.cmd_grade(self.ns())
        g = json.loads((self.out / "new" / "c1.grade.json").read_text())
        self.assertEqual(g["verdicts"], ["UNKNOWN", "KEPT"])

    def test_cmd_trigger_records_fired_flag_per_rep(self):
        (Path(self.tmp.name) / "s.md").write_text("skill")
        trig = [{"id": "t1", "prompt": "do it", "fire": True}, {"id": "t2", "prompt": "chat", "fire": False}]
        results = {"do it": ["atlas-prompt"], "chat": ["something-else"]}

        def fake_run(argv, cwd, timeout):
            return {"skills": results[argv[-1]], "seconds": 0.1}

        with mock.patch.object(ev, "load", return_value=trig), mock.patch.object(
            ev, "run_session", fake_run
        ), mock.patch.object(ev.subprocess, "run"), CaptureStdout() as cap:
            rc = ev.cmd_trigger(self.ns(reps=2))
        self.assertEqual(rc, 0)
        d = self.out / "trigger-new"
        self.assertEqual(sorted(p.name for p in d.iterdir()), ["t1-0.json", "t1-1.json", "t2-0.json", "t2-1.json"])
        self.assertIs(json.loads((d / "t1-1.json").read_text())["fired"], True)
        self.assertIs(json.loads((d / "t2-0.json").read_text())["fired"], False)
        self.assertIn("trigger-new t1 want=True got=[True, True]", cap.text)
        self.assertIn("trigger-new t2 want=False got=[False, False]", cap.text)

    def test_output_dirs_may_already_exist(self):
        (Path(self.tmp.name) / "s.md").write_text("skill")
        (self.out / "new").mkdir()
        (self.out / "trigger-new").mkdir()
        stub = lambda argv, cwd, timeout: {"result": "R", "skills": [], "seconds": 0}
        with mock.patch.object(ev, "load", return_value=[{"id": "t", "prompt": "P", "fire": True}]), mock.patch.object(
            ev, "run_session", stub
        ), mock.patch.object(ev.subprocess, "run"), CaptureStdout():
            self.assertEqual(ev.cmd_rewrite(self.ns()), 0)
            self.assertEqual(ev.cmd_trigger(self.ns()), 0)

    def test_cmd_trigger_loads_every_skill_so_selection_is_realistic(self):
        (Path(self.tmp.name) / "s.md").write_text("skill")
        names = []

        def fake_run(argv, cwd, timeout):
            plug = Path(argv[argv.index("--plugin-dir") + 1])
            names.append(len(list((plug / "skills").iterdir())))
            return {"skills": [], "seconds": 0}

        with mock.patch.object(ev, "load", return_value=[{"id": "t", "prompt": "P", "fire": True}]), mock.patch.object(
            ev, "run_session", fake_run
        ), mock.patch.object(ev.subprocess, "run"), CaptureStdout():
            ev.cmd_trigger(self.ns())
        self.assertGreater(names[0], 5)

    def test_cmd_trigger_uses_single_turn_and_prompt_verbatim(self):
        (Path(self.tmp.name) / "s.md").write_text("skill")
        seen = []
        with mock.patch.object(ev, "load", return_value=[{"id": "t", "prompt": "P", "fire": True}]), mock.patch.object(
            ev, "run_session", lambda argv, cwd, timeout: seen.append(argv) or {"skills": [], "seconds": 0}
        ), mock.patch.object(ev.subprocess, "run"), CaptureStdout():
            ev.cmd_trigger(self.ns())
        argv = seen[0]
        self.assertEqual(argv[argv.index("--max-turns") + 1], "1")
        self.assertEqual(argv[-1], "P")


class SummarizeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)
        (self.out / "L").mkdir()

    def grade(self, cid, **kw):
        g = {"id": cid, "words": 10, "words_core": 8, "size": "simple", "skip_expected": False, "skip_got": False,
             "anchors_missing": [], "verdicts": [], "added": []}
        g.update(kw)
        (self.out / "L" / f"{cid}.grade.json").write_text(json.dumps(g))

    def run_json(self, cid, **kw):
        r = {"seconds": 2.0, "output_tokens": 5, "cost": 0.25}
        r.update(kw)
        (self.out / "L" / f"{cid}.json").write_text(json.dumps(r))

    def test_counts_and_medians(self):
        self.grade("a", words=10, verdicts=["KEPT", "KEPT", "WEAKENED"], added=["x"], anchors_missing=["m"])
        self.grade("b", words=30, size="simple", verdicts=["DROPPED", "UNKNOWN"], added=["y", "z"])
        self.grade("c", words=100, size="complex", words_core=90, verdicts=["KEPT"])
        self.grade("d", words=999, size="skip", skip_expected=True, skip_got=True)
        self.grade("e", words=5, skip_expected=True, skip_got=False)
        for cid, secs in (("a", 1.0), ("b", 9.0), ("c", 5.0)):
            self.run_json(cid, seconds=secs)
        s = ev.summarize(self.out, "L")
        self.assertEqual(s["label"], "L")
        self.assertEqual(s["cases"], 5)
        self.assertEqual(s["gold_items"], 6)
        self.assertEqual((s["kept"], s["weakened"], s["dropped"], s["unknown"]), (3, 1, 1, 1))
        self.assertEqual(s["added_total"], 3)
        self.assertEqual(s["anchors_missing"], 1)
        self.assertEqual(s["skip_correct"], 4)  # all but e (expected skip, got none)
        self.assertEqual(s["words_simple_median"], 30)  # sorted [10,30] -> index 1
        self.assertEqual(s["words_complex_median"], 100)
        self.assertEqual(s["words_total"], 10 + 30 + 100 + 999 + 5)
        self.assertEqual(s["words_core_total"], 8 + 8 + 90 + 8 + 8)
        self.assertEqual(s["seconds_median"], 5.0)
        self.assertEqual(s["output_tokens_total"], 15)
        self.assertEqual(s["cost_total"], 0.75)
        self.assertNotIn("trigger", s)

    def test_words_core_falls_back_to_words(self):
        g = {"id": "a", "words": 12, "size": "simple", "skip_expected": False, "skip_got": False,
             "anchors_missing": [], "verdicts": [], "added": []}
        (self.out / "L" / "a.grade.json").write_text(json.dumps(g))
        self.assertEqual(ev.summarize(self.out, "L")["words_core_total"], 12)

    def test_empty_label_dir_yields_zeros(self):
        s = ev.summarize(self.out, "L")
        self.assertEqual((s["cases"], s["kept"], s["words_simple_median"], s["seconds_median"], s["cost_total"]),
                         (0, 0, 0, 0, 0))

    def test_null_usage_fields_count_as_zero(self):
        self.grade("a")
        self.run_json("a", output_tokens=None, cost=None)
        s = ev.summarize(self.out, "L")
        self.assertEqual((s["output_tokens_total"], s["cost_total"]), (0, 0))

    def test_trigger_confusion_matrix_precision_recall(self):
        d = self.out / "trigger-L"
        d.mkdir()
        want = [{"id": "p1", "fire": True}, {"id": "p2", "fire": True}, {"id": "n1", "fire": False},
                {"id": "n2", "fire": False}, {"id": "n3", "fire": False}]
        fired = {"p1-0": True, "p2-0": False, "n1-0": True, "n2-0": False, "n3-0": False, "p1-1": True}
        for stem, f in fired.items():
            (d / f"{stem}.json").write_text(json.dumps({"fired": f}))
        with mock.patch.object(ev, "load", return_value=want):
            s = ev.summarize(self.out, "L")
        t = s["trigger"]
        self.assertEqual((t["tp"], t["fp"], t["fn"], t["tn"]), (2, 1, 1, 2))
        self.assertEqual(t["precision"], round(2 / 3, 3))
        self.assertEqual(t["recall"], round(2 / 3, 3))

    def test_trigger_with_no_positives_gives_null_ratios(self):
        d = self.out / "trigger-L"
        d.mkdir()
        (d / "n1-0.json").write_text(json.dumps({"fired": False}))
        with mock.patch.object(ev, "load", return_value=[{"id": "n1", "fire": False}]):
            t = ev.summarize(self.out, "L")["trigger"]
        self.assertEqual((t["tp"], t["tn"]), (0, 1))
        self.assertIsNone(t["precision"])
        self.assertIsNone(t["recall"])

    def test_run_stems_with_dashes_map_to_case_id(self):
        d = self.out / "trigger-L"
        d.mkdir()
        (d / "my-case-0.json").write_text(json.dumps({"fired": True}))
        with mock.patch.object(ev, "load", return_value=[{"id": "my-case", "fire": True}]):
            self.assertEqual(ev.summarize(self.out, "L")["trigger"]["tp"], 1)

    def test_cmd_report_prints_json_rows_per_label(self):
        (self.out / "M").mkdir()
        self.grade("a")
        with CaptureStdout() as cap:
            rc = ev.cmd_report(SimpleNamespace(out=str(self.out), labels="L,M"))
        self.assertEqual(rc, 0)
        rows = json.loads(cap.text)
        self.assertEqual([r["label"] for r in rows], ["L", "M"])
        self.assertEqual([r["cases"] for r in rows], [1, 0])


class MainTests(unittest.TestCase):
    def _main(self, argv):
        with mock.patch.object(sys, "argv", ["run_eval.py"] + argv):
            return ev.main()

    def test_dispatches_each_subcommand_with_parsed_args(self):
        for cmd, extra in (("rewrite", ["--skill", "s", "--label", "l", "--out", "o"]),
                           ("trigger", ["--skill", "s", "--label", "l", "--out", "o"]),
                           ("grade", ["--out", "o", "--label", "l"]),
                           ("report", ["--out", "o", "--labels", "a,b"])):
            fn = f"cmd_{cmd}"
            with mock.patch.object(ev, fn, return_value=7) as m:
                self.assertEqual(self._main([cmd] + extra), 7, cmd)
            ns = m.call_args[0][0]
            self.assertEqual(ns.cmd, cmd)
            self.assertEqual(ns.out, "o")

    def test_defaults(self):
        with mock.patch.object(ev, "cmd_rewrite", return_value=0) as m:
            self._main(["rewrite", "--skill", "s", "--label", "l", "--out", "o"])
        a = m.call_args[0][0]
        self.assertEqual((a.model, a.jobs, a.timeout, a.max_turns, a.reps), ("sonnet", 4, 600, 30, 1))
        with mock.patch.object(ev, "cmd_grade", return_value=0) as m:
            self._main(["grade", "--out", "o", "--label", "l"])
        a = m.call_args[0][0]
        self.assertEqual((a.judge_model, a.jobs, a.timeout), ("opus", 4, 300))

    def test_missing_subcommand_or_required_arg_exits_nonzero(self):
        for argv in ([], ["rewrite"], ["grade", "--out", "o"], ["bogus"]):
            with self.assertRaises(SystemExit) as cm, contextlib.redirect_stderr(io.StringIO()):
                self._main(argv)
            self.assertEqual(cm.exception.code, 2, argv)


if __name__ == "__main__":
    unittest.main()
