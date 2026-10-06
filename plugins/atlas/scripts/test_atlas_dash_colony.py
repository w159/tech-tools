#!/usr/bin/env python3
"""Tests for atlas_dash_colony: todos, IRC, colony state, send guard, spawn-help.

Hermetic: temp project root + temp sqlite db, and tmux is replaced by a fake
(`_tmux` / `tmux_available` patched), so the real tmux server is never touched.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import atlas_db  # noqa: E402
import atlas_dash_colony as colony  # noqa: E402
import atlas_todo  # noqa: E402

REAL_PS_TREE = (
    colony._ps_tree
)  # ColonyTestBase patches it with a hermetic fake; real-tmux tests need the real one


class Ctx:
    """Stand-in for the dashboard's per-request context."""

    def __init__(self, db_path, root, query=None, body=None):
        self._db_path = db_path
        self._root = root
        self.query = query or {}
        self._body = body or {}
        self.groups = ()

    def json(self):
        return self._body

    def db(self):
        conn = atlas_db.connect(self._db_path)
        atlas_db.init(conn)
        return conn

    def project_root(self, param):
        if param in (None, "", "all"):
            return None
        return self._root if param == self._root else None


class FakeTmux:
    """Scriptable replacement for atlas_dash_colony._tmux."""

    def __init__(self):
        self.sessions = {}  # session -> {"created": ts, "panes": [pane dict]}
        self.screens = {}  # pane_id -> text
        self.sent = []  # (pane_id, kind, payload)
        self.killed = []
        self.foreground = {}  # pane_id -> pane_current_command (default: an interactive claude)
        self.pane_pids = {}  # pane_id -> pid string answered to the foreground probe
        self.ps = {}  # pane pid -> [command lines of that pid and its children]

    def add(
        self, session, window, pane_id, text="", dead=False, status=0, activity=None
    ):
        s = self.sessions.setdefault(
            session, {"created": time.time() - 100, "panes": []}
        )
        s["panes"].append(
            {
                "window": window,
                "pane_id": pane_id,
                "dead": dead,
                "status": status,
                "activity": time.time() if activity is None else activity,
            }
        )
        self.screens[pane_id] = text

    def __call__(self, *args, timeout=5.0):
        cmd = args[0]
        out, rc = "", 0
        if cmd == "list-sessions":
            out = "\n".join(
                f"{n}\t{int(s['created'])}" for n, s in self.sessions.items()
            )
        elif cmd == "list-panes":
            sess = args[args.index("-t") + 1]
            panes = self.sessions.get(sess, {}).get("panes", [])
            out = "\n".join(
                "\t".join(
                    (
                        p["window"],
                        p["pane_id"],
                        "1" if p["dead"] else "0",
                        str(p["status"]) if p["dead"] else "",
                        str(int(p["activity"])),
                        "node",
                    )
                )
                for p in panes
            )
            rc = 0 if sess in self.sessions else 1
        elif cmd == "capture-pane":
            out = self.screens.get(args[args.index("-t") + 1], "")
        elif cmd == "send-keys":
            pane = args[args.index("-t") + 1]
            if "-l" in args:
                rest = args[args.index("-l") + 1 :]
                self.sent.append(
                    (pane, "text", rest[1] if rest[:1] == ("--",) else rest[0])
                )
            else:
                self.sent.append((pane, "key", args[-1]))
        elif cmd == "display":
            pane = args[args.index("-t") + 1]
            if pane in self.screens:
                out = f"{self.pane_pids.get(pane, '1000')}\t{self.foreground.get(pane, 'claude')}\n"
            else:
                rc = 1
        elif cmd == "has-session":
            rc = 0 if args[args.index("-t") + 1] in self.sessions else 1
        elif cmd in ("kill-session", "kill-window"):
            self.killed.append(args[-1])
        return subprocess.CompletedProcess(["tmux", *args], rc, out, "")


class ColonyTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.realpath(self.tmp.name)
        (Path(self.root) / ".atlas" / ".run").mkdir(parents=True)
        self.db_path = os.path.join(self.root, "atlas.db")
        conn = atlas_db.connect(self.db_path)
        atlas_db.init(conn)
        self.project_id = atlas_db.register_project(conn, self.root)
        conn.commit()
        conn.close()
        colony._BASE_CACHE.clear()
        self.fake = FakeTmux()
        for patcher in (
            mock.patch.object(colony, "_tmux", self.fake),
            mock.patch.object(colony, "tmux_available", lambda: True),
            mock.patch.object(
                colony, "_ps_tree", lambda pid: self.fake.ps.get(pid, [])
            ),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def ctx(self, query=None, body=None):
        q = {"project": self.root}
        q.update(query or {})
        b = dict(body or {})
        b.setdefault("project", self.root)
        return Ctx(self.db_path, self.root, q, b)

    def call(self, route_method, route_path, query=None, body=None):
        for method, pattern, fn in colony.ROUTES:
            if method == route_method and pattern == route_path:
                return fn(self.ctx(query, body))
        raise AssertionError(f"no route {route_method} {route_path}")

    def note(self, owner, text, to="lead", ts=None):
        rec = atlas_todo.note(self.root, owner, text, to=to)
        if ts is not None:  # rewrite the timestamp for staleness scenarios
            path = atlas_todo.notes_dir(self.root) / f"{owner}.jsonl"
            lines = path.read_text().splitlines()
            last = json.loads(lines[-1])
            last["ts"] = ts
            lines[-1] = json.dumps(last)
            path.write_text("\n".join(lines) + "\n")
        return rec


class RouteTableTest(unittest.TestCase):
    def test_contract_routes_exist(self):
        got = {(m, p) for m, p, _ in colony.ROUTES}
        for want in (
            ("GET", "/api/v2/colony"),
            ("GET", "/api/v2/colony/agent"),
            ("GET", "/api/v2/colony/capture"),
            ("POST", "/api/v2/colony/send"),
            ("POST", "/api/v2/colony/kill"),
            ("POST", "/api/v2/colony/spawn-help"),
            ("POST", "/api/v2/colony/attach-command"),
            ("GET", "/api/v2/irc"),
            ("POST", "/api/v2/irc"),
            ("GET", "/api/v2/todos"),
            ("POST", "/api/v2/todos"),
        ):
            self.assertIn(want, got)

    def test_handlers_are_callable_and_patterns_compile(self):
        import re

        for _m, pattern, fn in colony.ROUTES:
            re.compile(pattern)
            self.assertTrue(callable(fn))


class StateInferenceTest(unittest.TestCase):
    NOW = 1_000_000.0

    def infer(self, **kw):
        base = dict(
            pane_text="",
            dead=False,
            exit_code=None,
            activity=self.NOW - 5,
            last_note_ts=0.0,
            now=self.NOW,
            has_pane=True,
        )
        base.update(kw)
        return colony.infer_state(**base)[0]

    def test_working_when_recent_activity(self):
        self.assertEqual(self.infer(), "working")

    def test_idle_when_quiet(self):
        self.assertEqual(self.infer(activity=self.NOW - 900), "idle")

    def test_needs_input_on_prompt(self):
        self.assertEqual(self.infer(pane_text="Overwrite file? (y/n)\n"), "needs_input")
        self.assertEqual(self.infer(pane_text="Continue [Y/n]"), "needs_input")

    def test_failed_on_error_text_or_nonzero_exit(self):
        self.assertEqual(self.infer(pane_text='Model "x" not found'), "failed")
        self.assertEqual(self.infer(exit_code=1), "failed")

    def test_exited_on_zero_exit(self):
        self.assertEqual(self.infer(exit_code=0), "exited")

    def test_dead_pane_without_exit_code_is_exited_or_failed(self):
        self.assertIn(self.infer(dead=True), ("exited", "failed"))

    def test_unknown_without_pane_or_evidence(self):
        self.assertEqual(
            self.infer(activity=0.0, has_pane=False, pane_text=None), "unknown"
        )

    def test_note_activity_counts_without_pane(self):
        self.assertEqual(
            self.infer(
                activity=0.0, has_pane=False, pane_text=None, last_note_ts=self.NOW - 3
            ),
            "working",
        )

    def test_stuck_diagnosis(self):
        self.assertTrue(colony.diagnose_stuck("needs_input", 600, 0, "")["is_stuck"])
        self.assertFalse(colony.diagnose_stuck("needs_input", 5, 0, "")["is_stuck"])
        self.assertTrue(colony.diagnose_stuck("failed", 1, 0, "exit 1")["is_stuck"])
        stuck = colony.diagnose_stuck("idle", 900, 2, "")
        self.assertTrue(stuck["is_stuck"])
        self.assertIn("2 claimed", stuck["reason"])
        self.assertFalse(colony.diagnose_stuck("idle", 900, 0, "")["is_stuck"])
        self.assertFalse(colony.diagnose_stuck("working", 1, 3, "")["is_stuck"])


class TodosTest(ColonyTestBase):
    def todos(self):
        status, body = self.call("GET", "/api/v2/todos")
        self.assertEqual(status, 200, body)
        return body

    def all_items(self):
        return [i for ph in self.todos()["phases"] for i in ph["items"]]

    def test_empty_board_shape(self):
        body = self.todos()
        self.assertEqual(body["project"], self.root)
        self.assertEqual(body["phases"], [])
        self.assertEqual(
            body["counts"], {"open": 0, "in_progress": 0, "done": 0, "blocked": 0}
        )

    def test_add_then_status_roundtrip(self):
        status, body = self.call(
            "POST", "/api/v2/todos", body={"op": "add", "content": "ship the dashboard"}
        )
        self.assertEqual(status, 200, body)
        self.assertTrue(body["ok"])
        self.assertTrue(body["next"])
        item = body["state"]["phases"][0]["items"][0]
        self.assertEqual(item["content"], "ship the dashboard")
        self.assertEqual(item["status"], "open")
        for key in (
            "id",
            "content",
            "status",
            "phase",
            "owner",
            "claimed_by",
            "updated",
        ):
            self.assertIn(key, item)

        status, body = self.call(
            "POST",
            "/api/v2/todos",
            body={"op": "status", "id": item["id"], "status": "done"},
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["state"]["counts"]["done"], 1)
        self.assertEqual(atlas_todo.load(self.root)["items"][0]["status"], "completed")

    def test_add_with_phase_groups_items(self):
        phases = atlas_todo.todo_phases()
        if not phases:
            self.skipTest("no todo phases in the operating contract")
        self.call(
            "POST",
            "/api/v2/todos",
            body={"op": "add", "content": "a", "phase": phases[0]},
        )
        self.call("POST", "/api/v2/todos", body={"op": "add", "content": "b"})
        names = [p["name"] for p in self.todos()["phases"]]
        self.assertEqual(names, [phases[0], "unphased"])

    def test_claim_and_assign_and_conflict(self):
        _, body = self.call("POST", "/api/v2/todos", body={"op": "add", "content": "x"})
        tid = body["state"]["phases"][0]["items"][0]["id"]
        status, body = self.call(
            "POST", "/api/v2/todos", body={"op": "claim", "id": tid, "owner": "alice"}
        )
        self.assertEqual(status, 200, body)
        item = self.all_items()[0]
        self.assertEqual(
            (item["status"], item["owner"], item["claimed_by"]),
            ("in_progress", "alice", "alice"),
        )
        status, body = self.call(
            "POST", "/api/v2/todos", body={"op": "claim", "id": tid, "owner": "bob"}
        )
        self.assertEqual(status, 409)
        self.assertFalse(body["ok"])
        status, body = self.call(
            "POST", "/api/v2/todos", body={"op": "assign", "id": tid, "owner": "carol"}
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(self.all_items()[0]["owner"], "carol")

    def test_update_content_and_remove(self):
        _, body = self.call(
            "POST", "/api/v2/todos", body={"op": "add", "content": "old"}
        )
        tid = body["state"]["phases"][0]["items"][0]["id"]
        status, body = self.call(
            "POST", "/api/v2/todos", body={"op": "update", "id": tid, "content": "new"}
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(self.all_items()[0]["content"], "new")
        status, body = self.call(
            "POST", "/api/v2/todos", body={"op": "remove", "id": tid}
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(self.all_items(), [])

    def test_blocked_status_and_clearing(self):
        _, body = self.call("POST", "/api/v2/todos", body={"op": "add", "content": "x"})
        tid = body["state"]["phases"][0]["items"][0]["id"]
        _, body = self.call(
            "POST",
            "/api/v2/todos",
            body={"op": "status", "id": tid, "status": "blocked"},
        )
        self.assertEqual(body["state"]["counts"]["blocked"], 1)
        _, body = self.call(
            "POST", "/api/v2/todos", body={"op": "status", "id": tid, "status": "open"}
        )
        self.assertEqual(body["state"]["counts"]["blocked"], 0)
        self.assertEqual(body["state"]["counts"]["open"], 1)

    def test_move_and_reorder(self):
        phases = atlas_todo.todo_phases()
        if len(phases) < 2:
            self.skipTest("needs two todo phases")
        ids = []
        for text in ("a", "b", "c"):
            _, body = self.call(
                "POST", "/api/v2/todos", body={"op": "add", "content": text}
            )
            ids = [i["id"] for ph in body["state"]["phases"] for i in ph["items"]]
        for tid in ids:
            status, _ = self.call(
                "POST",
                "/api/v2/todos",
                body={"op": "move", "id": tid, "phase": phases[0]},
            )
            self.assertEqual(status, 200)
        status, body = self.call(
            "POST",
            "/api/v2/todos",
            body={"op": "reorder", "phase": phases[0], "ids": list(reversed(ids))},
        )
        self.assertEqual(status, 200, body)
        got = [i["id"] for i in body["state"]["phases"][0]["items"]]
        self.assertEqual(got, list(reversed(ids)))

    def test_errors_are_honest(self):
        status, body = self.call("POST", "/api/v2/todos", body={"op": "nope"})
        self.assertEqual(status, 400)
        self.assertFalse(body["ok"])
        for key in ("error", "why", "do"):
            self.assertIn(key, body)
        status, body = self.call(
            "POST", "/api/v2/todos", body={"op": "add", "content": " "}
        )
        self.assertEqual(status, 400)
        status, body = self.call(
            "POST",
            "/api/v2/todos",
            body={"op": "status", "id": "tnope", "status": "done"},
        )
        self.assertEqual(status, 404)
        status, body = self.call(
            "POST", "/api/v2/todos", body={"op": "status", "id": "x", "status": "weird"}
        )
        self.assertEqual(status, 400)
        status, _ = self.call(
            "POST", "/api/v2/todos", body={"op": "add", "project": ""}
        )
        self.assertEqual(status, 400)

    def test_writes_use_the_board_lock(self):
        with mock.patch.object(
            colony, "_file_lock", wraps=atlas_todo._file_lock
        ) as lock:
            _, body = self.call(
                "POST", "/api/v2/todos", body={"op": "add", "content": "x"}
            )
            tid = body["state"]["phases"][0]["items"][0]["id"]
            self.call(
                "POST", "/api/v2/todos", body={"op": "assign", "id": tid, "owner": "z"}
            )
        self.assertTrue(lock.called)

    def test_get_requires_known_project(self):
        ctx = Ctx(self.db_path, self.root, {"project": "/nope"})
        status, body = colony.h_todos_get(ctx)
        self.assertEqual(status, 400)
        self.assertFalse(body["ok"])

    def test_get_without_project_or_all_merges_known_boards(self):
        self.call("POST", "/api/v2/todos", body={"op": "add", "content": "alpha"})
        for query in ({"project": "all"}, {"project": ""}):
            ctx = Ctx(self.db_path, self.root, query)
            status, body = colony.h_todos_get(ctx)
            self.assertEqual(status, 200, body)
            self.assertEqual(body["project"], "all")
            self.assertEqual(body["projects"], [self.root])
            items = [i for ph in body["phases"] for i in ph["items"]]
            self.assertEqual([i["content"] for i in items], ["alpha"])
            self.assertEqual(items[0]["project"], self.root)
            self.assertEqual(body["counts"]["open"], 1)

    def test_get_all_with_no_boards_is_empty_not_an_error(self):
        import shutil

        shutil.rmtree(Path(self.root) / ".atlas")
        colony._BASE_CACHE.clear()
        status, body = colony.h_todos_get(Ctx(self.db_path, self.root, {}))
        self.assertEqual(status, 200, body)
        self.assertEqual(body["phases"], [])


class IrcTest(ColonyTestBase):
    def test_post_then_get_roundtrip(self):
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "all", "body": "hello colony"}
        )
        self.assertEqual(status, 200, body)
        self.assertTrue(body["ok"])
        msg = body["message"]
        self.assertEqual(
            (msg["from"], msg["to"], msg["body"]), ("human", "all", "hello colony")
        )
        self.assertEqual(msg["kind"], "irc")

        status, got = self.call("GET", "/api/v2/irc")
        self.assertEqual(status, 200)
        bodies = [m["body"] for m in got["messages"]]
        self.assertEqual(bodies, ["hello colony"])
        for key in (
            "id",
            "ts",
            "from",
            "to",
            "body",
            "kind",
            "run",
            "project",
            "channel",
        ):
            self.assertIn(key, got["messages"][0])
        self.assertIn("human", got["agents"])
        self.assertEqual(got["channels"], ["all"])

    def test_board_notes_are_normalized_and_exit_is_typed(self):
        self.note("worker1", "doing things", to="lead")
        self.note("worker1", "exit 1 [failed: http 402]", to="lead")
        _, got = self.call("GET", "/api/v2/irc")
        kinds = {m["body"]: m["kind"] for m in got["messages"]}
        self.assertEqual(kinds["doing things"], "note")
        self.assertEqual(kinds["exit 1 [failed: http 402]"], "exit")
        self.assertIn("@lead", got["channels"])

    def test_messages_are_ordered_and_deduped(self):
        self.note("a", "one", ts=100.0)
        self.note("b", "two", ts=200.0)
        self.note("c", "three", ts=150.0)
        _, got = self.call("GET", "/api/v2/irc")
        self.assertEqual([m["body"] for m in got["messages"]], ["one", "three", "two"])
        ids = [m["id"] for m in got["messages"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_filters_since_agent_limit(self):
        self.note("a", "one", to="b", ts=100.0)
        self.note("b", "two", to="a", ts=200.0)
        self.note("c", "three", to="d", ts=300.0)
        _, got = self.call("GET", "/api/v2/irc", query={"agent": "a"})
        self.assertEqual([m["body"] for m in got["messages"]], ["one", "two"])
        _, got = self.call("GET", "/api/v2/irc", query={"since": "150"})
        self.assertEqual([m["body"] for m in got["messages"]], ["two", "three"])
        first_id = self.call("GET", "/api/v2/irc")[1]["messages"][0]["id"]
        _, got = self.call("GET", "/api/v2/irc", query={"since": first_id})
        self.assertEqual([m["body"] for m in got["messages"]], ["two", "three"])
        _, got = self.call("GET", "/api/v2/irc", query={"limit": "1"})
        self.assertEqual([m["body"] for m in got["messages"]], ["three"])

    def test_post_validation(self):
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "all", "body": "  "}
        )
        self.assertEqual(status, 400)
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "a b;rm", "body": "x"}
        )
        self.assertEqual(status, 400)
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "all", "body": "x", "project": ""}
        )
        self.assertEqual(status, 400)

    def test_post_to_agent_with_pane_delivers(self):
        self.fake.add(
            "atlas-r1", "w1", "%1", text="idle prompt\n", activity=time.time() - 300
        )
        self.note("w1", "started", to="lead")
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w1", "body": "status?"}
        )
        self.assertEqual(status, 200, body)
        self.assertTrue(body["delivered"])
        texts = [p for _, kind, p in self.fake.sent if kind == "text"]
        self.assertTrue(texts and "From: human" in texts[0] and "To: w1" in texts[0])
        self.assertIn("status?", texts[0])

    def test_post_to_agent_at_prompt_is_guarded_but_recorded(self):
        self.fake.add("atlas-r1", "w1", "%1", text="Proceed? (y/n)\n")
        self.note("w1", "started", to="lead")
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w1", "body": "yes"}
        )
        self.assertEqual(status, 200)
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"], "typing_guard")
        self.assertEqual(self.fake.sent, [])
        _, got = self.call("GET", "/api/v2/irc")
        self.assertIn("yes", [m["body"] for m in got["messages"]])


