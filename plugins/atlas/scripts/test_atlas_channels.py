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

    def _dead_lead(self, name="old", pid=None):
        todo.open_lead_channel(self.root, name, ["w1"])
        todo.mark_finished(self.root, "w1", 0)
        todo.mark_finished(self.root, name, 0)
        if pid:
            todo._reg_update(
                self.root,
                lambda r: r["channels"][f"{self.main}/{name}"]["members"][0].update(
                    pid=pid, pid_start=todo.pid_start(pid)
                )
                or r["channels"][f"{self.main}/{name}"]["members"][0].pop("exit_code"),
            )

    def test_reap_archives_and_removes_dead_lead_channel_idempotently(self):
        self._dead_lead()
        out = todo.reap_channels(self.root, now=time.time() + 90000)
        self.assertEqual(out["reaped"], 1)
        names = list(todo._reg_read(self.root)["channels"])
        self.assertNotIn(f"{self.main}/old", names)
        self.assertIn(self.main, names)  # main channel never reaped
        lines = Path(out["archived_path"]).read_text().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])["name"], f"{self.main}/old")
        self.assertEqual(todo.reap_channels(self.root, now=time.time() + 90000)["reaped"], 0)

    def test_reap_live_pid_and_keep_block_reaping(self):
        self._dead_lead("old", pid=os.getpid())
        later = time.time() + 90000
        self.assertEqual(todo.reap_channels(self.root, now=later)["reaped"], 0)
        self._dead_lead("mine")
        self.assertEqual(todo.reap_channels(self.root, now=later, keep="mine")["reaped"], 0)

    def _live_lead(self, name, age, pid=None):
        todo.open_lead_channel(self.root, name, ["w1"])

        def fn(r):
            ch = r["channels"][f"{self.main}/{name}"]
            ch["last_activity"] = time.time() - age
            if pid is not None:
                ch["members"][0]["pid"] = pid

        todo._reg_update(self.root, fn)

    def test_reap_dead_pid_member_without_exit_code(self):
        proc = subprocess.Popen([sys.executable, "-c", "pass"])
        proc.wait()
        self._live_lead("crashed", 10, pid=proc.pid)
        todo._reg_update(
            self.root,
            lambda r: r["channels"][f"{self.main}/crashed"]["members"][1].update(pid=proc.pid),
        )
        self.assertEqual(todo.reap_channels(self.root)["reaped"], 1)

    def _psless(self):
        """ps binary missing: subprocess.run raises OSError."""
        p = mock.patch.object(todo.subprocess, "run", side_effect=FileNotFoundError("ps"))
        p.start()
        self.addCleanup(p.stop)

    def _pin_all(self, name, pid):
        todo._reg_update(
            self.root,
            lambda r: [
                m.update(pid=pid) for m in r["channels"][f"{self.main}/{name}"]["members"]
            ],
        )

    def test_reap_ps_unavailable_live_pid_is_not_reaped(self):
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        self.addCleanup(proc.kill)
        self._live_lead("alive", 10, pid=proc.pid)
        self._pin_all("alive", proc.pid)
        self._psless()
        self.assertEqual(todo.reap_channels(self.root)["reaped"], 0)

    def test_reap_ps_unavailable_unknown_pid_uses_ttl_only(self):
        self._live_lead("blind", 10 * 86400, pid=999999)
        self._pin_all("blind", 999999)
        self._psless()
        with mock.patch.object(todo, "_proc_start", return_value=todo._UNKNOWN):
            self.assertEqual(todo.reap_channels(self.root, max_idle=10**9, lead_idle=10**9)["reaped"], 0)  # unknown pid: TTL only

    def test_reap_ps_unavailable_pid_gone_past_ttl_is_reaped(self):
        proc = subprocess.Popen([sys.executable, "-c", "pass"])
        proc.wait()
        self._live_lead("gone", 10 * 86400, pid=proc.pid)
        self._pin_all("gone", proc.pid)
        self._psless()
        self.assertEqual(todo.reap_channels(self.root)["reaped"], 1)

    def test_reap_idle_lead_past_two_hours_but_not_current(self):
        todo.open_lead_channel(self.root, "mine", ["w1"])
        todo.open_lead_channel(self.root, "idle", ["w1"])  # opens reap, so age after both exist
        todo._reg_update(
            self.root,
            lambda r: [c.update(last_activity=time.time() - 3 * 3600) for n, c in r["channels"].items() if n.endswith(("/mine", "/idle"))],
        )
        out = todo.reap_channels(self.root, keep="mine")
        names = list(todo._reg_read(self.root)["channels"])
        self.assertEqual(out["reaped"], 1)
        self.assertNotIn(f"{self.main}/idle", names)
        self.assertIn(f"{self.main}/mine", names)

    def test_reap_keeps_recently_active_lead(self):
        self._live_lead("fresh", 600)
        self.assertEqual(todo.reap_channels(self.root)["reaped"], 0)

    def test_reap_lead_idle_env_override(self):
        self._live_lead("env", 600)
        with mock.patch.dict(os.environ, {"ATLAS_LEAD_IDLE_TTL": "60"}):
            self.assertEqual(todo.reap_channels(self.root)["reaped"], 1)

    def test_reap_prunes_finished_main_members_and_dry_run_is_inert(self):
        self._dead_lead()
        out = todo.reap_channels(self.root, now=time.time() + 90000, dry_run=True)
        self.assertEqual((out["reaped"], out["would_reap"]), (0, 1))
        self.assertIn(f"{self.main}/old", list(todo._reg_read(self.root)["channels"]))
        todo.reap_channels(self.root, now=time.time() + 90000)
        mainc = todo.get_channel(self.root, self.main)
        self.assertEqual([m["name"] for m in mainc["members"]], [])

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
        gone = subprocess.Popen(["true"])
        gone.wait()
        todo.set_member_handles(self.root, "w1", chan, pid=gone.pid, pane_id="p-old")
        m = {x["name"]: x for x in todo.get_channel(self.root, chan)["members"]}["w1"]
        self.assertIsNone(m["pid_start"])  # reaped child: ps finds nothing
        todo.set_member_handles(self.root, "w1", chan, pid=os.getpid())
        m = {x["name"]: x for x in todo.get_channel(self.root, chan)["members"]}["w1"]
        self.assertTrue(todo.pid_matches(os.getpid(), m["pid_start"]))
        self.assertFalse(todo.pid_matches(os.getpid(), None))
        self.assertFalse(todo.pid_matches(os.getpid(), "Thu Jan  1 00:00:00 1970"))
        todo.mark_finished(self.root, "w1", 1)
        todo.leave(self.root, chan, "w1")
        todo.open_lead_channel(self.root, "lead-abc123", ["w1"])  # idempotent re-open
        m = {x["name"]: x for x in todo.get_channel(self.root, chan)["members"]}["w1"]
        self.assertEqual(m["exit_code"], 1)  # a plain re-open does not revive
        todo.register_member(self.root, "w1", chan)
        m = {x["name"]: x for x in todo.get_channel(self.root, chan)["members"]}["w1"]
        for key in ("exit_code", "ended_at", "pid", "pid_start", "pane_id"):
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
        todo.note(self.root, "B", "report: slice B finished", to="lead")
        self.assertIn("slice B finished", self.drain("L", aliases=("lead",)))

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

    def test_brief_requires_posting_at_start_contract_change_and_before_report(self):
        todo.open_lead_channel(self.root, "L", ["A", "B"])
        brief = todo.channel_brief(self.root, f"{self.main}/L", "L", "A").lower()
        # posting is mandatory, not optional
        self.assertIn("required", brief)
        self.assertNotIn("optional", brief)
        # the three trigger points, each addressed to the right party
        for token in (
            "start",
            "shared-contract",
            "sibling",
            "before your final report",
        ):
            self.assertIn(token, brief)
        self.assertRegex(brief, r"result to l\b")
        # the post command itself is still there
        self.assertIn(" note ", brief)

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


