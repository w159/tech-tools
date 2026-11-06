"""In-process tests for worker_report_gate_core: helpers, report checks, board settling and the
SubagentStop entry points. The sibling test drives the hook as a subprocess; these call the functions."""

import os as _iso_os
import sys as _iso_sys

_HERE = _iso_os.path.dirname(_iso_os.path.abspath(__file__))
_iso_sys.path.insert(0, _iso_os.path.join(_HERE, "..", "scripts"))
_iso_sys.path.insert(0, _HERE)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

import worker_report_gate_core as core  # noqa: E402

with open(core.PROTOCOL, encoding="utf-8") as _f:
    REPORT = json.load(_f)["report"]

GOOD = (
    "STATUS: DONE\nSTEPS: 2/2\nFILES_CHANGED: none\nEVIDENCE:\n1. pytest -q -> 5 passed\n"
    "DELIVERABLE: none\nNEXT: none"
)


def report(status="DONE", steps="2/2", files="none", evidence="1. pytest -q -> 5 passed", deliverable="none", nxt="none"):
    return (
        f"STATUS: {status}\nSTEPS: {steps}\nFILES_CHANGED: {files}\nEVIDENCE:\n{evidence}\n"
        f"DELIVERABLE: {deliverable}\nNEXT: {nxt}"
    )