class ColonyTest(ColonyTestBase):
    def snapshot(self):
        status, body = self.call("GET", "/api/v2/colony")
        self.assertEqual(status, 200, body)
        return body

    def test_empty_colony_shape(self):
        snap = self.snapshot()
        self.assertTrue(snap["tmux_available"])
        self.assertEqual(snap["rigs"], [])
        self.assertEqual(
            snap["counts"],
            {
                "working": 0,
                "idle": 0,
                "needs_input": 0,
                "failed": 0,
                "exited": 0,
                "unknown": 0,
            },
        )
        self.assertIn("mux_enabled", snap)

    def test_rig_and_agent_states_from_tmux(self):
        self.fake.add("atlas-r1", "lead", "%0")
        self.fake.add("atlas-r1", "busy", "%1", text="working...\n")
        self.fake.add("atlas-r1", "asker", "%2", text="Delete it? (y/n)\n")
        self.fake.add(
            "atlas-r1", "quiet", "%3", text="$ \n", activity=time.time() - 3600
        )
        self.fake.add("atlas-r1", "done", "%4", dead=True, status=0)
        self.fake.add("atlas-r1", "broke", "%5", dead=True, status=2)
        for n in ("busy", "asker", "done", "broke"):
            self.note(n, "hello", to="lead")
        self.note("quiet", "hello", to="lead", ts=time.time() - 3600)
        snap = self.snapshot()
        rig = next(r for r in snap["rigs"] if r["run"] == "r1")
        self.assertEqual(rig["id"], "atlas-r1")
        self.assertEqual(rig["project"], self.root)
        self.assertEqual(rig["tmux_session"], "atlas-r1")
        states = {a["name"]: a["state"] for a in rig["agents"]}
        self.assertNotIn("lead", states)
        self.assertEqual(states["busy"], "working")
        self.assertEqual(states["asker"], "needs_input")
        self.assertEqual(states["quiet"], "idle")
        self.assertEqual(states["done"], "exited")
        self.assertEqual(states["broke"], "failed")
        agent = next(a for a in rig["agents"] if a["name"] == "busy")
        for key in (
            "name",
            "role",
            "harness",
            "state",
            "window",
            "pane_id",
            "started",
            "last_activity",
            "idle_seconds",
            "exit_code",
            "todo_ids",
            "last_note",
            "stuck",
        ):
            self.assertIn(key, agent)
        self.assertEqual(agent["window"], "busy")
        self.assertEqual(agent["pane_id"], "%1")
        self.assertEqual(snap["counts"]["needs_input"], 1)
        self.assertEqual(snap["counts"]["failed"], 1)
        self.assertEqual(snap["counts"]["exited"], 1)

    def test_counts_cover_every_listed_agent_including_unknown(self):
        """Stale board dispatches (no pane, past the working window) are `unknown`,
        and the header counts must add up to the agents the rigs list."""
        conn = atlas_db.connect(self.db_path)
        run_id = atlas_db.start_run(conn, self.project_id, "sess-1")
        old = time.time() - 3 * 3600
        for _ in range(2):
            conn.execute(
                "INSERT INTO dispatches(run_id, ts, agent_type) VALUES(?,?,?)",
                (run_id, old, "atlas:explorer"),
            )
        conn.commit()
        conn.close()
        snap = self.snapshot()
        listed = [a for r in snap["rigs"] for a in r["agents"]]
        self.assertEqual(len(listed), 2)
        self.assertEqual(snap["counts"]["unknown"], 2)
        self.assertEqual(sum(snap["counts"].values()), len(listed))

    def test_other_projects_rigs_are_excluded(self):
        self.fake.add("atlas-other", "stranger", "%9", text="x\n")
        snap = self.snapshot()
        self.assertEqual(snap["rigs"], [])

    def test_agent_todos_and_stuck_idle_with_claimed_work(self):
        self.fake.add("atlas-r1", "w", "%1", text="$ \n", activity=time.time() - 4000)
        self.note("w", "claimed it", to="lead", ts=time.time() - 4000)
        added = atlas_todo.add(self.root, "do work")
        atlas_todo.claim(self.root, added["item"]["id"], "w")
        rig = self.snapshot()["rigs"][0]
        agent = rig["agents"][0]
        self.assertEqual(agent["todo_ids"], [added["item"]["id"]])
        self.assertTrue(agent["stuck"]["is_stuck"])

    def test_no_tmux_falls_back_to_board_notes_and_dispatches(self):
        with mock.patch.object(colony, "tmux_available", lambda: False):
            self.note("sub1", "analysing", to="lead")
            conn = atlas_db.connect(self.db_path)
            run_id = conn.execute(
                "INSERT INTO runs (project_id, session_id, started_at) VALUES (?, 's1', ?)",
                (self.project_id, time.time()),
            ).lastrowid
            conn.execute(
                "INSERT INTO dispatches (run_id, ts, agent_type, model, wave_id) VALUES (?, ?, 'implementer', 'claude-opus', 1)",
                (run_id, time.time()),
            )
            conn.commit()
            conn.close()
            snap = self.snapshot()
        self.assertFalse(snap["tmux_available"])
        agents = [a for r in snap["rigs"] for a in r["agents"]]
        names = {a["name"] for a in agents}
        self.assertIn("sub1", names)
        self.assertTrue(any(n.startswith("implementer#") for n in names))
        for a in agents:
            self.assertIsNone(a["window"])
            self.assertIsNone(a["pane_id"])
        impl = next(a for a in agents if a["name"].startswith("implementer#"))
        self.assertEqual(impl["harness"], "claude")
        self.assertEqual(impl["state"], "working")

    def test_agent_detail_and_capture(self):
        self.fake.add("atlas-r1", "w", "%1", text="line1\nline2\n")
        self.note("w", "hi lead", to="lead")
        self.note("lead", "hi w", to="w")
        status, body = self.call(
            "GET", "/api/v2/colony/agent", query={"run": "r1", "name": "w"}
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["name"], "w")
        self.assertEqual({m["body"] for m in body["notes"]}, {"hi lead", "hi w"})
        self.assertIn("line2", body["pane_tail"])
        self.assertIsInstance(body["todos"], list)
        status, cap = self.call(
            "GET",
            "/api/v2/colony/capture",
            query={"run": "r1", "name": "w", "lines": "50"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(cap["source"], "tmux")
        self.assertIn("line1", cap["text"])
        self.assertTrue(cap["captured"])
        status, _ = self.call(
            "GET", "/api/v2/colony/agent", query={"run": "r1", "name": "ghost"}
        )
        self.assertEqual(status, 404)
        status, _ = self.call("GET", "/api/v2/colony/agent", query={"run": "r1"})
        self.assertEqual(status, 400)

    def test_capture_without_pane_uses_notes(self):
        with mock.patch.object(colony, "tmux_available", lambda: False):
            self.note("sub1", "alpha", to="lead")
            self.note("sub1", "beta", to="lead")
            status, cap = self.call(
                "GET", "/api/v2/colony/capture", query={"run": "board", "name": "sub1"}
            )
        self.assertEqual(status, 200)
        self.assertEqual(cap["source"], "notes")
        self.assertEqual(cap["text"].splitlines(), ["alpha", "beta"])

    def test_capture_strips_ansi(self):
        self.fake.add("atlas-r1", "w", "%1", text="\x1b[31mred\x1b[0m plain\n")
        self.note("w", "x", to="lead")
        _, cap = self.call(
            "GET", "/api/v2/colony/capture", query={"run": "r1", "name": "w"}
        )
        self.assertEqual(cap["text"].strip(), "red plain")


class SendTest(ColonyTestBase):
    def setUp(self):
        super().setUp()
        self.fake.add("atlas-r1", "w", "%1", text="$ \n", activity=time.time() - 200)
        self.note("w", "ready", to="lead")

    def send(self, **body):
        body.setdefault("run", "r1")
        body.setdefault("name", "w")
        return self.call("POST", "/api/v2/colony/send", body=body)

    def test_send_types_envelope_then_enter_and_records_irc(self):
        status, body = self.send(text="please report")
        self.assertEqual(status, 200, body)
        self.assertTrue(body["delivered"])
        kinds = [(k) for _, k, _ in self.fake.sent]
        self.assertEqual(kinds, ["text", "key"])
        self.assertEqual(self.fake.sent[1][2], "Enter")
        typed = self.fake.sent[0][2]
        self.assertIn("From: human", typed)
        self.assertIn("To: w", typed)
        self.assertIn("please report", typed)
        _, irc = self.call("GET", "/api/v2/irc")
        self.assertIn("please report", [m["body"] for m in irc["messages"]])

    def test_typing_guard_refuses_prompt_unless_forced(self):
        self.fake.screens["%1"] = "Apply changes? (y/n)\n"
        status, body = self.send(text="y")
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "typing_guard")
        self.assertEqual(self.fake.sent, [])
        status, body = self.send(text="y", force=True)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["delivered"])
        self.assertEqual(len(self.fake.sent), 2)

    def test_send_without_pane_records_only(self):
        self.fake.sessions.clear()
        with mock.patch.object(colony, "tmux_available", lambda: False):
            status, body = self.send(run="board", name="w", text="note this")
        self.assertEqual(status, 200, body)
        self.assertFalse(body["delivered"])
        self.assertEqual(self.fake.sent, [])
        _, irc = self.call("GET", "/api/v2/irc")
        self.assertIn("note this", [m["body"] for m in irc["messages"]])

    def test_send_validation(self):
        self.assertEqual(self.send(text="")[0], 400)
        self.assertEqual(self.send(name="a b", text="x")[0], 400)
        self.assertEqual(self.send(name="ghost", text="x")[0], 404)

    def test_exited_agent_is_not_typed_into(self):
        self.fake.add("atlas-r1", "gone", "%7", dead=True, status=0)
        self.note("gone", "bye", to="lead")
        status, body = self.send(name="gone", text="hello?")
        self.assertEqual(status, 200, body)
        self.assertFalse(body["delivered"])
        self.assertEqual(self.fake.sent, [])


