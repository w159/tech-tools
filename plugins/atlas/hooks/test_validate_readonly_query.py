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


if __name__ == "__main__":
    unittest.main()
