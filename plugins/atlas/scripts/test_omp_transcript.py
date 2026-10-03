"""Behavioral tests for omp_transcript: converter output must drive the REAL
ingest and completion-gate code paths, not just look Claude-shaped.

The fixture under fixtures/omp_session/ is a structure-preserving slice of a real
omp session (entry types, toolCall/toolResult shapes, colony + advisor files)
with every piece of text and every tool argument replaced by synthetic content.
"""

import collections
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS = os.path.join(HERE, "..", "hooks")
sys.path.insert(0, HERE)
sys.path.insert(0, HOOKS)

import atlas_db  # noqa: E402
import omp_transcript  # noqa: E402
import session_ingest  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "omp_session", "omp-fixture-session.jsonl")
CLI = os.path.join(HERE, "omp_transcript.py")
RUNSTATE = os.path.join(HERE, "omp_runstate.py")
GATE = os.path.join(HOOKS, "completion_gate.py")


def _write_jsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write((r if isinstance(r, str) else json.dumps(r)) + "\n")


def _iso(dt):
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _records(path):
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def _tool_uses(records):
    for rec in records:
        content = rec["message"]["content"]
        for b in content if isinstance(content, list) else []:
            if b.get("type") == "tool_use":
                yield rec, b


class _TmpCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.db = os.path.join(self.tmp, "atlas.db")
        self._old_db = os.environ.get("ATLAS_DB")
        os.environ["ATLAS_DB"] = self.db
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        if self._old_db is None:
            os.environ.pop("ATLAS_DB", None)
        else:
            os.environ["ATLAS_DB"] = self._old_db

    def convert(self, session_file, out=None, session_id=None):
        out = out or os.path.join(self.tmp, "out", "t.jsonl")
        argv = [sys.executable, CLI, "convert", "--session-file", session_file, "--out", out]
        if session_id:
            argv += ["--session-id", session_id]
        proc = subprocess.run(argv, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
        self.assertEqual(len(lines), 1, "contract: exactly one JSON line on stdout")
        return out, json.loads(lines[0])


class RealFixtureIngestTest(_TmpCase):
    """(a) converter output on a real-shaped omp session ingests with Claude semantics."""

    def test_ingest_yields_claude_tool_names_paths_and_sidechain(self):
        out, res = self.convert(FIXTURE)
        self.assertTrue(res["ok"], res)
        sub_dir = os.path.join(os.path.dirname(out), "subagents")
        self.assertTrue(os.path.isdir(sub_dir))

        main_stats = session_ingest.ingest_transcript(out)
        sub_stats = [
            session_ingest.ingest_transcript(os.path.join(sub_dir, f))
            for f in sorted(os.listdir(sub_dir))
        ]
        self.assertEqual(main_stats["skipped"], 0)
        self.assertTrue(all(s["skipped"] == 0 for s in sub_stats))

        conn = atlas_db.connect()
        names = collections.Counter(
            r[0] for r in conn.execute("SELECT tool_name FROM tool_calls WHERE is_sidechain=0")
        )
        # omp names must be gone, Claude names present.
        for omp_name in ("bash", "edit", "todo", "task"):
            self.assertNotIn(omp_name, names)
        for claude_name in ("Bash", "Edit", "TodoWrite", "Task", "Read"):
            self.assertGreater(names[claude_name], 0, (claude_name, dict(names)))

        # Edit rows carry file_path (recovered from the omp hashline header),
        # and it survives summarize_input's 500-char cap.
        paths = {
            json.loads(s).get("file_path")
            for (s,) in conn.execute("SELECT input_summary FROM tool_calls WHERE tool_name='Edit'")
        }
        self.assertEqual(paths, {"src/calc.py", "docs/CHANGELOG.md"})

        # Sub-agent + advisor files are sidechains under the lead's session id.
        side = conn.execute(
            "SELECT COUNT(*), COUNT(DISTINCT session_id) FROM tool_calls WHERE is_sidechain=1"
        ).fetchone()
        self.assertGreater(side[0], 0)
        self.assertEqual(side[1], 1)
        msg_sidechain = conn.execute("SELECT SUM(is_sidechain) FROM messages").fetchone()[0]
        self.assertGreater(msg_sidechain, 0)

        # The MCP-over-write device call became a real mcp tool row.
        mcp = conn.execute("SELECT target FROM tool_calls WHERE kind='mcp'").fetchall()
        self.assertEqual(mcp, [("claude_mem.mcp_search_search",)])

        # A repeat ingest of the same bytes adds nothing (ids are stable + unique).
        before = conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0]
        session_ingest.ingest_transcript(out)
        after = conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0]
        self.assertEqual(before, after)
        conn.close()

    def test_tool_use_ids_unique_across_lead_and_sub_files(self):
        out, _ = self.convert(FIXTURE)
        ids = [b["id"] for _, b in _tool_uses(_records(out))]
        sub_dir = os.path.join(os.path.dirname(out), "subagents")
        for f in os.listdir(sub_dir):
            ids += [b["id"] for _, b in _tool_uses(_records(os.path.join(sub_dir, f)))]
        self.assertEqual(len(ids), len(set(ids)))

    def test_sidechain_files_use_lead_session_id_and_subagents_path(self):
        out, res = self.convert(FIXTURE)
        sub_dir = os.path.join(os.path.dirname(out), "subagents")
        files = sorted(os.listdir(sub_dir))
        self.assertIn("agent-advisor.jsonl", files)  # __advisor -> advisor
        self.assertIn("/subagents/", os.path.join(sub_dir, files[0]).replace("\\", "/"))
        for f in files:
            recs = _records(os.path.join(sub_dir, f))
            self.assertTrue(all(r["isSidechain"] is True for r in recs))
            self.assertTrue(all(r["sessionId"] == res["session_id"] for r in recs))
        self.assertTrue(all(r["isSidechain"] is False for r in _records(out)))


