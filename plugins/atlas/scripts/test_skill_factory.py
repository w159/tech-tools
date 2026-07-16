#!/usr/bin/env python3
"""Tests for skill_factory.py — auto-skill creation."""

import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import skill_factory


class _FakeCursor:
    """Minimal cursor for a fake sqlite connection."""

    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class _FakeConn:
    """Fake sqlite3.Connection that raises on a target SQL substring and
    returns canned rows for others. Used to exercise per-source error handling
    in _extract_lessons_from_session without a real DB."""

    def __init__(self, raise_substring, rows_by_substring):
        self.raise_substring = raise_substring
        self.rows_by_substring = rows_by_substring

    def execute(self, sql, params=()):
        if self.raise_substring and self.raise_substring in sql:
            raise sqlite3.Error(f"fake DB error on: {self.raise_substring}")
        for substr, rows in self.rows_by_substring.items():
            if substr in sql:
                return _FakeCursor(rows)
        return _FakeCursor([])

    def close(self):
        pass


def _make_db(path, runs=None, tool_calls=None, improvements=None, signals=None):
    """Create a real in-process sqlite atlas DB with the subset of the schema
    that skill_factory queries. Each arg is a list of tuples to insert.

    Schema:
      runs(id, session_id, orchestrating)
      tool_calls(id, session_id, tool_name, is_error, input_summary)
      improvements(id, run_id, dimension, baseline, target, note)
      signals(id, session_id, signal_type, snippet, ts)
    """
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE runs (id INTEGER PRIMARY KEY, session_id TEXT, orchestrating INTEGER)"
    )
    conn.execute(
        "CREATE TABLE tool_calls (id INTEGER PRIMARY KEY, session_id TEXT, "
        "tool_name TEXT, is_error INTEGER, input_summary TEXT)"
    )
    conn.execute(
        "CREATE TABLE improvements (id INTEGER PRIMARY KEY, run_id INTEGER, "
        "dimension TEXT, baseline TEXT, target TEXT, note TEXT)"
    )
    conn.execute(
        "CREATE TABLE signals (id INTEGER PRIMARY KEY, session_id TEXT, "
        "signal_type TEXT, snippet TEXT, ts TEXT)"
    )
    for r in runs or []:
        conn.execute("INSERT INTO runs VALUES (?,?,?)", r)
    for t in tool_calls or []:
        conn.execute("INSERT INTO tool_calls VALUES (?,?,?,?,?)", t)
    for i in improvements or []:
        conn.execute("INSERT INTO improvements VALUES (?,?,?,?,?,?)", i)
    for s in signals or []:
        conn.execute("INSERT INTO signals VALUES (?,?,?,?,?)", s)
    conn.commit()
    conn.close()


