import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import atlas_db  # noqa: E402
import session_ingest  # noqa: E402


class ClassifyErrorTests(unittest.TestCase):
    def test_one_case_per_class(self):
        cases = {
            "deny": ("Grep", "Atlas enforcement: use lean-ctx", False),
            "model_misuse": (
                "Edit",
                "File has not been read yet. Read it first.",
                False,
            ),
            "environment": ("Bash", "Exit code 1\nENOENT: no such file", False),
            "tool_fault": (
                "Bash",
                'Traceback (most recent call last):\n  File "/r/plugins/atlas/scripts/atlas_db.py", line 1\nboom',
                False,
            ),
            "user_code": (
                "eval",
                "Traceback (most recent call last): File \"<cell>\", line 1\nKeyError: 'a'",
                False,
            ),
            "unknown": ("Bash", "", False),
        }
        for want, (tool, snip, denied) in cases.items():
            self.assertEqual(atlas_db.classify_error(tool, snip, denied), want, want)
        self.assertEqual(set(cases), set(atlas_db.ERROR_CLASSES))

    def test_invalid_args_is_model_misuse(self):
        self.assertEqual(
            atlas_db.classify_error(
                "Task", "InputValidationError: missing required param", False
            ),
            "model_misuse",
        )

    def test_real_snippet_clusters(self):
        cases = [
            (
                "model_misuse",
                "wait",
                "Nothing to wait for: no background job or service you started is running",
            ),
            (
                "model_misuse",
                "Bash",
                "[Fact-Forcing Gate] Before the first Bash command this session, present",
            ),
            (
                "model_misuse",
                "Edit",
                "Edit rejected for plugins/atlas/hooks/completion_gate.py: file changed",
            ),
            (
                "model_misuse",
                "edit",
                "Input header must be [PATH] or [PATH#TAG] with a 4-hex content-hash ta",
            ),
            (
                "model_misuse",
                "Edit",
                "line 1: payload line has no preceding hunk header. Use `PUT N.=M:`",
            ),
            (
                "model_misuse",
                "edit",
                "Could not find a close enough match in /Users/jerry/x.py",
            ),
            (
                "model_misuse",
                "edit",
                "Found 2 occurrences in backend/alembic/versions/106_x.py",
            ),
            (
                "model_misuse",
                "write",
                "The user did not answer the approval prompt for changing `tui.mouse`",
            ),
            (
                "model_misuse",
                "mcp__lean_ctx__ctx_search",
                "Error: ERROR: path escapes project root: /Users/jerry/worktrees/x",
            ),
            (
                "model_misuse",
                "mcp__lean_ctx__ctx_search",
                "Error: queries[1]: unknown key 'path' — accepted keys are pattern",
            ),
            (
                "model_misuse",
                "mcp__lean-ctx__ctx_shell",
                "ERROR: ctx_shell detected a file-write command (shell redirect > or >>",
            ),
            (
                "model_misuse",
                "TodoWrite",
                "Invalid todo arguments: items must be tasks for flat init",
            ),
            ("model_misuse", "todo", "Errors: Missing phase name for append operation"),
            ("model_misuse", "Read", "proc://<id>/kill is writable only"),
            (
                "model_misuse",
                "mcp__Claude_Browser__find",
                "no read_page tree cached; call read_page first",
            ),
            (
                "environment",
                "mcp__35880cc3__ramp_edit_transaction",
                "Tool execution failed. You can try again.",
            ),
            (
                "environment",
                "mcp__lean-ctx__ctx_read",
                "per-file lock contention for /Users/jerry/x",
            ),
            (
                "environment",
                "mcp__plugin_claude-mem_mcp-search__timeline",
                "Error calling Worker API: fetch failed",
            ),
            (
                "environment",
                "write",
                'Error: { "error": { "code": "MISSING_CREDENTIALS", "message": "CIPP cr',
            ),
            (
                "environment",
                "wait",
                "Skipped due to a queued background completion (job or supervised proce",
            ),
            ("environment", "mcp__lean-ctx__ctx_shell", "[exit:1]"),
            ("environment", "Agent", "Could not determine current tmux pane/window"),
            (
                "model_misuse",
                "Edit",
                "File not found: /Users/jerry/x/new.ts. Use the write tool to create it.",
            ),
            (
                "model_misuse",
                "edit",
                "Error: File not found: src/a.ts\nUse the write tool to create new files.",
            ),
        ]
        for want, tool, snip in cases:
            self.assertEqual(atlas_db.classify_error(tool, snip, False), want, snip)

    def test_recurring_unclassified_causes(self):
        """Real 14-day 'unknown' snippets (trimmed) now map to a real cause."""
        put = "`PUT 143.=192:` rejected: the body ends by restating the 1 line(s) just below the range, but is too short"
        cases = [
            ("model_misuse", "Edit", put),
            (
                "model_misuse",
                "Edit",
                "line 1: `PUT <N:` / `PUT >N:` promises body rows and got none.",
            ),
            (
                "model_misuse",
                "Edit",
                "line 7: `-` rows are not valid; the range already names the lines",
            ),
            (
                "model_misuse",
                "Edit",
                "edit appeared successful but file content did not change on disk: a.ts",
            ),
            (
                "model_misuse",
                "Write",
                "EISDIR: illegal operation on a directory, open '/r/plugins/atlas/hooks'",
            ),
            ("model_misuse", "Glob", "Path is not a directory: xd://"),
            ("model_misuse", "read", "Invalid range 752-500: end must be >= start."),
            (
                "model_misuse",
                "Write",
                "No such tool: xd://mobbin_search_screens. Mounted devices: a, b",
            ),
            (
                "model_misuse",
                "Read",
                "Unknown agent: ImplementerOkProbe Known agents: Main, IrcLive",
            ),
            (
                "model_misuse",
                "read",
                "agent:// URL requires an output ID: agent://<id>",
            ),
            (
                "model_misuse",
                "Read",
                "Failed to execute JSON query: Error: cannot use null as iterable",
            ),
            (
                "model_misuse",
                "Read",
                "SQLite limit must be a positive integer; got '0'",
            ),
            (
                "model_misuse",
                "mcp__lean_ctx__ctx_glob",
                "xd://x content must be a JSON object, got array.",
            ),
            (
                "model_misuse",
                "mcp__lean_ctx__ctx_shell",
                "Error: ERROR: ctx_shell refuses the redirect into `README.md`",
            ),
            (
                "model_misuse",
                "eval",
                "ToolError: Browser selector must be a string; got a undefined.",
            ),
            (
                "model_misuse",
                "eval",
                "ToolError: tab.route() is not supported on the cmux backend at route",
            ),
            (
                "model_misuse",
                "mcp__azure__azure_keyvault",
                "This tool handles sensitive data and requires user consent",
            ),
            (
                "model_misuse",
                "todo",
                "Errors: Missing items for append operation Remaining items (4)",
            ),
            (
                "model_misuse",
                "mcp__lean_ctx__ctx_search",
                "ERROR: Auto-detected Node modules at /x — added as a read-only root",
            ),
            (
                "environment",
                "wait",
                "Previous OMP process exited before this tool returned; its outcome is unknown.",
            ),
            ("environment", "ask", "Ask tool was cancelled by the user"),
            (
                "environment",
                "eval",
                "TargetCloseError: Protocol error (Accessibility.getFullAXTree): Session closed.",
            ),
            (
                "environment",
                "eval",
                "Error: ResolveMessage: Cannot find module '/Users/j/puppeteer-core'",
            ),
            (
                "environment",
                "eval",
                'ToolError: Tab "forms" is not alive. Open it first with action:"open".',
            ),
            (
                "environment",
                "mcp__atlas_threatlocker__status",
                "Error: ThreatLocker MCP Server Status Credentials: Configured Auth check: FAILED HTTP",
            ),
            # shell output that fills the 500-char cap with no marker: the exit line was cut
            ("environment", "Bash", "import os " + "x" * 490),
            ("environment", "mcp__lean_ctx__shell", "y" * 500),
            # still unknown: short unmarked shell text, user-script tracebacks, non-shell output
            ("unknown", "Bash", "short plain output"),
            ("unknown", "eval", "z" * 500),
            ("user_code", "Bash", "Traceback (most recent call last): " + "q" * 480),
        ]
        for want, tool, snip in cases:
            self.assertEqual(atlas_db.classify_error(tool, snip, False), want, snip)

    def test_tool_fault_is_only_real_atlas_crashes(self):
        tb = (
            'Traceback (most recent call last):\n  File "%s", line 9, in main\n'
            "    x()\nKeyError: 'a'"
        )
        cases = [
            ("tool_fault", "Bash", tb % "/r/plugins/atlas/scripts/atlas_db.py"),
            (
                "tool_fault",
                "Bash",
                tb % "/Users/j/.claude/plugins/cache/m/atlas/1.0/scripts/x.py",
            ),
            ("tool_fault", "Bash", "SessionStart hook error: boom in atlas_x"),
            (
                "model_misuse",
                "Edit",
                "RETRYABLE - Edit without read: you have not read plugins/atlas/a.py",
            ),
            (
                "model_misuse",
                "Edit",
                "File modified since read: plugins/atlas/scripts/atlas_db.py",
            ),
            (
                "model_misuse",
                "Edit",
                "Edit rejected for plugins/atlas/scripts/atlas_db.py: bad",
            ),
            ("model_misuse", "Write", "content is required for plugins/atlas/x.md"),
            ("model_misuse", "Edit", "Invalid args for edit on plugins/atlas/a.py"),
            ("model_misuse", "Edit", "Validation failed for plugins/atlas/a.py"),
            ("user_code", "eval", tb % "<cell>"),
            ("user_code", "Bash", tb % "<string>"),
            ("user_code", "Bash", tb % "<stdin>"),
            ("user_code", "eval", "SyntaxError: JSON Parse error: Unexpected token"),
            (
                "model_misuse",
                "wait",
                "Service mode does not accept async or timeout; use ready.timeout",
            ),
            (
                "model_misuse",
                "wait",
                "Nothing to wait for: no background job or service you started is running",
            ),
            (
                "environment",
                "wait",
                "Skipped due to a queued background completion (job or supervised)",
            ),
            (
                "environment",
                "mcp__claude_mem__search",
                "Error calling Worker API: fetch failed",
            ),
            ("environment", "mcp__claude_mem__search", "Chroma collection unavailable"),
            ("unknown", "Bash", "error in atlas_db.py line 3"),
            (
                "model_misuse",
                "Edit",
                "String to replace not found in file. String: foo",
            ),
            ("model_misuse", "Edit", "old text not found in file plugins/x.py"),
            ("unknown", "Bash", "mkdir: /tmp/claude-501/x: File exists"),
            ("unknown", "Bash", "uid 502 owns /tmp/claude-502"),
            ("environment", "WebFetch", "Request failed with status code 503"),
            ("environment", "WebFetch", "HTTP 404 on url"),
            ("environment", "WebFetch", "upstream returned 502 Bad Gateway"),
            (
                "tool_fault",
                "Bash",
                "python3: can't open file '/scripts/atlas_todo.py': [Errno 2] No such file or directory",
            ),
            (
                "tool_fault",
                "Bash",
                "Traceback (most recent call last): " + "x" * 480 + " atlas_db.py",
            ),
            (
                "tool_fault",
                "Bash",
                "Traceback (most recent call last): File plugins/atlas/x",
            ),
            ("user_code", "eval", "Traceback (most recent call last): atlas_db boom"),
            ("unknown", "Edit", "Traceback (most recent call last): atlas_db boom"),
        ]
        for want, tool, snip in cases:
            self.assertEqual(atlas_db.classify_error(tool, snip, False), want, snip)

    def test_unmatched_and_none_are_unknown(self):
        self.assertEqual(
            atlas_db.classify_error("X", "something odd", False), "unknown"
        )
        self.assertEqual(atlas_db.classify_error("X", None, False), "unknown")

    def test_denied_flag_takes_precedence(self):
        self.assertEqual(
            atlas_db.classify_error("Bash", "Exit code 1 ENOENT", True), "deny"
        )
        self.assertEqual(
            atlas_db.classify_error(
                "Bash", "PreToolUse:Bash hook error: [atlas gate] x ENOENT", False
            ),
            "deny",
        )