class ConversionShapeTest(_TmpCase):
    def _lead(self, entries, name="lead.jsonl"):
        path = os.path.join(self.tmp, "src", name)
        _write_jsonl(path, entries)
        return path

    @staticmethod
    def _msg(eid, parent, ts, role, content, **extra):
        m = {"role": role, "content": content, "timestamp": 1790899732674}
        m.update(extra)
        return {"type": "message", "id": eid, "parentId": parent, "timestamp": ts, "message": m}

    def test_usage_keys_and_parent_uuid_and_first_line_session_id(self):
        t0 = "2026-10-02T00:00:00.000Z"
        path = self._lead([
            {"type": "session", "id": "sess-1", "timestamp": t0, "cwd": "/work/proj"},
            self._msg("u1", None, t0, "user", [{"type": "text", "text": "hello there"}], attribution="user"),
            self._msg("a1", "u1", t0, "assistant", [{"type": "text", "text": "hi"}],
                      model="m-1", usage={"input": 4, "output": 5, "cacheRead": 6, "cacheWrite": 7}),
        ])
        out, res = self.convert(path)
        recs = _records(out)
        self.assertEqual(res["session_id"], "sess-1")
        self.assertEqual(recs[0]["sessionId"], "sess-1")
        usage = recs[1]["message"]["usage"]
        self.assertEqual(
            usage,
            {"input_tokens": 4, "output_tokens": 5,
             "cache_read_input_tokens": 6, "cache_creation_input_tokens": 7},
        )
        self.assertEqual(recs[1]["parentUuid"], recs[0]["uuid"])
        self.assertNotEqual(recs[0]["uuid"], recs[1]["uuid"])
        # ingest maps the converted usage into the messages row
        session_ingest.ingest_transcript(out)
        row = atlas_db.connect().execute(
            "SELECT input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens "
            "FROM messages WHERE role='assistant'"
        ).fetchone()
        self.assertEqual(row, (4, 5, 6, 7))

    def test_long_edit_patch_still_exposes_file_path_through_ingest_and_run_paths(self):
        """Real omp edits carry multi-KB hashline bodies and no `path` argument:
        the target only exists in the `[path#TAG]` header. The gate's
        run_changed_paths reads `file_path` back out of the ingested summary, so
        this proves the header-derived path survives conversion, ingest's
        per-value cap, and the run-scoped read."""
        t0 = "2026-10-02T00:00:00.000Z"
        body = "PUT 1.=1:\n" + "+" + ("x" * 3000) + "\n"
        call = {"type": "toolCall", "id": "tc-big", "name": "edit",
                "arguments": {"i": "big", "input": f"[src/deep/module.py#BEEF]\n{body}"}}
        path = self._lead([self._msg("a1", None, t0, "assistant", [call])])
        out, _ = self.convert(path)
        session_ingest.ingest_transcript(out)
        conn = atlas_db.connect()
        summary = conn.execute("SELECT input_summary FROM tool_calls WHERE tool_name='Edit'").fetchone()[0]
        self.assertEqual(json.loads(summary).get("file_path"), "src/deep/module.py")
        sid = conn.execute("SELECT session_id FROM tool_calls").fetchone()[0]
        pid = atlas_db.register_project(conn, self.tmp)
        rid = atlas_db.start_run(conn, pid, sid)
        conn.execute("UPDATE runs SET started_at=0 WHERE id=?", (rid,))
        conn.commit()
        self.assertEqual(atlas_db.run_changed_paths(conn, rid), ["src/deep/module.py"])
        conn.close()

    def test_same_omp_call_id_in_lead_and_subagent_yields_distinct_rows(self):
        """omp tool call ids are only unique within one file. tool_calls is keyed
        on tool_use_id with INSERT OR IGNORE, so an un-namespaced collision would
        silently drop the sub-agent's call (and its sidechain flag)."""
        t0 = "2026-10-02T00:00:00.000Z"
        call = {"type": "toolCall", "id": "toolu_SAME", "name": "bash", "arguments": {"command": "echo hi"}}
        lead = self._lead([
            {"type": "session", "id": "sess-collide", "timestamp": t0, "cwd": "/work/proj"},
            self._msg("a1", None, t0, "assistant", [call]),
        ], name="collide.jsonl")
        _write_jsonl(os.path.join(self.tmp, "src", "collide", "Worker.jsonl"), [
            self._msg("w1", None, t0, "assistant", [dict(call)]),
        ])
        out, _ = self.convert(lead)
        sub_dir = os.path.join(os.path.dirname(out), "subagents")
        session_ingest.ingest_transcript(out)
        for f in os.listdir(sub_dir):
            session_ingest.ingest_transcript(os.path.join(sub_dir, f))
        rows = atlas_db.connect().execute(
            "SELECT is_sidechain FROM tool_calls WHERE tool_name='Bash' ORDER BY is_sidechain"
        ).fetchall()
        self.assertEqual(rows, [(0,), (1,)])

    def test_non_user_attribution_and_developer_role_are_not_prompts(self):
        t0 = "2026-10-02T00:00:00.000Z"
        path = self._lead([
            self._msg("u1", None, t0, "user", [{"type": "text", "text": "real human prompt"}], attribution="user"),
            self._msg("u2", "u1", t0, "user", [{"type": "text", "text": "parent agent assignment text"}], attribution="agent"),
            self._msg("d1", "u2", t0, "developer", [{"type": "text", "text": "harness note"}], attribution="agent"),
            {"type": "custom_message", "id": "c1", "parentId": "d1", "timestamp": t0, "content": "x", "attribution": "agent"},
            {"type": "title", "title": "t"},
            {"type": "credential_pin", "id": "p1", "parentId": "c1", "timestamp": t0},
        ])
        out, _ = self.convert(path)
        recs = _records(out)
        self.assertEqual(len(recs), 2)  # developer + custom/title/pin skipped
        session_ingest.ingest_transcript(out)
        prompts = [r[0] for r in atlas_db.connect().execute("SELECT text FROM user_prompts")]
        self.assertEqual(prompts, ["real human prompt"])

    def test_tool_result_pairing_orphans_and_error_flag(self):
        t0 = "2026-10-02T00:00:00.000Z"
        call = {"type": "toolCall", "id": "tc-1", "name": "bash", "arguments": {"command": "false"}}
        path = self._lead([
            self._msg("a1", None, t0, "assistant", [call]),
            self._msg("r1", "a1", t0, "toolResult", [{"type": "text", "text": "boom"}],
                      toolCallId="tc-1", toolName="bash", isError=True),
            self._msg("r2", "r1", t0, "toolResult", [{"type": "text", "text": "late"}],
                      toolCallId="tc-never-called", toolName="bash", isError=False),
        ])
        out, _ = self.convert(path)
        recs = _records(out)
        use_id = next(b["id"] for _, b in _tool_uses(recs))
        results = [b for r in recs for b in r["message"]["content"] if b.get("type") == "tool_result"]
        self.assertEqual(results[0]["tool_use_id"], use_id)
        self.assertTrue(results[0]["is_error"])
        self.assertNotEqual(results[1]["tool_use_id"], use_id)  # orphan kept, can't clobber
        session_ingest.ingest_transcript(out)
        row = atlas_db.connect().execute(
            "SELECT is_error FROM tool_calls WHERE tool_name='Bash'"
        ).fetchone()
        self.assertEqual(row[0], 1)

    def test_batched_task_fans_out_one_tool_use_per_item(self):
        t0 = "2026-10-02T00:00:00.000Z"
        call = {"type": "toolCall", "id": "tc-t", "name": "task", "arguments": {
            "i": "fan out",
            "tasks": [{"name": "A", "agent": "verifier", "task": "check it"},
                      {"name": "B", "task": "build it"}]}}
        path = self._lead([self._msg("a1", None, t0, "assistant", [call])])
        out, _ = self.convert(path)
        tasks = [b for _, b in _tool_uses(_records(out))]
        self.assertEqual([t["name"] for t in tasks], ["Task", "Task"])
        self.assertEqual([t["input"]["subagent_type"] for t in tasks], ["verifier", "task"])
        self.assertEqual([t["input"]["description"] for t in tasks], ["A", "B"])
        self.assertEqual(tasks[0]["input"]["prompt"], "check it")
        self.assertEqual(len({t["id"] for t in tasks}), 2)

    def test_unmapped_omp_tools_keep_their_names_and_web_search_maps(self):
        t0 = "2026-10-02T00:00:00.000Z"
        calls = [{"type": "toolCall", "id": f"tc-{n}", "name": n, "arguments": {"i": "x"}}
                 for n in ("web_search", "advise", "context_notes", "hub")]
        path = self._lead([self._msg("a1", None, t0, "assistant", calls)])
        out, _ = self.convert(path)
        names = [b["name"] for _, b in _tool_uses(_records(out))]
        self.assertEqual(names, ["WebSearch", "advise", "context_notes", "hub"])

    def test_mcp_shell_device_write_earns_gate_test_credit(self):
        """A pytest run made through the lean-ctx shell MCP (omp reaches it via
        `write xd://mcp__lean_ctx_ctx_shell`) must count as an executed test for
        completion-gate (g), which matches the tool by the part after the last `__`."""
        import completion_gate

        t0 = "2026-10-02T00:00:00.000Z"
        call = {"type": "toolCall", "id": "tc-sh", "name": "write", "arguments": {
            "path": "xd://mcp__lean_ctx_ctx_shell", "content": json.dumps({"command": "python3 -m pytest -q"})}}
        path = self._lead([self._msg("a1", None, t0, "assistant", [call])])
        out, _ = self.convert(path)
        self.assertTrue(completion_gate._transcript_test_commands(out, None))

    def test_mcp_xd_write_name_boundary_matches_gate_and_classify(self):
        cases = {
            "xd://mcp__lean_ctx_ctx_shell": "mcp__lean_ctx__ctx_shell",
            "xd://mcp__atlas_falcon_falcon_status": "mcp__atlas_falcon__status",
            "xd://mcp__azure_azure_keyvault": "mcp__azure__azure_keyvault",
        }
        for xd, want in cases.items():
            self.assertEqual(omp_transcript._split_mcp_xd(xd), want, xd)
        self.assertIsNone(omp_transcript._split_mcp_xd("xd://retain"))
        self.assertIsNone(omp_transcript._split_mcp_xd("src/file.py"))
        # the gate keys shell MCP tools off the part after the last "__"
        shell_tool = omp_transcript._split_mcp_xd("xd://mcp__lean_ctx_ctx_shell")
        self.assertIsNotNone(shell_tool)
        self.assertEqual((shell_tool or "").rsplit("__", 1)[-1], "ctx_shell")

    def test_epoch_ms_only_timestamp_is_converted_to_iso(self):
        entry = {"type": "message", "id": "a1", "parentId": None,
                 "message": {"role": "assistant", "content": [{"type": "text", "text": "x"}],
                             "timestamp": 1790899732674}}
        path = self._lead([entry])
        out, _ = self.convert(path)
        stamp = _records(out)[0]["timestamp"]
        self.assertIsInstance(stamp, str)
        self.assertEqual(datetime.fromisoformat(stamp.replace("Z", "+00:00")).year, 2026)

    def test_truncated_final_line_unknown_types_and_junk_do_not_crash(self):
        t0 = "2026-10-02T00:00:00.000Z"
        good = json.dumps(self._msg("u1", None, t0, "user", [{"type": "text", "text": "ok prompt"}], attribution="user"))
        path = self._lead([
            good,
            "not json at all",
            "[1, 2, 3]",
            json.dumps({"type": "brand_new_type", "id": "z", "weird": {"nested": [1]}}),
            json.dumps({"type": "message", "id": "m-null", "message": None}),
            json.dumps({"type": "message", "id": "m-bad", "message": {"role": "assistant", "content": 7}}),
            json.dumps(self._msg("a1", "u1", t0, "assistant", [{"type": "toolCall", "id": None, "name": None, "arguments": "oops"}])),
            '{"type": "message", "id": "cut", "message": {"role": "assi',  # truncated mid-write
        ])
        out, res = self.convert(path)
        self.assertTrue(res["ok"], res)
        recs = _records(out)
        self.assertEqual(recs[0]["message"]["content"][0]["text"], "ok prompt")
        # Exactly the good prompt and the degenerate-but-valid assistant turn
        # survive; the truncated tail and every junk line are dropped silently.
        self.assertEqual([r["type"] for r in recs], ["user", "assistant"])
        degenerate = recs[1]["message"]["content"]
        self.assertEqual(len(degenerate), 1)
        self.assertEqual(degenerate[0]["type"], "tool_use")
        self.assertEqual(degenerate[0]["input"], {})

    def test_non_finite_and_bool_usage_does_not_drop_the_assistant_record(self):
        t0 = "2026-10-02T00:00:00.000Z"
        call = {"type": "toolCall", "id": "tc-1", "name": "bash", "arguments": {"command": "ls"}}
        entry = self._msg("a1", None, t0, "assistant", [call],
                          usage={"input": float("nan"), "output": float("inf"), "cacheRead": True, "cacheWrite": 3})
        path = self._lead([json.dumps(entry)])  # json.dumps emits NaN/Infinity literals
        out, _ = self.convert(path)
        recs = _records(out)
        self.assertEqual(len(recs), 1)  # the tool_use is not lost to a bad usage number
        self.assertEqual(recs[0]["message"]["usage"],
                         {"input_tokens": 0, "output_tokens": 0,
                          "cache_read_input_tokens": 0, "cache_creation_input_tokens": 3})

    def test_rerun_prunes_stale_subagent_files(self):
        out, _ = self.convert(FIXTURE)
        sub_dir = os.path.join(os.path.dirname(out), "subagents")
        stale = os.path.join(sub_dir, "agent-Gone.jsonl")
        _write_jsonl(stale, [{"type": "user", "uuid": "x", "sessionId": "s", "isSidechain": True,
                              "message": {"role": "user", "content": []}}])
        self.convert(FIXTURE, out=out)
        self.assertFalse(os.path.exists(stale))
        self.assertIn("agent-advisor.jsonl", os.listdir(sub_dir))

    def test_cli_failure_is_fail_open(self):
        proc = subprocess.run(
            [sys.executable, CLI, "convert", "--session-file", os.path.join(self.tmp, "missing.jsonl"),
             "--out", os.path.join(self.tmp, "o.jsonl")],
            capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0)
        out = json.loads(proc.stdout)
        self.assertFalse(out["ok"])
        self.assertIn("error", out)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "o.jsonl")))

    def test_rerun_is_idempotent_and_atomic(self):
        out, first = self.convert(FIXTURE)
        with open(out, "rb") as fh:
            before = fh.read()
        _, second = self.convert(FIXTURE, out=out)
        with open(out, "rb") as fh:
            self.assertEqual(before, fh.read())
        self.assertEqual(first["lines"], second["lines"])
        self.assertEqual([f for f in os.listdir(os.path.dirname(out)) if f.endswith(".tmp")], [])


