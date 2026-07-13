import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

import atlas_db
import session_ingest

SID = "test-sess-0001"


def _line(**kw):
    kw.setdefault("sessionId", SID)
    kw.setdefault("cwd", "/repo/demo")
    kw.setdefault("gitBranch", "main")
    return json.dumps(kw)


def _msg(uuid, role, content, **extra):
    m = {"role": role, "content": content}
    m.update(extra)
    return _line(type=role, uuid=uuid, timestamp="2026-06-26T12:00:00Z", message=m)


# A small but representative transcript: a user prompt, an assistant turn that
# admits it never tried something (with token usage), an mcp call + its error
# result, a skill call, an agent dispatch, a Bash call carrying a secret, and a
# user correction.
FIXTURE = [
    _msg(
        "u1", "user", [{"type": "text", "text": "Please wire the callback endpoint."}]
    ),
    _msg(
        "a1",
        "assistant",
        [
            {"type": "thinking", "thinking": "internal reasoning here"},
            {
                "type": "text",
                "text": "Root cause: the callback was never wired; I just assumed it worked.",
            },
            {
                "type": "tool_use",
                "id": "tc_mcp",
                "name": "mcp__plugin_context-mode_context-mode__ctx_execute",
                "input": {"code": "print(1)"},
            },
        ],
        model="claude-opus-4-8",
        usage={
            "input_tokens": 10,
            "output_tokens": 20,
            "cache_read_input_tokens": 500,
            "cache_creation_input_tokens": 5,
        },
    ),
    _msg(
        "r1",
        "user",
        [
            {
                "type": "tool_result",
                "tool_use_id": "tc_mcp",
                "is_error": True,
                "content": "boom: bad creds",
            }
        ],
    ),
    _msg(
        "a2",
        "assistant",
        [
            {
                "type": "tool_use",
                "id": "tc_skill",
                "name": "Skill",
                "input": {"skill": "deep-research"},
            },
            {
                "type": "tool_use",
                "id": "tc_agent",
                "name": "Task",
                "input": {"subagent_type": "atlas:verifier"},
            },
            {
                "type": "tool_use",
                "id": "tc_bash",
                "name": "Bash",
                "input": {
                    "command": "curl -H 'Authorization: Bearer sk-abcdef0123456789abcdef' x",
                    "api_key": "supersecretvalue",
                },
            },
        ],
        usage={"input_tokens": 3, "output_tokens": 4},
    ),
    _msg(
        "r2",
        "user",
        [{"type": "tool_result", "tool_use_id": "tc_skill", "content": "ok"}],
    ),
    _msg(
        "u2",
        "user",
        [{"type": "text", "text": "No, that's wrong, you never actually tested it."}],
    ),
]


class SessionIngestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.tpath = os.path.join(self.tmp, f"{SID}.jsonl")
        self._write(FIXTURE)
        self.conn = atlas_db.connect(self.dbpath)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def _write(self, lines):
        with open(self.tpath, "w") as f:
            f.write("\n".join(lines) + "\n")

    def _ingest(self):
        return session_ingest.ingest_transcript(
            self.tpath, conn=self.conn, session_id=SID
        )

    # --- classification -------------------------------------------------------

    def test_tool_classification(self):
        self._ingest()
        rows = {
            r[0]: (r[1], r[2], r[3])
            for r in self.conn.execute(
                "SELECT tool_use_id, kind, target, server FROM tool_calls"
            )
        }
        self.assertEqual(rows["tc_mcp"][0], "mcp")
        self.assertEqual(rows["tc_mcp"][2], "context-mode")  # product server name
        self.assertEqual(rows["tc_skill"][0], "skill")
        self.assertEqual(rows["tc_skill"][1], "deep-research")
        self.assertEqual(rows["tc_agent"][0], "agent")
        self.assertEqual(rows["tc_agent"][1], "atlas:verifier")
        self.assertEqual(rows["tc_bash"][0], "builtin")
        self.assertEqual(rows["tc_bash"][1], "Bash")

    # --- secret redaction -----------------------------------------------------

    def test_secret_redaction(self):
        self._ingest()
        summary = self.conn.execute(
            "SELECT input_summary FROM tool_calls WHERE tool_use_id='tc_bash'"
        ).fetchone()[0]
        self.assertNotIn("supersecretvalue", summary)  # secret-named key
        self.assertNotIn("sk-abcdef0123456789", summary)  # secret-valued token
        self.assertIn("***", summary)

    # --- result join ----------------------------------------------------------

    def test_result_join_marks_error(self):
        self._ingest()
        err = self.conn.execute(
            "SELECT is_error, result_bytes FROM tool_calls WHERE tool_use_id='tc_mcp'"
        ).fetchone()
        self.assertEqual(err[0], 1)
        self.assertGreater(err[1], 0)
        ok = self.conn.execute(
            "SELECT is_error FROM tool_calls WHERE tool_use_id='tc_skill'"
        ).fetchone()[0]
        self.assertEqual(ok, 0)

    # --- signals --------------------------------------------------------------

    def test_signals_detected(self):
        self._ingest()
        types = {r[0] for r in self.conn.execute("SELECT signal_type FROM signals")}
        self.assertIn("assumption_admission", types)  # "I just assumed"
        self.assertIn("user_correction", types)  # "No, that's wrong"

    # --- prompts + tokens -----------------------------------------------------

    def test_prompts_and_token_aggregates(self):
        self._ingest()
        prompts = [
            r[0] for r in self.conn.execute("SELECT text FROM user_prompts ORDER BY id")
        ]
        # the tool_result-bearing user messages (r1, r2) are NOT prompts
        self.assertEqual(len(prompts), 2)
        self.assertTrue(any("callback endpoint" in p for p in prompts))
        meta = self.conn.execute(
            "SELECT input_tokens, output_tokens, cache_read_tokens, tool_call_count, "
            "error_count FROM session_logs WHERE session_id=?",
            (SID,),
        ).fetchone()
        self.assertEqual(meta[0], 13)  # 10 + 3
        self.assertEqual(meta[1], 24)  # 20 + 4
        self.assertEqual(meta[2], 500)
        self.assertEqual(meta[3], 4)  # tc_mcp, tc_skill, tc_agent, tc_bash
        self.assertEqual(meta[4], 1)  # one errored result

    # --- idempotency + incremental --------------------------------------------

    def test_idempotent_reingest(self):
        s1 = self._ingest()
        s2 = self._ingest()  # cursor at EOF -> nothing new
        self.assertGreater(s1["messages"], 0)
        self.assertEqual(s2["messages"], 0)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0], 4
        )

    def test_incremental_append(self):
        self._ingest()
        before = self.conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        with open(self.tpath, "a") as f:
            f.write(
                _msg("a9", "assistant", [{"type": "text", "text": "follow-up"}]) + "\n"
            )
        s = self._ingest()  # only the appended line is read
        self.assertEqual(s["messages"], 1)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], before + 1
        )

    def test_machine_prompts_are_not_counted(self):
        # claude-mem observer instructions and continuation nudges are not human
        # prompts and must not pollute the repeated-request signal.
        extra = [
            _msg(
                "m1",
                "user",
                [
                    {
                        "type": "text",
                        "text": "You are a Claude-Mem, observe the session.",
                    }
                ],
            ),
            _msg(
                "m2",
                "user",
                [
                    {
                        "type": "text",
                        "text": "[Your previous response had no visible output]",
                    }
                ],
            ),
            _msg(
                "m3",
                "user",
                [
                    {
                        "type": "text",
                        "text": "This session is being continued from a previous conversation.",
                    }
                ],
            ),
        ]
        self._write(FIXTURE + extra)
        self._ingest()
        texts = [r[0] for r in self.conn.execute("SELECT text FROM user_prompts")]
        self.assertFalse(any("Claude-Mem" in t for t in texts))
        self.assertFalse(any("being continued" in t for t in texts))
        self.assertEqual(len(texts), 2)  # only the two real human prompts

    def test_truncation_resets_cleanly(self):
        self._ingest()
        self._write(FIXTURE[:2])  # rewrite shorter -> cursor now past EOF
        self._ingest()
        # rows reflect the rewritten (shorter) transcript, no stale duplicates
        self.assertLessEqual(
            self.conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0], 1
        )

    # --- synthetic-session exclusion -----------------------------------------

    def test_normal_session_creates_one_session_log(self):
        # Control for the exclusion tests: a normal transcript path still lands
        # exactly one session_logs row (existing behavior).
        self._ingest()
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM session_logs").fetchone()[0], 1
        )

    def test_observer_session_path_is_excluded(self):
        # A transcript under .claude-mem/observer-sessions is a synthetic mirror:
        # zero session_logs rows, zero child rows, nothing ingested.
        obs_dir = os.path.join(self.tmp, ".claude-mem", "observer-sessions")
        os.makedirs(obs_dir, exist_ok=True)
        obs_path = os.path.join(obs_dir, "obs-sess.jsonl")
        with open(obs_path, "w") as f:
            f.write("\n".join(FIXTURE) + "\n")
        stats = session_ingest.ingest_transcript(
            obs_path, conn=self.conn, session_id="obs-sess"
        )
        self.assertEqual(stats["messages"], 0)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM session_logs").fetchone()[0], 0
        )
        for tbl in ("messages", "tool_calls", "user_prompts", "signals"):
            self.assertEqual(
                self.conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0], 0
            )

    def test_observer_session_cwd_is_excluded(self):
        # Defensive: even at a normal path, a transcript whose recorded cwd is
        # under observer-sessions is excluded (other synthetic sources).
        obs_cwd = os.path.join(self.tmp, ".claude-mem", "observer-sessions", "proj")
        line = json.dumps(
            {
                "type": "user",
                "uuid": "cwd1",
                "sessionId": "cwd-sess",
                "cwd": obs_cwd,
                "timestamp": "2026-06-26T12:00:00Z",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": "a real prompt here"}],
                },
            }
        )
        tpath = os.path.join(self.tmp, "cwd-sess.jsonl")  # normal path
        with open(tpath, "w") as f:
            f.write(line + "\n")
        stats = session_ingest.ingest_transcript(
            tpath, conn=self.conn, session_id="cwd-sess"
        )
        self.assertEqual(stats["messages"], 0)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM session_logs").fetchone()[0], 0
        )

    def test_backfill_skips_observer_sessions(self):
        # A temp tree with one observer + one normal transcript: only the normal
        # one is ingested.
        tree = tempfile.mkdtemp()
        norm_dir = os.path.join(tree, "projects", "repo-demo")
        os.makedirs(norm_dir)
        with open(os.path.join(norm_dir, "normal.jsonl"), "w") as f:
            f.write("\n".join(FIXTURE) + "\n")
        obs_dir = os.path.join(tree, ".claude-mem", "observer-sessions")
        os.makedirs(obs_dir)
        with open(os.path.join(obs_dir, "observer.jsonl"), "w") as f:
            f.write("\n".join(FIXTURE) + "\n")
        totals = session_ingest.backfill(root=tree, conn=self.conn)
        self.assertEqual(totals["files"], 1)  # observer skipped, only normal walked
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM session_logs").fetchone()[0], 1
        )


