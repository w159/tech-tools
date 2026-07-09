import json
import os
import tempfile
import unittest

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


if __name__ == "__main__":
    unittest.main()