class TodoAndLedgerTest(_TmpCase):
    def _todo_session(self, statuses, ledger=None):
        t0 = "2026-10-02T00:00:00.000Z"
        phases = [{"name": "p", "tasks": [{"content": f"item {i}", "status": s} for i, s in enumerate(statuses)]}]
        entries = [
            {"type": "message", "id": "a1", "parentId": None, "timestamp": t0, "message": {
                "role": "assistant", "content": [
                    {"type": "toolCall", "id": "tc-todo", "name": "todo", "arguments": {"op": "init"}}]}},
            {"type": "message", "id": "r1", "parentId": "a1", "timestamp": t0, "message": {
                "role": "toolResult", "toolCallId": "tc-todo", "toolName": "todo",
                "content": [{"type": "text", "text": "ok"}], "details": {"phases": phases}, "isError": False}},
        ]
        if ledger:
            entries.append({"type": "message", "id": "a2", "parentId": "r1", "timestamp": t0, "message": {
                "role": "assistant", "content": [{"type": "text", "text": ledger}]}})
        path = os.path.join(self.tmp, "src", "todo.jsonl")
        _write_jsonl(path, entries)
        return path

    def test_todowrite_reconstructed_from_result_phases_with_status_mapping(self):
        path = self._todo_session(["completed", "in_progress", "pending", "abandoned"])
        out, _ = self.convert(path)
        todos = next(b["input"]["todos"] for _, b in _tool_uses(_records(out)) if b["name"] == "TodoWrite")
        self.assertEqual([t["status"] for t in todos], ["completed", "in_progress", "pending", "completed"])
        self.assertEqual([t["content"] for t in todos][:2], ["item 0", "item 1"])
        self.assertTrue(all(t["activeForm"] for t in todos))

    def test_unpaired_todo_call_yields_empty_list_not_crash(self):
        t0 = "2026-10-02T00:00:00.000Z"
        path = os.path.join(self.tmp, "src", "u.jsonl")
        _write_jsonl(path, [{"type": "message", "id": "a1", "parentId": None, "timestamp": t0, "message": {
            "role": "assistant", "content": [{"type": "toolCall", "id": "x", "name": "todo", "arguments": {}}]}}])
        out, _ = self.convert(path)
        todos = next(b["input"]["todos"] for _, b in _tool_uses(_records(out)))
        self.assertEqual(todos, [])

    def test_open_todo_is_seen_by_gate_helper_and_drained_list_is_not(self):
        import completion_gate

        open_out, _ = self.convert(self._todo_session(["completed", "pending"]), out=os.path.join(self.tmp, "o1", "t.jsonl"))
        done_out, _ = self.convert(self._todo_session(["completed", "completed"]), out=os.path.join(self.tmp, "o2", "t.jsonl"))
        self.assertEqual(completion_gate._open_todos(open_out), 1)
        self.assertEqual(completion_gate._open_todos(done_out), 0)
        self.assertTrue(completion_gate._has_todo_plan(done_out, completion_gate.Path(self.tmp), "s"))

    def test_ledger_line_survives_conversion_for_gate(self):
        import completion_gate

        path = self._todo_session(["completed"], ledger="status\nLEDGER | 3/7 | wave 2 | next: verify")
        out, _ = self.convert(path)
        self.assertTrue(completion_gate._has_ledger_line(out))
        self.assertEqual(completion_gate._ledger_open_todos(out), 4)


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