# --- codex adapter fixtures ---------------------------------------------------

# Codex rollout JSONL lines are {"timestamp","type","payload"}. These builders
# reproduce the exact payload shapes observed in real
# ~/.codex/sessions/**/rollout-*.jsonl files (session_meta / turn_context /
# event_msg{user_message,token_count} / response_item{message,function_call,
# function_call_output,custom_tool_call,custom_tool_call_output}). All content is
# synthetic - no bytes copied from a real transcript - but structurally faithful.

CX_TS = "2026-04-16T20:45:44.096Z"


def _cx(typ, payload, ts=CX_TS):
    return json.dumps({"timestamp": ts, "type": typ, "payload": payload})


def _codex_session(sid, prompt, reply, tool_kind="function_call"):
    """A minimal but representative single codex session: meta, model context,
    a human prompt, a token_count, an assistant reply, and one tool call with a
    secret-bearing argument plus its output."""
    lines = [
        _cx(
            "session_meta",
            {
                "id": sid,
                "timestamp": CX_TS,
                "cwd": "/repo/codex-demo",
                "originator": "codex-tui",
                "cli_version": "0.121.0",
                "model_provider": "custom",
                "base_instructions": None,
            },
        ),
        _cx("turn_context", {"cwd": "/repo/codex-demo", "model": "gpt-5.4"}),
        _cx("event_msg", {"type": "user_message", "message": prompt}),
        _cx(
            "event_msg",
            {
                "type": "token_count",
                "info": {
                    "last_token_usage": {
                        "input_tokens": 100,
                        "cached_input_tokens": 40,
                        "output_tokens": 25,
                        "reasoning_output_tokens": 5,
                        "total_tokens": 130,
                    }
                },
            },
        ),
        _cx(
            "response_item",
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": reply}],
            },
        ),
    ]
    if tool_kind == "function_call":
        lines += [
            _cx(
                "response_item",
                {
                    "type": "function_call",
                    "name": "exec_command",
                    "call_id": f"{sid}-call1",
                    "arguments": json.dumps(
                        {"cmd": "pytest -q", "api_key": "supersecretvalue"}
                    ),
                },
            ),
            _cx(
                "response_item",
                {
                    "type": "function_call_output",
                    "call_id": f"{sid}-call1",
                    "output": "3 passed",
                },
            ),
        ]
    else:  # custom_tool_call (e.g. an MCP-backed codex tool)
        lines += [
            _cx(
                "response_item",
                {
                    "type": "custom_tool_call",
                    "status": "completed",
                    "call_id": f"{sid}-call1",
                    "name": "apply_patch",
                    "input": json.dumps({"patch": "diff --git a b"}),
                },
            ),
            _cx(
                "response_item",
                {
                    "type": "custom_tool_call_output",
                    "call_id": f"{sid}-call1",
                    "output": "applied",
                },
            ),
        ]
    return lines


class CodexAdapterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.dbpath)
        atlas_db.init(self.conn)
        # a codex-style date tree: root/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
        self.root = os.path.join(self.tmp, "codex", "sessions")
        self.daydir = os.path.join(self.root, "2026", "04", "16")
        os.makedirs(self.daydir)
        self._write(
            "codex-aaaa",
            "Refactor the auth module, please.",
            "I never actually ran the tests.",
        )
        self._write(
            "codex-bbbb",
            "Add pagination to the users endpoint.",
            "Done - applied the patch.",
            tool_kind="custom_tool_call",
        )

    def tearDown(self):
        self.conn.close()

    def _write(self, sid, prompt, reply, tool_kind="function_call"):
        p = os.path.join(self.daydir, f"rollout-2026-04-16T20-45-44-{sid}.jsonl")
        with open(p, "w") as f:
            f.write("\n".join(_codex_session(sid, prompt, reply, tool_kind)) + "\n")
        return p

    def test_backfill_ingests_codex_sessions(self):
        totals = session_ingest.backfill_agent("codex", root=self.root, conn=self.conn)
        self.assertEqual(totals["files"], 2)
        # every session_logs row is tagged agent='codex'
        agents = {
            r[0] for r in self.conn.execute("SELECT DISTINCT agent FROM session_logs")
        }
        self.assertEqual(agents, {"codex"})
        # two sessions, each: user + assistant message, one tool call, one prompt
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM session_logs").fetchone()[0], 2
        )
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 4
        )
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0], 2
        )
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM user_prompts").fetchone()[0], 2
        )

    def test_codex_tokens_and_meta(self):
        session_ingest.backfill_agent("codex", root=self.root, conn=self.conn)
        row = self.conn.execute(
            "SELECT agent, model, cwd, input_tokens, output_tokens, cache_read_tokens, "
            "tool_call_count FROM session_logs WHERE session_id='codex-aaaa'"
        ).fetchone()
        self.assertEqual(row[0], "codex")
        self.assertEqual(row[1], "gpt-5.4")  # from turn_context
        self.assertEqual(row[2], "/repo/codex-demo")
        self.assertEqual(row[3], 100)  # last_token_usage.input_tokens
        self.assertEqual(row[4], 25)  # output_tokens
        self.assertEqual(row[5], 40)  # cached_input_tokens -> cache_read_tokens
        self.assertEqual(row[6], 1)

    def test_codex_tool_call_scrubbed(self):
        session_ingest.backfill_agent("codex", root=self.root, conn=self.conn)
        summary = self.conn.execute(
            "SELECT input_summary FROM tool_calls WHERE tool_use_id='codex-aaaa-call1'"
        ).fetchone()[0]
        self.assertNotIn("supersecretvalue", summary)  # secret-named key scrubbed
        self.assertIn("***", summary)
        # the tool result was joined back onto the call row
        rbytes = self.conn.execute(
            "SELECT result_bytes FROM tool_calls WHERE tool_use_id='codex-aaaa-call1'"
        ).fetchone()[0]
        self.assertGreater(rbytes, 0)

    def test_codex_signal_detected(self):
        session_ingest.backfill_agent("codex", root=self.root, conn=self.conn)
        types = {r[0] for r in self.conn.execute("SELECT signal_type FROM signals")}
        self.assertIn("assumption_admission", types)  # "I never actually ran"

    def test_codex_backfill_is_idempotent(self):
        session_ingest.backfill_agent("codex", root=self.root, conn=self.conn)
        session_ingest.backfill_agent("codex", root=self.root, conn=self.conn)
        # stable synthetic ids -> re-run dedupes rather than doubling
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 4
        )
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0], 2
        )

    def test_codex_observer_cwd_excluded(self):
        # A codex session whose recorded cwd is under observer-sessions must be
        # skipped even through the new entry point (defense in depth).
        p = os.path.join(self.daydir, "rollout-2026-04-16T20-45-44-codex-obs.jsonl")
        lines = _codex_session("codex-obs", "hi", "there")
        # rewrite the session_meta cwd to a synthetic path
        meta = json.loads(lines[0])
        meta["payload"]["cwd"] = "/home/u/.claude-mem/observer-sessions/proj"
        lines[0] = json.dumps(meta)
        with open(p, "w") as f:
            f.write("\n".join(lines) + "\n")
        stats = session_ingest.ingest_agent_session(
            p, session_ingest.codex_adapter, conn=self.conn
        )
        self.assertEqual(stats["messages"], 0)
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) FROM session_logs WHERE session_id='codex-obs'"
            ).fetchone()[0],
            0,
        )


class SkippedReportingTest(unittest.TestCase):
    """A corrupt transcript line must not abort the whole ingest, but the
    silent swallow must become observable: the returned stats report a non-zero
    skipped count and at least one reason naming the failure, while the valid
    records on either side of the corrupt line still land."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.tpath = os.path.join(self.tmp, f"{SID}.jsonl")
        self.conn = atlas_db.connect(self.dbpath)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def _write(self, lines):
        with open(self.tpath, "w") as f:
            f.write("\n".join(lines) + "\n")

    def _ingest(self):
        return session_ingest.ingest_transcript(
            self.tpath, conn=self.conn, session_id=SID
        )

    def test_ingest_reports_skipped_count(self):
        # one corrupt (unparseable) JSON line wedged between valid records
        corrupt = "{this is not valid json"
        self._write(FIXTURE[:2] + [corrupt] + FIXTURE[2:])
        stats = self._ingest()
        self.assertGreater(stats.get("skipped", 0), 0)
        reasons = stats.get("skip_reasons") or []
        self.assertTrue(reasons)  # at least one reason captured
        self.assertTrue(
            any("json" in r.lower() or "parse" in r.lower() for r in reasons),
            f"skip reason should name the parse failure, got {reasons}",
        )

    def test_valid_records_still_ingested(self):
        corrupt = "{this is not valid json"
        self._write(FIXTURE[:2] + [corrupt] + FIXTURE[2:])
        stats = self._ingest()
        # the fix must not abort the whole ingest on one bad record
        self.assertGreater(stats["messages"], 0)
        self.assertGreater(
            self.conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 0
        )


class ClaudeStillTaggedClaudeTest(unittest.TestCase):
    """The existing claude path is unchanged and its rows land agent='claude'
    via the column default - no agent value is passed on that path."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.tpath = os.path.join(self.tmp, f"{SID}.jsonl")
        with open(self.tpath, "w") as f:
            f.write("\n".join(FIXTURE) + "\n")
        self.conn = atlas_db.connect(self.dbpath)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_claude_row_tagged_claude(self):
        session_ingest.ingest_transcript(self.tpath, conn=self.conn, session_id=SID)
        agent = self.conn.execute(
            "SELECT agent FROM session_logs WHERE session_id=?", (SID,)
        ).fetchone()[0]
        self.assertEqual(agent, "claude")


# --- coverage: classify / signals / helpers edge cases ------------------------

_orig_connect = atlas_db.connect


def _own_connect(dbpath):
    """Patch atlas_db.connect so an own-connection code path (conn=None) runs
    against a temp DB instead of the real ~/.claude store."""
    return mock.patch.object(
        atlas_db, "connect", side_effect=lambda *a, **k: _orig_connect(dbpath)
    )