class KillSpawnAttachTest(ColonyTestBase):
    def test_kill_window_and_session(self):
        self.fake.add("atlas-r1", "w", "%1")
        self.note("w", "x", to="lead")
        status, body = self.call(
            "POST", "/api/v2/colony/kill", body={"run": "r1", "name": "w"}
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(self.fake.killed, ["atlas-r1:w"])
        status, body = self.call("POST", "/api/v2/colony/kill", body={"run": "r1"})
        self.assertEqual(status, 200, body)
        self.assertEqual(self.fake.killed[-1], "atlas-r1")

    def test_kill_rejects_bad_names_and_unknown_rigs(self):
        for body in (
            {"run": "r1; rm -rf /"},
            {"run": "r1", "name": "a;b"},
            {"run": ""},
        ):
            status, resp = self.call("POST", "/api/v2/colony/kill", body=body)
            self.assertEqual(status, 400, body)
            self.assertFalse(resp["ok"])
        status, _ = self.call("POST", "/api/v2/colony/kill", body={"run": "nope"})
        self.assertEqual(status, 404)
        self.assertEqual(self.fake.killed, [])

    def test_kill_without_tmux_is_409(self):
        with mock.patch.object(colony, "tmux_available", lambda: False):
            status, _ = self.call("POST", "/api/v2/colony/kill", body={"run": "r1"})
        self.assertEqual(status, 409)

    def test_spawn_help_gives_commands_and_never_spawns(self):
        with (
            mock.patch.object(subprocess, "run") as run,
            mock.patch.object(subprocess, "Popen") as popen,
        ):
            status, body = self.call("POST", "/api/v2/colony/spawn-help")
        self.assertEqual(status, 200)
        run.assert_not_called()
        popen.assert_not_called()
        commands = [s["command"] for s in body["steps"]]
        self.assertTrue(any("ATLAS_MUX=tmux" in c for c in commands))
        self.assertTrue(any("atlas_mux.py" in c and "spawn" in c for c in commands))
        self.assertIn("mux_enabled", body)

    def test_attach_command(self):
        _, body = self.call("POST", "/api/v2/colony/attach-command", body={"run": "r1"})
        self.assertEqual(body["command"], "tmux attach -t atlas-r1")
        _, body = self.call(
            "POST", "/api/v2/colony/attach-command", body={"run": "r1", "name": "w"}
        )
        self.assertEqual(body["command"], "tmux attach -t atlas-r1:w")
        _, body = self.call(
            "POST", "/api/v2/colony/attach-command", body={"run": "atlas-r1"}
        )
        self.assertEqual(body["command"], "tmux attach -t atlas-r1")
        status, _ = self.call(
            "POST", "/api/v2/colony/attach-command", body={"run": "r1; ls"}
        )
        self.assertEqual(status, 400)


class SendGuardTest(ColonyTestBase):
    """Typing is allowed only into an interactive claude/omp TUI; nothing else is ever typed into."""

    def setUp(self):
        super().setUp()
        self.fake.add("atlas-r1", "w", "%1", text="idle\n", activity=time.time() - 200)
        self.note("w", "ready", to="lead")

    def send(self, **body):
        body.setdefault("run", "r1")
        body.setdefault("name", "w")
        return self.call("POST", "/api/v2/colony/send", body=body)

    def recorded(self, text):
        _, irc = self.call("GET", "/api/v2/irc")
        return [m for m in irc["messages"] if m["body"] == text]

    def test_shells_and_other_processes_are_refused_even_with_force(self):
        for command in (
            "bash",
            "zsh",
            "sh",
            "fish",
            "dash",
            "ksh",
            "tcsh",
            "-zsh",
            "Python",
            "python3",
            "node",
            "bun",
            "vim",
            "",
        ):
            with self.subTest(command=command):
                self.fake.foreground["%1"] = command
                for force in (False, True):
                    status, body = self.send(
                        text=f"echo {command or 'none'}", force=force
                    )
                    self.assertEqual(status, 409, body)
                    self.assertFalse(body["ok"])
                    self.assertFalse(body["delivered"])
                    self.assertEqual(body["error"], "pane_not_steerable")
                    self.assertTrue(body["why"] and body["do"])
                self.assertEqual(self.fake.sent, [])
                rec = self.recorded(f"echo {command or 'none'}")
                self.assertTrue(
                    rec, "the refused message must still be recorded on the board"
                )
                self.assertEqual({m["status"] for m in rec}, {"refused"})

    def test_probe_failure_fails_closed(self):
        real_fake = self.fake

        def display_fails(*args, timeout=5.0):
            if args[0] == "display":
                return subprocess.CompletedProcess(["tmux", *args], 1, "", "no server")
            return real_fake(*args, timeout=timeout)

        with mock.patch.object(colony, "_tmux", display_fails):
            status, body = self.send(text="hello", force=True)
        self.assertEqual(status, 409, body)
        self.assertEqual(body["error"], "pane_not_steerable")
        self.assertEqual(self.fake.sent, [])

    def test_run_worker_pane_gets_a_queued_note_and_nothing_typed(self):
        self.fake.foreground["%1"] = "Python"
        self.fake.pane_pids["%1"] = "4242"
        self.fake.ps["4242"] = [
            "/usr/bin/python3 /x/atlas_mux.py run-worker --name w --harness claude"
        ]
        status, body = self.send(text="please report")
        self.assertEqual(status, 200, body)
        self.assertTrue(body["ok"])
        self.assertEqual(body["delivered"], "queued")
        self.assertEqual(body["detail"], colony.QUEUED_DETAIL)
        self.assertEqual(self.fake.sent, [])
        notes = [
            r for r in atlas_todo.notes(self.root) if r.get("text") == "please report"
        ]
        self.assertEqual([(n["owner"], n["to"]) for n in notes], [("human", "w")])

    def test_headless_harness_child_is_queued_not_typed(self):
        self.fake.foreground["%1"] = "claude"
        self.fake.pane_pids["%1"] = "77"
        self.fake.ps["77"] = [
            "python worker.py",
            "claude -p --model sonnet do the thing",
        ]
        status, body = self.send(text="steer", force=True)
        self.assertEqual((status, body["delivered"]), (200, "queued"), body)
        self.assertEqual(self.fake.sent, [])

    def test_interactive_harness_is_typed_literally_then_enter(self):
        for command in ("claude", "omp"):
            with self.subTest(command=command):
                self.fake.sent.clear()
                self.fake.foreground["%1"] = command
                self.fake.pane_pids["%1"] = "5"
                self.fake.ps["5"] = [f"/usr/local/bin/{command} --model x"]
                status, body = self.send(text="ping")
                self.assertEqual(status, 200, body)
                self.assertIs(body["delivered"], True)
                self.assertEqual(body["message"]["status"], "delivered")
                self.assertEqual([k for _, k, _ in self.fake.sent], ["text", "key"])
                self.assertEqual(self.fake.sent[1][2], "Enter")

    def test_embedded_newlines_and_control_chars_are_neutralised(self):
        status, body = self.send(text="line1\nrm -rf /\r\n\x1b[2Jtab\there\x03\x7f")
        self.assertEqual(status, 200, body)
        typed = self.fake.sent[0][2]
        self.assertNotRegex(typed, r"[\x00-\x1f\x7f]")
        self.assertIn("line1", typed)
        self.assertIn("rm -rf /", typed)  # kept as inert text on the same line
        self.assertEqual([k for _, k, _ in self.fake.sent], ["text", "key"])

    def test_sanitize_keys_unit(self):
        self.assertEqual(colony.sanitize_keys("a\nb\rc\td\x1be\x7ff"), "a b c d e f")
        self.assertEqual(colony.sanitize_keys("plain ünïcode ok"), "plain ünïcode ok")

    def test_headless_detection_needs_a_standalone_dash_p(self):
        self.assertTrue(colony._is_headless("claude -p hello"))
        self.assertTrue(colony._is_headless("/usr/bin/omp -p x"))
        self.assertFalse(colony._is_headless("claude --port 3 --print"))
        self.assertFalse(colony._is_headless("python -p thing"))

    def test_irc_post_to_shell_pane_is_refused_but_recorded(self):
        self.fake.foreground["%1"] = "zsh"
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "whoami", "force": True}
        )
        self.assertEqual(status, 200)
        self.assertFalse(body["ok"])
        self.assertFalse(body["delivered"])
        self.assertEqual(body["error"], "pane_not_steerable")
        self.assertEqual(body["message"]["status"], "refused")
        self.assertEqual(self.fake.sent, [])
        self.assertEqual(len(self.recorded("whoami")), 1, "recorded exactly once")
        self.assertEqual(self.recorded("whoami")[0]["status"], "refused")

    def test_irc_post_to_run_worker_is_queued(self):
        self.fake.foreground["%1"] = "Python"
        self.fake.pane_pids["%1"] = "9"
        self.fake.ps["9"] = ["python atlas_mux.py run-worker --name w"]
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "hello"}
        )
        self.assertEqual(
            (status, body["ok"], body["delivered"]), (200, True, "queued"), body
        )
        self.assertEqual(body["message"]["status"], "queued")
        self.assertEqual(self.fake.sent, [])
        self.assertEqual(len(self.recorded("hello")), 1)
        self.assertEqual(self.recorded("hello")[0]["status"], "queued")


