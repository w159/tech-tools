"""Extra session_ingest tests: exact contracts of classification, snippets, key attribution, session-id
reads, tool-result accounting, backfill totals/batching and ownership re-pointing."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import re
import sys
import tempfile
import unittest
from unittest import mock

import atlas_db
import session_ingest as si


def _w(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")
    return path


def _msg(uuid, role, content, sid="s-more", **extra):
    return json.dumps(
        {
            "type": role,
            "uuid": uuid,
            "sessionId": sid,
            "cwd": "/repo/app",
            "timestamp": "2026-06-26T12:00:00Z",
            "message": {"role": role, "content": content, **extra},
        }
    )


class Base(unittest.TestCase):
    def setUp(self):
        p = mock.patch.dict(os.environ)
        p.start()
        self.addCleanup(p.stop)
        os.environ.pop("ATLAS_HARNESS", None)
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "atlas.db"))
        atlas_db.init(self.conn)
        self.addCleanup(self.conn.close)


class ClassifyMoreTest(unittest.TestCase):
    def test_product_plugin_name_becomes_server(self):
        self.assertEqual(
            si.classify("mcp__plugin_claude-mem_mcp-search__search", {}),
            ("mcp", "claude-mem.search", "claude-mem"),
        )
        self.assertEqual(
            si.classify("mcp__plugin_context7_context7__query-docs", {}),
            ("mcp", "context7.query-docs", "context7"),
        )

    def test_non_product_plugin_uses_inner_server(self):
        self.assertEqual(
            si.classify("mcp__plugin_azure_azure-ops__list", {}),
            ("mcp", "azure-ops.list", "azure-ops"),
        )

    def test_plugin_without_server_segment_falls_back_to_plugin(self):
        self.assertEqual(si.classify("mcp__plugin_solo__go", {}), ("mcp", "solo.go", "solo"))

    def test_plain_mcp_and_skill_fallbacks(self):
        self.assertEqual(si.classify("mcp__github__issue", {}), ("mcp", "github.issue", "github"))
        self.assertEqual(si.classify("Skill", {"command": "c"}), ("skill", "c", None))
        self.assertEqual(si.classify("Skill", {"skill": "s", "command": "c"}), ("skill", "s", None))
        self.assertEqual(si.classify("Task", {"subagent_type": "a:b"}), ("agent", "a:b", None))
        self.assertEqual(si.classify("Agent", {}), ("agent", "Agent", None))
        self.assertEqual(si.classify("Bash", None), ("builtin", "Bash", None))


class SummarizeInputMoreTest(unittest.TestCase):
    def test_identity_keys_first_and_task_names_lifted(self):
        s, size = si.summarize_input(
            {"zzz": "1", "tasks": [{"name": "a"}, {"name": None}, "junk"], "model": "m", "name": "n"}
        )
        d = json.loads(s)
        keys = list(d)
        self.assertEqual(keys[:3], ["name", "names", "model"])
        self.assertEqual(json.loads(d["names"]), ["a", ""])
        self.assertEqual(size, len(json.dumps({"zzz": "1", "tasks": [{"name": "a"}, {"name": None}, "junk"], "model": "m", "name": "n"})))

    def test_existing_names_not_overwritten_and_caps(self):
        d = json.loads(si.summarize_input({"tasks": [{"name": "a"}], "names": ["keep"]})[0])
        self.assertEqual(json.loads(d["names"]), ["keep"])
        s, _ = si.summarize_input({"k%d" % i: "x" * 300 for i in range(5)})
        self.assertLessEqual(len(s), 500)
        d = json.loads(si.summarize_input({"a": "x" * 300})[0])
        self.assertEqual(len(d["a"]), 200)

    def test_secret_named_key_redacted_and_none_input(self):
        d = json.loads(si.summarize_input({"api_key": "supersecretvalue", "path": "/x"})[0])
        self.assertEqual(d["api_key"], "[REDACTED]")
        self.assertEqual(d["path"], "/x")
        self.assertEqual(si.summarize_input(None), ("{}", 2))


class SnippetMoreTest(unittest.TestCase):
    def _snip(self, text, pat):
        return si._snippet(text, re.search(pat, text))

    def test_match_at_sentence_start_uses_fallback_window_not_zero_width(self):
        text = "Earlier note here. never tested it before the release."
        self.assertEqual(
            self._snip(text, "never tested"),
            "Earlier note here. never tested it before the release.",
        )

    def test_sentence_bounds_when_mid_sentence(self):
        text = "First one. The build I never tested it properly. Third bit."
        self.assertEqual(self._snip(text, "never tested"), "The build I never tested it properly.")

    def test_no_following_boundary_takes_80_chars_and_caps_300(self):
        text = "x " * 10 + "MATCH" + " y" * 100
        s = self._snip(text, "MATCH")
        self.assertTrue(s.startswith("x x"))
        self.assertEqual(self._snip("MATCH" + "a" * 500, "MATCH"), ("MATCH" + "a" * 80))
        self.assertLessEqual(len(self._snip("Q. " + "word " * 200 + "MATCH. tail", "MATCH")), 300)

    def test_whitespace_collapsed(self):
        self.assertEqual(self._snip("a   b\n\n  MATCH   c.  z", "MATCH"), "a b MATCH c.")


class KeysMoreTest(unittest.TestCase):
    def test_key_add_ignores_empty_and_records(self):
        k = {"m": [], "t": [], "full": False}
        si._key_add(k, "m", "")
        si._key_add(k, "m", None)
        si._key_add(k, "m", "u1")
        si._key_add(k, "t", "t1")
        self.assertEqual(k, {"m": ["u1"], "t": ["t1"], "full": False})

    def test_key_add_marks_full_at_cap_and_stops_recording(self):
        k = {"m": [], "t": [], "full": False}
        with mock.patch.object(si, "_KEY_CAP", 2):
            for v in ("a", "b", "c", "d"):
                si._key_add(k, "m", v)
            self.assertEqual(k["m"], ["a", "b"])
            self.assertIs(k["full"], True)
            si._key_add(k, "t", "late")
        self.assertEqual(k["t"], [])

    def test_key_json(self):
        self.assertIsNone(si._key_json({"m": [], "t": [], "full": False}))
        self.assertIsNone(si._key_json({"m": ["a"], "t": [], "full": True}))
        self.assertEqual(json.loads(si._key_json({"m": ["a"], "t": [], "full": False})), {"m": ["a"], "t": []})
        self.assertEqual(json.loads(si._key_json({"m": [], "t": ["t"], "full": False})), {"m": [], "t": ["t"]})


class TranscriptFactsTest(Base):
    def _facts(self, *lines):
        return si.transcript_facts(_w(os.path.join(self.tmp, "t.jsonl"), list(lines)))

    def test_omp_header_with_parent_session_is_subagent(self):
        self.assertEqual(
            self._facts(json.dumps({"type": "session", "id": "h", "cwd": "/c", "parentSession": "p"}), json.dumps({"type": "message"})),
            ("h", "/c", True, True),
        )

    def test_header_with_parent_only_is_subagent(self):
        self.assertTrue(self._facts(json.dumps({"type": "session", "id": "h", "parent": "p"}))[2])

    def test_header_without_parent_is_not_subagent(self):
        self.assertEqual(self._facts(json.dumps({"type": "session", "id": "h", "cwd": "/c"})), ("h", "/c", False, False))

    def test_claude_message_cwd_and_stop_at_first_message(self):
        out = self._facts(
            "not json",
            json.dumps([1]),
            json.dumps({"type": "user", "cwd": "/first"}),
            json.dumps({"type": "session", "id": "late", "cwd": "/late", "parentSession": "p"}),
        )
        self.assertEqual(out, (None, "/first", False, True))

    def test_header_cwd_wins_over_message_cwd(self):
        out = self._facts(json.dumps({"type": "session", "id": "h", "cwd": "/hdr"}), json.dumps({"type": "assistant", "cwd": "/msg"}))
        self.assertEqual(out[1], "/hdr")

    def test_missing_file(self):
        self.assertEqual(si.transcript_facts(os.path.join(self.tmp, "nope")), (None, None, False, False))


class SkipReasonTest(Base):
    def test_precedence_and_none(self):
        p = os.path.join(self.tmp, "x.jsonl")
        self.assertEqual(si.skip_reason(p, (None, "/w", True, True)), "subagent")
        self.assertEqual(si.skip_reason(p, (None, "/w", False, False)), "empty")
        self.assertEqual(si.skip_reason("/a/claude-mem-observer-sessions/x.jsonl", (None, "/w", False, True)), "scratch")
        self.assertEqual(si.skip_reason("/a/.claude-mem/observer-sessions/x.jsonl", (None, "/w", False, True)), "scratch")
        with mock.patch.object(si, "scratch_cwd", return_value=True):
            self.assertEqual(si.skip_reason(p, (None, "/w", False, True)), "scratch")
        with mock.patch.object(si, "scratch_cwd", return_value=False):
            self.assertIsNone(si.skip_reason(p, (None, "/w", False, True)))

    def test_facts_read_from_file_when_not_given(self):
        p = _w(os.path.join(self.tmp, "r.jsonl"), [json.dumps({"type": "user", "cwd": "/home/me/proj"})])
        with mock.patch.object(si, "scratch_cwd", return_value=False):
            self.assertIsNone(si.skip_reason(p))
        p2 = _w(os.path.join(self.tmp, "e.jsonl"), [json.dumps({"type": "summary"})])
        self.assertEqual(si.skip_reason(p2), "empty")


class ScratchCwdTest(unittest.TestCase):
    def test_temp_prefixes_and_scratch_dir(self):
        for c in ("/tmp", "/tmp/x/y", "/private/tmp/a", "/var/folders/ab/cd", "/home/u/proj/.scratch/run"):
            self.assertTrue(si.scratch_cwd(c), c)
        self.assertTrue(si.scratch_cwd("/home/u/proj/.scratch"))

    def test_empty_and_lookalike_paths(self):
        self.assertFalse(si.scratch_cwd(None))
        self.assertFalse(si.scratch_cwd(""))
        with mock.patch.dict(sys.modules, {"atlas_control": mock.Mock(is_fixture_project=mock.Mock(return_value=False))}):
            self.assertFalse(si.scratch_cwd("/tmpfoo/bar"))
            self.assertFalse(si.scratch_cwd("/home/u/proj"))

    def test_fixture_project_and_import_failure(self):
        with mock.patch.dict(sys.modules, {"atlas_control": mock.Mock(is_fixture_project=mock.Mock(return_value=True))}):
            self.assertTrue(si.scratch_cwd("/home/u/atlas-e2e-1"))
        with mock.patch.dict(sys.modules, {"atlas_control": mock.Mock(is_fixture_project=mock.Mock(side_effect=RuntimeError))}):
            self.assertFalse(si.scratch_cwd("/home/u/proj"))


class SyntheticTest(unittest.TestCase):
    def test_path_or_cwd_and_backslashes(self):
        self.assertTrue(si.is_synthetic_session(path="/h/.claude-mem/observer-sessions/a.jsonl"))
        self.assertTrue(si.is_synthetic_session(cwd="C:\\u\\.claude-mem\\observer-sessions"))
        self.assertTrue(si.is_synthetic_session(path="/ok", cwd="/h/.claude-mem/observer-sessions"))
        self.assertFalse(si.is_synthetic_session())
        self.assertFalse(si.is_synthetic_session(path="/ok", cwd="/fine"))


class SessionIdReadTest(Base):
    def test_first_nonblank_line_without_id_stops_the_search(self):
        p = _w(os.path.join(self.tmp, "a.jsonl"), ["", json.dumps({"type": "x"}), json.dumps({"sessionId": "later"})])
        self.assertIsNone(si._read_session_id(p))

    def test_id_found_after_blank_lines(self):
        p = _w(os.path.join(self.tmp, "b.jsonl"), ["", "   ", json.dumps({"sessionId": "sid-1"}), json.dumps({"sessionId": "sid-2"})])
        self.assertEqual(si._read_session_id(p), "sid-1")

    def test_cwd_search_continues_past_lines_without_cwd(self):
        p = _w(os.path.join(self.tmp, "c.jsonl"), [json.dumps({"a": 1}), json.dumps({"cwd": "/found"})])
        self.assertEqual(si._read_session_cwd(p), "/found")


class ToolResultAccountingTest(Base):
    def _ingest(self, lines, sid="s-more"):
        p = _w(os.path.join(self.tmp, f"{sid}.jsonl"), lines)
        return si.ingest_transcript(p, conn=self.conn, session_id=sid), p

    def test_results_counted_one_each_and_is_error_flag_values(self):
        stats, _ = self._ingest(
            [
                _msg("a1", "assistant", [
                    {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}},
                    {"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "ls"}},
                    {"type": "tool_use", "id": "t3", "name": "Bash", "input": {"command": "ls"}},
                    {"type": "tool_use", "id": "t4", "name": "Bash", "input": {"command": "ls"}},
                ]),
                _msg("r1", "user", [
                    {"type": "tool_result", "tool_use_id": "t1", "is_error": True, "content": "bad"},
                    {"type": "tool_result", "tool_use_id": "t2", "is_error": "true", "content": [{"type": "text", "text": "worse"}, "junk"]},
                    {"type": "tool_result", "tool_use_id": "t3", "is_error": False, "content": "fine"},
                    {"type": "tool_result", "tool_use_id": "t4", "content": None},
                ]),
            ]
        )
        self.assertEqual((stats["tools"], stats["results"]), (4, 4))
        rows = {r[0]: r[1:] for r in self.conn.execute("SELECT tool_use_id,is_error,result_bytes FROM tool_calls")}
        self.assertEqual(rows["t1"], (1, len("bad")))
        self.assertEqual(rows["t2"][0], 1)
        self.assertEqual(rows["t2"][1], len(json.dumps([{"type": "text", "text": "worse"}, "junk"])))
        self.assertEqual(rows["t3"], (0, len("fine")))
        self.assertEqual(rows["t4"][0], 0)
        snip = self.conn.execute("SELECT error_snippet FROM tool_calls WHERE tool_use_id='t2'").fetchone()[0]
        self.assertEqual(snip, "worse")

    def test_stats_exact_for_simple_transcript(self):
        stats, _ = self._ingest(
            [
                _msg("u1", "user", [{"type": "text", "text": "please do the thing now"}]),
                _msg("a1", "assistant", [{"type": "text", "text": "ok"}, {"type": "tool_use", "id": "t1", "name": "Bash", "input": {}}]),
                _msg("r1", "user", [{"type": "tool_result", "tool_use_id": "t1", "content": "x"}]),
            ]
        )
        self.assertEqual(
            {k: stats[k] for k in ("messages", "tools", "prompts", "signals", "results", "skipped")},
            {"messages": 3, "tools": 1, "prompts": 1, "signals": 0, "results": 1, "skipped": 0},
        )

    def test_result_text_shapes(self):
        self.assertEqual(si._result_text("s"), "s")
        self.assertEqual(si._result_text([{"text": "a"}, "x", {"type": "image"}, {"text": "b"}]), "a\n\nb")
        self.assertEqual(si._result_text(None), "")
        self.assertEqual(si._result_text({"text": "a"}), "")


class BackfillTotalsTest(Base):
    def _tree(self):
        root = os.path.join(self.tmp, "proj")
        for i in range(2):
            _w(
                os.path.join(root, "enc", f"s{i}.jsonl"),
                [
                    _msg(f"u{i}", "user", [{"type": "text", "text": "please wire the endpoint"}], sid=f"s{i}"),
                    _msg(f"a{i}", "assistant", [{"type": "text", "text": "ok"}, {"type": "tool_use", "id": f"t{i}", "name": "Bash", "input": {}}], sid=f"s{i}"),
                ],
            )
        _w(os.path.join(root, "enc", "empty.jsonl"), [json.dumps({"type": "summary"})])
        _w(os.path.join(root, "enc", "notes.txt"), ["ignored"])
        return root

    def test_totals_exact(self):
        with mock.patch.object(si, "scratch_cwd", return_value=False):
            out = si.backfill(self._tree(), conn=self.conn)
        self.assertEqual(out, {"files": 2, "messages": 4, "tools": 2, "prompts": 2, "signals": 0})

    def test_empty_root_gives_zero_totals(self):
        empty = os.path.join(self.tmp, "none")
        os.makedirs(empty)
        self.assertEqual(si.backfill(empty, conn=self.conn), {"files": 0, "messages": 0, "tools": 0, "prompts": 0, "signals": 0})

    def test_backfill_agent_unknown_and_empty_totals(self):
        with self.assertRaises(ValueError):
            si.backfill_agent("nope", root=self.tmp, conn=self.conn)
        empty = os.path.join(self.tmp, "none2")
        os.makedirs(empty)
        self.assertEqual(si.backfill_agent("codex", root=empty, conn=self.conn), {"files": 0, "messages": 0, "tools": 0, "prompts": 0, "signals": 0})


class BackfillErrorsMoreTest(Base):
    def _setup(self, n):
        calls = []
        for i in range(n):
            calls.append({"type": "tool_use", "id": f"e{i}", "name": "Bash", "input": {}})
        results = [{"type": "tool_result", "tool_use_id": f"e{i}", "is_error": True, "content": f"failure number {i}"} for i in range(n)]
        root = os.path.join(self.tmp, "root")
        _w(os.path.join(root, "p", "s-err.jsonl"), [_msg("a1", "assistant", calls, sid="s-err"), _msg("r1", "user", results, sid="s-err")])
        # simulate rows that failed but lost their snippet
        p = os.path.join(root, "p", "s-err.jsonl")
        si.ingest_transcript(p, conn=self.conn, session_id="s-err")
        self.conn.execute("UPDATE tool_calls SET error_snippet=NULL, denied=0")
        self.conn.commit()
        return root

    def test_rows_refilled_flag_kept_one_and_counts(self):
        root = self._setup(3)
        out = si.backfill_errors(roots=[root], conn=self.conn)
        self.assertEqual((out["empty_before"], out["updated"], out["empty_after"], out["denied"]), (3, 3, 0, 0))
        self.assertEqual(out["files"], 1)
        flags = sorted(r[0] for r in self.conn.execute("SELECT is_error FROM tool_calls"))
        self.assertEqual(flags, [1, 1, 1])
        snips = sorted(r[0] for r in self.conn.execute("SELECT error_snippet FROM tool_calls"))
        self.assertEqual(snips, [f"failure number {i}" for i in range(3)])
        again = si.backfill_errors(roots=[root], conn=self.conn)
        self.assertEqual((again["empty_before"], again["updated"]), (0, 0))

    def test_commits_every_batch_results(self):
        root = self._setup(4)

        class Spy:
            def __init__(self, conn):
                self.conn, self.commits = conn, 0

            def execute(self, *a, **k):
                return self.conn.execute(*a, **k)

            def commit(self):
                self.commits += 1
                self.conn.commit()

        spy = Spy(self.conn)
        si.backfill_errors(roots=[root], conn=spy, batch=2)
        # two mid-run commits (after results 2 and 4) plus the final one
        self.assertEqual(spy.commits, 3)
        spy = Spy(self.conn)
        self.conn.execute("UPDATE tool_calls SET error_snippet=NULL")
        si.backfill_errors(roots=[root], conn=spy, batch=100)
        self.assertEqual(spy.commits, 1)

    def test_denied_results_counted(self):
        root = self._setup(1)
        text = "DENY - this Task dispatch overrides model with 'x'"
        p = os.path.join(root, "p", "s-err.jsonl")
        _w(p, [_msg("a1", "assistant", [{"type": "tool_use", "id": "e0", "name": "Task", "input": {}}], sid="s-err"),
               _msg("r1", "user", [{"type": "tool_result", "tool_use_id": "e0", "is_error": True, "content": text}], sid="s-err")])
        with mock.patch.object(si.atlas_db, "is_denied_result", return_value=True):
            out = si.backfill_errors(roots=[root], conn=self.conn)
        self.assertEqual(out["denied"], 1)

    def test_error_results_claude_and_omp_shapes(self):
        p = _w(
            os.path.join(self.tmp, "mix.jsonl"),
            [
                "garbage with is_error",
                _msg("r0", "user", [{"type": "tool_result", "tool_use_id": "ok", "is_error": False, "content": "fine"}]),
                _msg("r1", "user", [{"type": "tool_result", "tool_use_id": "c1", "is_error": "True", "content": "boom"}, "junk"]),
                json.dumps({"type": "message", "message": {"role": "toolResult", "isError": True, "toolCallId": "o1", "content": [{"type": "text", "text": "omp bad"}]}}),
                json.dumps({"type": "message", "message": {"role": "toolResult", "isError": True, "content": "x"}}),
                json.dumps({"type": "message", "message": {"role": "toolResult", "isError": False, "toolCallId": "o2", "content": "isError"}}),
            ],
        )
        self.assertEqual(list(si._error_results(p)), [("c1", 4, "boom"), ("o1", len("omp bad"), "omp bad")])


class AdoptSourceTest(Base):
    def _row(self, sid="s-adopt", path="/old/path.jsonl"):
        atlas_db.upsert_session_log(self.conn, sid, transcript_path=path)
        self.conn.commit()

    def _path(self):
        return _w(os.path.join(self.tmp, "keep", "orig.jsonl"), ["{}"])

    def test_updates_and_returns_true_then_false_when_unchanged(self):
        self._row()
        src = self._path()
        with mock.patch.object(si.atlas_db, "is_tmp_path", return_value=False):
            self.assertIs(si.adopt_source_transcript("s-adopt", src, conn=self.conn), True)
            self.assertIs(si.adopt_source_transcript("s-adopt", src, conn=self.conn), False)
        self.assertEqual(self.conn.execute("SELECT transcript_path FROM session_logs").fetchone()[0], src)

    def test_unknown_session_missing_file_empty_args_and_tmp_source(self):
        src = self._path()
        with mock.patch.object(si.atlas_db, "is_tmp_path", return_value=False):
            self.assertIs(si.adopt_source_transcript("nope", src, conn=self.conn), False)
            self.assertIs(si.adopt_source_transcript("", src, conn=self.conn), False)
            self.assertIs(si.adopt_source_transcript("s", "", conn=self.conn), False)
            self.assertIs(si.adopt_source_transcript("s", os.path.join(self.tmp, "gone"), conn=self.conn), False)
        self._row()
        with mock.patch.object(si.atlas_db, "is_tmp_path", return_value=True):
            self.assertIs(si.adopt_source_transcript("s-adopt", src, conn=self.conn), False)
        self.assertEqual(self.conn.execute("SELECT transcript_path FROM session_logs").fetchone()[0], "/old/path.jsonl")

    def test_own_connection_is_committed_and_closed(self):
        self._row()
        src = self._path()
        os.environ["ATLAS_DB"] = os.path.join(self.tmp, "atlas.db")
        with mock.patch.object(si.atlas_db, "is_tmp_path", return_value=False):
            self.assertIs(si.adopt_source_transcript("s-adopt", src), True)
        self.assertEqual(self.conn.execute("SELECT transcript_path FROM session_logs").fetchone()[0], src)


class RepairTmpTest(Base):
    def test_counts_dry_run_and_apply(self):
        root = os.path.join(self.tmp, "omp")
        orig = _w(os.path.join(root, "a", "x.jsonl"), [json.dumps({"type": "session", "id": "known"}, separators=(",", ":"))])
        _w(os.path.join(root, "a", "y.jsonl"), ["", json.dumps({"type": "message"})])
        self.assertEqual(si._omp_session_files(root), {"known": orig})
        tmp_ts = os.path.join(tempfile.gettempdir(), "atlas-ingest-zz", "t.jsonl")
        atlas_db.upsert_session_log(self.conn, "known", transcript_path=tmp_ts)
        atlas_db.upsert_session_log(self.conn, "lost", transcript_path=tmp_ts)
        self.conn.commit()
        dry = si.repair_tmp_transcript_paths(apply=False, root=root, conn=self.conn)
        self.assertEqual(dry, {"tmp_rows": 2, "repointable": 1, "unrecoverable": 1, "applied": 0})
        self.assertEqual(self.conn.execute("SELECT transcript_path FROM session_logs WHERE session_id='known'").fetchone()[0], tmp_ts)
        with mock.patch.object(si.atlas_db, "is_tmp_path", side_effect=lambda p: p == tmp_ts):
            done = si.repair_tmp_transcript_paths(apply=True, root=root, conn=self.conn)
        self.assertEqual(done, {"tmp_rows": 2, "repointable": 1, "unrecoverable": 1, "applied": 1})
        self.assertEqual(self.conn.execute("SELECT transcript_path FROM session_logs WHERE session_id='known'").fetchone()[0], orig)


class ReconcileMoreTest(Base):
    def test_non_omp_session_adds_nothing(self):
        atlas_db.upsert_session_log(self.conn, "c1", agent="claude")
        self.assertEqual(si.reconcile_task_dispatches(self.conn, "c1"), 0)
        self.assertEqual(si.reconcile_task_dispatches(self.conn, "missing"), 0)

    def test_failure_is_swallowed_and_recorded(self):
        class Boom:
            def execute(self, *a, **k):
                raise RuntimeError("db down")

        with mock.patch("atlas_faults.record") as rec:
            self.assertEqual(si.reconcile_task_dispatches(Boom(), "s"), 0)
        self.assertEqual(rec.call_args[0][0], "session_ingest.dispatches")


class HarnessAgentMoreTest(unittest.TestCase):
    def test_values(self):
        for val, want in (("omp", "omp"), (" OMP ", "omp"), ("", None), ("other", None), ("claude", None)):
            with mock.patch.dict(os.environ, {"ATLAS_HARNESS": val}):
                self.assertEqual(si.harness_agent(), want, val)
        with mock.patch.dict(os.environ):
            os.environ.pop("ATLAS_HARNESS", None)
            self.assertIsNone(si.harness_agent())


class NormalizeAndEpochTest(unittest.TestCase):
    def test_normalize_edges(self):
        self.assertIsNone(si._normalize("  !!  "))
        self.assertEqual(si._normalize("Hello,   WORLD! 42"), "hello world 42")
        self.assertEqual(len(si._normalize("a" * 300)), 120)

    def test_epoch_z_suffix_is_utc(self):
        self.assertEqual(si._epoch("1970-01-01T00:01:00Z"), 60.0)
        self.assertEqual(si._epoch("1970-01-01T01:00:00+01:00"), 0.0)
        self.assertIsNone(si._epoch(""))


if __name__ == "__main__":
    unittest.main()