class ClassifyEdgeTest(unittest.TestCase):
    def test_non_plugin_mcp_server(self):
        # mcp__<server>__<tool> where server is not a plugin_* segment
        kind, target, server = session_ingest.classify("mcp__serena__find_symbol", {})
        self.assertEqual((kind, target, server), ("mcp", "serena.find_symbol", "serena"))

    def test_mcp_no_toolpart(self):
        kind, target, server = session_ingest.classify("mcp__serena", {})
        self.assertEqual((kind, target, server), ("mcp", "serena", "serena"))

    def test_skill_missing_name(self):
        kind, target, server = session_ingest.classify("Skill", {})
        self.assertEqual((kind, target, server), ("skill", "?", None))

    def test_agent_missing_type(self):
        kind, target, server = session_ingest.classify("Agent", {})
        self.assertEqual((kind, target, server), ("agent", "Agent", None))

    def test_builtin_empty_and_none(self):
        self.assertEqual(session_ingest.classify("", {}), ("builtin", "", None))
        self.assertEqual(session_ingest.classify(None, None), ("builtin", "", None))


class DetectSignalsTest(unittest.TestCase):
    def test_unverified_claim(self):
        sigs = list(session_ingest.detect_signals("assistant", "this should work fine"))
        self.assertTrue(any(s[0] == "unverified_claim" for s in sigs))

    def test_assumption_admission(self):
        sigs = list(session_ingest.detect_signals("assistant", "I just assumed it worked"))
        self.assertTrue(any(s[0] == "assumption_admission" for s in sigs))

    def test_user_correction(self):
        sigs = list(session_ingest.detect_signals("user", "that's wrong"))
        self.assertTrue(any(s[0] == "user_correction" for s in sigs))

    def test_empty_text_yields_nothing(self):
        self.assertEqual(list(session_ingest.detect_signals("assistant", "")), [])
        self.assertEqual(list(session_ingest.detect_signals("user", None)), [])

    def test_no_signal(self):
        self.assertEqual(list(session_ingest.detect_signals("assistant", "plain text")), [])
        self.assertEqual(list(session_ingest.detect_signals("user", "plain text")), [])


class HelpersTest(unittest.TestCase):
    def test_blocks_string_content(self):
        self.assertEqual(
            session_ingest._blocks({"content": "hi"}), [{"type": "text", "text": "hi"}]
        )

    def test_blocks_none_content(self):
        self.assertEqual(session_ingest._blocks({}), [])

    def test_blocks_list_content(self):
        c = [{"type": "text", "text": "x"}]
        self.assertIs(session_ingest._blocks({"content": c}), c)

    def test_is_real_prompt_tool_result_blocks(self):
        # non-empty text but blocks contain a tool_result -> not a real prompt
        self.assertFalse(
            session_ingest._is_real_prompt("hello", [{"type": "tool_result"}])
        )

    def test_is_real_prompt_too_short(self):
        self.assertFalse(session_ingest._is_real_prompt("a", []))

    def test_is_real_prompt_noise_prefix(self):
        self.assertFalse(session_ingest._is_real_prompt("<command-name>x", []))

    def test_is_real_prompt_real(self):
        self.assertTrue(session_ingest._is_real_prompt("write the tests", []))

    def test_epoch_none(self):
        self.assertIsNone(session_ingest._epoch(None))
        self.assertIsNone(session_ingest._epoch(""))

    def test_epoch_invalid(self):
        self.assertIsNone(session_ingest._epoch("not-a-timestamp"))

    def test_epoch_valid(self):
        self.assertIsNotNone(session_ingest._epoch("2026-06-26T12:00:00Z"))

    def test_normalize(self):
        self.assertEqual(
            session_ingest._normalize("Hello, World!! 123"), "hello world 123"
        )
        self.assertIsNone(session_ingest._normalize("!!!"))


class ReadSessionHelpersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def _write(self, name, content):
        p = os.path.join(self.tmp, name)
        with open(p, "w") as f:
            f.write(content)
        return p

    def test_read_session_cwd_skips_blank_line(self):
        p = self._write("a.jsonl", "\n" + json.dumps({"cwd": "/repo/x"}) + "\n")
        self.assertEqual(session_ingest._read_session_cwd(p), "/repo/x")

    def test_read_session_cwd_no_cwd(self):
        p = self._write("b.jsonl", json.dumps({"other": 1}) + "\n")
        self.assertIsNone(session_ingest._read_session_cwd(p))

    def test_read_session_cwd_missing_file(self):
        self.assertIsNone(
            session_ingest._read_session_cwd(os.path.join(self.tmp, "nope.jsonl"))
        )

    def test_read_session_id_skips_blank_line(self):
        p = self._write("c.jsonl", "\n" + json.dumps({"sessionId": "sid1"}) + "\n")
        self.assertEqual(session_ingest._read_session_id(p), "sid1")

    def test_read_session_id_no_session_id(self):
        p = self._write("d.jsonl", json.dumps({"other": 1}) + "\n")
        self.assertIsNone(session_ingest._read_session_id(p))

    def test_read_session_id_missing_file(self):
        self.assertIsNone(
            session_ingest._read_session_id(os.path.join(self.tmp, "nope.jsonl"))
        )


class IngestTranscriptEdgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.tpath = os.path.join(self.tmp, f"{SID}.jsonl")
        self._write(FIXTURE)
        self.conn = atlas_db.connect(self.dbpath)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def _write(self, lines):
        with open(self.tpath, "w") as f:
            f.write("\n".join(lines) + "\n")

    def test_own_connection_branch(self):
        with _own_connect(self.dbpath):
            stats = session_ingest.ingest_transcript(self.tpath)  # no conn
        self.assertGreater(stats["messages"], 0)

    def test_no_complete_line_returns_empty(self):
        session_ingest.ingest_transcript(self.tpath, conn=self.conn, session_id=SID)
        with open(self.tpath, "a") as f:
            f.write('{"type":"user","uuid":"partial"')  # no trailing newline
        stats = session_ingest.ingest_transcript(
            self.tpath, conn=self.conn, session_id=SID
        )
        self.assertEqual(stats["messages"], 0)

    def test_register_project_failure_swallowed(self):
        with mock.patch.object(atlas_db, "register_project", side_effect=RuntimeError("boom")):
            stats = session_ingest.ingest_transcript(
                self.tpath, conn=self.conn, session_id=SID
            )
        self.assertGreater(stats["messages"], 0)

    def test_derive_run_metrics_failure_swallowed(self):
        with mock.patch.object(atlas_db, "latest_run_id", return_value=42), mock.patch.object(
            atlas_db, "derive_run_metrics", side_effect=RuntimeError("boom")
        ):
            stats = session_ingest.ingest_transcript(
                self.tpath, conn=self.conn, session_id=SID
            )
        self.assertGreater(stats["messages"], 0)

    def test_non_message_type_skipped(self):
        extra = [
            json.dumps({"type": "summary", "uuid": "s1", "timestamp": "2026-06-26T12:00:00Z"})
        ]
        self._write(FIXTURE + extra)
        stats = session_ingest.ingest_transcript(self.tpath, conn=self.conn, session_id=SID)
        self.assertGreater(stats["messages"], 0)

    def test_non_dict_block_skipped(self):
        line = _msg(
            "nb1", "assistant", ["not a dict", {"type": "text", "text": "real text"}]
        )
        self._write(FIXTURE + [line])
        stats = session_ingest.ingest_transcript(self.tpath, conn=self.conn, session_id=SID)
        self.assertGreater(stats["messages"], 0)

    def test_tool_result_without_id_skipped(self):
        line = _msg("nr1", "user", [{"type": "tool_result", "content": "x"}])
        self._write(FIXTURE + [line])
        stats = session_ingest.ingest_transcript(self.tpath, conn=self.conn, session_id=SID)
        self.assertGreater(stats["messages"], 0)


class CodexHelpersTest(unittest.TestCase):
    def test_codex_text_string(self):
        self.assertEqual(session_ingest._codex_text("hello"), "hello")

    def test_codex_text_none(self):
        self.assertEqual(session_ingest._codex_text(None), "")

    def test_codex_text_non_list(self):
        self.assertEqual(session_ingest._codex_text(123), "")

    def test_codex_text_list(self):
        self.assertEqual(
            session_ingest._codex_text(
                [{"type": "input_text", "text": "a"}, {"type": "output_text", "text": "b"}]
            ),
            "a\nb",
        )

    def test_codex_args_dict(self):
        self.assertEqual(session_ingest._codex_args({"a": 1}), {"a": 1})

    def test_codex_args_unparseable_string(self):
        self.assertEqual(
            session_ingest._codex_args("not json{"), {"arguments": "not json{"}
        )

    def test_codex_args_non_dict_json(self):
        self.assertEqual(
            session_ingest._codex_args("[1, 2]"), {"arguments": "[1, 2]"}
        )

    def test_codex_args_non_str_non_dict(self):
        self.assertEqual(session_ingest._codex_args(None), {})
        self.assertEqual(session_ingest._codex_args(123), {})


class CodexAdapterEdgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def _write(self, name, lines):
        p = os.path.join(self.tmp, name)
        with open(p, "w") as f:
            f.write("\n".join(lines) + "\n")
        return p

    def test_blank_corrupt_and_non_dict_payload_lines_skipped(self):
        lines = [
            "",  # blank line -> continue
            "{not valid json",  # corrupt -> continue
            json.dumps(
                {"timestamp": CX_TS, "type": "session_meta", "payload": "notdict"}
            ),  # non-dict payload -> continue
            _cx("session_meta", {"id": "cx1", "cwd": "/repo/c", "timestamp": CX_TS}),
        ]
        p = self._write("rollout-x.jsonl", lines)
        recs = list(session_ingest.codex_adapter(p))
        self.assertTrue(any(r["kind"] == "meta" for r in recs))

    def test_tool_result_none_and_non_str_output(self):
        lines = [
            _cx("session_meta", {"id": "cx2", "cwd": "/repo/c", "timestamp": CX_TS}),
            _cx(
                "response_item",
                {"type": "function_call", "name": "f", "call_id": "c1", "arguments": "{}"},
            ),
            _cx(
                "response_item",
                {"type": "function_call_output", "call_id": "c1", "output": None},
            ),
            _cx(
                "response_item",
                {"type": "function_call_output", "call_id": "c2", "output": {"k": "v"}},
            ),
        ]
        p = self._write("rollout-y.jsonl", lines)
        results = [r for r in session_ingest.codex_adapter(p) if r["kind"] == "tool_result"]
        self.assertEqual(results[0]["result_bytes"], None)
        self.assertEqual(results[1]["result_bytes"], len(json.dumps({"k": "v"})))


class AgentSessionEdgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.dbpath)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def _empty_file(self, name):
        p = os.path.join(self.tmp, name)
        with open(p, "w") as f:
            f.write("")
        return p

    def test_synthetic_path_returns_empty(self):
        p = os.path.join(self.tmp, ".claude-mem", "observer-sessions", "rollout-synth.jsonl")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write("\n".join(_codex_session("synth", "hi", "bye")) + "\n")
        stats = session_ingest.ingest_agent_session(
            p, session_ingest.codex_adapter, conn=self.conn
        )
        self.assertEqual(stats["messages"], 0)

    def test_own_connection_branch(self):
        p = self._empty_file("rollout-own.jsonl")
        with open(p, "w") as f:
            f.write("\n".join(_codex_session("own1", "hi", "bye")) + "\n")
        with _own_connect(self.dbpath):
            stats = session_ingest.ingest_agent_session(p, session_ingest.codex_adapter)
        self.assertGreater(stats["messages"], 0)

    def test_meta_with_ended_at(self):
        def adapter(_path):
            yield {
                "kind": "meta",
                "session_id": "end1",
                "agent": "custom",
                "cwd": "/repo/c",
                "started_at": 100.0,
                "ended_at": 200.0,
            }
            yield {"kind": "message", "uuid": "m1", "ts": 150.0, "role": "user", "text": "hi"}

        p = self._empty_file("custom-ended.jsonl")
        stats = session_ingest.ingest_agent_session(p, adapter, conn=self.conn)
        self.assertGreater(stats["messages"], 0)

    def test_message_ts_before_started_at(self):
        def adapter(_path):
            yield {
                "kind": "meta",
                "session_id": "st1",
                "agent": "custom",
                "cwd": "/repo/c",
                "started_at": 100.0,
                "ended_at": 200.0,
            }
            yield {
                "kind": "message",
                "uuid": "m1",
                "ts": 50.0,
                "role": "assistant",
                "text": "earlier than started_at",
            }

        p = self._empty_file("custom-early.jsonl")
        stats = session_ingest.ingest_agent_session(p, adapter, conn=self.conn)
        self.assertGreater(stats["messages"], 0)

    def test_register_project_failure_swallowed(self):
        p = self._empty_file("rollout-regfail.jsonl")
        with open(p, "w") as f:
            f.write("\n".join(_codex_session("regfail", "hi", "bye")) + "\n")
        with mock.patch.object(
            atlas_db, "register_project", side_effect=RuntimeError("boom")
        ):
            stats = session_ingest.ingest_agent_session(
                p, session_ingest.codex_adapter, conn=self.conn
            )
        self.assertGreater(stats["messages"], 0)


class BackfillAgentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.root = os.path.join(self.tmp, "codex", "sessions")
        os.makedirs(self.root)
        self.conn = atlas_db.connect(self.dbpath)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def _rollout(self, dirpath, name, lines=None):
        os.makedirs(dirpath, exist_ok=True)
        p = os.path.join(dirpath, name)
        with open(p, "w") as f:
            if lines is None:
                lines = _codex_session(name.replace("rollout-", "").split(".")[0], "hi", "bye")
            f.write("\n".join(lines) + "\n")
        return p

    def test_unknown_agent_raises(self):
        with self.assertRaises(ValueError):
            session_ingest.backfill_agent("bogus", root=self.root, conn=self.conn)

    def test_own_connection_branch(self):
        self._rollout(self.root, "rollout-a.jsonl")
        with _own_connect(self.dbpath):
            totals = session_ingest.backfill_agent("codex", root=self.root)
        self.assertEqual(totals["files"], 1)

    def test_non_rollout_files_skipped(self):
        self._rollout(self.root, "notrollout.jsonl")
        self._rollout(self.root, "rollout-keep.jsonl")
        totals = session_ingest.backfill_agent("codex", root=self.root, conn=self.conn)
        self.assertEqual(totals["files"], 1)

    def test_synthetic_rollout_skipped(self):
        obs = os.path.join(self.tmp, ".claude-mem", "observer-sessions")
        self._rollout(obs, "rollout-obs.jsonl")
        self._rollout(self.root, "rollout-keep.jsonl")
        totals = session_ingest.backfill_agent("codex", root=self.tmp, conn=self.conn)
        self.assertEqual(totals["files"], 1)

    def test_ingest_exception_continues(self):
        self._rollout(self.root, "rollout-bad.jsonl")
        self._rollout(self.root, "rollout-good.jsonl")
        orig = session_ingest.ingest_agent_session

        def _flaky(p, adapter, conn=None, session_id=None):
            if "bad" in os.path.basename(p):
                raise RuntimeError("boom")
            return orig(p, adapter, conn=conn, session_id=session_id)

        with mock.patch.object(session_ingest, "ingest_agent_session", side_effect=_flaky):
            totals = session_ingest.backfill_agent("codex", root=self.root, conn=self.conn)
        self.assertEqual(totals["files"], 1)

    def test_progress_print_at_200(self):
        for i in range(200):
            self._rollout(self.root, f"rollout-{i:04d}.jsonl", lines=[])
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            totals = session_ingest.backfill_agent("codex", root=self.root, conn=self.conn)
        self.assertEqual(totals["files"], 200)
        self.assertIn("200 codex sessions", buf.getvalue())


class BackfillTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.root = os.path.join(self.tmp, "projects")
        os.makedirs(self.root)
        self.conn = atlas_db.connect(self.dbpath)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_own_connection_branch(self):
        with open(os.path.join(self.root, "a.jsonl"), "w") as f:
            f.write("\n".join(FIXTURE) + "\n")
        with _own_connect(self.dbpath):
            totals = session_ingest.backfill(self.root)
        self.assertEqual(totals["files"], 1)

    def test_non_jsonl_skipped(self):
        with open(os.path.join(self.root, "skip.txt"), "w") as f:
            f.write("nope")
        with open(os.path.join(self.root, "keep.jsonl"), "w") as f:
            f.write("\n".join(FIXTURE) + "\n")
        totals = session_ingest.backfill(self.root, conn=self.conn)
        self.assertEqual(totals["files"], 1)

    def test_ingest_exception_continues(self):
        for name in ("bad.jsonl", "good.jsonl"):
            with open(os.path.join(self.root, name), "w") as f:
                f.write("\n".join(FIXTURE) + "\n")
        orig = session_ingest.ingest_transcript

        def _flaky(p, conn=None, session_id=None, force=False):
            if "bad" in os.path.basename(p):
                raise RuntimeError("boom")
            return orig(p, conn=conn, session_id=session_id, force=force)

        with mock.patch.object(session_ingest, "ingest_transcript", side_effect=_flaky):
            totals = session_ingest.backfill(self.root, conn=self.conn)
        self.assertEqual(totals["files"], 1)

    def test_progress_print_at_200(self):
        for i in range(200):
            with open(os.path.join(self.root, f"t{i:04d}.jsonl"), "w") as f:
                f.write("")
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            totals = session_ingest.backfill(self.root, conn=self.conn)
        self.assertEqual(totals["files"], 200)
        self.assertIn("200 transcripts", buf.getvalue())


class MainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.tpath = os.path.join(self.tmp, f"{SID}.jsonl")
        with open(self.tpath, "w") as f:
            f.write("\n".join(FIXTURE) + "\n")

    def _run(self, argv, expect_db=False):
        out, err = io.StringIO(), io.StringIO()
        cm = _own_connect(self.dbpath) if expect_db else contextlib.nullcontext()
        with cm, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = session_ingest.main(argv)
        return rc, out.getvalue(), err.getvalue()

    def test_help(self):
        rc, out, _ = self._run(["--help"])
        self.assertEqual(rc, 0)
        self.assertIn("Mirror Claude Code", out)

    def test_no_args(self):
        rc, out, _ = self._run([])
        self.assertEqual(rc, 0)
        self.assertIn("Mirror Claude Code", out)

    def test_backfill(self):
        root = os.path.join(self.tmp, "empty-projects")
        os.makedirs(root)
        rc, out, _ = self._run(["--backfill", root], expect_db=True)
        self.assertEqual(rc, 0)
        self.assertIn("Backfilling", out)

    def test_backfill_agent_codex(self):
        root = os.path.join(self.tmp, "codex-empty")
        os.makedirs(root)
        rc, out, _ = self._run(["--backfill-agent", "codex", root], expect_db=True)
        self.assertEqual(rc, 0)
        self.assertIn("codex", out)

    def test_backfill_agent_missing_arg(self):
        rc, _, err = self._run(["--backfill-agent"])
        self.assertEqual(rc, 2)
        self.assertIn("usage", err)

    def test_backfill_agent_unknown(self):
        rc, _, err = self._run(["--backfill-agent", "bogus"])
        self.assertEqual(rc, 2)
        self.assertIn("usage", err)

    def test_single_transcript(self):
        rc, out, _ = self._run([self.tpath], expect_db=True)
        self.assertEqual(rc, 0)
        self.assertIn("messages", out)


class MainModuleTest(unittest.TestCase):
    """Cover the `if __name__ == "__main__"` guard by exec'ing the source with
    __name__ set to "__main__", so its try/except/sys.exit wrapper runs under
    coverage without spawning a subprocess (which would not be traced)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dbpath = os.path.join(self.tmp, "atlas.db")
        self.tpath = os.path.join(self.tmp, f"{SID}.jsonl")
        with open(self.tpath, "w") as f:
            f.write("\n".join(FIXTURE) + "\n")
        self.src = os.path.join(
            os.path.dirname(session_ingest.__file__), "session_ingest.py"
        )

    def _exec_as_main(self, argv):
        ns = {"__name__": "__main__", "__file__": self.src, "__builtins__": __builtins__}
        with open(self.src) as f:
            code = compile(f.read(), self.src, "exec")
        with mock.patch.object(sys, "argv", ["session_ingest.py", *argv]):
            exec(code, ns)  # noqa: S102 - intentional in-process exec for coverage

    def test_main_block_help_exits_zero(self):
        with self.assertRaises(SystemExit) as cm:
            self._exec_as_main(["--help"])
        self.assertEqual(cm.exception.code, 0)

    def test_main_block_exception_swallowed_exits_zero(self):
        with mock.patch.object(
            atlas_db, "connect", side_effect=lambda *a, **k: _orig_connect(self.dbpath)
        ), mock.patch.object(atlas_db, "init", side_effect=RuntimeError("init boom")):
            with self.assertRaises(SystemExit) as cm:
                self._exec_as_main([self.tpath])
        self.assertEqual(cm.exception.code, 0)


if __name__ == "__main__":
    unittest.main()