class OwnerTokens(unittest.TestCase):
    setUp = ChannelModel.setUp  # same env isolation and temp git root, none of its tests

    def post(self, owner, *extra):
        return cli("note", "hi", "--root", self.root, "--owner", owner, *extra)

    def test_token_bearing_owner_needs_the_token(self):
        tok = todo.issue_owner_token(self.root, "W1")
        rc, out = self.post("W1")
        self.assertEqual((rc, out), (1, {"ok": False, "error": "owner_token_required"}))
        rc, out = self.post("W1", "--owner-token", "0" * len(tok))
        self.assertEqual((rc, out), (1, {"ok": False, "error": "owner_token_invalid"}))
        rc, out = self.post("W1", "--owner-token", tok)
        self.assertEqual(rc, 0)
        self.assertEqual(out["note"]["owner"], "W1")

    def test_env_token_fallback(self):
        tok = todo.issue_owner_token(self.root, "W1")
        os.environ["ATLAS_OWNER_TOKEN"] = tok
        self.assertEqual(self.post("W1")[0], 0)

    def test_token_is_bound_to_its_owner(self):
        tok = todo.issue_owner_token(self.root, "W1")
        todo.issue_owner_token(self.root, "W2")
        self.assertTrue(todo.verify_owner_token(self.root, "W1", tok))
        self.assertFalse(todo.verify_owner_token(self.root, "W2", tok))
        self.assertEqual(todo.issue_owner_token(self.root, "W1"), tok)  # deterministic

    def test_unissued_owner_posts_as_before(self):
        todo.issue_owner_token(self.root, "W1")
        self.assertEqual(self.post("other")[0], 0)

    def test_secret_mode_and_no_token_persisted(self):
        tok = todo.issue_owner_token(self.root, "W1")
        self.post("W1", "--owner-token", tok)
        run = Path(self.root) / ".atlas/.run"
        secrets = [p for p in run.iterdir() if p.is_file() and "secret" in p.name]
        self.assertEqual(len(secrets), 1)
        self.assertEqual(secrets[0].stat().st_mode & 0o777, 0o600)
        for p in run.rglob("*"):
            if p.is_file():
                self.assertNotIn(tok.encode(), p.read_bytes(), str(p))

    def test_register_member_still_returns_the_channel(self):
        chan = todo.open_lead_channel(self.root, "L", ["A"])["name"]
        self.assertEqual(todo.register_member(self.root, "W1", chan), chan)