@unittest.skipUnless(shutil.which("tmux"), "tmux not installed")
class RealTmuxSendTest(ColonyTestBase):
    """Real tmux server on a private socket: what the dashboard would type into, and what it must not."""

    def setUp(self):
        super().setUp()
        self.sock = os.path.join(self.root, "tmux.sock")
        self.addCleanup(self.tmux, "kill-server")
        real = subprocess.run

        def private_tmux(*args, timeout=5.0):
            return real(
                ["tmux", "-S", self.sock, "-f", "/dev/null", *args],
                capture_output=True,
                text=True,
                timeout=timeout,
            )

        for patcher in (
            mock.patch.object(colony, "_tmux", private_tmux),
            mock.patch.object(colony, "_ps_tree", REAL_PS_TREE),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.note("w", "ready", to="lead")

    def tmux(self, *args):
        return subprocess.run(
            ["tmux", "-S", self.sock, "-f", "/dev/null", *args],
            capture_output=True,
            text=True,
        )

    def spawn(self, *command):
        res = self.tmux(
            "new-session",
            "-d",
            "-x",
            "120",
            "-y",
            "30",
            "-s",
            "atlas-r1",
            "-n",
            "w",
            *command,
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        deadline = time.time() + 5
        while time.time() < deadline:  # wait for the foreground process to exist
            out = self.tmux(
                "display", "-p", "-t", "atlas-r1:w", "#{pane_current_command}"
            ).stdout.strip()
            if out:
                return
            time.sleep(0.05)

    def screen(self):
        return self.tmux("capture-pane", "-p", "-t", "atlas-r1:w").stdout

    def send(self, text, **extra):
        return self.call(
            "POST",
            "/api/v2/colony/send",
            body={"run": "r1", "name": "w", "text": text, **extra},
        )

    def stub_named(self, name):
        """A real binary whose process name is `name` (a symlink would report `sleep`)."""
        path = os.path.join(self.root, name)
        sleep = shutil.which("sleep")
        self.assertIsNotNone(sleep, "no sleep binary to copy")
        shutil.copy(str(sleep), path)
        if sys.platform == "darwin":  # a copied signed binary is killed until re-signed
            subprocess.run(
                ["codesign", "-f", "-s", "-", path], capture_output=True, check=True
            )
        return path

    def test_shell_pane_gets_409_and_nothing_is_typed(self):
        marker = os.path.join(self.root, "EXECUTED")
        self.spawn("sh")  # a real interactive-capable shell as the pane's foreground
        time.sleep(0.4)
        before = self.screen()
        status, body = self.send(f"touch {marker}", force=True)
        time.sleep(0.5)
        self.assertEqual(status, 409, body)
        self.assertEqual(body["error"], "pane_not_steerable")
        self.assertFalse(body["delivered"])
        self.assertFalse(os.path.exists(marker), "the shell ran the text as a command")
        self.assertEqual(
            self.screen(), before, "something was typed into the shell pane"
        )
        _, irc = self.call("GET", "/api/v2/irc")
        self.assertIn(f"touch {marker}", [m["body"] for m in irc["messages"]])

    def test_run_worker_pane_is_queued_and_nothing_is_typed(self):
        # a real process whose argv carries the mux marker; pane_current_command is Python/python3, never a harness
        self.spawn(
            sys.executable,
            "-c",
            "import time;time.sleep(60)",
            "atlas_mux.py",
            "run-worker",
        )
        before = self.screen()
        status, body = self.send("hello worker")
        time.sleep(0.4)
        self.assertEqual((status, body["delivered"]), (200, "queued"), body)
        self.assertEqual(self.screen(), before)
        notes = [
            r for r in atlas_todo.notes(self.root) if r.get("text") == "hello worker"
        ]
        self.assertEqual([(n["owner"], n["to"]) for n in notes], [("human", "w")])

    def test_plain_python_pane_is_refused(self):
        self.spawn(sys.executable, "-c", "import time;time.sleep(60)")
        before = self.screen()
        status, body = self.send("print(1)", force=True)
        self.assertEqual(status, 409, body)
        self.assertEqual(self.screen(), before)

    def test_interactive_harness_stub_receives_the_text_literally(self):
        claude = self.stub_named("claude")
        self.spawn(claude, "60")
        self.assertEqual(
            self.tmux(
                "display", "-p", "-t", "atlas-r1:w", "#{pane_current_command}"
            ).stdout.strip(),
            "claude",
        )
        status, body = self.send("-l hello; $(touch x) `id`\nsecond line")
        time.sleep(0.5)
        self.assertEqual(status, 200, body)
        self.assertIs(body["delivered"], True)
        screen = self.screen()
        self.assertIn(
            "From: human | To: w | -l hello; $(touch x) `id` | second line", screen
        )
        self.assertFalse(os.path.exists(os.path.join(self.root, "x")))


class IrcDeliveryStatusTest(ColonyTestBase):
    """`status: queued|read|delivered|refused` on IRC and drawer messages. queued/read come from
    the cursor the worker's own PostToolUse hook advances (hooks/worker_inbox.py); delivered and
    refused are the dashboard's own send outcome, persisted on the note."""

    def setUp(self):
        super().setUp()
        sys.path.insert(0, str(SCRIPTS.parent / "hooks"))
        import worker_inbox

        self.inbox = worker_inbox
        self.env = {"ATLAS_WORKER_NAME": "w", "ATLAS_PROJECT_ROOT": self.root}

    def messages(self, **query):
        status, body = self.call("GET", "/api/v2/irc", query=query)
        self.assertEqual(status, 200, body)
        return body["messages"]

    def one(self, text):
        (msg,) = [m for m in self.messages() if m["body"] == text]
        return msg

    def test_message_to_a_worker_is_queued_until_its_hook_drains_it(self):
        atlas_todo.note(self.root, colony.HUMAN, "please report", to="w")
        self.assertEqual(self.one("please report")["status"], "queued")
        out = self.inbox.context_for_post_tool_use(self.env)
        self.assertIn("please report", out)
        self.assertEqual(self.one("please report")["status"], "read")

    def test_only_the_drained_message_flips(self):
        base = time.time() - 100
        self.note(colony.HUMAN, "first", to="w", ts=base)
        self.inbox.context_for_post_tool_use(self.env)
        self.note(colony.HUMAN, "second", to="w", ts=base + 5)
        self.assertEqual(self.one("first")["status"], "read")
        self.assertEqual(self.one("second")["status"], "queued")

    def test_each_workers_cursor_is_its_own(self):
        atlas_todo.note(self.root, colony.HUMAN, "for w", to="w")
        atlas_todo.note(self.root, colony.HUMAN, "for v", to="v")
        self.inbox.context_for_post_tool_use(self.env)
        self.assertEqual(self.one("for w")["status"], "read")
        self.assertEqual(self.one("for v")["status"], "queued")

    def test_lines_nobody_is_waiting_for_are_never_queued(self):
        atlas_todo.note(self.root, "w", "compiling", to="lead")  # mux stdout mirror
        atlas_todo.note(self.root, "w", "exit 0", to="lead")
        atlas_todo.note(self.root, colony.HUMAN, "everyone", to="all")
        atlas_todo.note(self.root, "a", "agent to agent", to="b")
        atlas_todo.note(self.root, "board", "todos reset", to="w")
        for text in (
            "compiling",
            "exit 0",
            "everyone",
            "agent to agent",
            "todos reset",
        ):
            self.assertEqual(self.one(text)["status"], "read", text)

    def test_posting_through_the_route_reports_queued_then_read(self):
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "via the route"}
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["message"]["status"], "queued")
        self.inbox.context_for_post_tool_use(self.env)
        self.assertEqual(self.one("via the route")["status"], "read")

    def test_agent_drawer_notes_carry_the_same_status(self):
        self.fake.add("atlas-r1", "w", "%1", text="")
        # a rig belongs to the project whose board holds notes owned by its windows
        atlas_todo.note(self.root, "w", "started", to="lead")
        atlas_todo.note(self.root, colony.HUMAN, "drawer ping", to="w")
        q = {"run": "r1", "name": "w"}
        status, body = self.call("GET", "/api/v2/colony/agent", query=q)
        self.assertEqual(status, 200, body)
        (note,) = [n for n in body["notes"] if n["body"] == "drawer ping"]
        self.assertEqual(note["status"], "queued")
        self.inbox.context_for_post_tool_use(self.env)
        status, body = self.call("GET", "/api/v2/colony/agent", query=q)
        (note,) = [n for n in body["notes"] if n["body"] == "drawer ping"]
        self.assertEqual(note["status"], "read")

    def test_missing_hook_module_means_queued_never_a_crash(self):
        atlas_todo.note(self.root, colony.HUMAN, "no hooks dir", to="w")
        with mock.patch.object(colony, "worker_inbox", None):
            self.assertEqual(self.one("no hooks dir")["status"], "queued")

    def test_same_worker_name_in_two_projects_does_not_bleed(self):
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        other_root = os.path.realpath(other.name)
        (Path(other_root) / ".atlas" / ".run").mkdir(parents=True)
        atlas_todo.note(self.root, colony.HUMAN, "same name", to="w")
        atlas_todo.note(other_root, colony.HUMAN, "same name", to="w")
        self.inbox.context_for_post_tool_use(self.env)  # drains only self.root
        by_project = {
            m["project"]: m["status"]
            for m in colony.read_messages([self.root, other_root])
            if m["body"] == "same name"
        }
        self.assertEqual(by_project, {self.root: "read", other_root: "queued"})

    # --- delivered / refused -------------------------------------------------------------

    def interactive_pane(self):
        self.fake.add("atlas-r1", "w", "%1", text="idle\n", activity=time.time() - 200)
        self.note("w", "ready", to="lead")
        self.fake.foreground["%1"] = "claude"
        self.fake.pane_pids["%1"] = "5"
        self.fake.ps["5"] = ["/usr/local/bin/claude --model x"]

    def drawer_note(self, text):
        status, body = self.call(
            "GET", "/api/v2/colony/agent", query={"run": "r1", "name": "w"}
        )
        self.assertEqual(status, 200, body)
        (note,) = [n for n in body["notes"] if n["body"] == text]
        return note

    def test_typed_into_an_interactive_pane_is_delivered_not_queued_forever(self):
        self.interactive_pane()
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "typed in"}
        )
        self.assertEqual(
            (status, body["ok"], body["delivered"]), (200, True, True), body
        )
        self.assertEqual(body["message"]["status"], "delivered")
        self.assertEqual(self.one("typed in")["status"], "delivered")
        self.assertEqual(self.drawer_note("typed in")["status"], "delivered")
        # nobody drains a cursor for a typed line: draining the worker's inbox must not change it
        self.inbox.context_for_post_tool_use(self.env)
        self.assertEqual(self.one("typed in")["status"], "delivered")

    def test_colony_send_to_an_interactive_pane_is_delivered(self):
        self.interactive_pane()
        status, body = self.call(
            "POST",
            "/api/v2/colony/send",
            body={"run": "r1", "name": "w", "text": "via send"},
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["message"]["status"], "delivered")
        self.assertEqual(self.one("via send")["status"], "delivered")
        self.assertEqual(self.drawer_note("via send")["status"], "delivered")

    def test_shell_pane_message_is_refused_not_queued(self):
        self.fake.add("atlas-r1", "w", "%1", text="$ \n", activity=time.time() - 200)
        self.note("w", "ready", to="lead")
        self.fake.foreground["%1"] = "zsh"
        # POST /api/v2/irc answers HTTP 200 with ok:false; /colony/send answers 409
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "ls -la"}
        )
        self.assertEqual(status, 200, body)
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"], "pane_not_steerable")
        self.assertEqual(body["message"]["status"], "refused")
        status, body = self.call(
            "POST",
            "/api/v2/colony/send",
            body={"run": "r1", "name": "w", "text": "pwd"},
        )
        self.assertEqual(status, 409, body)
        self.assertEqual(body["error"], "pane_not_steerable")
        self.assertEqual(body["message"]["status"], "refused")
        self.assertEqual(self.fake.sent, [])
        self.assertEqual(self.one("ls -la")["status"], "refused")
        self.assertEqual(self.one("pwd")["status"], "refused")
        self.assertEqual(self.drawer_note("ls -la")["status"], "refused")
        # refused is terminal: a hook drain never turns it into read
        self.inbox.context_for_post_tool_use(self.env)
        self.assertEqual(self.one("ls -la")["status"], "refused")

    def test_worker_messages_keep_queued_then_read_semantics(self):
        # -p run-worker pane: nothing typed, the hook drains it later
        self.fake.add("atlas-r1", "w", "%1", text="", activity=time.time() - 200)
        self.note("w", "ready", to="lead")
        self.fake.foreground["%1"] = "Python"
        self.fake.pane_pids["%1"] = "9"
        self.fake.ps["9"] = ["python atlas_mux.py run-worker --name w"]
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "for -p"}
        )
        self.assertEqual((status, body["delivered"]), (200, "queued"), body)
        self.assertEqual(self.one("for -p")["status"], "queued")
        self.inbox.context_for_post_tool_use(self.env)
        self.assertEqual(self.one("for -p")["status"], "read")

    def test_no_pane_note_stays_queued_not_delivered(self):
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "nobody home"}
        )
        self.assertEqual((status, body["delivered"]), (200, False), body)
        self.assertEqual(self.one("nobody home")["status"], "queued")

    def test_delivery_outcome_is_ignored_for_lines_nobody_waits_on(self):
        atlas_todo.note(self.root, "w", "mirror", to="lead", delivery="refused")
        atlas_todo.note(
            self.root, colony.HUMAN, "to all", to="all", delivery="delivered"
        )
        self.assertEqual(self.one("mirror")["status"], "read")
        self.assertEqual(self.one("to all")["status"], "read")

    def test_delivered_and_refused_survive_a_missing_hook_module(self):
        atlas_todo.note(self.root, colony.HUMAN, "typed", to="w", delivery="delivered")
        atlas_todo.note(self.root, colony.HUMAN, "bounced", to="w", delivery="refused")
        with mock.patch.object(colony, "worker_inbox", None):
            self.assertEqual(self.one("typed")["status"], "delivered")
            self.assertEqual(self.one("bounced")["status"], "refused")


if __name__ == "__main__":
    unittest.main()
