"""Colony roster: states, send/kill contract, project scoping (atlas_dash_colony)."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_dash_colony as colony  # noqa: E402
import atlas_dash_irc  # noqa: E402
import atlas_herdr  # noqa: E402
import atlas_todo  # noqa: E402

LEAD = "lead-abc123"


class Ctx:
    def __init__(self, root, name=None, body=None, query=None):
        self.root, self.groups = root, (name,) if name else ()
        self._body, self.query = body or {}, query or {}

    def json(self):
        return self._body

    def project_root(self, p):
        return self.root if p == self.root else None


class ColonyTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        os.makedirs(os.path.join(self.root, ".atlas", ".run"))
        env = mock.patch.dict(
            os.environ, {"ATLAS_HOME": self.root, "ATLAS_CHANNEL": ""}
        )
        env.start()
        self.addCleanup(env.stop)
        self.chan = atlas_todo.open_lead_channel(
            self.root, LEAD, ["w-fin", "w-bad", "w-idle", "w-sub"]
        )["name"]
        atlas_todo.mark_finished(self.root, "w-fin", 0)
        atlas_todo.mark_finished(self.root, "w-bad", 2)
        atlas_todo.add(self.root, "do idle", owner="w-idle", channel=self.chan)
        atlas_todo.add(self.root, "do sub", owner="w-sub", channel=self.chan)
        self.rows = {
            "p1": {
                "pane_id": "p1",
                "agent": "omp",
                "status": "idle",
                "cwd": self.root,
                "title": "",
            },
        }
        self.panes = {"w-idle": {"pane_id": "p1", "label": "w-idle"}}
        atlas_todo.set_member_handles(self.root, "w-idle", pane_id="p1")
        self.sent = []
        for target, val in (
            (colony, {"_herdr": lambda: (self.rows, self.panes)}),
            (
                atlas_herdr,
                {
                    "send_prompt": lambda pane, text: (
                        self.sent.append((pane, text)) or {}
                    )
                },
            ),
        ):
            for k, v in val.items():
                p = mock.patch.object(target, k, v)
                p.start()
                self.addCleanup(p.stop)

    def states(self, now=None):
        return {
            m["name"]: m["state"]
            for m in colony.build_colony(self.root, now=now)["members"]
        }

    def test_pane_less_worker_with_a_stale_log_is_dead_but_subagent_is_not(self):
        logs = Path(self.root, ".atlas", ".run", "logs")
        logs.mkdir(parents=True)
        (logs / "w-sub.log").write_text("x")
        s = self.states(now=__import__("time").time() + 3600)
        self.assertEqual(s["w-sub"], "dead")
        self.assertEqual(self.states()["w-sub"], "running")

    def test_states(self):
        s = self.states()
        self.assertEqual(s[LEAD], "running")
        self.assertEqual(s["w-fin"], "finished")
        self.assertEqual(s["w-bad"], "dead")
        self.assertEqual(s["w-idle"], "idle")
        self.assertEqual(s["w-sub"], "running")

    def test_quiet_with_open_todo_is_stuck_never_dead_without_a_pid(self):
        s = self.states(now=__import__("time").time() + 3600)
        self.assertEqual(s["w-idle"], "stuck")
        self.assertEqual(s["w-sub"], "parked")  # no pane, no pid, silent: parked wins over stuck

    def test_tasks_join_by_owner_and_lead_is_kind_lead(self):
        ms = {m["name"]: m for m in colony.build_colony(self.root)["members"]}
        self.assertEqual([t["title"] for t in ms["w-idle"]["tasks"]], ["do idle"])
        self.assertEqual(ms[LEAD]["kind"], "lead")
        self.assertTrue(ms["w-idle"]["steerable"])

    def test_send_finished_409_steerable_200_headless_queued(self):
        def send(name, **b):
            return colony.h_colony_send(
                Ctx(self.root, name, {"text": "hi", "project": self.root, **b})
            )

        status, body = send("w-fin")
        self.assertEqual((status, body["error"]), (409, "member_finished"))
        self.assertEqual(send("w-bad")[1]["error"], "member_dead")
        status, body = send("w-idle")
        self.assertEqual(
            (status, body["delivered"], body["queued"]), (200, True, False)
        )
        self.assertEqual(len(self.sent), 1)
        status, body = send("w-sub")
        self.assertEqual(
            (status, body["delivered"], body["queued"]), (200, False, True)
        )

    def test_send_and_kill_require_a_known_project(self):
        status, body = colony.h_colony_send(Ctx(self.root, "w-sub", {"text": "hi"}))
        self.assertEqual((status, body["error"]), (400, "project_required"))
        status, body = colony.h_colony_kill(Ctx(self.root, "w-sub", {}))
        self.assertEqual(status, 400)

    def test_kill_unknown_404_finished_409_lead_409(self):
        def kill(name):
            return colony.h_colony_kill(Ctx(self.root, name, {"project": self.root}))[0]

        self.assertEqual(kill("nobody"), 404)
        self.assertEqual(kill("w-fin"), 409)
        self.assertEqual(kill(LEAD), 409)

    def test_irc_post_to_finished_member_409_but_live_pane_wins(self):
        post = lambda to: atlas_dash_irc._post(  # noqa: E731
            Ctx(self.root), {"to": to, "body": "yo"}, self.root
        )
        self.assertEqual(post("w-fin")[1]["error"], "member_finished")
        live = {
            "reachable": True,
            "agents": [{**self.rows["p1"], "workspace": "", "title": "w-idle"}],
        }
        with mock.patch.object(atlas_herdr, "agents", lambda: live):
            self.assertEqual(post("w-idle")[0], 200)

    def test_member_without_handles_cannot_be_killed(self):
        status, body = colony.h_colony_kill(
            Ctx(self.root, "w-sub", {"project": self.root})
        )
        self.assertEqual((status, body["error"]), (409, "member_dead"))

    def test_kill_by_a_label_only_foreign_pane_name_is_404_and_closes_nothing(self):
        self.rows["p8"] = {
            "pane_id": "p8",
            "agent": "omp",
            "status": "idle",
            "cwd": "/elsewhere",
            "title": "",
        }
        self.panes["other-proj-w"] = {"pane_id": "p8", "label": "other-proj-w"}
        with mock.patch.object(atlas_herdr, "close_pane") as close:
            status, body = colony.h_colony_kill(
                Ctx(self.root, "other-proj-w", {"project": self.root})
            )
        self.assertEqual((status, body["error"]), (404, "no_such_member"))
        close.assert_not_called()

    def test_a_same_named_pane_of_another_project_is_not_this_members(self):

        # herdr has a live pane labelled w-sub (another project's); w-sub recorded none
        self.rows["p9"] = {
            "pane_id": "p9",
            "agent": "omp",
            "status": "idle",
            "cwd": "/elsewhere",
            "title": "",
        }
        self.panes["w-sub"] = {"pane_id": "p9", "label": "w-sub"}
        ms = {m["name"]: m for m in colony.build_colony(self.root)["members"]}
        self.assertIsNone(ms["w-sub"]["pane_id"])
        with mock.patch.object(atlas_herdr, "close_pane") as close:
            status, _ = colony.h_colony_kill(
                Ctx(self.root, "w-sub", {"project": self.root})
            )
        self.assertEqual(status, 409)
        close.assert_not_called()

    def test_kill_sigterms_the_recorded_pid(self):
        import subprocess

        child = subprocess.Popen(["sleep", "60"])
        self.addCleanup(child.kill)
        atlas_todo.set_member_handles(self.root, "w-sub", pid=child.pid)
        status, body = colony.h_colony_kill(
            Ctx(self.root, "w-sub", {"project": self.root})
        )
        self.assertEqual((status, body["via"]), (200, "pid"))
        self.assertEqual(child.wait(timeout=5), -15)

    def test_a_recorded_pid_that_is_gone_is_dead_and_unkillable(self):
        import subprocess

        child = subprocess.Popen(["true"])
        child.wait()
        atlas_todo.set_member_handles(self.root, "w-sub", pid=child.pid)
        self.assertEqual(self.states()["w-sub"], "dead")
        status, body = colony.h_colony_kill(
            Ctx(self.root, "w-sub", {"project": self.root})
        )
        self.assertEqual((status, body["error"]), (409, "member_dead"))

    def _record(self, pid, start):
        atlas_todo.set_member_handles(self.root, "w-sub", pid=pid)

        def fn(reg):
            for chan in reg["channels"].values():
                for m in chan["members"]:
                    if m["name"] == "w-sub":
                        m["pid_start"] = start

        atlas_todo._reg_update(self.root, fn, atlas_todo.CHANNEL_LOCK_TIMEOUT_S)

    def test_kill_refuses_a_recycled_pid_with_a_different_start_time(self):
        import subprocess

        child = subprocess.Popen(["sleep", "60"])
        self.addCleanup(child.kill)
        self._record(child.pid, "Thu Jan  1 00:00:00 1970")
        self.assertEqual(self.states()["w-sub"], "dead")
        status, body = colony.h_colony_kill(
            Ctx(self.root, "w-sub", {"project": self.root})
        )
        self.assertEqual((status, body["error"]), (409, "member_dead"))
        self.assertIsNone(child.poll())  # still alive

    def test_kill_refuses_a_pid_recorded_without_a_start_time(self):
        import subprocess

        child = subprocess.Popen(["sleep", "60"])
        self.addCleanup(child.kill)
        self._record(child.pid, None)
        status, body = colony.h_colony_kill(
            Ctx(self.root, "w-sub", {"project": self.root})
        )
        self.assertEqual((status, body["error"]), (409, "member_dead"))
        self.assertIsNone(child.poll())

    def test_respawn_under_the_same_name_is_live_again(self):
        atlas_todo.leave(self.root, self.chan, "w-bad")
        self.assertEqual(self.states()["w-bad"], "dead")
        atlas_todo.register_member(self.root, "w-bad", self.chan)
        self.assertEqual(self.states()["w-bad"], "running")

    def test_deliver_flags_and_last_sent_follow_the_hook_receipt(self):
        d = colony.build_colony(self.root)
        ms = {m["name"]: m for m in d["members"]}
        self.assertEqual(d["channel"]["name"], self.chan)
        self.assertFalse(ms["w-fin"]["deliver"]["ok"])
        self.assertIn("finished", ms["w-fin"]["deliver"]["reason"])
        self.assertEqual(ms["w-idle"]["deliver"]["how"], "pane")
        self.assertEqual(ms["w-sub"]["deliver"]["how"], "hook")
        self.assertIsNone(ms["w-sub"]["last_sent"])
        code, body = colony.h_colony_send(
            Ctx(self.root, "w-sub", {"text": "hello sub", "project": self.root})
        )
        self.assertEqual(code, 200)
        self.assertTrue(body["message"]["delivery_text"].startswith("queued"))
        sent = {m["name"]: m for m in colony.build_colony(self.root)["members"]}[
            "w-sub"
        ]["last_sent"]
        self.assertEqual(sent["status"], "queued")
        # the worker's hook drains it: the dashboard now reports the receipt time
        out = atlas_dash_irc.worker_inbox.drain(self.root, "w-sub")
        self.assertIn("hello sub", out)
        sent = {m["name"]: m for m in colony.build_colony(self.root)["members"]}[
            "w-sub"
        ]["last_sent"]
        self.assertEqual(sent["status"], "read")
        self.assertTrue(sent["delivery_text"].startswith("delivered to w-sub at "))

    def test_channel_views_carry_member_state_current_and_refusal(self):
        roster, cur = atlas_dash_irc._roster(self.root)
        self.assertEqual(cur, self.chan)
        view = atlas_dash_irc._chan_view(
            self.root, atlas_todo.get_channel(self.root, self.chan), {}, roster, cur
        )
        self.assertTrue(view["current"])
        mem = {m["name"]: m for m in view["members"]}
        self.assertEqual(mem["w-fin"]["live_state"], "finished")
        self.assertEqual(mem["w-fin"]["state"], "done")
        self.assertFalse(mem["w-fin"]["deliver"]["ok"])
        self.assertEqual(mem["w-bad"]["state"], "fail")

    def test_current_channel_prefers_a_session_lead_over_a_busier_named_lead(self):
        chans = [
            {"kind": "lead", "lead": "selffix", "last_activity": 9},
            {"kind": "lead", "lead": "lead-a1b2c3", "last_activity": 1},
        ]
        self.assertEqual(colony._active_lead(chans)["lead"], "lead-a1b2c3")

    def test_pane_less_pid_less_worker_silent_10_min_is_parked_and_cannot_receive(self):
        later = __import__("time").time() + colony.PARKED_S + 60
        ms = {
            m["name"]: m for m in colony.build_colony(self.root, now=later)["members"]
        }
        self.assertFalse(ms["w-sub"]["deliver"]["ok"])
        self.assertIn("parked", ms["w-sub"]["deliver"]["reason"])
        self.assertTrue(ms["w-idle"]["deliver"]["ok"])  # has a live pane
        # the state label comes from the same decision as deliver: parked, never running/idle
        self.assertEqual(ms["w-sub"]["state"], "parked")
        self.assertTrue(ms["w-sub"]["parked"])
        self.assertNotEqual(ms["w-idle"]["state"], "parked")
        fresh = {m["name"]: m for m in colony.build_colony(self.root)["members"]}
        self.assertTrue(fresh["w-sub"]["deliver"]["ok"])

    def test_member_finish_cli_resolves_an_omp_subagent_id(self):
        import subprocess

        out = subprocess.run(
            [
                sys.executable,
                str(Path(colony.__file__).with_name("atlas_todo.py")),
                "member-finish",
                "--root",
                self.root,
                "--agent",
                "3-w-sub",
                "--exit",
                "0",
            ],
            capture_output=True,
            text=True,
            env={**os.environ, "ATLAS_HOME": self.root},
        )
        self.assertIn('"member": "w-sub"', out.stdout)
        self.assertEqual(self.states()["w-sub"], "finished")

    def _sessions(self, age, now):
        """A fake omp session dir holding the lead's transcript (id starts abc123), `age` seconds old."""
        base = Path(self.root) / "sessions"
        f = base / "-proj" / "2026-10-09T16-00-00-000Z_abc123ff-0000.jsonl"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.touch()
        t = now - age
        os.utime(f, (t, t))
        return base

    def test_lead_liveness_is_derived_from_session_signals_not_a_pane(self):
        now = __import__("time").time()
        for age, db, want_active, text in (
            (30, {}, True, "active, last session write 30s ago"),
            (600, {}, False, "idle 10 min"),
            (600, {"tool call": now - 5}, True, "active, last tool call 5s ago"),
        ):
            base = self._sessions(age, now)
            with (
                mock.patch.object(colony, "_session_roots", lambda b=base: [b]),
                mock.patch.object(colony, "_db_last", lambda _s, d=db: d),
            ):
                lv = colony.lead_liveness(self.root, LEAD, now)
                lead = next(
                    m
                    for m in colony.build_colony(self.root, now=now)["members"]
                    if m["kind"] == "lead"
                )
            self.assertIsNotNone(lv)
            assert lv
            self.assertEqual(lv["active"], want_active)
            self.assertEqual(lv["text"], text)
            self.assertEqual(lead["state"], "running" if want_active else "idle")
            self.assertIsNone(
                lead["pane_id"]
            )  # no pane involved: headless is only "no terminal pane"
            self.assertTrue(lead["headless"])
            self.assertEqual(lead["liveness"]["text"], text)
        with (
            mock.patch.object(colony, "_session_roots", lambda: []),
            mock.patch.object(colony, "_db_last", lambda _s: {}),
        ):
            self.assertIsNone(colony.lead_liveness(self.root, LEAD, now))
            self.assertIsNone(colony.lead_liveness(self.root, "selffix", now))

    def test_a_note_to_the_lead_is_tracked_and_reads_as_delivered_only_after_the_hook_drains_it(
        self,
    ):
        dead = {"reachable": False, "agents": []}
        with mock.patch.object(atlas_herdr, "agents", lambda: dead):
            for to in ("lead", LEAD):  # bare `lead` resolves to the channel's lead
                code, body = atlas_dash_irc._post(
                    Ctx(self.root),
                    {"to": to, "body": f"hi {to}", "channel": self.chan},
                    self.root,
                )
                self.assertEqual(code, 200)
                self.assertEqual(body["message"]["to"], LEAD)
                self.assertEqual(body["message"]["status"], "queued")
                self.assertTrue(body["message"]["delivery_text"].startswith("queued"))
        import worker_inbox  # the hook module, as the lead's PostToolUse runs it

        out = worker_inbox.drain(self.root, LEAD, aliases=("lead",))
        self.assertIn("hi lead", out)
        self.assertIn(f"hi {LEAD}", out)
        msgs, _more = atlas_dash_irc.read_messages([self.root])
        got = {m["body"]: m for m in msgs if m["body"].startswith("hi ")}
        self.assertEqual({m["status"] for m in got.values()}, {"read"})
        self.assertTrue(
            got["hi lead"]["delivery_text"].startswith(f"delivered to {LEAD} at ")
        )


if __name__ == "__main__":
    unittest.main()
