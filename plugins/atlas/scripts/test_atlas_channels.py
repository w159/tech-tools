#!/usr/bin/env python3
"""End-to-end tests for the IRC channel model (atlas_todo channels + worker_inbox)."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import concurrent.futures
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import atlas_todo as todo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "hooks"))
import worker_inbox  # noqa: E402


def git(cwd, *args):
    subprocess.run(
        ["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", *args],
        check=True,
        capture_output=True,
    )


def cli(*argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = todo._cli(list(argv))
    return rc, json.loads(buf.getvalue())


class ChannelModel(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for k in (
            "ATLAS_CHANNELS",  # test_dispatch_tripwire sets it process-wide
            "ATLAS_CHANNEL",
            "ATLAS_LEAD_NAME",
            "ATLAS_WORKER_NAME",
            "ATLAS_PROJECT_ROOT",
        ):
            os.environ.pop(k, None)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = os.path.realpath(self._tmp.name)
        git(self.root, "init", "-q", "-b", "feature/x")
        git(self.root, "commit", "-q", "--allow-empty", "-m", "i")
        self.main = f"{os.path.basename(self.root)}@feature/x"

    def drain(self, name, **kw):
        return worker_inbox.drain(self.root, name, **kw)

    def test_mark_finished_works_in_either_order_with_leave(self):
        chan = todo.open_lead_channel(self.root, "L", ["A", "B"])["name"]
        todo.leave(self.root, chan, "A")
        self.assertEqual(todo.mark_finished(self.root, "A", 3), 1)
        todo.mark_finished(self.root, "B", 0)
        todo.leave(self.root, chan, "B")
        members = todo._reg_read(self.root)["channels"][chan]["members"]
        by = {m["name"]: m for m in members}
        self.assertEqual((by["A"]["exit_code"], by["B"]["exit_code"]), (3, 0))
        self.assertTrue(by["A"]["ended_at"] and by["B"]["ended_at"])

    def test_respawn_under_a_finished_name_revives_it_and_drops_stale_handles(self):
        chan = todo.open_lead_channel(self.root, "lead-abc123", ["w1"])["name"]
        todo.set_member_handles(self.root, "w1", chan, pid=111, pane_id="p-old")
        todo.mark_finished(self.root, "w1", 1)
        todo.leave(self.root, chan, "w1")
        todo.open_lead_channel(self.root, "lead-abc123", ["w1"])  # idempotent re-open
        m = {x["name"]: x for x in todo.get_channel(self.root, chan)["members"]}["w1"]
        self.assertEqual(m["exit_code"], 1)  # a plain re-open does not revive
        todo.register_member(self.root, "w1", chan)
        m = {x["name"]: x for x in todo.get_channel(self.root, chan)["members"]}["w1"]
        for key in ("exit_code", "ended_at", "pid", "pane_id"):
            self.assertNotIn(key, m)
        self.assertEqual(todo.set_member_handles(self.root, "w1", chan, pid=222), 1)
        self.assertEqual(todo.set_member_handles(self.root, "ghost", pid=1), 0)

    def test_main_channel_branch_detached_and_non_git(self):
        self.assertEqual(todo.main_channel(self.root), self.main)
        git(self.root, "checkout", "-q", "--detach")
        sha = subprocess.run(
            ["git", "-C", self.root, "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(
            todo.main_channel(self.root), f"{os.path.basename(self.root)}@{sha}"
        )
        with tempfile.TemporaryDirectory() as plain:
            self.assertEqual(
                todo.main_channel(plain), os.path.basename(os.path.realpath(plain))
            )
            todo.note(plain, "a", "hi", to="all")  # non-git project works
            self.assertEqual(len(todo.notes(plain)), 1)

    def test_lead_dispatch_subchannel_and_isolated_delivery(self):
        chan = todo.open_lead_channel(self.root, "L", ["A", "B", "C"])
        self.assertEqual(chan["name"], f"{self.main}/L")
        self.assertEqual(chan["parent"], self.main)
        self.assertEqual(
            [(m["name"], m["role"], m["parent"]) for m in chan["members"]],
            [
                ("L", "lead", None),
                ("A", "subagent", "L"),
                ("B", "subagent", "L"),
                ("C", "subagent", "L"),
            ],
        )
        # idempotent
        again = todo.open_lead_channel(self.root, "L", ["A", "B", "C"])
        self.assertEqual(len(again["members"]), 4)
        tree = todo.channels(self.root)
        self.assertEqual(len(tree), 1)
        self.assertEqual([c["name"] for c in tree[0]["children"]], [chan["name"]])
        self.assertIn("L", [m["name"] for m in tree[0]["members"]])

        # a subagent posts into its lead's subchannel by default
        rec = todo.note(self.root, "A", "to B", to="B")
        self.assertEqual(rec["channel"], chan["name"])
        got = self.drain("B")
        self.assertIn("to B", got)
        self.assertEqual(self.drain("B"), "")  # exactly once
        self.assertEqual(self.drain("C"), "")  # sibling not addressed
        self.assertEqual(self.drain("A"), "")  # not its own note

        # broadcast reaches B and C only (and the lead), never the sender
        todo.note(self.root, "A", "all hands", to="all", channel=chan["name"])
        self.assertIn("all hands", self.drain("B"))
        self.assertIn("all hands", self.drain("C"))
        self.assertEqual(self.drain("A"), "")
        self.assertIn("all hands", self.drain("L"))

        # the lead sees subagent replies addressed to `lead`
        todo.note(self.root, "B", "done", to="lead")
        self.assertIn("done", self.drain("L", aliases=("lead",)))

        # a non-member never sees channel traffic
        self.assertEqual(self.drain("outsider"), "")

    def test_other_lead_and_other_branch_isolated(self):
        todo.open_lead_channel(self.root, "L", ["A", "B"])
        todo.open_lead_channel(self.root, "M", ["X"])
        todo.note(self.root, "A", "L only", to="all", channel=f"{self.main}/L")
        self.assertEqual(self.drain("X"), "")
        self.assertIn("L only", self.drain("B"))
        # branch switch: different main channel, notes isolated
        git(self.root, "checkout", "-q", "-b", "other")
        main2 = f"{os.path.basename(self.root)}@other"
        self.assertEqual(todo.main_channel(self.root), main2)
        todo.note(self.root, "p", "main2 note", to="q", channel=main2)
        self.assertEqual(
            todo.notes(self.root, channel=f"{self.main}/L")[-1]["text"], "L only"
        )
        self.assertEqual(
            [r["text"] for r in todo.notes(self.root, channel=main2)], ["main2 note"]
        )
        # a worker of the old branch's subchannel gets nothing from the new main
        self.assertEqual(self.drain("B"), "")

    def test_parallel_writers_lose_nothing(self):
        todo.open_lead_channel(self.root, "L", ["w0"])

        def write(i):
            for j in range(10):
                todo.note(self.root, f"w{i}", f"m{i}-{j}", to="all")

        with concurrent.futures.ThreadPoolExecutor(8) as ex:
            list(ex.map(write, range(8)))
        recs = todo.notes(self.root)
        self.assertEqual(len(recs), 80)
        self.assertEqual(len({r["seq"] for r in recs}), 80)

    def test_channel_board_groups_todos_by_member(self):
        chan = todo.open_lead_channel(self.root, "L", ["A", "B"])
        a = todo.add(self.root, "item a")
        b = todo.add(self.root, "item b")
        todo.claim(self.root, a["item"]["id"], "A")
        todo.claim(self.root, b["item"]["id"], "B")
        todo.set_status(
            self.root, b["item"]["id"], "completed", owner="B", evidence="ok"
        )
        todo.note(self.root, "A", "working", channel=chan["name"])
        rc, out = cli("channel-board", chan["name"], "--root", self.root)
        self.assertEqual(rc, 0)
        by = {m["name"]: m for m in out["members"]}
        self.assertEqual([i["content"] for i in by["A"]["items"]], ["item a"])
        self.assertEqual(by["B"]["counts"]["completed"], 1)
        self.assertEqual(by["A"]["last_note"]["text"], "working")
        self.assertIsNone(by["B"]["last_note"])
        self.assertEqual(out["counts"]["completed"], 1)
        rc, out = cli("channel-board", "nope", "--root", self.root)
        self.assertEqual(rc, 1)

    def test_cli_channels_open_notes_and_briefs(self):
        rc, out = cli(
            "channel-open", "--root", self.root, "--lead", "L", "--members", "A,B"
        )
        self.assertEqual(rc, 0)
        self.assertEqual(out["channel"]["name"], f"{self.main}/L")
        self.assertIn("--channel", out["briefs"]["A"])
        self.assertIn("--owner A", out["briefs"]["A"])
        rc, out = cli("channels", "--root", self.root)
        self.assertEqual(out["main"], self.main)
        rc, out = cli("note", "hello", "--root", self.root, "--owner", "A", "--to", "B")
        self.assertEqual(out["note"]["channel"], f"{self.main}/L")
        rc, out = cli("notes", "--root", self.root, "--channel", f"{self.main}/L")
        self.assertEqual([n["text"] for n in out["notes"]], ["hello"])
        rc, out = cli("notes", "--root", self.root, "--channel", self.main)
        self.assertEqual(out["notes"], [])

    def test_leave_and_join(self):
        chan = todo.open_lead_channel(self.root, "L", ["A"])
        todo.join(self.root, chan["name"], "Z")
        self.assertIn(chan["name"], todo.channels_of(self.root, "Z"))
        todo.leave(self.root, chan["name"], "Z")
        self.assertEqual(todo.channels_of(self.root, "Z"), [])

    def test_identity_resolves_omp_agent_id(self):
        todo.open_lead_channel(self.root, "L", ["IrcCore"])
        who = worker_inbox.identity(
            {"cwd": self.root, "agent_name": "3-IrcCore"}, env={}
        )
        self.assertIsNotNone(who)
        self.assertEqual(who[0], "IrcCore")  # type: ignore[index]
        self.assertIsNone(
            worker_inbox.identity({"cwd": self.root, "agent_name": "9-Unknown"}, env={})
        )

    def test_channel_open_from_subdir_lands_in_project_registry(self):
        sub = os.path.join(self.root, "pkg", "deep")
        os.makedirs(sub)
        rc, out = cli("channel-open", "--root", sub, "--lead", "L", "--members", "A")
        self.assertEqual(rc, 0)
        self.assertEqual(
            out["channel"]["name"], f"{self.main}/L"
        )  # not `deep@feature/x`
        self.assertTrue((Path(self.root) / ".atlas/.run/channels.json").exists())
        self.assertFalse((Path(sub) / ".atlas").exists())

    def test_register_member_joins_the_launching_leads_channel_once(self):
        chan = todo.open_lead_channel(self.root, "L", ["A"])["name"]
        for _ in range(2):  # idempotent
            self.assertEqual(todo.register_member(self.root, "W1", chan), chan)
        members = todo.get_channel(self.root, chan)["members"]
        self.assertEqual([m["name"] for m in members].count("W1"), 1)
        self.assertEqual([m["parent"] for m in members if m["name"] == "W1"], ["L"])

    def test_register_member_without_a_channel_never_picks_the_newest_lead(self):
        todo.open_lead_channel(self.root, "lead-new", ["A"])
        self.assertEqual(todo.register_member(self.root, "W1"), f"{self.main}/lead")
        names = [
            m["name"]
            for m in todo.get_channel(self.root, f"{self.main}/lead-new")["members"]
        ]
        self.assertNotIn("W1", names)

    def test_a_workers_children_never_enrol_into_the_lead_it_inherited(self):
        chan = todo.open_lead_channel(self.root, "lead-xxxxxx", ["W"])["name"]
        env = {
            "ATLAS_WORKER_NAME": "W",
            "ATLAS_CHANNEL": chan,
            "ATLAS_LEAD_NAME": "lead-xxxxxx",
        }
        with mock.patch.dict(os.environ, env):
            got = todo.register_member(self.root, "child")
        self.assertEqual(got, f"{self.main}/W")  # W leads its own children
        names = [m["name"] for m in todo.get_channel(self.root, chan)["members"]]
        self.assertNotIn("child", names)
        # the lead itself (no worker name in env) still enrols its workers
        with mock.patch.dict(os.environ, {**env, "ATLAS_WORKER_NAME": ""}):
            self.assertEqual(todo.register_member(self.root, "kid"), chan)

    def test_worker_with_an_inherited_channel_is_not_a_member_of_it(self):
        chan = todo.open_lead_channel(self.root, "lead-aaaaaa", ["A"])["name"]
        env = {
            "ATLAS_WORKER_NAME": "fix-1",
            "ATLAS_CHANNEL": chan,
            "ATLAS_LEAD_NAME": "lead-aaaaaa",
        }
        with mock.patch.dict(os.environ, env):
            implicit = todo.note(self.root, "fix-1", "x", to="lead-aaaaaa")
            explicit = todo.note(
                self.root, "fix-1", "y", to="lead-aaaaaa", channel=chan, kind="report"
            )
        for rec in (implicit, explicit):
            self.assertEqual(rec["channel"], self.main)
        names = [m["name"] for m in todo.get_channel(self.root, chan)["members"]]
        self.assertNotIn("fix-1", names)
        # once the lead side registers it, the same env is honoured
        todo.register_member(self.root, "fix-1", chan)
        with mock.patch.dict(os.environ, env):
            self.assertEqual(todo.note(self.root, "fix-1", "z")["channel"], chan)

    def test_lead_inbox_only_carries_notes_from_channel_members(self):
        chan = todo.open_lead_channel(self.root, "lead-aaaaaa", ["W"])["name"]
        worker_inbox._write_cursor(
            worker_inbox.cursor_path(self.root, "lead-aaaaaa"), 0.0, 0
        )
        todo.note(self.root, "W", "member report", to="lead-aaaaaa", channel=chan)
        todo.note(self.root, "stranger", "forged", to="lead-aaaaaa", channel=chan)
        todo.note(self.root, "stranger", "in main", to="lead-aaaaaa", channel=self.main)
        todo.note(self.root, "stranger", "no channel", to="lead-aaaaaa", channel="")
        todo.note(
            self.root, "human", "human in main", to="lead-aaaaaa", channel=self.main
        )
        todo.note(self.root, "stranger", "forged alias", to="lead", channel=chan)
        todo.note(self.root, "human", "from dashboard", to="lead-aaaaaa", channel=chan)
        todo.leave(self.root, chan, "W")
        todo.note(self.root, "W", "late report", to="lead-aaaaaa", channel=chan)
        got = self.drain("lead-aaaaaa", aliases=("lead",))
        self.assertIn("member report", got)
        self.assertIn("from dashboard", got)
        self.assertIn("late report", got)  # departed members keep their report
        self.assertNotIn("forged", got)
        self.assertIn("human in main", got)
        self.assertNotIn("from stranger", got)
        self.assertNotIn("no channel", got)

    def test_selffix_worker_gets_its_own_channel_not_the_lead_env(self):
        import atlas_launch
        import atlas_selffix

        chan = todo.open_lead_channel(self.root, "lead-aaaaaa", ["A"])["name"]
        seen = {}

        def fake_launch(root, name, prompt, **kw):
            seen.update(kw["env"], name=name, root=root)
            return {"ok": True}

        env = {"ATLAS_CHANNEL": chan, "ATLAS_LEAD_NAME": "lead-aaaaaa"}
        with mock.patch.dict(os.environ, env):
            with mock.patch.object(atlas_launch, "launch", fake_launch):
                with mock.patch.object(atlas_selffix, "build_prompt", lambda *a: "p"):
                    atlas_selffix._worker_launch(self.root, {"id": 1}, self.root)
        self.assertEqual(seen["ATLAS_CHANNEL"], f"{self.main}/selffix")
        self.assertEqual(seen["ATLAS_LEAD_NAME"], "selffix")
        todo.register_member(
            self.root, "fix-1", seen["ATLAS_CHANNEL"], seen["ATLAS_LEAD_NAME"]
        )
        self.assertEqual(todo.channels_of(self.root, "fix-1"), [f"{self.main}/selffix"])

    def test_held_registry_lock_never_hangs_a_worker_note(self):
        lock = Path(self.root) / ".atlas/.run/channels.json.lock"
        lock.parent.mkdir(parents=True, exist_ok=True)
        code = (
            "import fcntl,time;"
            f"f=open({str(lock)!r},'a+');fcntl.flock(f,fcntl.LOCK_EX);"
            "print('held',flush=True);time.sleep(6)"
        )
        holder = subprocess.Popen(
            [sys.executable, "-c", code], stdout=subprocess.PIPE, text=True
        )
        assert holder.stdout is not None
        self.addCleanup(holder.stdout.close)
        self.addCleanup(holder.wait)
        self.addCleanup(holder.kill)
        self.assertEqual(holder.stdout.readline().strip(), "held")
        with tempfile.TemporaryDirectory() as home:
            with mock.patch.dict(os.environ, {"ATLAS_HOME": home}):
                t0 = time.monotonic()
                todo.register_member(self.root, "W1", None, "L")
                elapsed = time.monotonic() - t0
            faults = (Path(home) / "hook-faults.jsonl").read_text()
        self.assertLess(elapsed, 4)
        self.assertIn("register_worker.lock_timeout", faults)

    def test_file_lock_timeout_param_is_opt_in(self):
        from atlas_memory import LockTimeout, _file_lock

        p = Path(self.root) / "x.json"
        with _file_lock(p), self.assertRaises(LockTimeout), _file_lock(p, timeout=0.1):
            pass

    def test_lead_owner_notes_follow_the_lead_subchannel(self):
        self.assertEqual(todo.note(self.root, "lead", "pre")["channel"], self.main)
        todo.open_lead_channel(self.root, "lead-abc123", ["A"])
        self.assertEqual(
            todo.note(self.root, "lead", "post")["channel"], f"{self.main}/lead-abc123"
        )

    def test_detached_and_non_git_dispatch_naming(self):
        git(self.root, "checkout", "-q", "--detach")
        sha = subprocess.run(
            ["git", "-C", self.root, "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        base = os.path.basename(self.root)
        self.assertEqual(
            todo.open_lead_channel(self.root, "L", ["A"])["name"], f"{base}@{sha}/L"
        )
        with tempfile.TemporaryDirectory() as plain:
            p = os.path.realpath(plain)
            self.assertEqual(
                todo.open_lead_channel(p, "L", ["A"])["name"],
                f"{os.path.basename(p)}/L",
            )

    def test_lead_plan_items_group_under_the_lead(self):
        chan = todo.open_lead_channel(self.root, "lead-sess12", ["A"])
        todo.mirror(
            self.root, [{"content": "plan step", "status": "pending"}], "sess123456"
        )
        todo.mirror(
            self.root, [{"content": "other lead", "status": "pending"}], "zzzzzz9999"
        )
        mine = todo.add(self.root, "a's item")
        todo.claim(self.root, mine["item"]["id"], "A")
        by = {
            m["name"]: m for m in todo.channel_board(self.root, chan["name"])["members"]
        }
        self.assertEqual(
            [i["content"] for i in by["lead-sess12"]["items"]], ["plan step"]
        )
        self.assertEqual([i["content"] for i in by["A"]["items"]], ["a's item"])


if __name__ == "__main__":
    unittest.main()