class TestSkillFactory(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        os.environ["ATLAS_HOME"] = self.tmpdir

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        del os.environ["ATLAS_HOME"]

    def test_validate_name_valid(self):
        self.assertIsNone(skill_factory._validate_name("my-skill"))
        self.assertIsNone(skill_factory._validate_name("learned-fix-bug"))

    def test_validate_name_invalid(self):
        self.assertIsNotNone(skill_factory._validate_name(""))
        self.assertIsNotNone(skill_factory._validate_name("UPPERCASE"))
        self.assertIsNotNone(skill_factory._validate_name("has spaces"))
        self.assertIsNotNone(skill_factory._validate_name("x" * 65))

    def test_skill_name_from_topic(self):
        name = skill_factory._skill_name_from_topic("Fix database migration errors")
        self.assertTrue(name.startswith("learned-"))
        self.assertTrue("database" in name or "migration" in name or "fix" in name)

    def test_create_skill(self):
        result = skill_factory.create_skill(
            "test-skill", "A test skill", "## Test\n\nThis is a test skill body."
        )
        self.assertTrue(result["success"])
        self.assertTrue(os.path.exists(result["path"]))
        content = open(result["path"]).read()
        self.assertIn('created_by: "atlas-auto"', content)
        self.assertIn("test-skill", content)

    def test_create_skill_duplicate(self):
        skill_factory.create_skill("dup-skill", "First", "body1")
        result = skill_factory.create_skill("dup-skill", "Second", "body2")
        self.assertFalse(result["success"])

    def test_create_skill_invalid_name(self):
        result = skill_factory.create_skill("INVALID", "desc", "body")
        self.assertFalse(result["success"])

    def test_existing_skill_names(self):
        skill_factory.create_skill("skill-a", "A", "body")
        skill_factory.create_skill("skill-b", "B", "body")
        names = skill_factory._existing_skill_names()
        self.assertIn("skill-a", names)
        self.assertIn("skill-b", names)

    def test_dedup_skill_name(self):
        existing = {"learned-fix", "learned-fix-2"}
        result = skill_factory._dedup_skill_name("learned-fix", existing)
        self.assertEqual(result, "learned-fix-3")
        result = skill_factory._dedup_skill_name("new-skill", existing)
        self.assertEqual(result, "new-skill")

    def test_auto_create_no_db(self):
        """Should return gracefully when no atlas DB exists."""
        # Point to a non-existent DB path
        result = skill_factory.auto_create_from_session(
            db_path=os.path.join(self.tmpdir, "nonexistent.db")
        )
        self.assertFalse(result["created"])
        self.assertIn("no atlas DB", result["reason"])

    def test_build_skill_md_has_provenance(self):
        md = skill_factory._build_skill_md("test", "desc", "body")
        self.assertIn('created_by: "atlas-auto"', md)
        self.assertIn("name: test", md)
        self.assertIn('description: "desc"', md)

    def test_create_skill_cleans_up_on_write_failure(self):
        """M10: a failed SKILL.md write must not leave the skill dir behind,
        so retrying create_skill for the same name succeeds instead of
        returning 'already exists'."""
        real_write_text = skill_factory.Path.write_text
        call_count = {"n": 0}

        def flaky_write_text(self_path, *args, **kwargs):
            call_count["n"] += 1
            # First write (the SKILL.md) raises as if disk full; subsequent
            # writes use the real implementation.
            if call_count["n"] == 1:
                raise OSError("disk full")
            return real_write_text(self_path, *args, **kwargs)

        with mock.patch.object(skill_factory.Path, "write_text", flaky_write_text):
            result = skill_factory.create_skill("flaky-skill", "desc", "body")
        # First call fails and must report a clear error.
        self.assertFalse(result["success"])

        # Retry: write no longer raises, and the leftover dir from the first
        # attempt must not block the retry.
        result2 = skill_factory.create_skill("flaky-skill", "desc", "body")
        self.assertTrue(result2["success"], f"retry blocked: {result2}")
        self.assertTrue(os.path.exists(result2["path"]))

    def test_extract_lessons_surfaces_db_error(self):
        """M14: when one lesson source raises sqlite3.Error, the failure must
        be surfaced (to stderr here) and lessons from the non-failing source
        must still be returned instead of silently zeroing the whole result."""
        # improvements query raises; signals query returns one lesson.
        conn = _FakeConn(
            raise_substring="FROM improvements",
            rows_by_substring={
                "FROM runs": [(1,)],
                "FROM signals": [("user_correction", "don't assume the API is stable")],
            },
        )
        err = io.StringIO()
        with redirect_stderr(err):
            lessons = skill_factory._extract_lessons_from_session(conn, "sess-xyz")  # type: ignore[arg-type]  # _FakeConn quacks like sqlite3.Connection (execute/fetchall)

        stderr_text = err.getvalue()
        # The DB error from the improvements source must be surfaced.
        self.assertTrue(
            "improvements" in stderr_text.lower() and "error" in stderr_text.lower(),
            f"expected DB error surfaced to stderr, got: {stderr_text!r}",
        )
        # Lessons from the non-failing (signals) source must still be returned.
        self.assertTrue(
            any(lesson["source"] == "signals" for lesson in lessons),
            f"expected signals lesson, got: {lessons}",
        )

    # --- name derivation edge cases ---

    def test_skill_name_from_topic_empty(self):
        """Topic with no usable words falls back to 'learned-lesson'."""
        self.assertEqual(
            skill_factory._skill_name_from_topic("!!! ???"), "learned-lesson"
        )

    def test_skill_name_from_topic_already_learned_prefix(self):
        """A topic whose derived name already starts with 'learned-' is not
        double-prefixed."""
        name = skill_factory._skill_name_from_topic("learned fix bug now")
        self.assertEqual(name, "learned-fix-bug-now")

    def test_skill_name_from_topic_truncation(self):
        """A very long derived name is truncated to MAX_NAME_LENGTH."""
        topic = " ".join(["supercalifragilistic"] * 5)
        name = skill_factory._skill_name_from_topic(topic)
        self.assertTrue(name.startswith("learned-"))
        self.assertLessEqual(len(name), skill_factory.MAX_NAME_LENGTH)

    # --- existing skill names when dir absent ---

    def test_existing_skill_names_no_dir(self):
        """When the skills directory does not exist, returns an empty set."""
        os.environ["ATLAS_HOME"] = os.path.join(self.tmpdir, "does-not-exist")
        self.assertEqual(skill_factory._existing_skill_names(), set())

    # --- dedup fallback (all -2..-99 taken) ---

    def test_dedup_skill_name_exhausted(self):
        """When all -2..-99 candidates are taken, dedup falls back to a
        time-based suffix so it always returns something unique."""
        base = "learned-fix"
        existing = {base}
        existing.update(f"{base}-{i}" for i in range(2, 100))
        result = skill_factory._dedup_skill_name(base, existing)
        self.assertTrue(result.startswith(f"{base}-"))
        # The suffix after the base must be a positive integer (the timestamp).
        suffix = result[len(base) + 1 :]
        self.assertTrue(suffix.isdigit(), f"expected numeric suffix, got {result!r}")

    # --- _session_run_id ---

    def test_session_run_id_db_error(self):
        """A sqlite error in the runs lookup returns None instead of raising."""
        conn = _FakeConn(raise_substring="FROM runs", rows_by_substring={})
        self.assertIsNone(skill_factory._session_run_id(conn, "s1"))  # type: ignore[arg-type]

    # --- _session_worthy branches via real DB ---

    def test_session_worthy_no_run(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(db, runs=[(1, "other-session", 1)])
        conn = sqlite3.connect(db)
        self.assertEqual(
            skill_factory._session_worthy(conn, "missing-session"),
            (False, "no run found"),
        )
        conn.close()

    def test_session_worthy_not_orchestrating(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(db, runs=[(1, "s1", 0)])
        conn = sqlite3.connect(db)
        worthy, reason = skill_factory._session_worthy(conn, "s1")
        conn.close()
        self.assertFalse(worthy)
        self.assertEqual(reason, "not an orchestration run")

    def test_session_worthy_few_tools(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            tool_calls=[(1, "s1", "Read", 0, "x")],  # only 1 tool call
        )
        conn = sqlite3.connect(db)
        worthy, reason = skill_factory._session_worthy(conn, "s1")
        conn.close()
        self.assertFalse(worthy)
        self.assertIn("only 1 tool calls", reason)

    def test_session_worthy_no_learnable_signals(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            tool_calls=[(i, "s1", "Read", 0, "x") for i in range(5)],  # 5 non-error
        )
        conn = sqlite3.connect(db)
        worthy, reason = skill_factory._session_worthy(conn, "s1")
        conn.close()
        self.assertFalse(worthy)
        self.assertEqual(reason, "no learnable signals (no improvements, corrections, or persistent errors)")

    def test_session_worthy_yes(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            tool_calls=[(i, "s1", "Read", 0, "x") for i in range(5)],
            improvements=[(1, 1, "speed", "slow", "fast", "be faster")],
        )
        conn = sqlite3.connect(db)
        worthy, reason = skill_factory._session_worthy(conn, "s1")
        conn.close()
        self.assertTrue(worthy)
        self.assertIn("orchestrating run with 5 tools", reason)

    def test_session_worthy_db_error(self):
        # _session_run_id must succeed (return a run_id) so the later
        # orchestrating query raises and hits the outer except in _session_worthy.
        conn = _FakeConn(
            raise_substring="WHERE id=?",
            rows_by_substring={"session_id=?": [(1,)]},
        )
        worthy, reason = skill_factory._session_worthy(conn, "s1")  # type: ignore[arg-type]
        self.assertFalse(worthy)
        self.assertIn("DB error:", reason)

    # --- _extract_lessons_from_session happy paths via real DB ---

    def test_extract_lessons_improvements_with_note(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            improvements=[(1, 1, "speed", "slow", "fast", "be faster")],
        )
        conn = sqlite3.connect(db)
        lessons = skill_factory._extract_lessons_from_session(conn, "s1")
        conn.close()
        self.assertEqual(len(lessons), 1)
        self.assertEqual(lessons[0]["source"], "improvements")
        self.assertIn("speed", lessons[0]["body"])

    def test_extract_lessons_improvements_empty_note_skipped(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            improvements=[(1, 1, "speed", "slow", "fast", "   ")],
        )
        conn = sqlite3.connect(db)
        lessons = skill_factory._extract_lessons_from_session(conn, "s1")
        conn.close()
        self.assertEqual(lessons, [])

    def test_extract_lessons_signals_assumption_admission(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            signals=[(1, "s1", "assumption_admission", "assumed the API was stable", "2026-01-01")],
        )
        conn = sqlite3.connect(db)
        lessons = skill_factory._extract_lessons_from_session(conn, "s1")
        conn.close()
        self.assertEqual(len(lessons), 1)
        self.assertEqual(lessons[0]["source"], "signals")
        self.assertIn("Assumption admitted", lessons[0]["body"])

    def test_extract_lessons_tool_errors(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            tool_calls=[
                (1, "s1", "Bash", 1, "rm -rf"),
                (2, "s1", "Bash", 1, "rm -rf again"),
                (3, "s1", "Bash", 1, "rm -rf third"),
            ],
        )
        conn = sqlite3.connect(db)
        lessons = skill_factory._extract_lessons_from_session(conn, "s1")
        conn.close()
        self.assertEqual(len(lessons), 1)
        self.assertEqual(lessons[0]["source"], "tool_errors")
        self.assertIn("Tool Error Pattern: Bash", lessons[0]["body"])

    def test_extract_lessons_tool_errors_empty_tool_name_skipped(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            tool_calls=[(1, "s1", None, 1, "x")],
        )
        conn = sqlite3.connect(db)
        lessons = skill_factory._extract_lessons_from_session(conn, "s1")
        conn.close()
        self.assertEqual(lessons, [])

    # --- _extract_lessons_from_session per-source except branches ---

    def test_extract_lessons_signals_except_surfaces_error(self):
        """signals query raising sqlite3.Error is surfaced and does not zero
        the tool_errors source."""
        conn = _FakeConn(
            raise_substring="FROM signals",
            rows_by_substring={
                "FROM runs": [(1,)],
            },
        )
        err = io.StringIO()
        with redirect_stderr(err):
            lessons = skill_factory._extract_lessons_from_session(conn, "s1")  # type: ignore[arg-type]
        stderr_text = err.getvalue()
        self.assertIn("signals", stderr_text.lower())
        self.assertIn("error", stderr_text.lower())
        self.assertEqual(lessons, [])

    def test_extract_lessons_tool_errors_except_surfaces_error(self):
        """tool_errors query raising sqlite3.Error is surfaced."""
        conn = _FakeConn(
            raise_substring="FROM tool_calls",
            rows_by_substring={
                "FROM runs": [(1,)],
            },
        )
        err = io.StringIO()
        with redirect_stderr(err):
            lessons = skill_factory._extract_lessons_from_session(conn, "s1")  # type: ignore[arg-type]
        stderr_text = err.getvalue()
        self.assertIn("tool_errors", stderr_text)
        self.assertIn("error", stderr_text.lower())
        self.assertEqual(lessons, [])

    # --- auto_create_from_session end-to-end ---

    def test_auto_create_uses_env_db_when_db_path_none(self):
        """When db_path is None, the ATLAS_DB env var supplies the path."""
        db = os.path.join(self.tmpdir, "env.db")
        _make_db(db)  # empty DB, no orchestrating runs
        os.environ["ATLAS_DB"] = db
        try:
            result = skill_factory.auto_create_from_session()
        finally:
            del os.environ["ATLAS_DB"]
        self.assertFalse(result["created"])
        self.assertEqual(result["reason"], "no orchestrating sessions found")

    def test_auto_create_no_orchestrating_sessions(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(db, runs=[(1, "s1", 0)])  # non-orchestrating run
        result = skill_factory.auto_create_from_session(db_path=db)
        self.assertFalse(result["created"])
        self.assertEqual(result["reason"], "no orchestrating sessions found")

    def test_auto_create_not_worthy(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            tool_calls=[(1, "s1", "Read", 0, "x")],  # only 1 tool -> not worthy
        )
        result = skill_factory.auto_create_from_session(db_path=db)
        self.assertFalse(result["created"])
        self.assertIn("tool calls", result["reason"])
        self.assertEqual(result["session_id"], "s1")

    def test_auto_create_no_lessons_extracted(self):
        """Worthy session (has an improvement) but the improvement note is
        empty, so no lessons are extracted."""
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "s1", 1)],
            tool_calls=[(i, "s1", "Read", 0, "x") for i in range(5)],
            improvements=[(1, 1, "speed", "slow", "fast", "")],  # empty note
        )
        result = skill_factory.auto_create_from_session(db_path=db)
        self.assertFalse(result["created"])
        self.assertEqual(result["reason"], "no lessons extracted")
        self.assertEqual(result["session_id"], "s1")

    def test_auto_create_success(self):
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(
            db,
            runs=[(1, "sess-abc1234567", 1)],
            tool_calls=[(i, "sess-abc1234567", "Read", 0, "x") for i in range(5)],
            improvements=[(1, 1, "speed", "slow", "fast", "be faster next time")],
        )
        result = skill_factory.auto_create_from_session(db_path=db)
        self.assertTrue(result["success"], f"expected success, got: {result}")
        self.assertEqual(result["session_id"], "sess-abc1234567")
        self.assertTrue(result["name"].startswith("learned-"))
        self.assertTrue(os.path.exists(result["path"]))
        self.assertGreater(len(result["lessons"]), 0)
        # The skill file should reference the source session.
        content = open(result["path"]).read()
        self.assertIn("sess-abc1234567", content)

    def test_auto_create_cannot_open_db(self):
        """sqlite3.connect raising yields 'cannot open atlas DB'."""
        db = os.path.join(self.tmpdir, "a.db")
        _make_db(db, runs=[(1, "s1", 1)])

        def boom(*a, **k):
            raise sqlite3.Error("nope")

        with mock.patch.object(skill_factory.sqlite3, "connect", boom):
            result = skill_factory.auto_create_from_session(db_path=db)
        self.assertFalse(result["created"])
        self.assertEqual(result["reason"], "cannot open atlas DB")

    # --- CLI entry ---

    def _run_cli(self, argv):
        """Invoke _cli with the given argv and capture stdout."""
        out = io.StringIO()
        with mock.patch.object(sys, "argv", argv), redirect_stdout(out):
            skill_factory._cli()
        return out.getvalue()

    def test_cli_no_args(self):
        out = self._run_cli(["skill_factory"])
        self.assertIn("Usage", out)

    def test_cli_auto(self):
        out = self._run_cli(["skill_factory", "auto"])
        # No DB present -> JSON with created=False.
        data = json.loads(out)
        self.assertFalse(data["created"])

    def test_cli_create_too_few_args(self):
        out = self._run_cli(["skill_factory", "create", "only-name"])
        self.assertIn("Usage", out)

    def test_cli_create_no_body_file(self):
        out = self._run_cli(["skill_factory", "create", "cli-skill", "a desc"])
        data = json.loads(out)
        self.assertTrue(data["success"])
        self.assertTrue(os.path.exists(data["path"]))

    def test_cli_create_with_body_file(self):
        body_path = os.path.join(self.tmpdir, "body.md")
        with open(body_path, "w") as f:
            f.write("## Body from file\n")
        out = self._run_cli(
            ["skill_factory", "create", "cli-skill-file", "a desc", body_path]
        )
        data = json.loads(out)
        self.assertTrue(data["success"])
        content = open(data["path"]).read()
        self.assertIn("Body from file", content)

    def test_cli_list(self):
        skill_factory.create_skill("alpha-skill", "a", "body")
        skill_factory.create_skill("beta-skill", "b", "body")
        out = self._run_cli(["skill_factory", "list"])
        names = [n for n in out.splitlines() if n]
        self.assertIn("alpha-skill", names)
        self.assertIn("beta-skill", names)
        # Listed in sorted order.
        self.assertEqual(names, sorted(names))

    def test_cli_unknown_command(self):
        out = self._run_cli(["skill_factory", "bogus"])
        self.assertIn("Unknown command: bogus", out)

    # --- Content-based dedup tests ---

    def test_content_similarity_identical(self):
        sim = skill_factory._content_similarity("hello world", "hello world")
        self.assertEqual(sim, 1.0)

    def test_content_similarity_unrelated(self):
        sim = skill_factory._content_similarity("alpha beta", "gamma delta")
        self.assertEqual(sim, 0.0)

    def test_content_similarity_partial(self):
        sim = skill_factory._content_similarity(
            "alpha beta gamma delta", "alpha beta epsilon zeta"
        )
        self.assertGreater(sim, 0.0)
        self.assertLess(sim, 1.0)

    def test_content_similarity_empty(self):
        self.assertEqual(skill_factory._content_similarity("", "text"), 0.0)
        self.assertEqual(skill_factory._content_similarity("text", ""), 0.0)

    def test_is_duplicate_skill_finds_match(self):
        # Create a skill, then check that similar content is detected as dup
        skill_factory.create_skill("learned-test-1", "test", "## Lesson\n\nAlways verify before claiming.")
        contents = skill_factory._existing_skill_contents()
        self.assertIn("learned-test-1", contents)
        dup = skill_factory._is_duplicate_skill(
            "## Lesson\n\nAlways verify before claiming.", contents
        )
        self.assertIsNotNone(dup)
        self.assertEqual(dup, "learned-test-1")

    def test_is_duplicate_skill_no_match(self):
        skill_factory.create_skill("learned-test-2", "test", "## Lesson\n\nAlways verify before claiming.")
        contents = skill_factory._existing_skill_contents()
        dup = skill_factory._is_duplicate_skill(
            "## Different Lesson\n\nNever use undefined variables in production code.", contents
        )
        self.assertIsNone(dup)

    def test_existing_skill_contents_only_auto(self):
        # Hand-written skills (no created_by: atlas-auto) should be excluded
        skills_dir = skill_factory._skills_dir()
        hand_dir = skills_dir / "hand-written-skill"
        hand_dir.mkdir(parents=True)
        (hand_dir / "SKILL.md").write_text(
            "---\nname: hand-written-skill\ndescription: \"manual\"\n---\n# hand-written-skill\n\nManual content.",
            encoding="utf-8",
        )
        contents = skill_factory._existing_skill_contents()
        self.assertNotIn("hand-written-skill", contents)


if __name__ == "__main__":
    unittest.main()
