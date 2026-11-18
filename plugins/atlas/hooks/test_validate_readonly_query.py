import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import subprocess
import unittest

# validate-readonly-query.sh is the only bash hook; invoke it through bash so the
# test does not depend on the execute bit being set in every environment.
HOOK = os.path.join(os.path.dirname(__file__), "validate-readonly-query.sh")


def run_hook(payload):
    """Pipe a Claude Code PreToolUse payload into the hook and return the CompletedProcess."""
    return subprocess.run(
        ["bash", HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )


def payload(command):
    return {"tool_input": {"command": command}}


class ValidateReadonlyQueryTest(unittest.TestCase):
    """Security gate: a regex regression here silently lets writes through."""

    # --- reads and benign shell usage must pass (exit 0) ---

    def test_select_passes(self):
        self.assertEqual(run_hook(payload("SELECT * FROM users")).returncode, 0)

    def test_select_with_write_like_column_names_passes(self):
        # Word boundaries keep column names (updated_at, create_time) from tripping the guard.
        self.assertEqual(
            run_hook(payload("SELECT updated_at, create_time FROM t")).returncode, 0
        )

    def test_explain_analyze_passes(self):
        self.assertEqual(
            run_hook(payload("EXPLAIN ANALYZE SELECT count(*) FROM orders")).returncode,
            0,
        )

    def test_empty_command_passes(self):
        self.assertEqual(run_hook({"tool_input": {}}).returncode, 0)

    def test_missing_command_key_passes(self):
        self.assertEqual(run_hook({}).returncode, 0)

    def test_garbage_stdin_fails_open(self):
        # Non-JSON stdin must not crash the guard; jq yields empty, hook exits 0.
        p = subprocess.run(
            ["bash", HOOK], input="not json at all", capture_output=True, text=True
        )
        self.assertEqual(p.returncode, 0)

    # --- documented false-negative pass-throughs ---

    def test_find_delete_passes(self):
        self.assertEqual(run_hook(payload("find . -delete")).returncode, 0)

    def test_str_replace_passes(self):
        self.assertEqual(run_hook(payload("str.replace(old, new)")).returncode, 0)

    def test_create_a_file_phrase_passes(self):
        self.assertEqual(
            run_hook(payload("create a file called foo.txt")).returncode, 0
        )

    def test_git_update_index_passes(self):
        self.assertEqual(run_hook(payload("git update-index --refresh")).returncode, 0)

    def test_revoke_meeting_access_passes(self):
        self.assertEqual(run_hook(payload("revoke_meeting_access")).returncode, 0)

    # --- each blocked verb exits 2 ---

    def test_delete_from_blocked(self):
        self.assertEqual(
            run_hook(payload("DELETE FROM users WHERE id=1")).returncode, 2
        )

    def test_insert_into_blocked(self):
        self.assertEqual(run_hook(payload("INSERT INTO t VALUES (1)")).returncode, 2)

    def test_replace_into_blocked(self):
        self.assertEqual(run_hook(payload("REPLACE INTO t VALUES (1)")).returncode, 2)

    def test_merge_into_blocked(self):
        self.assertEqual(
            run_hook(payload("MERGE INTO t USING s ON t.id = s.id")).returncode, 2
        )

    def test_update_set_blocked(self):
        self.assertEqual(
            run_hook(payload("UPDATE users SET name = 'x' WHERE id = 1")).returncode, 2
        )

    def test_truncate_table_blocked(self):
        self.assertEqual(run_hook(payload("TRUNCATE TABLE foo")).returncode, 2)

    def test_truncate_without_table_blocked(self):
        self.assertEqual(run_hook(payload("truncate foo")).returncode, 2)

    def test_drop_table_blocked(self):
        self.assertEqual(run_hook(payload("DROP TABLE users")).returncode, 2)

    def test_drop_database_blocked(self):
        self.assertEqual(run_hook(payload("DROP DATABASE prod")).returncode, 2)

    def test_create_table_blocked(self):
        self.assertEqual(run_hook(payload("CREATE TABLE t (id INT)")).returncode, 2)

    def test_create_index_blocked(self):
        self.assertEqual(run_hook(payload("CREATE INDEX i ON t (c)")).returncode, 2)

    def test_alter_table_blocked(self):
        self.assertEqual(
            run_hook(payload("ALTER TABLE t ADD COLUMN c INT")).returncode, 2
        )

    def test_alter_view_blocked(self):
        self.assertEqual(run_hook(payload("ALTER VIEW v AS SELECT 1")).returncode, 2)

    def test_grant_blocked(self):
        self.assertEqual(
            run_hook(payload("GRANT SELECT ON db.* TO 'reader'")).returncode, 2
        )

    def test_revoke_blocked(self):
        self.assertEqual(
            run_hook(payload("REVOKE SELECT ON db.* FROM 'reader'")).returncode, 2
        )

    def test_copy_from_blocked(self):
        self.assertEqual(run_hook(payload("COPY tbl FROM '/tmp/x.csv'")).returncode, 2)

    def test_copy_to_blocked(self):
        self.assertEqual(run_hook(payload("COPY tbl TO '/tmp/x.csv'")).returncode, 2)

    # --- CREATE modifiers (OR REPLACE / TEMP / UNLOGGED) and comment-interleaved writes ---

    def test_create_or_replace_function_blocked(self):
        self.assertEqual(
            run_hook(payload("CREATE OR REPLACE FUNCTION foo() RETURNS int AS $$ begin end $$ language plpgsql")).returncode,
            2,
        )

    def test_create_temporary_table_blocked(self):
        self.assertEqual(
            run_hook(payload("CREATE TEMPORARY TABLE foo (id int)")).returncode, 2
        )

    def test_create_temp_table_blocked(self):
        self.assertEqual(
            run_hook(payload("CREATE TEMP TABLE foo (id int)")).returncode, 2
        )

    def test_create_unlogged_table_blocked(self):
        self.assertEqual(
            run_hook(payload("CREATE UNLOGGED TABLE foo (id int)")).returncode, 2
        )

    def test_create_or_replace_view_blocked(self):
        self.assertEqual(
            run_hook(payload("CREATE OR REPLACE VIEW v AS SELECT 1")).returncode, 2
        )

    def test_create_aggregate_blocked(self):
        self.assertEqual(
            run_hook(payload("CREATE AGGREGATE myagg (int) (SFUNC = s, STYPE = int)")).returncode,
            2,
        )

    def test_update_block_comment_interleaved_blocked(self):
        # /* */ between verb, table, and SET must not hide the write.
        self.assertEqual(
            run_hook(payload("UPDATE/**/users/**/SET name = 'x'")).returncode, 2
        )

    def test_delete_block_comment_interleaved_blocked(self):
        self.assertEqual(
            run_hook(payload("DELETE/**/FROM users")).returncode, 2
        )

    def test_insert_block_comment_interleaved_blocked(self):
        self.assertEqual(
            run_hook(payload("INSERT/**/INTO t VALUES (1)")).returncode, 2
        )

    # --- write verbs missed by the first pass ---

    def test_more_write_forms_blocked(self):
        for cmd in [
            "UPDATE public.users AS u SET name = 'x'",
            "DELETE users",
            "DROP TYPE mood",
            "DROP OWNED BY joe",
            "CALL purge_all()",
            "VACUUM FULL",
            "REINDEX DATABASE prod",
            "EXEC sp_executesql N'DROP PROCEDURE p'",
        ]:
            with self.subTest(cmd=cmd):
                self.assertEqual(run_hook(payload(cmd)).returncode, 2)

    def test_read_forms_still_pass(self):
        for cmd in [
            "WITH x AS (SELECT 1) SELECT * FROM x",
            "SELECT call_count, vacuum_count FROM stats",
            "SELECT * FROM calls WHERE type = 'drop'",
            "EXPLAIN SELECT 1",
            "git branch --delete feature",
        ]:
            with self.subTest(cmd=cmd):
                self.assertEqual(run_hook(payload(cmd)).returncode, 0)

    # --- case-insensitive ---

    def test_lowercase_insert_blocked(self):
        self.assertEqual(run_hook(payload("insert into t values (1)")).returncode, 2)

    def test_lowercase_update_set_blocked(self):
        self.assertEqual(
            run_hook(payload("update t set x = 1 where id = 2")).returncode, 2
        )

    def test_lowercase_grant_blocked(self):
        self.assertEqual(run_hook(payload("grant all on schema x to y")).returncode, 2)

    def test_lowercase_revoke_blocked(self):
        self.assertEqual(
            run_hook(payload("revoke select on db.* from x")).returncode, 2
        )

    def test_mixed_case_drop_blocked(self):
        self.assertEqual(run_hook(payload("drop table users")).returncode, 2)

    # --- multi-statement and newline-split SQL must be caught ---

    def test_multi_statement_drop_blocked(self):
        self.assertEqual(run_hook(payload("SELECT 1; DROP TABLE users")).returncode, 2)

    def test_newline_split_grant_blocked(self):
        # JSON "\n" decodes to a real newline; grep still catches the GRANT line.
        self.assertEqual(
            run_hook(payload("SELECT 1;\nGRANT SELECT ON db.* TO 'x'")).returncode, 2
        )

    def test_newline_split_delete_blocked(self):
        self.assertEqual(
            run_hook(payload("-- comment\nDELETE FROM users")).returncode, 2
        )

    # --- tokens of a single pattern split across a newline must be caught ---
    # grep is line-based, so [[:space:]]+ cannot span a newline; the hook
    # collapses newlines to spaces before matching. These split each blocked
    # pattern's own tokens across a newline (the evasion the earlier
    # newline-split tests do NOT exercise).

    def test_newline_split_delete_from_tokens_blocked(self):
        self.assertEqual(
            run_hook(payload("DELETE\nFROM users WHERE id=1")).returncode, 2
        )

    def test_newline_split_insert_into_tokens_blocked(self):
        self.assertEqual(
            run_hook(payload("INSERT\nINTO users VALUES (1)")).returncode, 2
        )

    def test_newline_split_update_set_tokens_blocked(self):
        self.assertEqual(
            run_hook(payload("UPDATE users\nSET password = 'x'\nWHERE id = 1")).returncode,
            2,
        )

    def test_newline_split_drop_table_tokens_blocked(self):
        self.assertEqual(
            run_hook(payload("DROP\nTABLE users")).returncode, 2
        )

    def test_newline_split_grant_on_tokens_blocked(self):
        self.assertEqual(
            run_hook(payload("GRANT SELECT\nON db.* TO 'x'")).returncode, 2
        )

    def test_newline_split_merge_into_tokens_blocked(self):
        self.assertEqual(
            run_hook(payload("MERGE\nINTO t USING s ON t.id = s.id")).returncode, 2
        )
    # --- blocked output is on stderr and carries the documented message ---

    def test_blocked_message_on_stderr(self):
        p = run_hook(payload("DELETE FROM users"))
        self.assertEqual(p.returncode, 2)
        self.assertIn("Blocked", p.stderr)
        self.assertIn("read-only", p.stderr)


class ValidateReadonlyBypassTest(unittest.TestCase):
    def test_write_after_dashes_inside_quoted_sql_blocked(self):
        # `--` inside a quoted string is not a comment to the shell; the stripped
        # text would lose the DROP, the raw text must still be checked.
        p = run_hook(payload("psql -c 'SELECT 1 -- x'; DROP TABLE users"))
        self.assertEqual(p.returncode, 2)

    def test_write_after_dashes_on_same_line_blocked(self):
        p = run_hook(payload("psql -c \"SELECT '--'\"; psql -c 'DELETE FROM t'"))
        self.assertEqual(p.returncode, 2)

    def test_select_with_trailing_comment_still_passes(self):
        self.assertEqual(run_hook(payload("SELECT 1 -- just a note")).returncode, 0)

    def test_select_with_block_comment_passes(self):
        self.assertEqual(run_hook(payload("SELECT /* hi */ 1")).returncode, 0)

    def _run_without(self, missing):
        import shutil
        import tempfile

        shim = tempfile.mkdtemp()
        for tool in ("cat", "tr", "grep", "jq", "perl"):
            if tool == missing:
                continue
            src = shutil.which(tool)
            if src:
                os.symlink(src, os.path.join(shim, tool))
        return subprocess.run(
            ["/bin/bash", HOOK],
            input=json.dumps(payload("SELECT 1")),
            capture_output=True,
            text=True,
            env={"PATH": shim},
        )

    def test_missing_jq_fails_closed(self):
        p = self._run_without("jq")
        self.assertEqual(p.returncode, 2)
        self.assertIn("jq", p.stderr)

    def test_missing_perl_fails_closed(self):
        p = self._run_without("perl")
        self.assertEqual(p.returncode, 2)
        self.assertIn("perl", p.stderr)


class StateChangingStatementsTest(unittest.TestCase):
    """X6: statements that change server or data state without matching the DML/DDL structure list."""

    BLOCKED = (
        "psql -c \"ALTER SYSTEM SET work_mem='1GB'\"",
        "psql -c 'alter   system reset all'",
        "psql -c \"DO \\$\\$ BEGIN PERFORM 1; END \\$\\$\"",
        "psql -c 'DO $$ BEGIN PERFORM 1; END $$'",
        "psql -c \"do language plpgsql 'begin null; end'\"",
        "psql -c \"DO 'BEGIN PERFORM 1; END'\"",
        "psql -c 'SELECT pg_terminate_backend(123)'",
        "psql -c 'SELECT pg_cancel_backend(pid) FROM pg_stat_activity'",
        "psql -c \"SELECT dblink_exec('dbname=x','drop table t')\"",
        "psql -c \"SELECT * FROM dblink('dbname=x','insert into t values (1) returning 1') AS r(a int)\"",
        "psql -c 'SELECT pg_reload_conf()'",
        "psql -c 'SELECT pg_switch_wal()'",
        "psql -c 'SELECT pg_promote()'",
        "psql -c \"SELECT pg_drop_replication_slot('s')\"",
        "psql -c \"SELECT set_config('default_transaction_read_only','off',false)\"",
        "psql -c \"SELECT lo_import('/etc/passwd')\"",
        "psql -c 'SELECT lo_unlink(1234)'",
        "psql -c \"SELECT nextval('s')\"",
        "psql -c \"SELECT setval('s', 1)\"",
        "psql -c 'SELECT * INTO newt FROM t'",
        "psql -c 'SET ROLE postgres'",
        "psql -c 'SET SESSION AUTHORIZATION postgres'",
        "psql -c 'SET default_transaction_read_only = off'",
        "psql -c 'BEGIN READ WRITE'",
        "psql -c 'LOCK TABLE t'",
        "psql -c \"COMMENT ON TABLE t IS 'x'\"",
        "psql -c 'REFRESH MATERIALIZED VIEW v'",
        "psql -c 'IMPORT FOREIGN SCHEMA s FROM SERVER x INTO y'",
        "psql -c \"CREATE SUBSCRIPTION s CONNECTION 'x' PUBLICATION p\"",
        "psql -c 'ALTER TYPE t ADD VALUE x'",
        "psql -c 'CREATE TYPE ty AS ENUM (x)'",
        "psql -c 'CREATE SERVER s FOREIGN DATA WRAPPER w'",
        "psql -c 'CREATE EVENT TRIGGER e'",
        "psql -c 'ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO x'",
        "mysql -e 'SET GLOBAL read_only=0'",
        "mysql -e 'LOAD DATA INFILE \"/tmp/x\" INTO TABLE t'",
        "mysql -e 'SELECT 1 INTO OUTFILE \"/tmp/x\"'",
        "sqlite3 db 'ATTACH DATABASE \"x\" AS y'",
        "sqlite3 db 'PRAGMA writable_schema=1'",
        "sqlite3 db 'VACUUM INTO \"/tmp/x\"'",
        # hidden in a comment-stripped or multi-line form
        "psql -c 'ALTER/**/SYSTEM SET x=1'",
        "psql <<SQL\nALTER\nSYSTEM SET x=1;\nSQL",
    )
    PASSES = (
        "psql -c 'SELECT state, count(*) FROM pg_stat_activity GROUP BY state'",
        "psql -c 'SELECT pg_is_in_recovery()'",
        "psql -c \"SELECT current_setting('work_mem')\"",
        "psql -c 'SELECT nextval_count, set_config_name FROM audit_log'",
        "psql -c \"SELECT 'do it' AS verb, 1 AS do_flag\"",
        "psql -c 'SELECT pg_size_pretty(pg_database_size(current_database()))'",
        "for f in a b; do psql -c 'SELECT 1'; done",
        "while read l; do echo $l; done < ids.txt",
        "psql -c 'EXPLAIN SELECT * FROM t'",
        "psql -c 'SHOW work_mem'",
        "psql -c 'SELECT * FROM pg_locks'",
        "systemd-notify --ready",
        "docker attach web",
    )

    def test_state_changing_statements_blocked(self):
        for cmd in self.BLOCKED:
            with self.subTest(cmd=cmd):
                p = run_hook(payload(cmd))
                self.assertEqual(p.returncode, 2, p.stderr)
                self.assertIn("Blocked", p.stderr)

    def test_read_only_lookalikes_pass(self):
        for cmd in self.PASSES:
            with self.subTest(cmd=cmd):
                self.assertEqual(run_hook(payload(cmd)).returncode, 0)


if __name__ == "__main__":
    unittest.main()
