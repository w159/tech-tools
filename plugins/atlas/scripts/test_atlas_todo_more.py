#!/usr/bin/env python3
"""atlas_todo: path claims, archive rotation, owner tokens, channel reaping/leave/brief."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import atlas_todo as T


class Project(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for k in ("ATLAS_PROJECT_ROOT", "ATLAS_LEAD_NAME", "ATLAS_WORKER_NAME", "ATLAS_CHANNEL"):
            os.environ.pop(k, None)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = os.path.realpath(self._tmp.name)
        os.makedirs(os.path.join(self.root, ".atlas", ".run"))


class PathConflictTest(unittest.TestCase):
    def test_overlap_is_equality_or_segment_prefix(self):
        c = T._path_conflict
        self.assertTrue(c("mod/a.py", "mod/a.py"))
        self.assertTrue(c("mod", "mod/a.py"))
        self.assertTrue(c("mod/a.py", "mod"))
        self.assertTrue(c("mod/", "mod/a.py"))
        self.assertTrue(c(" mod ", "mod"))
        self.assertFalse(c("mod/a", "mod/aa"))
        self.assertFalse(c("mod/aa", "mod/a"))
        self.assertFalse(c("", "mod"))
        self.assertFalse(c("mod", "  "))
        self.assertFalse(c("a/b", "c/d"))

    def test_claim_paths_arg_splits_commas_and_drops_blanks(self):
        self.assertEqual(T._claim_paths_arg(" a, b ,,c "), ["a", "b", "c"])
        self.assertEqual(T._claim_paths_arg(None), [])


class ClaimsTest(Project):
    def claims(self, **kw):
        return {c["owner"]: c["paths"] for c in T.active_claims(self.root, **kw)}

    def test_claim_requires_paths_and_posts_a_claim_note(self):
        self.assertEqual(T.claim_paths(self.root, "alice", ["", "  "]), {"ok": False, "error": "paths_required"})
        r = T.claim_paths(self.root, "alice", ["src/a.py", "docs"])
        self.assertTrue(r["ok"])
        self.assertEqual(r["paths"], ["src/a.py", "docs"])
        self.assertEqual((r["note"]["kind"], r["note"]["to"]), ("claim", "all"))
        self.assertEqual(r["note"]["text"], "claims: src/a.py, docs")
        self.assertEqual(r["note"]["paths"], ["src/a.py", "docs"])
        self.assertEqual(self.claims(), {"alice": ["src/a.py", "docs"]})

    def test_latest_claim_replaces_and_each_owner_has_own_claim_sorted(self):
        T.claim_paths(self.root, "bob", ["b"])
        T.claim_paths(self.root, "alice", ["a1"])
        T.claim_paths(self.root, "alice", ["a2"])
        got = T.active_claims(self.root)
        self.assertEqual([(c["owner"], c["paths"]) for c in got], [("alice", ["a2"]), ("bob", ["b"])])
        self.assertTrue(all(c["seq"] > 0 and c["ts"] for c in got))

    def test_release_named_paths_then_all(self):
        T.claim_paths(self.root, "alice", ["a", "b", "c"])
        r = T.release_paths(self.root, "alice", ["b", " "])
        self.assertTrue(r["ok"])
        self.assertEqual((r["note"]["kind"], r["note"]["text"]), ("release", "releases: b"))
        self.assertEqual(self.claims(), {"alice": ["a", "c"]})
        T.release_paths(self.root, "alice", ["a", "c"])
        self.assertEqual(self.claims(), {})
        T.claim_paths(self.root, "alice", ["x"])
        r = T.release_paths(self.root, "alice")
        self.assertEqual(r["note"]["text"], "releases: all")
        self.assertEqual(self.claims(), {})

    def test_release_without_a_claim_is_harmless(self):
        T.release_paths(self.root, "ghost", ["a"])
        self.assertEqual(self.claims(), {})

    def test_exit_report_drops_claim_but_plain_report_does_not(self):
        T.claim_paths(self.root, "alice", ["a"])
        T.claim_paths(self.root, "bob", ["b"])
        T.note(self.root, "alice", "progress so far", kind="report")
        self.assertEqual(set(self.claims()), {"alice", "bob"})
        T.note(self.root, "alice", "done\nexit 0", kind="report")
        T.note(self.root, "bob", "exit 0 is mentioned mid-line, exit 3", kind="note")
        self.assertEqual(set(self.claims()), {"bob"})

    def test_claims_are_scoped_to_channel(self):
        T.claim_paths(self.root, "alice", ["a"], channel="chan/one")
        T.claim_paths(self.root, "bob", ["b"], channel="chan/two")
        self.assertEqual(self.claims(channel="chan/one"), {"alice": ["a"]})
        self.assertEqual(self.claims(channel="chan/two"), {"bob": ["b"]})


class PathConflictsTest(Project):
    def test_requires_paths(self):
        self.assertEqual(
            T.path_conflicts(self.root, "me", [" ", ""]), {"ok": False, "error": "paths_required"}
        )

    def test_overlap_with_other_owner_reports_and_notifies_that_owner(self):
        T.claim_paths(self.root, "alice", ["src", "docs/x.md"])
        T.claim_paths(self.root, "me", ["mine"])
        r = T.path_conflicts(self.root, "me", ["src/a.py", "src/b.py", "other"])
        self.assertFalse(r["ok"])
        self.assertEqual(r["owner"], "me")
        self.assertEqual(r["paths"], ["src/a.py", "src/b.py", "other"])
        self.assertEqual(r["conflicts"], [{"owner": "alice", "paths": ["src/a.py", "src/b.py"]}])
        inbox = [n for n in T.notes(self.root, to="alice") if n.get("kind") == "conflict"]
        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]["owner"], "me")
        self.assertEqual(
            inbox[0]["text"], "conflict: me wants src/a.py, src/b.py which you claim"
        )

    def test_own_claim_never_conflicts_and_notify_false_posts_nothing(self):
        T.claim_paths(self.root, "me", ["src"])
        self.assertTrue(T.path_conflicts(self.root, "me", ["src/a.py"])["ok"])
        T.claim_paths(self.root, "alice", ["lib"])
        r = T.path_conflicts(self.root, "me", ["lib/z"], notify=False)
        self.assertFalse(r["ok"])
        self.assertEqual([n for n in T.notes(self.root) if n.get("kind") == "conflict"], [])

    def test_segment_boundary_is_respected_and_clear_result_is_ok(self):
        T.claim_paths(self.root, "alice", ["mod/a"])
        r = T.path_conflicts(self.root, "me", ["mod/aa"])
        self.assertEqual((r["ok"], r["conflicts"]), (True, []))

    def test_each_conflicting_owner_is_notified_once(self):
        T.claim_paths(self.root, "alice", ["x"])
        T.claim_paths(self.root, "bob", ["x/y"])
        r = T.path_conflicts(self.root, "me", ["x/y"])
        self.assertEqual([c["owner"] for c in r["conflicts"]], ["alice", "bob"])
        got = [n["to"] for n in T.notes(self.root) if n.get("kind") == "conflict"]
        self.assertEqual(sorted(got), ["alice", "bob"])


class NoteSeqTest(unittest.TestCase):
    def test_seq_coercion(self):
        self.assertEqual(T._note_seq({"seq": 7}), 7)
        self.assertEqual(T._note_seq({"seq": "12"}), 12)
        for bad in ({}, {"seq": None}, {"seq": 0}, {"seq": "x"}, {"seq": [1]}):
            self.assertEqual(T._note_seq(bad), 0, bad)
            self.assertIs(type(T._note_seq(bad)), int)

    def test_ts_key_coercion(self):
        self.assertEqual(T._note_ts_key({"ts": "2.5"}), 2.5)
        self.assertEqual(T._note_ts_key({"ts": "x"}), 0.0)
        self.assertEqual(T._note_ts_key({}), 0.0)


class RotateArchiveTest(Project):
    def put(self, items):
        board = T.load(self.root)
        board["items"] = items
        T.save(self.root, board)

    def test_returns_zero_when_nothing_old_and_leaves_board_alone(self):
        now = time.time()
        self.put(
            [
                {"id": "a", "archived": True, "archived_at": now - 10},
                {"id": "b", "archived": False, "updated_at": now - 99 * 86400},
            ]
        )
        self.assertEqual(T.rotate_archive(self.root), 0)
        self.assertEqual([i["id"] for i in T.load(self.root)["items"]], ["a", "b"])
        self.assertFalse((Path(T.board_path(self.root)).parent / "archive").exists())

    def test_moves_old_archived_items_to_month_files_and_returns_count(self):
        now = time.time()
        old = now - 30 * 86400
        self.put(
            [
                {"id": "old1", "archived": True, "archived_at": old},
                {"id": "old2", "archived": True, "updated_at": old},
                {"id": "fresh", "archived": True, "archived_at": now - 60},
                {"id": "live", "archived": False, "updated_at": old},
            ]
        )
        self.assertEqual(T.rotate_archive(self.root), 2)
        self.assertEqual([i["id"] for i in T.load(self.root)["items"]], ["fresh", "live"])
        month = time.strftime("%Y-%m", time.localtime(old))
        f = Path(T.board_path(self.root)).parent / "archive" / f"todos-{month}.jsonl"
        self.assertEqual([json.loads(x)["id"] for x in f.read_text().splitlines()], ["old1", "old2"])

    def test_custom_max_age(self):
        now = time.time()
        self.put([{"id": "a", "archived": True, "archived_at": now - 100}])
        self.assertEqual(T.rotate_archive(self.root, max_age_s=1000), 0)
        self.assertEqual(T.rotate_archive(self.root, max_age_s=50), 1)


class OwnerTokenTest(Project):
    def test_issue_marks_owner_and_token_verifies_only_for_that_owner(self):
        self.assertFalse(T.owner_token_issued(self.root, "alice"))
        tok = T.issue_owner_token(self.root, "alice")
        self.assertRegex(tok, r"^[0-9a-f]{64}$")
        self.assertTrue(T.owner_token_issued(self.root, "alice"))
        self.assertFalse(T.owner_token_issued(self.root, "bob"))
        self.assertTrue(T.verify_owner_token(self.root, "alice", tok))
        self.assertFalse(T.verify_owner_token(self.root, "bob", tok))
        self.assertFalse(T.verify_owner_token(self.root, "alice", tok[:-1] + ("0" if tok[-1] != "0" else "1")))
        self.assertFalse(T.verify_owner_token(self.root, "alice", ""))
        self.assertFalse(T.verify_owner_token(self.root, "alice", None))

    def test_token_is_stable_and_secret_file_is_private(self):
        t1 = T.issue_owner_token(self.root, "alice")
        self.assertEqual(T.issue_owner_token(self.root, "alice"), t1)
        secret = Path(self.root, ".atlas", ".run", T.OWNER_SECRET_FILE)
        self.assertEqual(secret.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(secret.read_bytes()), 32)
        marker = Path(self.root, ".atlas", ".run", T.OWNER_ISSUED_DIR, "alice")
        self.assertEqual(marker.read_text(), "")
        self.assertNotIn(t1, marker.read_text())

    def test_owner_names_are_sanitized_before_verification(self):
        tok = T.issue_owner_token(self.root, "a/b")
        self.assertTrue(T.verify_owner_token(self.root, "a/b", tok))
        self.assertTrue(T.owner_token_issued(self.root, "a/b"))


class PsTableTest(unittest.TestCase):
    def test_runs_ps_with_the_bound_real_runner(self):
        with mock.patch.object(T, "_PS_RUN", return_value="sentinel") as run:
            self.assertEqual(T._ps_ancestor_table(), "sentinel")
        args, kw = run.call_args
        self.assertEqual(args, (["ps", "-A", "-o", "pid=,ppid=,comm="],))
        self.assertEqual((kw["capture_output"], kw["text"], kw["timeout"]), (True, True, 2))

    def test_real_ps_lists_this_process(self):
        try:
            r = T._ps_ancestor_table()
        except (OSError, subprocess.SubprocessError):
            self.skipTest("ps not available")
        if r.returncode != 0:
            self.skipTest("ps refused")
        pids = {ln.split()[0] for ln in r.stdout.splitlines() if ln.split()}
        self.assertIn(str(os.getpid()), pids)


class ChannelTest(Project):
    def setUp(self):
        super().setUp()
        T.ensure_main(self.root)
        self.chan = T.open_lead_channel(self.root, "lead-a1", ["w1"])["name"]

    def test_leave_removes_unfinished_member_and_remembers_it_as_departed(self):
        T.join(self.root, self.chan, "w2")
        out = T.leave(self.root, self.chan, "w2")
        self.assertNotIn("w2", [m["name"] for m in out["members"]])
        self.assertEqual(out["departed"]["w2"]["name"], "w2")
        self.assertIn("w1", [m["name"] for m in out["members"]])

    def test_leave_keeps_a_finished_member_and_does_not_mark_it_departed(self):
        T.join(self.root, self.chan, "w3")
        T.mark_finished(self.root, "w3", 0)
        out = T.leave(self.root, self.chan, "w3")
        self.assertIn("w3", [m["name"] for m in out["members"]])
        self.assertNotIn("w3", out.get("departed", {}))

    def test_leave_unknown_channel_is_none(self):
        self.assertIsNone(T.leave(self.root, "nope/none", "w1"))

    def test_channel_brief_lists_siblings_excluding_self_and_lead(self):
        T.join(self.root, self.chan, "w2")
        brief = T.channel_brief(self.root, self.chan, "lead-a1", "w1")
        self.assertIn(f"CHANNEL: {self.chan} (you are w1; lead lead-a1; siblings: w2).", brief)
        self.assertIn(f'--owner w1', brief)
        self.assertNotIn("siblings: w1", brief)

    def test_channel_brief_for_unknown_channel_has_no_siblings(self):
        brief = T.channel_brief(self.root, "nope", "lead-a1", "w1")
        self.assertIn("siblings: none yet", brief)

    def test_member_board_item_comes_from_agent_id_registration(self):
        self.assertIsNone(T.member_board_item(self.root, "w1"))
        self.assertEqual(T.set_member_agent_id(self.root, "w1", "agent-9", "item-42"), 1)
        self.assertEqual(T.member_board_item(self.root, "w1"), "item-42")
        self.assertIsNone(T.member_board_item(self.root, "nobody"))
        T.set_member_agent_id(self.root, "w1", "agent-10")  # no item: keeps the old one
        self.assertEqual(T.member_board_item(self.root, "w1"), "item-42")

    def test_item_counts_counts_each_status_and_normalises_unknown(self):
        items = [
            {"status": "pending"}, {"status": "pending"}, {"status": "in_progress"},
            {"status": "completed"}, {"status": "blocked"}, {"status": "weird"}, {},
        ]
        self.assertEqual(
            T._item_counts(items),
            {"pending": 4, "in_progress": 1, "completed": 1, "blocked": 1},
        )
        self.assertEqual(T._item_counts([]), {s: 0 for s in T.STATUSES})


class ReapTest(Project):
    NOW = 1_000_000_000.0

    def setUp(self):
        super().setUp()
        T.ensure_main(self.root)

    def make_lead(self, lead="lead-a1", idle=0.0, member=None):
        T.open_lead_channel(self.root, lead, [])

        def fn(reg):
            for c in reg["channels"].values():
                if c.get("lead") == lead:
                    c["last_activity"] = self.NOW - idle
                    c["members"] = [member or {"name": lead, "role": "lead"}]
            return None

        T._reg_update(self.root, fn)
        return lambda: [n for n, c in T._reg_read(self.root)["channels"].items() if c.get("kind") == "lead"]

    def reap(self, **kw):
        return T.reap_channels(self.root, now=self.NOW, **kw)

    def test_default_lead_idle_ttl_is_two_hours(self):
        self.assertEqual(T.LEAD_IDLE_TTL_S, 7200)
        leads = self.make_lead(idle=7200 + 60)
        self.assertEqual(self.reap(dry_run=True)["would_reap"], 1)
        self.assertEqual(len(leads()), 1)
        self.assertEqual(self.reap()["reaped"], 1)
        self.assertEqual(leads(), [])

    def test_lead_idle_just_under_ttl_survives(self):
        leads = self.make_lead(idle=7200 - 60)
        self.assertEqual(self.reap()["reaped"], 0)
        self.assertEqual(len(leads()), 1)

    def test_env_overrides_lead_idle_ttl_and_bad_value_falls_back(self):
        leads = self.make_lead(idle=600)
        with mock.patch.dict(os.environ, {"ATLAS_LEAD_IDLE_TTL": "300"}):
            self.assertEqual(self.reap(dry_run=True)["would_reap"], 1)
        with mock.patch.dict(os.environ, {"ATLAS_LEAD_IDLE_TTL": "junk"}):
            self.assertEqual(self.reap()["reaped"], 0)
        self.assertEqual(len(leads()), 1)

    def test_live_pane_keeps_channel_and_probe_error_counts_as_not_live(self):
        member = {"name": "seat", "role": "subagent", "pane_id": "%7"}
        leads = self.make_lead(idle=99999, member=member)
        seen = []
        self.assertEqual(self.reap(pane_live=lambda p: seen.append(p) or True)["reaped"], 0)
        self.assertEqual(seen, ["%7"])
        self.assertEqual(len(leads()), 1)

        def boom(_p):
            raise RuntimeError("tmux gone")

        self.assertEqual(self.reap(pane_live=boom)["reaped"], 1)
        self.assertEqual(leads(), [])

    def test_member_without_pane_is_not_live(self):
        leads = self.make_lead(idle=99999, member={"name": "seat", "role": "subagent"})
        calls = []
        self.assertEqual(self.reap(pane_live=lambda p: calls.append(p) or True)["reaped"], 1)
        self.assertEqual(calls, [])
        self.assertEqual(leads(), [])

    def test_finished_member_channel_is_reaped_regardless_of_idle(self):
        leads = self.make_lead(idle=0, member={"name": "w", "role": "subagent", "exit_code": 0})
        self.assertEqual(self.reap()["reaped"], 1)
        self.assertEqual(leads(), [])

    def test_keep_protects_named_lead_and_archive_line_is_written_first(self):
        leads = self.make_lead(lead="lead-a1", idle=99999)
        self.assertEqual(self.reap(keep="lead-a1")["reaped"], 0)
        self.assertEqual(len(leads()), 1)
        out = self.reap()
        self.assertEqual(out["reaped"], 1)
        arch = Path(out["archived_path"])
        self.assertTrue(arch.name.startswith("channels-"))
        rows = [json.loads(x) for x in arch.read_text().splitlines()]
        self.assertEqual([r["lead"] for r in rows], ["lead-a1"])
        self.assertEqual(out["kept"], 1)  # main channel remains


if __name__ == "__main__":
    unittest.main()