class DispatchAgentTypeTests(unittest.TestCase):
    def test_resolve_shapes(self):
        r = atlas_db.resolve_agent_type
        self.assertEqual(r({"subagent_type": "atlas:verifier"}), "atlas:verifier")
        self.assertEqual(r({"subagent_type": "", "agent": "explorer"}), "explorer")
        self.assertEqual(r({"agent_type": "x"}), "x")
        self.assertEqual(
            r({"tasks": [{"task": "a"}, {"agent": "reviewer"}]}), "reviewer"
        )
        self.assertEqual(r({"subagent_type": "  "}), "general-purpose")
        self.assertEqual(r(None), "general-purpose")

    def test_log_dispatch_never_stores_blank(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        conn = atlas_db.connect(os.path.join(tmp.name, "d.db"))
        self.addCleanup(conn.close)
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x", "x")
        rid = atlas_db.start_run(conn, pid, "s1")
        atlas_db.log_dispatch(conn, rid, "")
        atlas_db.log_dispatch(conn, rid, None)
        atlas_db.log_dispatch(conn, rid, "atlas:implementer")
        got = [
            r[0] for r in conn.execute("SELECT agent_type FROM dispatches ORDER BY id")
        ]
        self.assertEqual(
            got, ["general-purpose", "general-purpose", "atlas:implementer"]
        )


def _claude_line(uid, content):
    return json.dumps(
        {
            "type": "user",
            "uuid": "u-" + uid,
            "message": {"role": "user", "content": content},
        }
    )


class BackfillErrorsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        os.makedirs(os.path.join(root, "claude", "proj"))
        os.makedirs(os.path.join(root, "omp", "proj"))
        with open(os.path.join(root, "claude", "proj", "s.jsonl"), "w") as f:
            f.write(
                _claude_line(
                    "1",
                    [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tu-deny",
                            "is_error": True,
                            "content": "PreToolUse:Grep hook error: Atlas enforcement: use ctx_search",
                        },
                        {
                            "type": "tool_result",
                            "tool_use_id": "tu-env",
                            "is_error": True,
                            "content": [
                                {"type": "text", "text": "Exit code 2\nno such file"}
                            ],
                        },
                        {
                            "type": "tool_result",
                            "tool_use_id": "tu-ok",
                            "content": "fine",
                        },
                    ],
                )
                + "\n"
            )
        with open(os.path.join(root, "omp", "proj", "o.jsonl"), "w") as f:
            f.write(json.dumps({"type": "title", "v": 1}) + "\n")
            f.write(
                json.dumps(
                    {"type": "session", "id": "sess9", "cwd": "/r"},
                    separators=(",", ":"),
                )
                + "\n"
            )
            f.write(
                json.dumps(
                    {
                        "type": "message",
                        "id": "m1",
                        "message": {
                            "role": "toolResult",
                            "toolCallId": "call1",
                            "isError": True,
                            "content": [
                                {"type": "text", "text": "DENY - no inline edits"}
                            ],
                        },
                    }
                )
                + "\n"
            )
        self.conn = atlas_db.connect(os.path.join(root, "t.db"))
        atlas_db.init(self.conn)
        for tuid in ("tu-deny", "tu-env", "tu-ok", "sess9:call1", "gone"):
            atlas_db.insert_tool_call(
                self.conn,
                "s",
                {
                    "tool_use_id": tuid,
                    "tool_name": "Bash",
                    "kind": "builtin",
                    "target": "Bash",
                },
            )
        self.conn.execute("UPDATE tool_calls SET is_error=1 WHERE tool_use_id!='tu-ok'")
        self.conn.commit()
        self.roots = [os.path.join(root, "claude"), os.path.join(root, "omp")]

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_backfill_fills_and_is_idempotent(self):
        out = session_ingest.backfill_errors(self.roots, conn=self.conn)
        self.assertEqual(out["empty_before"], 4)
        self.assertEqual(out["updated"], 3)
        self.assertEqual(out["denied"], 2)
        self.assertEqual(out["empty_after"], 1)  # "gone": transcript missing
        rows = {
            r[0]: r[1:]
            for r in self.conn.execute(
                "SELECT tool_use_id, denied, error_snippet FROM tool_calls"
            )
        }
        self.assertEqual(rows["tu-deny"][0], 1)
        self.assertEqual(rows["sess9:call1"][0], 1)
        self.assertIn("no such file", rows["tu-env"][1])
        self.assertIsNone(rows["tu-ok"][1])
        snap = list(self.conn.execute("SELECT * FROM tool_calls ORDER BY tool_use_id"))
        again = session_ingest.backfill_errors(self.roots, conn=self.conn)
        self.assertEqual(again["updated"], 0)
        self.assertEqual(again["empty_after"], 1)
        self.assertEqual(
            snap,
            list(self.conn.execute("SELECT * FROM tool_calls ORDER BY tool_use_id")),
        )


if __name__ == "__main__":
    unittest.main()