def git(root, *args):
    subprocess.run(
        ["git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        check=True,
        capture_output=True,
    )


class Tmp(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.root = os.path.realpath(self.td.name)


class HasFailingTest(unittest.TestCase):
    def test_unresolved_failures_detected(self):
        for t in ("5 failed, 3 passed", "1 error", "2 failures", "FAILED tests/x.py", "Error: boom", "10 Errors"):
            self.assertTrue(core.has_failing(t), t)

    def test_clean_or_resolved_text_passes(self):
        for t in ("all passed", "0 failed", "no failures", "errors-free", "3 failed (all fixed, 0 remaining)", "0 errors, 12 passed", "ok"):
            self.assertFalse(core.has_failing(t), t)

    def test_decimal_prefix_is_not_a_count(self):
        self.assertFalse(core.has_failing("x.5 failed"))
        self.assertFalse(core.has_failing("rate 1.5 failures"))

    def test_mixed_resolved_and_unresolved_still_blocks(self):
        self.assertTrue(core.has_failing("0 failed earlier but 2 failed now"))


class MarkerClaimedTest(Tmp):
    def test_first_claim_true_then_false_and_names_sanitized(self):
        with mock.patch.dict(os.environ, {"ATLAS_REPORT_GATE_DIR": os.path.join(self.root, "gate")}):
            self.assertTrue(core.marker_claimed("a/b c"))
            self.assertFalse(core.marker_claimed("a/b c"))
            self.assertTrue(core.marker_claimed("other"))
            self.assertEqual(sorted(os.listdir(os.path.join(self.root, "gate"))), ["a_b_c", "other"])

    def test_default_dir_under_tempdir(self):
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_REPORT_GATE_DIR"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(core.tempfile, "gettempdir", return_value=self.root):
            self.assertTrue(core.marker_claimed(7))
        self.assertTrue(os.path.exists(os.path.join(self.root, "atlas-report-gate", "7")))


class SectionsTest(unittest.TestCase):
    FIELDS = ["STATUS", "STEPS", "EVIDENCE"]

    def test_continuations_and_ignored_preamble(self):
        lines = ["preamble", "STATUS: DONE", "STEPS : 1/2", "EVIDENCE:", "1. a -> b", "  more", "other: x"]
        self.assertEqual(
            core.sections(lines, self.FIELDS),
            {"STATUS": "DONE", "STEPS": "1/2", "EVIDENCE": "1. a -> b\n  more\nother: x"},
        )

    def test_repeated_label_appends(self):
        self.assertEqual(core.sections(["STATUS: a", "STATUS: b"], self.FIELDS), {"STATUS": "a\nb"})

    def test_label_must_start_the_line(self):
        self.assertEqual(core.sections([" STATUS: DONE", "xSTEPS: 1/1"], self.FIELDS), {})


class EvidenceOkTest(unittest.TestCase):
    def test_arrow_forms(self):
        for t in ("1. ls -> out", "1) ls → out", "2. ls => out", "  3. cmd->x"):
            self.assertTrue(core.evidence_ok(t), t)

    def test_output_may_itself_contain_arrows(self):
        self.assertTrue(core.evidence_ok("1. git log -> a -> b => c"))
        self.assertFalse(core.evidence_ok("1. git log -> "))

    def test_continuation_line_counts_as_output(self):
        self.assertTrue(core.evidence_ok("1. pytest -q\n   5 passed"))
        self.assertTrue(core.evidence_ok("1. pytest -q\n\n   5 passed"))

    def test_rejections(self):
        for t in ("", "no numbering -> here", "1. only a command", "1. -> output only", "1. cmd ->", "1.\n   orphan continuation"):
            self.assertFalse(core.evidence_ok(t), t)

    def test_second_item_can_satisfy(self):
        self.assertTrue(core.evidence_ok("1. bare\n2. cmd -> out"))

    def test_text_before_first_item_ignored(self):
        self.assertFalse(core.evidence_ok("intro line\nstill intro"))


class LastEvidenceRowTest(unittest.TestCase):
    def test_last_item_with_continuations(self):
        self.assertEqual(core.last_evidence_row("1. red -> 2 failed\n2. green -> ok\n   4 passed"), "2. green -> ok\n   4 passed")

    def test_no_numbered_rows_returns_whole_text(self):
        self.assertEqual(core.last_evidence_row("free text"), "free text")
        self.assertEqual(core.last_evidence_row(""), "")

    def test_red_then_green_passes_the_failure_check(self):
        self.assertFalse(core.has_failing(core.last_evidence_row("1. t -> 2 failed\n2. t -> 2 passed")))
        self.assertTrue(core.has_failing(core.last_evidence_row("1. t -> ok\n2. t -> 2 failed")))


class GitChangedTest(Tmp):
    def _run(self, raw, top="/top"):
        def fake(cmd, **kw):
            return SimpleNamespace(stdout=top + "\n" if "rev-parse" in cmd else raw)

        with mock.patch.object(core.subprocess, "run", side_effect=fake):
            return core.git_changed("/cwd")

    def test_porcelain_parse_with_renames_and_copies(self):
        raw = "R  new.py\0old.py\0 M mod.py\0?? un.txt\0 C copy.py\0src.py\0AM a.py\0"
        self.assertEqual(
            self._run(raw),
            {"/top/new.py", "/top/old.py", "/top/mod.py", "/top/un.txt", "/top/copy.py", "/top/src.py", "/top/a.py"},
        )

    def test_plain_entry_does_not_swallow_next_entry(self):
        self.assertEqual(self._run("M  a.py\0 M b.py\0"), {"/top/a.py", "/top/b.py"})

    def test_short_or_empty_entries_ignored_and_trailing_rename_safe(self):
        self.assertEqual(self._run(""), set())
        self.assertEqual(self._run("R  only.py"), {"/top/only.py"})
        self.assertEqual(self._run("ab\0"), set())

    def test_git_unavailable_is_empty(self):
        with mock.patch.object(core.subprocess, "run", side_effect=OSError("no git")):
            self.assertEqual(core.git_changed("/x"), set())
        with mock.patch.object(core.subprocess, "run", side_effect=subprocess.TimeoutExpired("git", 5)):
            self.assertEqual(core.git_changed("/x"), set())

    def test_real_repo_untracked_modified_and_rename(self):
        git(self.root, "init", "-q")
        for n in ("keep.txt", "old.txt"):
            with open(os.path.join(self.root, n), "w") as f:
                f.write(n)
        git(self.root, "add", ".")
        git(self.root, "commit", "-qm", "init")
        with open(os.path.join(self.root, "keep.txt"), "w") as f:
            f.write("changed")
        git(self.root, "mv", "old.txt", "new.txt")
        os.makedirs(os.path.join(self.root, "sub"))
        with open(os.path.join(self.root, "sub", "u.txt"), "w") as f:
            f.write("u")
        got = core.git_changed(self.root)
        want = {os.path.join(self.root, n) for n in ("keep.txt", "old.txt", "new.txt", os.path.join("sub", "u.txt"))}
        self.assertEqual(got, want)

    def test_non_repo_is_empty(self):
        self.assertEqual(core.git_changed(self.root), set())


class MissingFilesTest(Tmp):
    def _touch(self, rel):
        p = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w").close()
        return p

    def test_trivial_values_return_empty_list(self):
        for v in ("", "  ", "none", "None", " NONE "):
            self.assertEqual(core.missing_files(v, self.root), [])
        self.assertEqual(core.missing_files("ghost.py", None), [])
        self.assertEqual(core.missing_files("ghost.py", ""), [])
        self.assertEqual(core.missing_files("ghost.py", os.path.join(self.root, "nodir")), [])

    def test_existing_relative_absolute_and_backticked(self):
        p = self._touch("a/b.py")
        self._touch("c.py")
        self.assertEqual(core.missing_files(f"a/b.py; `c.py`; {p}", self.root), [])

    def test_missing_listed_in_order_split_on_semicolons_and_newlines(self):
        self._touch("here.py")
        self.assertEqual(core.missing_files("ghost1.py; here.py\n- ghost2.py\n* ghost3.py", self.root), ["ghost1.py", "ghost2.py", "ghost3.py"])

    def test_skips_globs_urls_none_and_gone_annotations(self):
        v = "src/*.py; a?.py; {a,b}.py; local://x; agent://y; none; scratch.py (deleted); tmp.py (throwaway, not committed); real_missing.py"
        self.assertEqual(core.missing_files(v, self.root), ["real_missing.py"])

    def test_non_gone_annotation_is_stripped_and_checked(self):
        self._touch("mod.py")
        self.assertEqual(core.missing_files("mod.py (new helper); nope.py (renamed)", self.root), ["nope.py"])

    def test_semicolon_inside_annotation_does_not_split(self):
        self._touch("keep.py")
        self.assertEqual(core.missing_files("keep.py (a; b)", self.root), [])

    def test_git_status_rescues_deleted_file(self):
        git(self.root, "init", "-q")
        p = self._touch("gone.py")
        git(self.root, "add", ".")
        git(self.root, "commit", "-qm", "x")
        os.remove(p)
        self.assertEqual(core.missing_files("gone.py; truly_absent.py", self.root), ["truly_absent.py"])

    def test_git_not_consulted_when_nothing_missing(self):
        self._touch("a.py")
        with mock.patch.object(core, "git_changed") as gc:
            self.assertEqual(core.missing_files("a.py", self.root), [])
        gc.assert_not_called()


class CheckReportTest(Tmp):
    def check(self, msg, agent="atlas:runner", cwd=None):
        return core.check_report(msg, agent, cwd or self.root, REPORT)

    def test_valid_reports_have_no_problems(self):
        self.assertEqual(self.check(GOOD), [])
        self.assertEqual(self.check(report("FAILED", evidence="")), [])
        self.assertEqual(self.check("\n\n" + GOOD), [])

    def test_first_line_and_missing_labels_short_circuit(self):
        self.assertEqual(self.check("hello"), ["the first non-empty line is not `STATUS: DONE|FAILED|BLOCKED`", "missing labels: STATUS, STEPS, FILES_CHANGED, EVIDENCE, DELIVERABLE, NEXT"])
        out = self.check("STATUS: DONE\nSTEPS: 1/1")
        self.assertEqual(out, ["missing labels: FILES_CHANGED, EVIDENCE, DELIVERABLE, NEXT"])
        self.assertEqual(self.check(GOOD.replace("STATUS: DONE", "STATUS: MAYBE")), ["the first non-empty line is not `STATUS: DONE|FAILED|BLOCKED`"])

    def test_steps_validation(self):
        self.assertEqual(self.check(report(steps="three")), ["STEPS is not `<done>/<total>`"])
        self.assertEqual(self.check(report(steps="3/2")), ["STEPS done exceeds total"])
        self.assertEqual(self.check(report(steps=" 2 / 2 ")), [])
        self.assertEqual(self.check(report(steps="0/0")), [])
        self.assertEqual(self.check(report("BLOCKED", steps="x")), ["STEPS is not `<done>/<total>`"])

    def test_done_needs_evidence_and_no_failures(self):
        out = self.check(report(evidence="1. just a command"))
        self.assertEqual(len(out), 1)
        self.assertIn("numbered EVIDENCE line", out[0])
        out = self.check(report(evidence="1. pytest -> 2 failed"))
        self.assertEqual(out, ["a DONE report's EVIDENCE shows failing results; report FAILED or fix and re-run"])
        self.assertEqual(self.check(report("FAILED", evidence="1. pytest -> 2 failed")), [])

    def test_writers_files_changed_checked_readers_not(self):
        out = self.check(report(files="ghost.py"), agent="atlas:implementer")
        self.assertEqual(out, ["FILES_CHANGED names paths that do not exist and are not in git status: ghost.py"])
        self.assertEqual(self.check(report(files="ghost.py"), agent="atlas:explorer"), [])
        self.assertEqual(self.check(report("FAILED", files="ghost.py"), agent="atlas:implementer"), [])

    def test_ghost_list_truncated_to_three(self):
        out = self.check(report(files="a.py; b.py; c.py; d.py"), agent="atlas:docs-curator")
        self.assertTrue(out[0].endswith("a.py, b.py, c.py"))

    def test_writers_constant(self):
        self.assertEqual(core.WRITERS, ("atlas:implementer", "atlas:docs-curator", "atlas:runner"))


class FakeTodo:
    """Records set_status calls; mirrors the slice of atlas_todo that close_board_item uses."""

    def __init__(self, items, board=None):
        self.items, self.board, self.calls = items, board, []
        self.finished, self.left = [], []

    def member_board_item(self, root, who):
        return self.board

    def load(self, root):
        return {"items": self.items}

    def set_status(self, root, iid, status, evidence=None):
        self.calls.append((root, iid, status, evidence))

    def mark_finished(self, root, who, code):
        self.finished.append((who, code))

    def _reg_read(self, root):
        return {"channels": {"c1": {}, "c2": {}}}

    def leave(self, root, ch, who):
        self.left.append((ch, who))


class CloseBoardItemTest(unittest.TestCase):
    def test_done_completes_with_first_evidence_item_capped(self):
        t = FakeTodo([{"id": "i1", "owner": "w"}])
        long = "x" * 400
        msg = report(evidence=f"1. first -> {long}\n2. second -> y")
        core.close_board_item(t, "R", "w", msg, REPORT)
        (root, iid, status, ev), = t.calls
        self.assertEqual((root, iid, status), ("R", "i1", "completed"))
        self.assertEqual(len(ev), 300)
        self.assertTrue(ev.startswith("1. first -> xx"))

    def test_blocked_and_failed_mark_blocked(self):
        for st in ("BLOCKED", "FAILED"):
            t = FakeTodo([{"id": "i1", "owner": "w"}])
            core.close_board_item(t, "R", "w", report(st), REPORT)
            self.assertEqual(t.calls[0][2], "blocked", st)

    def test_board_item_id_beats_owner_and_skips_completed_or_archived(self):
        items = [
            {"id": "own", "owner": "w"},
            {"id": "hint", "owner": "someone"},
            {"id": "done", "owner": "w", "status": "completed"},
            {"id": "arch", "owner": "w", "archived": True},
        ]
        t = FakeTodo(items, board="hint")
        core.close_board_item(t, "R", "w", GOOD, REPORT)
        self.assertEqual(t.calls[0][1], "hint")
        t = FakeTodo(items, board="done")
        core.close_board_item(t, "R", "w", GOOD, REPORT)
        self.assertEqual(t.calls[0][1], "own")

    def test_owner_fallback_picks_latest_open_item(self):
        t = FakeTodo([{"id": "a", "owner": "w"}, {"id": "b", "owner": "w"}, {"id": "c", "owner": "z"}])
        core.close_board_item(t, "R", "w", GOOD, REPORT)
        self.assertEqual(t.calls[0][1], "b")

    def test_no_matching_item_is_a_noop(self):
        t = FakeTodo([{"id": "a", "owner": "z"}])
        core.close_board_item(t, "R", "w", GOOD, REPORT)
        self.assertEqual(t.calls, [])

    def test_no_message_blocks_with_no_final_report(self):
        for msg, rep in ((None, REPORT), ("", REPORT), ("   ", None)):
            t = FakeTodo([{"id": "a", "owner": "w"}])
            core.close_board_item(t, "R", "w", msg, rep)
            self.assertEqual(t.calls, [("R", "a", "blocked", "worker finished without a valid report: no final report")], (msg, rep))

    def test_message_without_report_blocks_with_container_problems(self):
        t = FakeTodo([{"id": "a", "owner": "w"}])
        core.close_board_item(t, "R", "w", "just prose", None)
        (_, iid, status, ev), = t.calls
        self.assertEqual((iid, status), ("a", "blocked"))
        self.assertEqual(
            ev,
            "worker finished without a valid report: the first non-empty line is not `STATUS: DONE|FAILED|BLOCKED`; "
            "missing labels: STATUS, STEPS, FILES_CHANGED, EVIDENCE, DELIVERABLE, NEXT",
        )

    def test_report_without_message_blocks(self):
        t = FakeTodo([{"id": "a", "owner": "w"}])
        core.close_board_item(t, "R", "w", None, REPORT)
        self.assertEqual(t.calls[0][2:], ("blocked", "worker finished without a valid report: no final report"))

    def test_block_reason_capped_at_300(self):
        t = FakeTodo([{"id": "a", "owner": "w"}])
        core._block(t, "R", {"id": "a"}, "y" * 500)
        self.assertEqual(len(t.calls[0][3]), 300)
        self.assertTrue(t.calls[0][3].startswith("worker finished without a valid report: yyy"))

    def test_reap_member_settles_finishes_and_leaves_every_channel(self):
        t = FakeTodo([{"id": "a", "owner": "w"}])
        core.reap_member(t, "R", "w", GOOD, REPORT)
        self.assertEqual(t.calls[0][1:3], ("a", "completed"))
        self.assertEqual(t.finished, [("w", 0)])
        self.assertEqual(sorted(t.left), [("c1", "w"), ("c2", "w")])


class FinishMemberTest(Tmp):
    def setUp(self):
        super().setUp()
        import atlas_todo

        self.todo = atlas_todo
        git(self.root, "init", "-q")

    def _members(self):
        return {m["name"]: m for c in self.todo._reg_read(self.root)["channels"].values() for m in c["members"]}

    def test_agent_name_match_with_report_completes_item(self):
        self.todo.open_lead_channel(self.root, "lead-x", ["impl-1"])
        item = self.todo.add(self.root, "work", owner="impl-1", origin="manual")["item"]
        core.finish_member({"agent_name": "impl-1", "cwd": self.root}, GOOD, REPORT)
        self.assertEqual(self.todo.load(self.root)["items"][0]["status"], "completed")
        self.assertEqual(item["id"], self.todo.load(self.root)["items"][0]["id"])

    def test_agent_id_mapping_used(self):
        self.todo.open_lead_channel(self.root, "lead-x", ["impl-2"])
        self.todo.set_member_agent_id(self.root, "impl-2", "aid123456789")
        core.finish_member({"agent_id": "aid123456789", "agent_type": "atlas:implementer", "cwd": self.root})
        self.assertEqual(self._members()["impl-2"].get("exit_code"), 0)

    def test_type_fallback_single_candidate_and_excludes_lead_and_mapped(self):
        self.todo.open_lead_channel(self.root, "lead-x", ["runner-a", "explorer-q"])
        core.finish_member({"agent_id": "nomap", "agent_type": "atlas:runner", "cwd": self.root})
        m = self._members()
        self.assertEqual(m["runner-a"].get("exit_code"), 0)
        self.assertNotIn("exit_code", m["explorer-q"])
        self.assertNotIn("exit_code", m["lead-x"])

    def test_type_fallback_ambiguous_records_fault_and_finishes_nobody(self):
        self.todo.open_lead_channel(self.root, "lead-x", ["runner-a", "runner-b"])
        with mock.patch("atlas_faults.record") as rec:
            core.finish_member({"agent_id": "nomap", "agent_type": "atlas:runner", "cwd": self.root})
        self.assertEqual(rec.call_args[0][0], "worker_report_gate.finish_member")
        self.assertIn("ambiguous SubagentStop fallback: ['runner-a', 'runner-b']", str(rec.call_args[0][1]))
        self.assertTrue(all("exit_code" not in m for m in self._members().values()))

    def test_no_agent_type_and_no_match_are_noops(self):
        self.todo.open_lead_channel(self.root, "lead-x", ["runner-a"])
        core.finish_member({"agent_id": "nomap", "cwd": self.root})
        core.finish_member({"agent_id": "nomap", "agent_type": "atlas:verifier", "cwd": self.root})
        self.assertTrue(all("exit_code" not in m for m in self._members().values()))

    def test_errors_are_swallowed_and_recorded(self):
        with mock.patch("atlas_todo.find_root", side_effect=RuntimeError("bad root")), mock.patch("atlas_faults.record") as rec:
            self.assertIsNone(core.finish_member({"cwd": self.root}))
        self.assertEqual(rec.call_args[0][0], "worker_report_gate.finish_member")
        with mock.patch("atlas_todo.find_root", side_effect=RuntimeError("bad")), mock.patch("atlas_faults.record", side_effect=RuntimeError("worse")):
            self.assertIsNone(core.finish_member({"cwd": self.root}))


class MainTest(Tmp):
    def run_main(self, payload, env=None, raw=None):
        gate = os.path.join(self.root, "gate")
        e = {"ATLAS_REPORT_GATE_DIR": gate}
        e.update(env or {})
        out = io.StringIO()
        with mock.patch.dict(os.environ, e), mock.patch("sys.stdin", io.StringIO(raw if raw is not None else json.dumps(payload))), mock.patch("sys.stdout", out):
            core.main()
        return out.getvalue()

    def pl(self, **kw):
        p = {"hook_event_name": "SubagentStop", "agent_id": "a1", "agent_type": "atlas:runner", "last_assistant_message": "nope", "cwd": self.root}
        p.update(kw)
        return p

    def test_bad_report_blocks_once_with_template_then_finishes(self):
        with mock.patch.object(core, "finish_member") as fm:
            out = self.run_main(self.pl())
            d = json.loads(out)
            self.assertEqual(d["decision"], "block")
            self.assertIn("Your final message is not the atlas report container (the first non-empty line is not", d["reason"])
            self.assertIn("EVIDENCE:\n1. <command or read-back> -> ", d["reason"])
            fm.assert_not_called()
            self.assertEqual(self.run_main(self.pl()), "")
            fm.assert_called_once_with(self.pl())

    def test_compliant_report_is_silent_and_settles(self):
        with mock.patch.object(core, "finish_member") as fm:
            self.assertEqual(self.run_main(self.pl(last_assistant_message=GOOD)), "")
        fm.assert_called_once()
        self.assertEqual(fm.call_args[0][1], GOOD)
        self.assertEqual(fm.call_args[0][2], REPORT)

    def test_no_agent_id_keys_marker_on_message(self):
        with mock.patch.object(core, "finish_member"):
            self.assertIn("block", self.run_main(self.pl(agent_id=None, last_assistant_message="one")))
            self.assertIn("block", self.run_main(self.pl(agent_id=None, last_assistant_message="two")))
            self.assertEqual(self.run_main(self.pl(agent_id=None, last_assistant_message="one")), "")

    def test_silent_skip_paths(self):
        with mock.patch.object(core, "finish_member") as fm:
            self.assertEqual(self.run_main(self.pl(), env={"ATLAS_GATE": "off"}), "")
            self.assertEqual(self.run_main(self.pl(), env={"ATLAS_GATE_REPORT": "off"}), "")
            self.assertEqual(self.run_main(self.pl(hook_event_name="Stop")), "")
            self.assertEqual(self.run_main(None, raw="[1]"), "")
            self.assertEqual(self.run_main(self.pl(stop_hook_active=True)), "")
            fm.assert_not_called()

    def test_non_atlas_or_blank_message_only_finishes_member(self):
        for kw in ({"agent_type": "other:x"}, {"agent_type": ""}, {"last_assistant_message": "  "}, {"last_assistant_message": None}, {"last_assistant_message": 5}):
            with mock.patch.object(core, "finish_member") as fm:
                self.assertEqual(self.run_main(self.pl(**kw)), "", kw)
            fm.assert_called_once_with(self.pl(**kw))

    def test_malformed_stdin_raises_to_cli(self):
        with self.assertRaises(ValueError):
            self.run_main(None, raw="{not json")


class CliTest(Tmp):
    def test_cli_exits_zero_and_records_fault_on_error(self):
        with mock.patch.object(core, "main", side_effect=RuntimeError("bang")), mock.patch("atlas_faults.record") as rec:
            with self.assertRaises(SystemExit) as cm:
                core._cli()
        self.assertEqual(cm.exception.code, 0)
        self.assertEqual(rec.call_args[0][0], "worker_report_gate")
        self.assertIsInstance(rec.call_args[0][1], RuntimeError)

    def test_cli_clean_run_exits_zero_without_fault(self):
        with mock.patch.object(core, "main"), mock.patch("atlas_faults.record") as rec:
            with self.assertRaises(SystemExit) as cm:
                core._cli()
        self.assertEqual(cm.exception.code, 0)
        rec.assert_not_called()

    def test_cli_swallows_fault_recorder_failure(self):
        with mock.patch.object(core, "main", side_effect=RuntimeError("x")), mock.patch("atlas_faults.record", side_effect=RuntimeError("y")):
            with self.assertRaises(SystemExit) as cm:
                core._cli()
        self.assertEqual(cm.exception.code, 0)


if __name__ == "__main__":
    unittest.main()
