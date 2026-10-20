"""atlas_colony_model: snapshot shape, pane_state markers, attach_argv, capture. tmux is a PATH shim."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import shutil
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_colony_model as model  # noqa: E402

PANES = (
    "%1\tatlas-t1\tatlas-t1\t111\t0\t0\texplorer-aa\texplorer\tnode\n"
    "%2\tatlas-t1\tatlas-t1\t222\t0\t0\timplementer-bb\timplementer\tomp\n"
    "%3\tatlas-t1\tatlas-t1\t333\t1\t2\tverifier-cc\tverifier\tzsh\n"
)
SCREENS = {
    "%1": "Do you want to proceed?\n❯ 1. Yes\n",
    "%2": "⣾ working ▏ 0:12 · 3 tools\n",
}
FAKE_TMUX = r"""#!/bin/bash
echo "$*" >> "$FAKE_LOG"
case "$1" in
  list-panes) printf '%b' "$FAKE_PANES" ;;
  list-sessions) echo -e "atlas-t1\t1\t0\natlas-view-x\t1\t1\nother\t1\t0" ;;
  capture-pane) t="${@: -1}"; v="FAKE_SCREEN_${t#%}"; printf '%s' "${!v}" ;;
  display-message) printf 'atlas-t1\t@4\n' ;;
  -V) echo "tmux 3.5a" ;;
  *) ;;