class GateEndToEndTest(_TmpCase):
    """(b)/(e) the REAL completion_gate on an omp-converted transcript, with run
    state armed through the omp_runstate CLI exactly as the bridge will."""

    SID = "omp-gate-sess"

    def setUp(self):
        super().setUp()
        self.proj = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.proj, "docs"))
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(self.proj, "docs", name), "w") as fh:
                fh.write("# x\n")
        with open(os.path.join(self.proj, "README.md"), "w") as fh:
            fh.write("# readme\n")
        _git(self.proj, "init", "-q")
        self.env = dict(os.environ, ATLAS_DB=self.db, ATLAS_HOOKSTATE_DIR=os.path.join(self.tmp, "hs"))
        self.env.pop("ATLAS_GATE", None)

    def runstate(self, *argv):
        proc = subprocess.run([sys.executable, RUNSTATE, *argv, "--session-id", self.SID, "--cwd", self.proj],
                              capture_output=True, text=True, env=self.env)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def omp_session(self, content_blocks, ts):
        """One assistant turn built from omp-shaped toolCall blocks at `ts`."""
        entries = [{"type": "session", "id": self.SID, "timestamp": _iso(ts), "cwd": self.proj}]
        parent = None
        for i, blk in enumerate(content_blocks):
            eid = f"a{i}"
            entries.append({"type": "message", "id": eid, "parentId": parent, "timestamp": _iso(ts),
                            "message": {"role": "assistant", "content": [blk]}})
            parent = eid
        path = os.path.join(self.tmp, "src", "gate.jsonl")
        _write_jsonl(path, entries)
        return path

    def gate(self, transcript):
        payload = {"session_id": self.SID, "cwd": self.proj, "transcript_path": transcript,
                   "stop_hook_active": False, "hook_event_name": "Stop"}
        proc = subprocess.run([sys.executable, GATE], input=json.dumps(payload),
                              capture_output=True, text=True, env=self.env)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout) if proc.stdout.strip() else None

    @staticmethod
    def _edit_call(cid, path):
        return {"type": "toolCall", "id": cid, "name": "edit",
                "arguments": {"i": "edit", "input": f"[{path}#AAAA]\nPUT 1.=1:\n+x\n"}}

    @staticmethod
    def _task_call(cid):
        return {"type": "toolCall", "id": cid, "name": "task",
                "arguments": {"i": "delegate", "tasks": [{"name": "W", "agent": "implementer", "task": "do it"}]}}

    def _begin_and_edit(self):
        self.runstate("begin")
        self.runstate("arm")
        self.runstate("event", "--tool", "Edit", "--path", "src/app.py")

    def test_edit_without_task_blocks_on_delegation_condition(self):
        self._begin_and_edit()
        ts = datetime.now(timezone.utc) + timedelta(seconds=5)
        out, _ = self.convert(self.omp_session([self._edit_call("tc-e", "src/app.py")], ts))
        verdict = self.gate(out)
        verdict = verdict or {}
        self.assertEqual(verdict.get("decision"), "block", "armed run + code edit + no dispatch must block")
        self.assertIn("(m)", verdict.get("reason", ""))

    def test_task_dispatch_in_converted_transcript_clears_delegation(self):
        self._begin_and_edit()
        ts = datetime.now(timezone.utc) + timedelta(seconds=5)
        out, _ = self.convert(self.omp_session(
            [self._edit_call("tc-e", "src/app.py"), self._task_call("tc-t")], ts))
        verdict = self.gate(out)
        reason = (verdict or {}).get("reason", "")
        self.assertNotIn("(m)", reason)

    def test_open_todo_makes_gate_report_open_items_condition(self):
        self._begin_and_edit()
        ts = datetime.now(timezone.utc) + timedelta(seconds=5)
        t = _iso(ts)
        entries = [
            {"type": "session", "id": self.SID, "timestamp": t, "cwd": self.proj},
            {"type": "message", "id": "a0", "parentId": None, "timestamp": t, "message": {
                "role": "assistant", "content": [self._edit_call("tc-e", "src/app.py"), self._task_call("tc-t"),
                                                 {"type": "toolCall", "id": "tc-todo", "name": "todo", "arguments": {"op": "init"}}]}},
            {"type": "message", "id": "r0", "parentId": "a0", "timestamp": t, "message": {
                "role": "toolResult", "toolCallId": "tc-todo", "toolName": "todo", "content": [{"type": "text", "text": "ok"}],
                "details": {"phases": [{"name": "p", "tasks": [{"content": "unfinished work", "status": "in_progress"}]}]},
                "isError": False}},
        ]
        path = os.path.join(self.tmp, "src", "todo_gate.jsonl")
        _write_jsonl(path, entries)
        out, _ = self.convert(path)
        verdict = self.gate(out)
        self.assertIsNotNone(verdict)
        self.assertIn("(i)", (verdict or {}).get("reason", ""))

    def test_tool_use_before_run_start_earns_no_test_credit(self):
        """(e) a pytest run stamped BEFORE the run began must not satisfy (g).
        ISO conversion is what makes the window comparison meaningful: had the
        epoch-ms message.timestamp leaked through, the record would be undated
        and dropped; had a stale ISO been kept, it would wrongly count."""
        import completion_gate

        self.runstate("begin")
        conn = atlas_db.connect()
        started = atlas_db.run_started_at(conn, atlas_db.current_run_id(conn, self.SID))
        conn.close()
        self.assertIsNotNone(started)
        started_dt = datetime.fromtimestamp(float(started or 0), tz=timezone.utc)
        bash = {"type": "toolCall", "id": "tc-b", "name": "bash", "arguments": {"command": "python3 -m pytest -q"}}

        before, _ = self.convert(self.omp_session([bash], started_dt - timedelta(minutes=10)),
                                 out=os.path.join(self.tmp, "before", "t.jsonl"))
        after, _ = self.convert(self.omp_session([bash], started_dt + timedelta(minutes=10)),
                                out=os.path.join(self.tmp, "after", "t.jsonl"))
        self.assertFalse(completion_gate._transcript_test_commands(before, started))
        self.assertTrue(completion_gate._transcript_test_commands(after, started))