class RegistryHardening(unittest.TestCase):
    """Corrupt channels.json is quarantined, never overwritten; the lead lock is bounded."""

    def setUp(self):
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for k in ("ATLAS_CHANNEL", "ATLAS_LEAD_NAME", "ATLAS_WORKER_NAME"):
            os.environ.pop(k, None)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = os.path.realpath(self._tmp.name)
        (Path(self.root) / ".atlas" / ".run").mkdir(parents=True)

    def test_truncated_registry_is_quarantined_not_overwritten(self):
        todo.open_lead_channel(self.root, "lead-a", ["w1"])
        path = todo._channels_path(self.root)
        good = path.read_text(encoding="utf-8")
        torn = good[: len(good) // 2]
        path.write_text(torn, encoding="utf-8")
        with self.assertRaises(todo.ChannelRegistryCorrupt):
            todo.open_lead_channel(self.root, "lead-b", [])
        self.assertEqual(path.read_text(encoding="utf-8"), torn)
        copies = list(path.parent.glob("channels.json.corrupt-*"))
        self.assertEqual(len(copies), 1)
        self.assertEqual(copies[0].read_text(encoding="utf-8"), torn)
        with self.assertRaises(todo.ChannelRegistryCorrupt):  # persistent: no copy pile-up
            todo.open_lead_channel(self.root, "lead-b", [])
        self.assertEqual(len(list(path.parent.glob("channels.json.corrupt-*"))), 1)

    def test_readers_stay_lenient_on_corrupt_registry(self):
        todo.open_lead_channel(self.root, "lead-a", [])
        todo._channels_path(self.root).write_text("{not json", encoding="utf-8")
        self.assertEqual(todo._reg_read(self.root)["channels"], {})

    def test_cli_channel_open_reports_corruption(self):
        todo.open_lead_channel(self.root, "lead-a", [])
        todo._channels_path(self.root).write_text("{not json", encoding="utf-8")
        rc, out = cli("channel-open", "--root", self.root, "--lead", "lead-b")
        self.assertEqual(rc, 1)
        self.assertFalse(out["ok"])
        self.assertIn("corrupt", out["error"])

    def test_open_lead_channel_lock_is_bounded_by_default(self):
        import atlas_memory

        todo.open_lead_channel(self.root, "lead-a", [])
        with atlas_memory._file_lock(todo._channels_path(self.root)):
            t0 = time.monotonic()
            with self.assertRaises(atlas_memory.LockTimeout):
                todo.open_lead_channel(self.root, "lead-b", [])
            self.assertLess(time.monotonic() - t0, 4.0)
        todo.open_lead_channel(self.root, "lead-b", [])  # released: works again


if __name__ == "__main__":
    unittest.main()
