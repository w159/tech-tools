"""Wave control verbs: pause/resume/cancel contract on fixture state (atlas_dash_colony)."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
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


class WaveTest(unittest.TestCase):
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
        self.sent, self.closed, self.signals = [], [], []
        self.wave_file = Path(self.root, ".atlas", ".run", "colony_wave.json")
        for target, val in (
            (colony, {"_herdr": lambda: (self.rows, self.panes)}),
            (
                atlas_herdr,
                {
                    "send_prompt": lambda pane, text: (
                        self.sent.append((pane, text)) or {}
                    ),
                    "close_pane": lambda pane_id: (
                        self.closed.append(pane_id) or {"ok": True}
                    ),
                },
            ),
        ):
            for k, v in val.items():
                p = mock.patch.object(target, k, v)
                p.start()
                self.addCleanup(p.stop)
        killer = mock.patch("os.kill", lambda pid, sig: self.signals.append((pid, sig)))
        killer.start()
        self.addCleanup(killer.stop)

    def verb(self, handler, name, **body) -> tuple[int, dict]:
        result = handler(Ctx(self.root, name, {"project": self.root, **body}))
        assert isinstance(result, tuple) and len(result) == 2, result
        return result

    def send(self, name, **extra):
        return colony.h_colony_send(
            Ctx(self.root, name, {"text": "hi", "project": self.root, **extra})
        )

    def row(self, name):
        for m in colony.build_colony(self.root)["members"]:
            if m["name"] == name:
                return m
        raise AssertionError(name)

    # --- atomic wave writes ----------------------------------------------------------------

    def test_wave_write_round_trips_and_leaves_no_tmp_residue(self):
        self.verb(colony.h_colony_pause, "w-idle")
        run_dir = self.wave_file.parent
        wave = colony._wave_read(self.root)
        self.assertEqual(wave["members"]["w-idle"]["paused"], True)
        self.assertEqual(list(run_dir.glob("*.tmp*")), [])

    def test_pause_refuses_sends_until_resume(self):
        self.assertEqual(
            self.verb(colony.h_colony_pause, "w-idle")[1]["paused"], "w-idle"
        )
        status, body = self.send("w-idle")
        self.assertEqual((status, body["error"]), (409, "member_paused"))
        self.assertEqual(self.sent, [])  # nothing typed while paused
        self.assertEqual(
            self.verb(colony.h_colony_resume, "w-idle")[1]["resumed"], "w-idle"
        )
        status, body = self.send("w-idle")
        self.assertEqual((status, body["delivered"]), (200, True))

    def test_pause_is_a_flag_never_a_kill(self):
        self.verb(colony.h_colony_pause, "w-sub")
        self.assertEqual((self.closed, self.signals), ([], []))
        self.assertEqual(self.row("w-sub")["wave"], {"paused": True, "canceled": False})

    def test_resume_is_a_noop_without_a_hold(self):
        status, body = self.verb(colony.h_colony_resume, "w-sub")
        self.assertEqual((status, body["resume_state"]), (200, None))

    # --- cancel graceful ----------------------------------------------------------------

    def test_cancel_graceful_lets_the_worker_live_and_records_resume_state(self):
        status, body = self.send(
            "w-sub"
        )  # a pending unit: queued for its next tool call
        self.assertEqual((status, body["queued"]), (200, True))
        status, body = self.verb(colony.h_colony_cancel, "w-sub")
        self.assertEqual(
            (status, body["mode"], body["running"]), (200, "graceful", "running")
        )
        items = body["resume_state"]["open_items"]
        self.assertEqual([i["content"] for i in items], ["do sub"])
        self.assertEqual(len(body["resume_state"]["queued_messages"]), 1)
        self.assertEqual((self.closed, self.signals), ([], []))  # worker untouched
        wave = json.loads(self.wave_file.read_text())
        self.assertTrue(wave["members"]["w-sub"]["canceled"])
        status, e = self.send("w-sub")
        self.assertEqual((status, e["error"]), (409, "member_canceled"))
        self.assertEqual(self.row("w-sub")["wave"]["canceled"], True)

    def test_resume_after_cancel_returns_the_recorded_resume_state(self):
        self.verb(colony.h_colony_cancel, "w-sub")
        status, body = self.verb(colony.h_colony_resume, "w-sub")
        self.assertEqual(status, 200)
        self.assertEqual(
            [i["content"] for i in body["resume_state"]["open_items"]], ["do sub"]
        )
        self.assertEqual(self.send("w-sub")[1]["queued"], True)  # queueing reopens
        self.assertEqual(
            self.row("w-sub")["wave"], {"paused": False, "canceled": False}
        )

    def test_cancel_graceful_refuses_a_finished_member(self):
        status, body = self.verb(colony.h_colony_cancel, "w-fin")
        self.assertEqual((status, body["error"]), (409, "member_finished"))

    # --- cancel hard = the kill contract -------------------------------------------------

    def test_cancel_hard_uses_the_kill_contract(self):
        status, body = self.verb(colony.h_colony_cancel, "w-idle", hard=True)
        self.assertEqual(
            (status, body), (200, {"ok": True, "killed": "w-idle", "via": "pane"})
        )
        self.assertEqual(self.closed, ["p1"])
        self.assertEqual(self.signals, [])

    def test_cancel_hard_on_a_pid_member_sigterms_it(self):
        # registry pid path, exactly like kill: SIGTERM the recorded pid
        import subprocess

        child = subprocess.Popen(["sleep", "60"])
        self.addCleanup(child.kill)
        atlas_todo.set_member_handles(self.root, "w-sub", pid=child.pid)
        status, body = self.verb(colony.h_colony_cancel, "w-sub", hard=True)
        self.assertEqual(
            (status, body), (200, {"ok": True, "killed": "w-sub", "via": "pid"})
        )
        self.assertEqual(self.signals, [(child.pid, 15)])

    # --- the lead is never a wave target -------------------------------------------------

    def test_the_lead_is_not_killable_by_any_wave_verb(self):
        for handler, body in (
            (colony.h_colony_pause, {}),
            (colony.h_colony_resume, {}),
            (colony.h_colony_cancel, {}),
            (colony.h_colony_cancel, {"hard": True}),
        ):
            status, e = self.verb(handler, LEAD, **body)
            self.assertEqual((status, e["error"]), (409, "lead_not_killable"))

    # --- receipts on the roster -----------------------------------------------------------

    def test_queued_and_refused_receipts_surface_on_the_roster(self):
        self.assertEqual(self.send("w-sub")[1]["queued"], True)
        r = self.row("w-sub")
        self.assertEqual((r["queued"], r["last_sent"]["status"]), (1, "queued"))
        boom = mock.patch.object(
            atlas_herdr,
            "send_prompt",
            mock.Mock(
                side_effect=atlas_herdr.PromptRefused(503, "herdr_down", "no socket")
            ),
        )
        boom.start()
        self.addCleanup(boom.stop)
        status, body = self.send("w-idle")
        self.assertEqual((status, body["receipt"]), (503, "refused"))
        r = self.row("w-idle")
        self.assertEqual((r["queued"], r["last_sent"]["status"]), (0, "refused"))


if __name__ == "__main__":
    unittest.main()