esac
"""


class PaneActivityTest(unittest.TestCase):
    def test_latest_tool_row_wins(self):
        text = "● ctx_read atlas_dashboard.py:1-250\n  ⎿ ok\n● ctx_read atlas_dashboard.py:2501-2750\n\n❯ \n"
        self.assertEqual(model._pane_activity(text), "ctx_read atlas_dashboard.py:2501-2750")
        self.assertEqual(model._pane_activity("thinking…\n❯ "), "")
        feed = "10:04:27  ctx_read    atlas_dashboard.py:1-100\n10:04:34  think       Chunk 1 done\n"
        self.assertEqual(model._pane_activity(feed), "ctx_read atlas_dashboard.py:1-100")

    def test_peer_note_row_keeps_recipient_and_text(self):
        feed = "10:04:27  peer       → lead: all done\n"
        self.assertEqual(model._pane_activity(feed), "peer → lead: all done")
        self.assertNotIn("$", model._pane_activity(feed))


class NamingTest(unittest.TestCase):
    def test_slug_from_task(self):
        self.assertEqual(model._slug("Read-only: read atlas_tui.py in 10 chunks"), "read-atlas-tui")
        self.assertEqual(model._slug("", "fallback"), "fallback")
        self.assertEqual(model._slug("Fix the Login bug now please"), "fix-login-bug")

    def test_colony_names_dedupe_oldest_first_and_explicit_wins(self):
        teams = [
            {"team_id": "b", "created": 2, "lead": "lead-x"},
            {"team_id": "a", "created": 1},
            {"team_id": "c", "created": 3, "name": "review", "source": {"harness": "omp", "session": "s1", "lead": "l", "project": "p"}},
        ]
        cols = {
            "a": {"id": "a", "task": "Audit the dashboard", "created": 1, "project": "/x/proj"},
            "b": {"id": "b", "task": "Audit the dashboard", "created": 2, "project": "/x/proj"},
            "c": {"id": "c", "task": "x" * 90, "created": 3, "project": "/x/proj"},
        }
        model._name_colonies(cols, teams)
        self.assertEqual(["audit-dashboard", "audit-dashboard-2", "review"], [cols[k]["name"] for k in "abc"])
        self.assertEqual(60, len(cols["c"]["title"]))
        self.assertEqual({"project": "proj", "lead": "", "harness": "", "session": "", "label": "proj"}, cols["a"]["source"])
        self.assertEqual("lead-x", cols["b"]["source"]["lead"])
        self.assertEqual({"project": "p", "lead": "l", "harness": "omp", "session": "s1", "label": "from omp session s1 · lead l · p"}, cols["c"]["source"])

    def test_seat_addresses_index_only_repeated_roles_in_spawn_order(self):
        teams = [{"team_id": "t", "members": [{"name": "explorer-z"}, {"name": "explorer-a"}, {"name": "critic-1"}]}]
        cols = {"t": {"name": "tui-review"}}
        seats = [{"name": n, "role": r, "colony": "t"} for n, r in
                 (("explorer-a", "explorer"), ("critic-1", "completeness-critic"), ("explorer-z", "explorer"))]
        model._address_seats(seats, cols, teams, [{"kind": "agent", "name": "explorer", "description": "d" * 50}])
        got = {s["name"]: s["address"] for s in seats}
        self.assertEqual("explorer-1@tui-review", got["explorer-z"])
        self.assertEqual("explorer-2@tui-review", got["explorer-a"])
        self.assertEqual("completeness-critic@tui-review", got["critic-1"])
        self.assertEqual("d" * 39 + "…", seats[0]["role_title"])

    def test_subagent_seats_address_by_member_name(self):
        teams = [{"team_id": "t", "members": [{"name": "explorer-a"}, {"name": "scout-b"}, {"name": "critic-1"}]}]
        cols = {"t": {"name": "tui-review"}}
        seats = [{"name": n, "role": r, "colony": "t"} for n, r in
                 (("scout-b", "subagent"), ("critic-1", "completeness-critic"), ("explorer-a", "subagent"))]
        model._address_seats(seats, cols, teams, [])
        got = {s["name"]: s["address"] for s in seats}
        self.assertEqual("explorer-a@tui-review", got["explorer-a"])
        self.assertEqual("scout-b@tui-review", got["scout-b"])
        self.assertEqual("completeness-critic@tui-review", got["critic-1"])


class ModelTest(unittest.TestCase):
    def setUp(self):
        model._STATIC.clear()
        model._NOTES.clear()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        run = Path(self.root, ".atlas", ".run")
        (run / "teams").mkdir(parents=True)
        (run / "logs").mkdir()
        (run / "teams" / "t1.json").write_text(
            json.dumps(
                {
                    "team_id": "t1",
                    "class": "audit",
                    "effort": "low",
                    "task": "map it\nsecond line",
                    "channel": "proj@main/lead-x",
                    "transport": "tmux",
                    "created": 1000.0,
                    "members": [
                        {"name": "explorer-aa", "role": "explorer"},
                        {"name": "implementer-bb", "role": "implementer"},
                        {"name": "verifier-cc", "role": "verifier"},
                    ],
                }
            )
        )
        (run / "channels.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "channels": {
                        "proj@main/lead-x": {
                            "name": "proj@main/lead-x",
                            "kind": "lead",
                            "lead": "lead-x",
                            "members": [
                                {"name": "explorer-aa", "role": "explorer"},
                                {"name": "implementer-bb", "role": "implementer"},
                                {
                                    "name": "verifier-cc",
                                    "role": "verifier",
                                    "exit_code": 0,
                                },
                            ],
                        }
                    },
                }
            )
        )
        for n, first in (
            ("explorer-aa", "$ claude -p --model sonnet"),
            ("implementer-bb", "$ omp --mode json"),
            ("verifier-cc", "$ codex exec --json -m gpt-5"),
        ):
            (run / "logs" / f"{n}.log").write_text(first + "\nrest\n")
        (run / "board").mkdir()
        (run / "board" / "explorer-aa.jsonl").write_text(
            json.dumps(
                {
                    "ts": 5.0,
                    "seq": 1,
                    "owner": "explorer-aa",
                    "to": "lead-x",
                    "text": "found it",
                    "kind": "blocked",
                    "channel": "proj@main/lead-x",
                }
            )
            + "\n"
        )
        shim = Path(self.root, "bin")
        shim.mkdir()
        t = shim / "tmux"
        t.write_text(FAKE_TMUX)
        t.chmod(t.stat().st_mode | stat.S_IXUSR)
        self.log = Path(self.root, "tmux.log")
        env = {
            "PATH": f"{shim}:{os.environ['PATH']}",
            "FAKE_LOG": str(self.log),
            "FAKE_PANES": PANES,
            "FAKE_SCREEN_1": SCREENS["%1"],
            "FAKE_SCREEN_2": SCREENS["%2"],
            "ATLAS_HOME": self.root,
        }
        p = mock.patch.dict(os.environ, env)
        p.start()
        self.addCleanup(p.stop)

    def _team(self, root, tid, created, member, **extra):
        (Path(root, ".atlas", ".run", "teams", f"{tid}.json")).write_text(
            json.dumps({"team_id": tid, "class": "fix", "effort": "low", "task": "x", "created": created, "members": [{"name": member, "role": "implementer"}], **extra})
        )

    def _finished_colony(self, tid, ended_ago, **extra):
        name = f"worker-{tid}"
        self._team(self.root, tid, time.time() - 900, name, channel=f"proj@main/lead-{tid}", **extra)
        reg = Path(self.root, ".atlas", ".run", "channels.json")
        data = json.loads(reg.read_text())
        data["channels"][f"proj@main/lead-{tid}"] = {
            "name": f"proj@main/lead-{tid}", "kind": "lead", "lead": f"lead-{tid}",
            "members": [{"name": name, "role": "implementer", "exit_code": 0, "ended_at": time.time() - ended_ago}],
        }
        reg.write_text(json.dumps(data))

    def test_finished_grace_window(self):
        self._finished_colony("fin60", 60)
        self._finished_colony("fin400", 400)
        self._finished_colony("fingone", 60, state="reaped")
        by_id = {c["id"]: c for c in model.snapshot(self.root)["colonies"]}
        self.assertTrue(by_id["fin60"]["finished"])
        self.assertFalse(by_id["t1"]["finished"])
        self.assertNotIn("fin400", by_id)
        self.assertNotIn("fingone", by_id)

    def _no_ended_at(self, tid, log_ago, **extra):
        self._finished_colony(tid, 0, **extra)
        reg = Path(self.root, ".atlas", ".run", "channels.json")
        data = json.loads(reg.read_text())
        del data["channels"][f"proj@main/lead-{tid}"]["members"][0]["ended_at"]
        reg.write_text(json.dumps(data))
        old = time.time() - 900
        os.utime(Path(self.root, ".atlas", ".run", "teams", f"{tid}.json"), (old, old))
        log = Path(self.root, ".atlas", ".run", "logs", f"worker-{tid}.log")
        log.write_text("$ claude\n")
        os.utime(log, (time.time() - log_ago,) * 2)

    def test_finished_grace_without_ended_at_uses_log_mtime(self):
        self._no_ended_at("nolog60", 60)
        self._no_ended_at("nolog400", 400)
        self._no_ended_at("nologgone", 60, state="reaped")
        by_id = {c["id"]: c for c in model.snapshot(self.root)["colonies"]}
        self.assertTrue(by_id["nolog60"]["finished"])
        self.assertNotIn("nolog400", by_id)
        self.assertNotIn("nologgone", by_id)

    def test_killed_seat_without_pane_exit_code_or_ended_at_is_finished(self):
        self._no_ended_at("kill60", 60)
        reg = Path(self.root, ".atlas", ".run", "channels.json")
        data = json.loads(reg.read_text())
        entry = data["channels"]["proj@main/lead-kill60"]["members"][0]
        del entry["exit_code"]
        entry["pid"] = 4194000  # not a live process
        reg.write_text(json.dumps(data))
        by_id = {c["id"]: c for c in model.snapshot(self.root)["colonies"]}
        self.assertTrue(by_id["kill60"]["finished"])

    def test_source_lead_falls_back_to_channel_and_label(self):
        src = {c["id"]: c["source"] for c in model.snapshot(self.root)["colonies"]}["t1"]
        self.assertEqual(src["lead"], "lead-x")
        self.assertEqual(src["label"], f"lead lead-x · {src['project']}")
        full = {"harness": "claude", "session": "s1", "lead": "L", "project": "p"}
        self.assertEqual(model._source_label(full, "c"), "from claude session s1 · lead L · p")
        self.assertEqual(model._source_label({"harness": "", "session": "", "lead": "", "project": ""}, "p@b/L"), "channel p@b/L")

    def test_paneless_omp_channel_reports_subagent_and_harness(self):
        reg = Path(self.root, ".atlas", ".run", "channels.json")
        data = json.loads(reg.read_text())
        data["channels"]["proj@main/lead-omp1"] = {
            "name": "proj@main/lead-omp1", "kind": "lead", "lead": "lead-omp1", "harness": "omp",
            "members": [{"name": "worker-o1", "role": "implementer", "exit_code": 0, "ended_at": time.time() - 60}],
        }
        reg.write_text(json.dumps(data))
        s = model.snapshot(self.root)
        c = next(c for c in s["colonies"] if c["channel"] == "proj@main/lead-omp1")
        self.assertEqual(c["transport"], "subagent")
        self.assertEqual(c["source"]["harness"], "omp")
        seat = next(x for x in s["seats"] if x["name"] == "worker-o1")
        self.assertEqual(seat["runtime"], "omp")

    def _channel(self, name, lead, members, **extra):
        reg = Path(self.root, ".atlas", ".run", "channels.json")
        data = json.loads(reg.read_text())
        data["channels"][name] = {
            "name": name, "kind": "lead", "lead": lead, **extra, "members": members,
        }
        reg.write_text(json.dumps(data))

    def test_running_paneless_omp_colony_is_live(self):
        self._channel(
            "proj@main/lead-live", "lead-live",
            [{"name": "worker-l1", "role": "implementer", "joined": time.time() - 60}],
            harness="omp", lead_pid=os.getpid(),
        )
        s = model.snapshot(self.root)
        c = next(c for c in s["colonies"] if c["channel"] == "proj@main/lead-live")
        self.assertFalse(c["finished"])
        self.assertEqual(c["transport"], "subagent")
        seat = next(x for x in s["seats"] if x["name"] == "worker-l1")
        self.assertEqual(seat["state"], "working")
        self.assertEqual(seat["runtime"], "omp")

    def test_dead_lead_pid_marks_paneless_seat_dead(self):
        import subprocess

        pr = subprocess.Popen(["/bin/sleep", "0"])  # spawn + reap: a guaranteed-dead pid
        pr.wait()
        self._channel(
            "proj@main/lead-dead", "lead-dead",
            [{"name": "worker-d1", "role": "implementer", "ended_at": time.time() - 60}],
            harness="omp", lead_pid=pr.pid,
        )
        s = model.snapshot(self.root)
        seat = next(x for x in s["seats"] if x["name"] == "worker-d1")
        self.assertEqual(seat["state"], "dead")

    def test_live_lead_pid_adds_lead_seat(self):
        model._TRANSCRIPTS.clear()
        with mock.patch.object(model, "_omp_sessions_root", return_value=Path(self.root) / "no-sessions"):
            self._channel(
                "proj@main/lead-abc123", "lead-abc123",
                [{"name": "worker-s1", "role": "scout", "joined": time.time() - 30}],
                harness="omp", lead_pid=os.getpid(),
            )
            s = model.snapshot(self.root)
        seat = next(x for x in s["seats"] if x["name"] == "lead-abc123")
        self.assertEqual(seat["role"], "lead")
        self.assertEqual(seat["pod"], "lead")
        self.assertTrue(seat["lead"])
        self.assertEqual(seat["state"], "working")
        self.assertEqual(seat["runtime"], "omp")
        self.assertEqual(seat["target"], "")
        self.assertEqual(seat["pid"], os.getpid())
        c = next(c for c in s["colonies"] if c["channel"] == "proj@main/lead-abc123")
        self.assertIn("lead", [p["id"] for p in c["pods"]])
        self.assertFalse(c["finished"])
        self.assertTrue(next(x for x in s["seats"] if x["name"] == "worker-s1")["state"] == "working")

    def test_dead_lead_pid_adds_no_lead_seat(self):
        import subprocess

        pr = subprocess.Popen(["/bin/sleep", "0"])  # spawn + reap: a guaranteed-dead pid
        pr.wait()
        self._channel(
            "proj@main/lead-dead2", "lead-dead2",
            [],  # no members at all: nothing else can keep the colony alive
            harness="omp", lead_pid=pr.pid,
        )
        s = model.snapshot(self.root)
        self.assertFalse(any(x["name"] == "lead-dead2" for x in s["seats"]))
        self.assertFalse(any(c["channel"] == "proj@main/lead-dead2" for c in s["colonies"]))

    def test_colony_stays_live_with_only_lead_alive(self):
        model._TRANSCRIPTS.clear()
        with mock.patch.object(model, "_omp_sessions_root", return_value=Path(self.root) / "no-sessions"):
            self._channel(
                "proj@main/lead-only", "lead-only",
                [{"name": "worker-f1", "role": "runner", "exit_code": 0, "ended_at": time.time() - 60}],
                harness="omp", lead_pid=os.getpid(),
            )
            s = model.snapshot(self.root)
        c = next(c for c in s["colonies"] if c["channel"] == "proj@main/lead-only")
        self.assertFalse(c["finished"])  # the live lead keeps the colony live past the finished grace
        self.assertTrue(any(x["name"] == "lead-only" for x in s["seats"]))
        self.assertEqual(  # the finished subagent stays listed under its lead's colony
            next(x for x in s["seats"] if x["name"] == "worker-f1")["state"], "finished"
        )

    def test_registry_only_recent_channel_is_in_process_colony(self):
        now = time.time()
        self._channel(
            "proj@main/lead-reg", "lead-reg",
            [{"name": "worker-r1", "role": "implementer", "joined": now - 600},
             {"name": "worker-r2", "role": "explorer", "joined": now - 500}],
            last_activity=now - 30,
        )
        s = model.snapshot(self.root)
        c = next(c for c in s["colonies"] if c["channel"] == "proj@main/lead-reg")
        self.assertEqual(c["transport"], "in-process")
        self.assertFalse(c["finished"])
        names = {x["name"] for x in s["seats"] if x["colony"] == c["id"]}
        self.assertEqual(names, {"lead-reg", "worker-r1", "worker-r2"})
        self.assertTrue(all(x["target"] == "" for x in s["seats"] if x["name"] in names))

    def test_registry_only_stale_or_dead_channel_absent(self):
        import subprocess

        pr = subprocess.Popen(["/bin/sleep", "0"])
        pr.wait()
        old = time.time() - 2 * 86400
        self._channel("proj@main/lead-old", "lead-old", [], last_activity=old)
        self._channel(
            "proj@main/lead-dd", "lead-dd", [{"name": "worker-dd", "role": "x", "joined": old}],
            last_activity=time.time() - 5, lead_pid=pr.pid,
        )
        chans = {c["channel"] for c in model.snapshot(self.root)["colonies"]}
        self.assertNotIn("proj@main/lead-old", chans)
        self.assertNotIn("proj@main/lead-dd", chans)

    def test_registry_only_channel_merges_with_team_colony(self):
        # t1's channel is proj@main/lead-x: a registry-live lead-x must not add a second colony
        self._channel("proj@main/lead-x", "lead-x", [], last_activity=time.time() - 5)
        s = model.snapshot(self.root)
        self.assertEqual(1, sum(1 for c in s["colonies"] if c["channel"] == "proj@main/lead-x"))

    def test_registry_only_seat_state_from_notes(self):
        now = time.time()
        self._channel(
            "proj@main/lead-st", "lead-st",
            [{"name": "worker-b1", "role": "x", "joined": now - 900},
             {"name": "worker-i1", "role": "x", "joined": now - 900}],
            last_activity=now - 5,
        )
        with mock.patch.object(model, "_recent_notes", return_value=[
            {"owner": "worker-b1", "kind": "blocked", "ts": now - 10, "text": "stuck"},
            {"owner": "worker-i1", "kind": "note", "ts": now - 600, "text": "old"},
        ]):
            s = model.snapshot(self.root)
        st = {x["name"]: x["state"] for x in s["seats"]}
        self.assertEqual(st["worker-b1"], "blocked")
        self.assertEqual(st["worker-i1"], "idle")

    def test_named_lead_without_sid6_gets_no_transcript(self):
        self.assertEqual(model._lead_transcript("/r", "lead-boss", {"harness": "omp"}), "")
        self.assertEqual(model._lead_transcript("/r", "lead-abc123", {"harness": "codex"}), "")

    def test_name_colonies_harness_falls_back_to_channel_record(self):
        chans = {"p@b/L": {"name": "p@b/L", "harness": "omp"}}
        cols = {"t": {"id": "t", "channel": "p@b/L", "project": "/x/proj", "created": 1}}
        model._name_colonies(cols, [{"team_id": "t"}], chans)
        self.assertEqual("omp", cols["t"]["source"]["harness"])
        model._name_colonies(cols, [{"team_id": "t"}])
        self.assertEqual("", cols["t"]["source"]["harness"])  # recomputed: no chan_recs

    def test_only_colonies_with_work_in_progress_listed(self):
        now = time.time()
        self._team(self.root, "grace1", now - 60, "worker-k1")  # 1 min old, no panes: startup grace
        self._team(self.root, "stale1", now - 600, "worker-o1")  # 10 min old, no panes: hidden
        self._team(self.root, "gone1", now - 60, "worker-g1", state="reaped")
        reg = Path(self.root, ".atlas", ".run", "channels.json")
        data = json.loads(reg.read_text())
        data["channels"]["proj@main/lead-old"] = {  # all seats finished, no pane
            "name": "proj@main/lead-old", "kind": "lead", "lead": "lead-old",
            "members": [{"name": f"explorer-s{i}", "role": "explorer", "exit_code": 0} for i in range(3)],
        }
        reg.write_text(json.dumps(data))
        s = model.snapshot(self.root)
        ids = {c["id"] for c in s["colonies"]}
        self.assertEqual(ids, {"t1", "grace1"})  # t1 has live working panes
        self.assertEqual({x["colony"] for x in s["seats"]}, ids)

    def test_all_projects_includes_other_projects_teams(self):
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        o = os.path.realpath(other.name)
        (Path(o, ".atlas", ".run", "teams")).mkdir(parents=True)
        Path(o, ".atlas", ".run", "teams", "t2.json").write_text(
            json.dumps({"team_id": "t2", "class": "fix", "effort": "low", "task": "other", "created": time.time(), "members": [{"name": "worker-zz", "role": "implementer"}]})
        )
        projects = [{"root": self.root, "name": "a", "channels": 1}, {"root": o, "name": "b", "channels": 0}]
        with mock.patch.object(model, "_projects", return_value=projects):
            s = model.snapshot(self.root, True)
        by_id = {c["id"]: c for c in s["colonies"]}
        self.assertEqual(by_id["t2"]["project"], o)
        self.assertEqual(by_id["t1"]["project"], self.root)
        self.assertIn("worker-zz", {x["name"] for x in s["seats"] if x["colony"] == "t2"})
        with mock.patch.object(model, "_projects", return_value=projects[:1]):
            self.assertNotIn("t2", {c["id"] for c in model.snapshot(self.root)["colonies"]})

    def _skip_rule_snapshot(self, panes, projects):
        env = {"FAKE_PANES": panes}
        with mock.patch.dict(os.environ, env), mock.patch.object(model, "_projects", return_value=projects):
            return model.snapshot(self.root, True)

    def test_all_projects_skip_rule_keeps_live_panes(self):
        dirs = []
        for _ in range(3):
            d = tempfile.TemporaryDirectory()
            self.addCleanup(d.cleanup)
            dirs.append(os.path.realpath(d.name))
        a, b, c = dirs
        sub = Path(b, "sub", "dir")
        sub.mkdir(parents=True)
        outside = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, outside, True)
        Path(c, ".atlas", ".run", "board").mkdir(parents=True)  # old files only, no teams dir
        Path(c, ".atlas", ".run", "board", "old.jsonl").write_text("{}\n")
        projects = [{"root": r, "name": Path(r).name, "channels": 0} for r in (self.root, a, b, c)]
        panes = (
            f"%11\tatlas-skipa\tw\t1\t0\t0\tworker-a\timplementer\tomp\t{a}\n"
            f"%12\tatlas-skipb\tw\t2\t0\t0\tworker-b\timplementer\tomp\t{sub}\n"
            f"%13\tatlas-skipo\tw\t3\t0\t0\tworker-o\timplementer\tomp\t{outside}\n"
        )
        s = self._skip_rule_snapshot(panes, projects)
        proj = {x["id"]: x["project"] for x in s["colonies"]}
        self.assertEqual(proj.get("skipa"), a)  # (a) non-team spawn, cwd == project
        self.assertEqual(proj.get("skipb"), b)  # (b) cwd in a subdir lists under the project
        self.assertEqual(proj.get("skipo"), outside)  # (c) no registered project: its cwd
        self.assertNotIn(c, proj.values())  # (d) no teams dir, no panes: history only

    def test_all_projects_subprocess_budget_and_idle_projects_skipped(self):
        idle = []
        for i in range(30):  # registered projects with no teams dir and no live pane
            d = Path(self.root, f"idle{i}")
            d.mkdir()
            idle.append({"root": str(d), "name": f"idle{i}", "channels": 0})
        projects = [{"root": self.root, "name": "a", "channels": 1}] + idle
        calls = []
        real = model.subprocess.run
        scanned = []
        real_load = model.atlas_todo.load

        def counting(*a, **k):
            calls.append(a[0])
            return real(*a, **k)

        with mock.patch.object(model, "_projects", return_value=projects):
            model.snapshot(self.root, True)  # warms the 60 s static caches
            with mock.patch.object(model.subprocess, "run", counting), mock.patch.object(
                model.atlas_todo, "load", lambda r: (scanned.append(r), real_load(r))[1]
            ):
                model.snapshot(self.root, True)
        # list-panes, list-sessions and one capture per live pane (2); nothing per project
        self.assertLessEqual(len(calls), 4, calls)
        self.assertEqual(scanned, [self.root])

    def test_snapshot_chat_slices_age_and_held(self):
        board = Path(self.root, ".atlas", ".run", "board")
        with (board / "implementer-bb.jsonl").open("w") as f:
            for i in range(1, 121):
                ch = "proj@main/lead-x" if i % 3 else "other@main/lead-y"
                owner = "lead-x" if i == 119 else "implementer-bb"
                f.write(json.dumps({"ts": 10.0 + i, "seq": i, "owner": owner, "to": "all",
                                    "text": f"m{i}", "kind": "note", "channel": ch}) + "\n")
        s = model.snapshot(self.root)
        chat = s["chat"]
        self.assertEqual(set(chat), {"proj@main/lead-x", "other@main/lead-y"})
        px = chat["proj@main/lead-x"]
        self.assertLessEqual(len(px), 100)
        self.assertEqual([m["seq"] for m in px], sorted(m["seq"] for m in px))
        self.assertTrue(all(m["text"] and "lead" in m for m in px))
        self.assertTrue(px[-1]["lead"] and not px[0]["lead"])  # seq 119 is from the lead
        self.assertTrue(all(m["from"] == "implementer-bb" for m in chat["other@main/lead-y"]))
        col = s["colonies"][0]
        self.assertEqual(col["seat_count"], 3)
        self.assertGreater(col["age_s"], 0)
        self.assertTrue(all(x["held"] is False for x in s["seats"]))

    def test_snapshot_does_not_reread_unchanged_board_files(self):
        model.snapshot(self.root)
        real, opened = Path.open, []

        def spy(self_, *a, **k):
            opened.append(str(self_))
            return real(self_, *a, **k)

        with mock.patch.object(Path, "open", spy):
            model.snapshot(self.root)
        self.assertEqual([o for o in opened if o.endswith(".jsonl")], [])

    def test_seat_held_reads_the_wave_flag(self):
        wave = Path(self.root, ".atlas", ".run", "colony_wave.json")
        wave.write_text(json.dumps({"members": {"implementer-bb": {"paused": True}}}))
        seat = {x["name"]: x for x in model.snapshot(self.root)["seats"]}
        self.assertTrue(seat["implementer-bb"]["held"])
        self.assertFalse(seat["explorer-aa"]["held"])

    def test_snapshot_shape_and_seats(self):
        s = model.snapshot(self.root)
        self.assertEqual(
            list(s),
            [
                "ok",
                "host",
                "clock",
                "project",
                "colonies",
                "seats",
                "chat",
                "feed",
                "needs",
                "specs",
                "projects",
                "terminals",
                "system",
            ],
        )
        col = s["colonies"][0]
        self.assertEqual(
            (col["id"], col["label"], col["session"], col["transport"], col["task"]),
            ("t1", "t1 · audit/low", "atlas-t1", "tmux", "map it"),
        )
        self.assertEqual((col["name"], col["title"]), ("map", "map it"))
        self.assertEqual(set(col["source"]), {"project", "lead", "harness", "session", "label"})
        self.assertEqual(
            [p["id"] for p in col["pods"]], ["explorer", "implementer", "verifier"]
        )
        seat = {x["name"]: x for x in s["seats"]}
        self.assertEqual(
            set(seat["explorer-aa"]),
            {
                "name",
                "colony",
                "project",
                "pod",
                "role",
                "runtime",
                "model",
                "state",
                "exit_code",
                "target",
                "pid",
                "queue",
                "open_items",
                "work",
                "now",
                "log_path",
                "transcript",
                "last_active",
                "held",
                "lead",
                "address",
                "role_title",
            },
        )
        self.assertEqual(
            (
                seat["explorer-aa"]["runtime"],
                seat["explorer-aa"]["model"],
                seat["explorer-aa"]["state"],
            ),
            ("claude", "sonnet", "blocked"),
        )
        self.assertEqual(
            (
                seat["implementer-bb"]["runtime"],
                seat["implementer-bb"]["state"],
                seat["implementer-bb"]["target"],
            ),
            ("omp", "working", "%2"),
        )
        self.assertEqual(
            (
                seat["verifier-cc"]["runtime"],
                seat["verifier-cc"]["state"],
                seat["verifier-cc"]["exit_code"],
            ),
            ("codex", "finished", 0),
        )
        self.assertEqual(seat["explorer-aa"]["now"], "found it")
        self.assertEqual([n["kind"] for n in s["needs"]], ["blocked"])
        self.assertEqual(
            s["terminals"],
            [{"session": "atlas-t1", "windows": 1, "attached": 0, "panes": 3}],
        )
        self.assertTrue(s["system"]["tmux"]["ok"])
        self.assertIn("audit", {x["name"] for x in s["specs"] if x["kind"] == "team"})

    def test_pane_state_markers(self):
        cases = [
            ("claude", "✻ Thinking… (esc to interrupt)\n> ", "working"),
            ("claude", "done\n❯ ", "idle"),
            ("claude", "Do you want to run this?\n❯ 1. Yes", "blocked"),
            ("claude", "Proceed (y/n)", "blocked"),
            ("codex", "• Working (12s • esc to interrupt)\n› ", "working"),
            ("codex", "ready\n› ask", "idle"),
            ("omp", "Working…\n❯", "working"),
            ("omp", "ok\n❯ x", "idle"),
            ("omp", "\x1b[32m⣷ working\x1b[0m", "working"),
            ("claude", " ✔ DONE · 0:10 · 3 tools", "idle"),
            ("omp", " ✖ FAILED · 0:10", "idle"),
            ("claude", "random output", "unknown"),
            ("claude", "", "unknown"),
        ]
        for rt, text, want in cases:
            self.assertEqual(model.pane_state(text, rt), want, (rt, text))

    def test_capture_and_missing_tmux(self):
        self.assertIn("working", model.capture("%2", 50, ansi=False))
        self.assertIn("capture-pane -p -J -S -50 -t %2", self.log.read_text())
        model.capture("%2", ansi=True)
        self.assertIn("capture-pane -p -J -e -S -200 -t %2", self.log.read_text())
        with mock.patch.dict(os.environ, {"PATH": "/nonexistent"}):
            self.assertEqual(model.capture("%2"), "")
            self.assertEqual(model.snapshot(self.root)["terminals"], [])

    def test_attach_argv(self):
        setup, argv = model.attach_argv("%2", "ab12")
        self.assertEqual(
            setup[0],
            ["tmux", "new-session", "-d", "-t", "atlas-t1", "-s", "atlas-view-ab12"],
        )
        self.assertIn(["tmux", "select-window", "-t", "atlas-view-ab12:@4"], setup)
        self.assertIn(["tmux", "select-pane", "-t", "%2"], setup)
        self.assertEqual(argv[:4], ["tmux", "attach-session", "-t", "atlas-view-ab12"])
        self.assertEqual(argv[4:], [";", "set-option", "-t", "atlas-view-ab12", "destroy-unattached", "on"])
        self.assertFalse(any("destroy-unattached" in c for c in setup))
        self.assertTrue(any(c[1] == "if-shell" and "resize-pane -Z -t %2" in c[-1] for c in setup))
        setup, _ = model.attach_argv("atlas-t1:worker", "cd34")
        self.assertIn(["tmux", "select-window", "-t", "atlas-view-cd34:worker"], setup)
        model.cleanup_view("ab12")
        self.assertIn("kill-session -t atlas-view-ab12", self.log.read_text())


@unittest.skipUnless(shutil.which("tmux"), "tmux missing")
class RealTmuxViewTest(unittest.TestCase):
    def test_view_survives_setup_then_cleanup(self):
        import subprocess
        import time

        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            env = {**os.environ, "TMUX_TMPDIR": tmp}
            env.pop("TMUX", None)
            with mock.patch.dict(os.environ, env, clear=True):
                tm = lambda *a: subprocess.run(["tmux", *a], capture_output=True, text=True, env=env)  # noqa: E731
                made = tm("new-session", "-d", "-s", "atlas-rt", "-x", "80", "-y", "24", "-P", "-F", "#{pane_id}", "cat")
                pane = made.stdout.strip()
                self.assertTrue(pane.startswith("%"), made.stderr)
                tm("split-window", "-d", "-t", "atlas-rt", "cat")
                setup, _ = model.attach_argv(pane, "rt1")
                for c in setup:
                    r = subprocess.run(c, capture_output=True, text=True, env=env)
                    self.assertEqual(r.returncode, 0, (c, r.stderr))
                time.sleep(0.5)
                self.assertEqual(tm("has-session", "-t", "atlas-view-rt1").returncode, 0)
                self.assertEqual(tm("display-message", "-p", "-t", "atlas-view-rt1", "#{window_zoomed_flag}").stdout.strip(), "1")
                model.cleanup_view("rt1")
                self.assertNotEqual(tm("has-session", "-t", "atlas-view-rt1").returncode, 0)
                tm("kill-server")  # inside the with: a cleanup would run after TMPDIR is gone and leak the server


class TranscriptTailTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    @staticmethod
    def _write_jsonl(path, records):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
        return path

    def test_omp_tail_rendering_order_and_format(self):
        p = self._write_jsonl(
            Path(self.tmp, "s", "w.jsonl"),
            [
                {"type": "session", "timestamp": "2026-10-19T10:00:00.000Z", "id": "s1"},
                {"type": "model_change", "timestamp": "2026-10-19T10:00:01.000Z", "model": "m"},
                {
                    "type": "message",
                    "timestamp": "2026-10-19T10:00:02.000Z",
                    "message": {"role": "user", "content": "fix the bug\nplease"},
                },
                {
                    "type": "message",
                    "timestamp": "2026-10-19T10:00:03.000Z",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "thinking", "thinking": "hidden"},
                            {"type": "text", "text": "on it\nline two"},
                            {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"path": "a.py"}},
                        ],
                    },
                },
                {
                    "type": "message",
                    "timestamp": "2026-10-19T10:00:04.000Z",
                    "message": {"role": "toolResult", "content": [{"type": "text", "text": "\x1b[31mdef f(): pass\x1b[0m\nmore"}]},
                },
                {"type": "model_usage", "timestamp": "2026-10-19T10:00:05.000Z", "usage": {}},
                {"type": "custom", "customType": "session_exit", "data": {"reason": "dispose"}, "timestamp": "2026-10-19T10:00:06.000Z"},
            ],
        )
        self.assertEqual(
            model.transcript_tail(str(p)),
            ["▸ fix the bug", "please", "on it", "line two", "→ read {\"path\": \"a.py\"}", "  ← def f(): pass"],
        )

    def test_claude_tail_rendering_order_and_format(self):
        p = self._write_jsonl(
            Path(self.tmp, "c", "a.jsonl"),
            [
                {"type": "user", "timestamp": "2026-10-19T10:00:00.000Z", "message": {"role": "user", "content": "run it"}},
                {
                    "type": "assistant",
                    "timestamp": "2026-10-19T10:00:01.000Z",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "text", "text": "running"},
                            {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls -la"}},
                        ],
                    },
                },
                {
                    "type": "user",
                    "timestamp": "2026-10-19T10:00:02.000Z",
                    "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "file.txt\nother.txt"}]},
                },
            ],
        )
        self.assertEqual(
            model.transcript_tail(str(p)),
            ["▸ run it", "running", "→ Bash {\"command\": \"ls -la\"}", "  ← file.txt"],
        )

    def test_lines_limit_keeps_latest(self):
        p = self._write_jsonl(
            Path(self.tmp, "l", "x.jsonl"),
            [
                {"type": "message", "timestamp": f"2026-10-19T10:00:0{i}.000Z", "message": {"role": "assistant", "content": f"line {i}"}}
                for i in range(5)
            ],
        )
        self.assertEqual(model.transcript_tail(str(p), lines=2), ["line 3", "line 4"])

    def test_error_returns_empty(self):
        self.assertEqual(model.transcript_tail(str(Path(self.tmp, "missing.jsonl"))), [])
        d = Path(self.tmp, "adir")
        d.mkdir()
        self.assertEqual(model.transcript_tail(str(d)), [])
        bad = Path(self.tmp, "bad.jsonl")
        bad.write_bytes(b"\xff\xfe\x00garbage not json\n")
        self.assertEqual(model.transcript_tail(str(bad)), [])


class TranscriptResolutionTest(unittest.TestCase):
    def setUp(self):
        model._TRANSCRIPTS.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        p = mock.patch.dict(os.environ, {"HOME": str(self.home), "PI_CODING_AGENT_DIR": "", "CLAUDE_CONFIG_DIR": ""})
        p.start()
        self.addCleanup(p.stop)

    def _omp_session(self, slug, dirname, name, mtime=None):
        f = self.home / ".omp" / "agent" / "sessions" / slug / dirname / f"{name}.jsonl"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("{}\n")
        if mtime:
            os.utime(f, (mtime, mtime))
        return f

    def test_omp_transcript_resolves_by_sid_and_member_name(self):
        want = self._omp_session("-x-proj", "2026-10-19T17-24-15-712Z_abcdef11-48e0-7359-867a-da09d7910de0", "TuiX", mtime=100)
        self._omp_session("-x-proj", "2026-10-19T16-00-00-000Z_abcdef11-0000-0000-0000-000000000000", "TuiX", mtime=50)
        self._omp_session("-y-proj", "2026-10-19T17-00-00-000Z_abcdef11-9999-0000-0000-000000000000", "TuiX", mtime=200)
        got = model._seat_transcript("/x/proj", "TuiX", {}, {"lead": "lead-abcdef"})
        self.assertEqual(got, str(want))

    def test_omp_transcript_prefers_cwd_slug_over_newer_other_project(self):
        want = self._omp_session("-x-proj", "2026-10-19T17-24-15-712Z_abcdef22-48e0-7359-867a-da09d7910de0", "TuiY", mtime=100)
        self._omp_session("-x-proj2", "2026-10-19T18-00-00-000Z_abcdef22-48e0-7359-867a-da09d7910de0", "TuiY", mtime=900)
        got = model._seat_transcript("/x/proj", "TuiY", {}, {"lead": "lead-abcdef22"})
        self.assertEqual(got, str(want))

    def test_omp_transcript_missing_returns_empty(self):
        self.assertEqual(model._seat_transcript("/x/proj", "Nobody", {}, {"lead": "lead-abcdef"}), "")

    def test_omp_sessions_root_honours_pi_coding_agent_dir(self):
        with mock.patch.dict(os.environ, {"PI_CODING_AGENT_DIR": str(self.home / "agentdir")}):
            self.assertEqual(model._omp_sessions_root(), self.home / "agentdir" / "sessions")
        self.assertEqual(model._omp_sessions_root(), self.home / ".omp" / "agent" / "sessions")

    def test_claude_transcript_resolves_by_recorded_agent_id(self):
        f = self.home / ".claude" / "projects" / "-x-proj" / "sess-1" / "subagents" / "agent-adfb194813edbfebf.jsonl"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("{}\n")
        self.assertEqual(model._seat_transcript("/x/proj", "w", {"agent_id": "adfb194813edbfebf"}, None), str(f))
        self.assertEqual(model._seat_transcript("/x/proj", "w", {}, None), "")
        self.assertEqual(model._seat_transcript("/x/proj", "w", {"agent_id": "nope"}, None), "")

    def test_transcript_cache_honours_ttl(self):
        self._omp_session("-x-proj", "2026-10-19T17-24-15-712Z_abcdef33-48e0-7359-867a-da09d7910de0", "TuiZ")
        first = model._seat_transcript("/x/proj", "TuiZ", {}, {"lead": "lead-abcdef"})
        shutil.rmtree(self.home / ".omp")  # a rescan would find nothing
        self.assertEqual(model._seat_transcript("/x/proj", "TuiZ", {}, {"lead": "lead-abcdef"}), first)
        model._TRANSCRIPTS.clear()
        self.assertEqual(model._seat_transcript("/x/proj", "TuiZ", {}, {"lead": "lead-abcdef"}), "")

    def test_session_exit_marks_seat_finished_and_sets_end_time(self):
        root = Path(self.tmp.name, "proj")
        (root / ".atlas" / ".run" / "teams").mkdir(parents=True)
        (root / ".atlas" / ".run" / "logs").mkdir()
        chan = "proj@main/lead-abcdef"
        (root / ".atlas" / ".run" / "teams" / "se.json").write_text(
            json.dumps({"team_id": "se", "class": "fix", "effort": "low", "task": "x", "created": time.time() - 900,
                        "members": [{"name": "TuiZ", "role": "implementer"}], "channel": chan})
        )
        (root / ".atlas" / ".run" / "channels.json").write_text(
            json.dumps({"version": 1, "channels": {chan: {"name": chan, "kind": "lead", "lead": "lead-abcdef", "harness": "omp",
                                                          "members": [{"name": "TuiZ", "role": "implementer"}]}}})
        )
        exit_at = time.time() - 120
        f = self._omp_session(
            "-" + str(root).strip("/").replace("/", "-"), "2026-10-19T17-24-15-712Z_abcdef44-48e0-7359-867a-da09d7910de0", "TuiZ"
        )
        f.write_text(
            "".join(
                json.dumps(r) + "\n"
                for r in (
                    {"type": "message", "timestamp": "2026-10-19T10:00:00.000Z", "message": {"role": "assistant", "content": "done"}},
                    {"type": "custom", "customType": "session_exit", "data": {"reason": "dispose"},
                     "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(exit_at))},
                )
            )
        )
        s = model.snapshot(str(root))
        seat = next(x for x in s["seats"] if x["name"] == "TuiZ")
        self.assertEqual(seat["state"], "finished")
        self.assertEqual(seat["exit_code"], 0)
        self.assertEqual(seat["transcript"], str(f))
        seen, exit_seen_ts, _ = model._transcript_scan(str(f))
        self.assertTrue(seen)
        self.assertLess(abs(exit_seen_ts - exit_at), 2)
        colony = next(c for c in s["colonies"] if c["channel"] == chan)
        self.assertTrue(colony["finished"])
        self.assertEqual(seat["now"], "done")


if __name__ == "__main__":
    unittest.main()
