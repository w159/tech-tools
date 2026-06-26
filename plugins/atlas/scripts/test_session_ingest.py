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


if __name__ == "__main__":
    unittest.main()