if __name__ == "__main__":
    unittest.main()


class GateConditionMatrixTest(GateEndToEndTest):
    """Each Definition-of-done condition individually, on omp-derived state.

    A fully satisfied baseline must PASS; then exactly one precondition is removed
    and the gate must block on exactly that condition letter. This is the proof
    that the omp path reaches every condition, not only that the gate runs."""

    def _evidence_and_verified_finding(self):
        os.makedirs(os.path.join(self.proj, ".atlas", "evidence"), exist_ok=True)
        os.makedirs(os.path.join(self.proj, ".atlas", ".run"), exist_ok=True)
        with open(os.path.join(self.proj, ".atlas", "evidence", "proof.txt"), "w") as fh:
            fh.write("pytest: 3 passed\n")
        with open(os.path.join(self.proj, ".atlas", ".run", "findings.json"), "w") as fh:
            json.dump([{"id": "x", "status": "verified",
                        "verified_at": datetime.now(timezone.utc).isoformat()}], fh)

    def _commit_base(self):
        """Commit the tree as the base the run's own changes are measured against. Without a base commit git
        reports nothing as moved, so the gate's (f) git cross-check cannot see the CHANGELOG entry."""
        os.makedirs(os.path.join(self.proj, "src"), exist_ok=True)
        if not os.path.exists(os.path.join(self.proj, "src", "app.py")):
            self._write("src/app.py", "print(0)\n")
        _git(self.proj, "add", "-A")
        subprocess.run(["git", "-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "base"],
                       cwd=self.proj, capture_output=True, check=True)

    def _satisfied(self, worktree=False):
        """Armed run: code edit, an implementer AND a verifier dispatch, a completed plan,
        evidence + verified finding newer than the run start, CHANGELOG written, docs non-empty."""
        self._commit_base()
        self.runstate("begin")
        arm = ["arm", "--agent-type", "atlas:implementer"] + (["--worktree"] if worktree else [])
        self.runstate(*arm)
        self.runstate("event", "--tool", "Edit", "--path", "src/app.py")
        self.runstate("event", "--tool", "Task", "--dispatch", "atlas:verifier")
        time.sleep(1.1)  # evidence/findings must be NEWER than the run start
        self._evidence_and_verified_finding()
        with open(os.path.join(self.proj, "docs", "CHANGELOG.md"), "a") as fh:
            fh.write(f"entry {time.time()}\n")
        os.makedirs(os.path.join(self.proj, "src"), exist_ok=True)
        with open(os.path.join(self.proj, "src", "app.py"), "w") as fh:
            fh.write("print(1)\n")
        t = _iso(datetime.now(timezone.utc) + timedelta(seconds=5))
        entries = [
            {"type": "session", "id": self.SID, "timestamp": t, "cwd": self.proj},
            {"type": "message", "id": "a0", "parentId": None, "timestamp": t, "message": {
                "role": "assistant", "content": [{"type": "toolCall", "id": "tc-todo", "name": "todo", "arguments": {"op": "init"}}]}},
            {"type": "message", "id": "r0", "parentId": "a0", "timestamp": t, "message": {
                "role": "toolResult", "toolCallId": "tc-todo", "toolName": "todo", "isError": False,
                "content": [{"type": "text", "text": "ok"}],
                "details": {"phases": [{"name": "P", "tasks": [{"content": "do it", "status": "completed"}]}]}}},
        ]
        path = os.path.join(self.tmp, "src", "matrix.jsonl")
        _write_jsonl(path, entries)
        out, _ = self.convert(path)
        return out

    @staticmethod
    def _letters(verdict):
        import re
        return sorted(set(re.findall(r"^\s{2}\(([a-z])\)", (verdict or {}).get("reason", ""), re.M)))

    def _write(self, rel, text):
        p = os.path.join(self.proj, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as fh:
            fh.write(text)

    def test_baseline_with_every_condition_satisfied_passes(self):
        self.assertIsNone(self.gate(self._satisfied()))

    def test_each_condition_blocks_on_exactly_its_own_letter(self):
        cases = {
            "a": lambda: shutil.rmtree(os.path.join(self.proj, ".atlas", "evidence")),
            "b": lambda: self._write(".atlas/.run/findings.json", "[]"),
            "c": lambda: self._write("docs/CHANGELOG.md", ""),
            "d": lambda: self._write("docs/ROADMAP.md", ""),
            "e": lambda: self._write("README.md", ""),
            "h": lambda: self._write("docs/ROADMAP.md", "- [x] done item\n- status: done\n"),
            "l": lambda: self._write("docs/plans/plan-2026-10-02.md", "p\n"),
        }
        for letter, mutate in cases.items():
            with self.subTest(condition=letter):
                self.tearDown()
                self.setUp()
                out = self._satisfied()
                mutate()
                self.assertEqual(self._letters(self.gate(out)), [letter])

    def test_condition_f_blocks_when_code_shipped_and_changelog_untouched_in_git(self):
        out = self._satisfied()
        # revert the CHANGELOG to its committed (empty-diff) content: code changed, CHANGELOG did not
        with open(os.path.join(self.proj, "docs", "CHANGELOG.md"), "w") as fh:
            fh.write("# x\n")
        _git(self.proj, "add", "-A")
        subprocess.run(["git", "-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "base"],
                       cwd=self.proj, capture_output=True)
        self._write("src/app.py", "print(2)\n")
        self._evidence_and_verified_finding()
        self.assertEqual(self._letters(self.gate(out)), ["f"])

    def test_condition_g_blocks_an_implementer_with_no_independent_verifier(self):
        self._commit_base()
        self.runstate("begin")
        self.runstate("arm", "--agent-type", "atlas:implementer")
        self.runstate("event", "--tool", "Edit", "--path", "src/app.py")
        time.sleep(1.1)
        self._evidence_and_verified_finding()
        with open(os.path.join(self.proj, "docs", "CHANGELOG.md"), "a") as fh:
            fh.write("entry\n")
        t = _iso(datetime.now(timezone.utc) + timedelta(seconds=5))
        entries = [{"type": "session", "id": self.SID, "timestamp": t, "cwd": self.proj},
                   {"type": "message", "id": "a0", "parentId": None, "timestamp": t, "message": {
                       "role": "assistant", "content": [{"type": "toolCall", "id": "tc-todo", "name": "todo", "arguments": {"op": "init"}}]}},
                   {"type": "message", "id": "r0", "parentId": "a0", "timestamp": t, "message": {
                       "role": "toolResult", "toolCallId": "tc-todo", "toolName": "todo", "isError": False,
                       "content": [{"type": "text", "text": "ok"}],
                       "details": {"phases": [{"name": "P", "tasks": [{"content": "x", "status": "completed"}]}]}}}]
        path = os.path.join(self.tmp, "src", "g.jsonl")
        _write_jsonl(path, entries)
        out, _ = self.convert(path)
        self.assertEqual(self._letters(self.gate(out)), ["g"])

    def test_condition_j_blocks_only_when_a_worktree_dispatch_left_a_worktree_behind(self):
        out = self._satisfied(worktree=True)
        _git(self.proj, "add", "-A")
        subprocess.run(["git", "-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "base"],
                       cwd=self.proj, capture_output=True)
        self._evidence_and_verified_finding()
        with open(os.path.join(self.proj, "docs", "CHANGELOG.md"), "a") as fh:
            fh.write("again\n")
        self.assertIsNone(self.gate(out), "worktree dispatch with no leftover worktree must pass")
        wt = os.path.join(self.tmp, "leftover-wt")
        subprocess.run(["git", "worktree", "add", "-q", wt, "-b", "leftover"], cwd=self.proj, check=True, capture_output=True)
        self.assertEqual(self._letters(self.gate(out)), ["j"])

    def test_conditions_i_and_k_open_todo_and_missing_plan(self):
        self._commit_base()
        self.runstate("begin")
        self.runstate("arm", "--agent-type", "atlas:implementer")
        self.runstate("event", "--tool", "Edit", "--path", "src/app.py")
        self.runstate("event", "--tool", "Task", "--dispatch", "atlas:verifier")
        time.sleep(1.1)
        self._evidence_and_verified_finding()
        with open(os.path.join(self.proj, "docs", "CHANGELOG.md"), "a") as fh:
            fh.write("entry\n")

        def session(status):
            t = _iso(datetime.now(timezone.utc) + timedelta(seconds=5))
            rows = [{"type": "session", "id": self.SID, "timestamp": t, "cwd": self.proj}]
            if status:
                rows += [{"type": "message", "id": "a0", "parentId": None, "timestamp": t, "message": {
                             "role": "assistant", "content": [{"type": "toolCall", "id": "tc", "name": "todo", "arguments": {"op": "init"}}]}},
                         {"type": "message", "id": "r0", "parentId": "a0", "timestamp": t, "message": {
                             "role": "toolResult", "toolCallId": "tc", "toolName": "todo", "isError": False,
                             "content": [{"type": "text", "text": "ok"}],
                             "details": {"phases": [{"name": "P", "tasks": [{"content": "x", "status": status}]}]}}}]
            else:
                rows += [{"type": "message", "id": "a0", "parentId": None, "timestamp": t, "message": {
                             "role": "assistant", "content": [{"type": "text", "text": "done"}]}}]
            path = os.path.join(self.tmp, "src", f"s-{status}.jsonl")
            _write_jsonl(path, rows)
            return self.convert(path)[0]

        self.assertEqual(self._letters(self.gate(session(None))), ["k"])
        self.assertEqual(self._letters(self.gate(session("in_progress"))), ["i"])
        self.assertIsNone(self.gate(session("completed")))


_EXPECTED_TOOL_MAP = {
    "bash": "Bash",
    "edit": "Edit",
    "write": "Write",
    "read": "Read",
    "grep": "Grep",
    "glob": "Glob",
    "find": "Glob",
    "task": "Task",
    "todo": "TodoWrite",
    "web_search": "WebSearch",
}


class ToolMapContractTest(unittest.TestCase):
    """TOOL_MAP is derived from contracts/tool-names.json, not hand-copied."""

    def test_derived_map_equals_the_historical_literal(self):
        self.assertEqual(omp_transcript.TOOL_MAP, _EXPECTED_TOOL_MAP)
        self.assertEqual(omp_transcript._load_tool_map(), _EXPECTED_TOOL_MAP)

    def test_derivation_follows_a_modified_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "tool-names.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"claudeToOmp": {
                    "ToolSearch-load": "load",
                    "ToolSearch": "xd:// device catalog",
                    "AskUserQuestion": "an inline user question",
                    "SendMessage": "write agent://<name>",
                    "Alpha": "beta",
                    "Gamma": "beta",
                    "Delta": "epsilon",
                }}, fh)
            derived = omp_transcript._load_tool_map(path)
        # first matching key in file order wins; phrase-valued and dashed keys never leak;
        # omp-only tools with no claudeToOmp entry are still added
        self.assertEqual(derived, {
            "beta": "Alpha",
            "epsilon": "Delta",
            "find": "Glob",
            "web_search": "WebSearch",
        })

    def test_unreadable_contract_falls_back_to_the_same_map(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = os.path.join(tmp, "nope.json")
            garbage = os.path.join(tmp, "garbage.json")
            with open(garbage, "w", encoding="utf-8") as fh:
                fh.write("{not json")
            wrong_shape = os.path.join(tmp, "list.json")
            with open(wrong_shape, "w", encoding="utf-8") as fh:
                fh.write("[]")
            for path in (missing, garbage, wrong_shape):
                self.assertEqual(omp_transcript._load_tool_map(path), _EXPECTED_TOOL_MAP, path)


def _mcp_contract():
    with open(os.path.join(HERE, "..", "contracts", "mcp-servers.json"), encoding="utf-8") as fh:
        return json.load(fh)


def _connector_matcher_servers():
    """Server names in the matcher of the hooks.json hook that runs connector_credential_watch.py."""
    with open(os.path.join(HOOKS, "hooks.json"), encoding="utf-8") as fh:
        events = json.load(fh)["hooks"]
    for groups in events.values():
        for group in groups:
            if any("connector_credential_watch.py" in h.get("command", "") for h in group["hooks"]):
                names = []
                for alt in group["matcher"].split("|"):
                    name = alt.strip().removeprefix("mcp__").removesuffix(".*").rstrip("_")
                    if name:
                        names.append(name)
                return names
    raise AssertionError("no hook runs connector_credential_watch.py")


class McpServersContractTest(unittest.TestCase):
    """contracts/mcp-servers.json: two lists with different purposes, each pinned to its reader."""

    def test_connector_watch_equals_the_hooks_json_connector_matcher(self):
        self.assertEqual(set(_mcp_contract()["connectorWatch"]), set(_connector_matcher_servers()))
        self.assertEqual(len(_mcp_contract()["connectorWatch"]), len(set(_mcp_contract()["connectorWatch"])))

    def test_known_mcp_servers_equal_the_contract_underscored_servers(self):
        self.assertEqual(list(omp_transcript._KNOWN_MCP_SERVERS), _mcp_contract()["underscoredServers"])

    def test_underscored_servers_follow_a_modified_contract_and_fail_open(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = os.path.join(tmp, "mcp-servers.json")
            with open(good, "w", encoding="utf-8") as fh:
                json.dump({"underscoredServers": ["only_one"]}, fh)
            self.assertEqual(omp_transcript._load_mcp_servers(good), ("only_one",))
            bad = os.path.join(tmp, "bad.json")
            with open(bad, "w", encoding="utf-8") as fh:
                fh.write("{not json")
            for path in (bad, os.path.join(tmp, "missing.json")):
                self.assertEqual(omp_transcript._load_mcp_servers(path), omp_transcript._KNOWN_MCP_SERVERS_FALLBACK)
