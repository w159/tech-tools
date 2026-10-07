#!/usr/bin/env python3
"""Tests for the unified agents feed (atlas_dash_herd): /api/v2/agents, peek, prompt.

Hermetic: a fake herdr speaks the real newline-JSON protocol on a temp unix socket
(HERDR_SOCKET_PATH), so no real pane is ever read or typed into. atlas_herdr.status() is
patched because the real one probes the herdr web UI over HTTP.
"""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import http.client
import importlib.util
import json
import os
import re
import socketserver
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import atlas_db  # noqa: E402
import atlas_dash_herd as herd  # noqa: E402
import atlas_dash_irc as irc  # noqa: E402
import atlas_dash_work as work  # noqa: E402
import atlas_herdr  # noqa: E402

STATUS = {
    "healthy": True,
    "url": "http://127.0.0.1:1",
    "auth_required": False,
    "server_up": True,
}
FAKE_TOKEN = (
    "abcdefghijklmnopqrstuvwx1234"  # a fake bearer value, only used to prove masking
)


class FakeHerdr:
    """Serves the herdr socket methods the dashboard uses from mutable fixtures."""

    def __init__(self, path):
        self.calls = []
        self.agents = [
            self.agent(
                "wA:p1", "wA", "wA:t1", "omp", "idle", "/work/alpha", "alpha lead"
            ),
            self.agent(
                "wA:p2", "wA", "wA:t2", "omp", "working", "/work/alpha", "build-api"
            ),
            self.agent("wB:p1", "wB", "wB:t1", "unknown", "idle", "/work/beta", "zsh"),
        ]
        self.workspaces = [
            {
                "workspace_id": "wA",
                "label": "alpha",
                "focused": True,
                "agent_status": "working",
                "pane_count": 2,
            },
            {
                "workspace_id": "wB",
                "label": "beta",
                "focused": False,
                "agent_status": "idle",
                "pane_count": 1,
            },
            {
                "workspace_id": "wC",
                "label": "atlas-work",
                "focused": False,
                "agent_status": "working",
                "pane_count": 1,
            },
        ]
        self.tabs = [
            {
                "tab_id": "wA:t1",
                "workspace_id": "wA",
                "number": 1,
                "label": "main",
                "focused": True,
                "pane_count": 1,
                "agent_status": "idle",
            },
            {
                "tab_id": "wA:t2",
                "workspace_id": "wA",
                "number": 2,
                "label": "api-worker",
                "focused": False,
                "pane_count": 1,
                "agent_status": "working",
            },
        ]
        self.colony_panes = [
            {
                "pane_id": "wA:p2",
                "workspace_id": "wC",
                "tab_id": "wA:t2",
                "label": "build-api",
            }
        ]
        self.screen = (
            f"line one\n\x1b[31mred\x1b[0m line\nAuthorization: Bearer {FAKE_TOKEN}\n"
        )
        outer = self

        class H(socketserver.StreamRequestHandler):
            def handle(self):
                req = json.loads(self.rfile.readline())
                res = outer.reply(req["method"], req.get("params") or {})
                self.wfile.write((json.dumps({"id": req["id"], **res}) + "\n").encode())

        class S(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
            daemon_threads = True

        self.server = S(path, H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @staticmethod
    def agent(pane, ws, tab, kind, status, cwd, title, seq=1):
        return {
            "pane_id": pane,
            "workspace_id": ws,
            "tab_id": tab,
            "agent": kind,
            "agent_status": status,
            "cwd": cwd,
            "terminal_title": title,
            "terminal_title_stripped": title,
            "focused": False,
            "state_change_seq": seq,
            "completion_seq": 0,
        }

    def reply(self, method, params):
        self.calls.append((method, params))
        if method == "ping":
            return {"result": {"type": "pong"}}
        if method == "agent.list":
            return {"result": {"agents": self.agents}}
        if method == "workspace.list":
            return {"result": {"workspaces": self.workspaces}}
        if method == "tab.list":
            return {"result": {"tabs": self.tabs}}
        if method == "pane.list":
            ws = params.get("workspace_id")
            return {
                "result": {
                    "panes": [p for p in self.colony_panes if p["workspace_id"] == ws]
                }
            }
        if method == "pane.read":
            if params["pane_id"] not in {a["pane_id"] for a in self.agents}:
                return {"error": {"message": "pane not found"}}
            return {"result": {"read": {"text": self.screen, "truncated": False}}}
        if method == "agent.prompt":
            return {"result": {"type": "ok"}}
        return {"error": {"message": f"unknown method {method}"}}

    def typed(self):
        return [p for m, p in self.calls if m == "agent.prompt"]

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class Ctx:
    """The dashboard's per-request context: db() opens a fresh connection each call."""

    def __init__(self, db_path, root, query=None, body=None, groups=()):
        self.db_path, self.root = db_path, root
        self.query, self._body, self.groups = query or {}, body or {}, groups

    def json(self):
        return self._body

    def db(self):
        return sqlite3.connect(self.db_path)

    def project_root(self, param):
        return self.root if param == self.root else None


class AgentsBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.realpath(self.tmp.name) + "/work-alpha"
        (Path(self.root) / ".atlas" / ".run").mkdir(parents=True)
        self.db_path = os.path.join(self.tmp.name, "atlas.db")
        self.conn = sqlite3.connect(self.db_path)
        self.addCleanup(self.conn.close)
        atlas_db.init(self.conn)
        atlas_db.register_project(self.conn, self.root, "work-alpha")
        self.conn.commit()
        work._BASE_CACHE.clear()
        herd._PROJECTS.update(at=0.0, roots=[])
        herd._SEEN.clear()
        sock_dir = tempfile.mkdtemp(prefix="hd", dir="/tmp")  # AF_UNIX paths stay short
        self.sock = os.path.join(sock_dir, "h.sock")
        self.herdr = FakeHerdr(self.sock)
        self.addCleanup(self.herdr.close)
        for p in (
            mock.patch.dict(os.environ, {"HERDR_SOCKET_PATH": self.sock}),
            mock.patch.object(atlas_herdr, "status", lambda: dict(STATUS)),
            mock.patch.object(
                work, "_junk_root", lambda path: False
            ),  # tmp dirs are junk
        ):
            p.start()
            self.addCleanup(p.stop)

    def ctx(self, query=None, body=None, groups=()):
        return Ctx(self.db_path, self.root, query, body, groups)

    def feed(self, **query):
        status, body = herd._agents_unified(self.ctx(query))
        self.assertEqual(status, 200)
        return body

    @staticmethod
    def by_key(body):
        return {a["key"]: a for a in body["agents"]}

    def herdr_down(self):
        return mock.patch.dict(os.environ, {"HERDR_SOCKET_PATH": self.sock + ".gone"})

    def add_todo(self, content):
        _, body = work.h_todos_post(
            self.ctx(body={"op": "add", "project": self.root, "content": content})
        )
        return body["state"]["phases"][0]["items"][0]["id"]


class TestUnifiedFeed(AgentsBase):
    def test_pane_records_equal_the_herdr_agent_list(self):
        body = self.feed()
        got = [(a["pane_id"], a["status"]) for a in body["agents"] if a["pane_id"]]
        self.assertEqual(
            got, [(a["pane_id"], a["agent_status"]) for a in self.herdr.agents]
        )
        self.assertEqual(
            body["counts"],
            {"working": 1, "blocked": 0, "idle": 2, "done": 0, "unknown": 0},
        )
        self.assertEqual(body["layers"]["atlas"], {"ok": True})
        self.assertEqual(
            body["layers"]["herdr_socket"], {"reachable": True, "reason": None}
        )
        self.assertTrue(body["layers"]["herdr_web_ui"]["healthy"])
        self.assertEqual(body["workspaces"][0]["workspace_id"], "wA")

    def test_tab_labels_colony_names_and_state_vocabulary(self):
        recs = self.by_key(self.feed())
        self.assertEqual(recs["wA:p1"]["tab_label"], "main")
        self.assertEqual(recs["wA:p2"]["tab_label"], "api-worker")
        self.assertTrue(recs["wA:p2"]["colony"])
        self.assertEqual(recs["wA:p2"]["run"], "work")
        self.assertEqual(recs["wA:p2"]["name"], "build-api")  # worker-name rule
        self.assertEqual(recs["wA:p2"]["sources"], ["herdr", "mux"])
        self.assertFalse(recs["wA:p1"]["colony"])
        self.assertEqual(
            recs["wA:p1"]["name"], "alpha lead"
        )  # title: no worker-shaped label
        self.assertEqual(recs["wA:p1"]["state"], "idle")
        self.assertEqual(recs["wA:p2"]["state"], "working")
        self.herdr.agents[0]["agent_status"] = "blocked"
        self.assertEqual(self.by_key(self.feed())["wA:p1"]["state"], "input")

    def test_project_attribution_and_filter(self):
        self.herdr.agents[0]["cwd"] = self.root + "/src"
        recs = self.by_key(self.feed())
        self.assertEqual(recs["wA:p1"]["project"], self.root)
        self.assertIsNone(recs["wA:p2"]["project"])
        only = self.feed(project=self.root)
        self.assertEqual([a["key"] for a in only["agents"]], ["wA:p1"])

    def test_state_change_timestamp_moves_only_on_a_real_transition(self):
        first = self.by_key(self.feed())["wA:p1"]
        self.assertEqual(first["state_changed_source"], "first_seen")
        time.sleep(0.02)
        same = self.by_key(self.feed())["wA:p1"]
        self.assertEqual(same["state_changed_at"], first["state_changed_at"])
        time.sleep(1.1)
        self.herdr.agents[0].update(agent_status="working", state_change_seq=2)
        moved = self.by_key(self.feed())["wA:p1"]
        self.assertEqual(moved["state_changed_source"], "observed")
        self.assertGreater(moved["state_changed_at"], first["state_changed_at"])

    def test_tasks_and_messages_join_by_name(self):
        item = self.add_todo("build the api")
        work.h_todos_post(
            self.ctx(
                body={
                    "op": "assign",
                    "project": self.root,
                    "id": item,
                    "owner": "build-api",
                }
            )
        )
        irc._record_irc(self.root, irc.HUMAN, "build-api", "status please")
        irc._record_irc(self.root, "build-api", "lead", "on it")
        recs = self.by_key(self.feed())
        rec = recs["wA:p2"]
        self.assertEqual([t["content"] for t in rec["tasks"]], ["build the api"])
        self.assertEqual(rec["messages"]["count"], 2)
        self.assertEqual(rec["messages"]["unread"], 1)  # the human note is still queued
        self.assertEqual(sorted(rec["sources"]), ["herdr", "irc", "mux", "todo"])
        self.assertEqual(recs["wA:p1"]["tasks"], [])
        self.assertNotIn("build-api", recs)  # joined to its pane, no duplicate ghost

    def test_participants_without_a_pane_appear_only_while_recent(self):
        irc._record_irc(self.root, "ghost-one", "lead", "hello")
        irc._record_irc(self.root, "gone-ok", "lead", "exit 0")
        irc._record_irc(self.root, "gone-bad", "lead", "exit 2 [failed: boom]")
        body = self.feed()
        recs = self.by_key(body)
        self.assertIsNone(recs["ghost-one"]["pane_id"])
        self.assertEqual(recs["ghost-one"]["state"], "unknown")
        self.assertEqual(recs["gone-ok"]["state"], "done")
        self.assertEqual(recs["gone-bad"]["state"], "fail")
        self.assertNotIn(irc.HUMAN, recs)
        self.assertNotIn("all", recs)
        self.assertEqual(
            sum(body["counts"].values()), 3
        )  # ghosts never inflate herdr counts
        later = time.time() + herd.GHOST_CLEAN_S + 60
        with mock.patch.object(herd.time, "time", return_value=later):
            old = self.by_key(self.feed())
        self.assertNotIn("gone-ok", old)  # a clean exit becomes history after an hour
        self.assertNotIn("ghost-one", old)
        self.assertIn("gone-bad", old)  # a failed one stays

    def test_children_come_from_the_panes_own_session_dispatches(self):
        sid = "01a1138f-f3ee-7000-8713-8b35ba47b483"
        self.herdr.agents[0]["agent_session"] = {
            "kind": "path",
            "value": f"/home/u/.omp/sessions/2026-10-06T23-32-43Z_{sid}.jsonl",
        }
        pid = atlas_db.register_project(self.conn, self.root, "work-alpha")
        run = atlas_db.start_run(self.conn, pid, sid, "lead run")
        atlas_db.log_dispatch(self.conn, run, "atlas:implementer", None, None)
        atlas_db.log_dispatch(self.conn, run, "atlas:verifier", None, None)
        other = atlas_db.start_run(self.conn, pid, "another-session", "x")
        atlas_db.log_dispatch(self.conn, other, "atlas:unrelated", None, None)
        self.conn.commit()
        recs = self.by_key(self.feed())
        types = sorted(c["agent_type"] for c in recs["wA:p1"]["children"])
        self.assertEqual(types, ["atlas:implementer", "atlas:verifier"])
        self.assertEqual(recs["wA:p1"]["children_total"], 2)
        self.assertEqual(recs["wA:p2"]["children"], [])
        self.assertNotIn(
            sid, json.dumps(recs)
        )  # the session id/path never leaves the process

    def test_parent_pane_comes_from_the_launch_record(self):
        item = self.add_todo("child work")

        def link(board):
            it = work._find_item(board, item)
            it.update(
                status="in_progress",
                owner="build-api",
                launch={"target": "herdr:wA:p2", "parent_pane": "wA:p1"},
            )
            return {"ok": True}

        work._locked_edit(self.root, link)
        recs = self.by_key(self.feed())
        self.assertEqual(recs["wA:p2"]["parent_pane"], "wA:p1")
        self.assertIsNone(recs["wA:p1"]["parent_pane"])

    def test_herd_agents_rows_carry_the_same_enrichment(self):
        status, body = herd._agents(self.ctx())
        self.assertEqual(status, 200)
        row = {a["pane_id"]: a for a in body["agents"]}["wA:p2"]
        for key in (
            "tab_label",
            "state_changed_at",
            "parent_pane",
            "children",
            "colony",
        ):
            self.assertIn(key, row)
        self.assertEqual(row["tab_label"], "api-worker")
        self.assertEqual(body["tabs"][0]["label"], "main")

    def test_herdr_down_degrades_to_one_layer_and_never_raises(self):
        irc._record_irc(self.root, "ghost-one", "lead", "hello")
        with self.herdr_down():
            body = self.feed()
        self.assertFalse(body["layers"]["herdr_socket"]["reachable"])
        self.assertEqual(body["layers"]["herdr_socket"]["reason"], "socket_missing")
        self.assertTrue(body["layers"]["atlas"]["ok"])
        keys = [a["key"] for a in body["agents"]]
        self.assertIn("ghost-one", keys)
        self.assertEqual([k for k in keys if k not in ("ghost-one", "lead")], [])


class TestPeek(AgentsBase):
    def peek(self, ident, lines=None, unified=True):
        q = {} if lines is None else {"lines": str(lines)}
        fn = herd._unified_peek if unified else herd._peek
        return fn(self.ctx(q, groups=(ident,)))

    def test_peek_strips_ansi_masks_secrets_and_is_bounded(self):
        status, body = self.peek("wA:p1")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["lines"][:2], ["line one", "red line"])
        self.assertNotIn(FAKE_TOKEN, json.dumps(body))
        self.assertIn("[REDACTED]", body["lines"][2])
        self.assertTrue(body["redacted"])
        self.herdr.calls.clear()
        self.peek("wA:p1", lines=9999)
        sent = [p for m, p in self.herdr.calls if m == "pane.read"][0]
        self.assertEqual(sent["lines"], herd.PEEK_MAX_LINES)
        self.assertEqual(sent["source"], "recent")
        self.herdr.screen = "x" * 5000
        _, long = self.peek("wA:p1")
        self.assertLessEqual(len(long["lines"][0]), herd.PEEK_LINE_CHARS)

    def test_peek_resolves_worker_names_and_refuses_unknown_panes(self):
        self.assertEqual(self.peek("build-api")[1]["pane_id"], "wA:p2")
        self.assertEqual(self.peek("nope")[0], 404)
        self.assertEqual(
            self.peek("wZ:p9", unified=False)[0], 404
        )  # herdr: no such pane
        self.assertEqual(self.peek("wA:p1", lines="abc")[0], 400)

    def test_peek_fails_closed_when_redaction_is_unavailable(self):
        with mock.patch.object(herd, "_redact", lambda text: None):
            status, body = self.peek("wA:p1")
        self.assertEqual(status, 503)
        self.assertNotIn("lines", body)

    def test_peek_when_herdr_is_down_is_503(self):
        with self.herdr_down():
            self.assertEqual(self.peek("wA:p1")[0], 503)
            self.assertEqual(self.peek("wA:p1", unified=False)[0], 503)


class TestPrompt(AgentsBase):
    def prompt(self, ident, text):
        return herd._unified_prompt(self.ctx(body={"text": text}, groups=(ident,)))

    def test_idle_interactive_agent_gets_the_prompt_with_keystrokes_collapsed(self):
        status, body = self.prompt("wA:p1", "run tests\nthen \x1b[31mstop\r\x03")
        self.assertEqual(status, 200, body)
        sent = self.herdr.typed()
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["target"], "wA:p1")
        self.assertNotRegex(sent[0]["text"], r"[\x00-\x1f\x7f]")
        self.assertIn("run tests then", sent[0]["text"])

    def test_refusals_never_reach_the_pane(self):
        cases = [
            (self.prompt("build-api", "hi"), 409),  # working, not idle
            (
                self.prompt("wB:p1", "rm -rf /"),
                409,
            ),  # a plain shell: typed text would run
            (self.prompt("nope", "hi"), 404),
            (self.prompt("wA:p1", "   "), 400),
            (self.prompt("wA:p1", "x" * (atlas_herdr.PROMPT_MAX + 1)), 400),
        ]
        for (status, body), want in cases:
            self.assertEqual(status, want, body)
            self.assertFalse(body["ok"])
        self.assertEqual(self.herdr.typed(), [])

    def test_ghost_participant_has_no_pane_to_type_into(self):
        irc._record_irc(self.root, "ghost-one", "lead", "hello")
        self.assertEqual(self.prompt("ghost-one", "hi")[0], 404)
        self.assertEqual(self.herdr.typed(), [])

    def test_herdr_down_is_503(self):
        with self.herdr_down():
            self.assertEqual(self.prompt("wA:p1", "hi")[0], 503)


class TestConsole(AgentsBase):
    def test_console_urls_for_the_gateway_hosted_full_ui(self):
        with mock.patch.object(
            atlas_herdr,
            "status",
            lambda: {**STATUS, "url": "http://127.0.0.1:7317/", "herdr_server": True},
        ):
            status, body = herd._console(self.ctx())
        self.assertEqual(status, 200)
        self.assertEqual(body["chrome_full_url"], "http://127.0.0.1:7317/?chrome=full")
        self.assertEqual(body["herdr_ui_url"], "http://127.0.0.1:7317/herdr")
        self.assertIn(
            "pane={pane_id}&machine=local&chrome=pane", body["pane_url_template"]
        )
        self.assertTrue(body["reachable"])
        self.assertEqual(body["layers"]["herdr_socket"], {"reachable": True})
        self.assertIn(
            ("GET", r"^/api/v2/herd/console$"), {(m, p) for m, p, _ in herd.ROUTES}
        )


class TestRoutesAndGate(unittest.TestCase):
    def test_route_table_and_patterns(self):
        got = {(m, p) for m, p, _ in herd.ROUTES}
        for want in (
            ("GET", r"^/api/v2/agents$"),
            ("GET", rf"^/api/v2/agents/({herd.PANE_RE})/peek$"),
            ("POST", rf"^/api/v2/agents/({herd.PANE_RE})/prompt$"),
            ("GET", rf"^/api/v2/herd/agents/({herd.PANE_RE})/peek$"),
            ("GET", r"^/api/v2/herd/agents$"),
        ):
            self.assertIn(want, got)
        rx = re.compile(rf"^/api/v2/agents/({herd.PANE_RE})/peek$")
        self.assertIsNone(rx.match("/api/v2/agents/a b/peek"))
        self.assertIsNone(rx.match("/api/v2/agents/a;rm -rf/peek"))
        found = rx.match("/api/v2/agents/wA:p1/peek")
        self.assertEqual(found and found.group(1), "wA:p1")

    def test_peek_and_prompt_need_the_dashboard_token(self):
        spec = importlib.util.spec_from_file_location(
            "atlas_dashboard", SCRIPTS / "atlas_dashboard.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for path in ("/api/v2/agents/wA:p1/peek", "/api/v2/herd/agents/wA:p1/peek"):
            self.assertTrue(mod._SENSITIVE_GET.match(path), path)
        self.assertIsNone(mod._SENSITIVE_GET.match("/api/v2/agents"))
        self.assertIn("agents", [event for event, _ in mod.SSE_TOPICS])
        httpd = mod._Server((mod.LOOPBACK, 0), mod.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        port = httpd.server_address[1]

        def call(
            method, path
        ):  # no token: refused before any route (or herdr) is reached
            conn = http.client.HTTPConnection(mod.LOOPBACK, port, timeout=10)
            headers = {
                "Host": f"{mod.LOOPBACK}:{port}",
                "Content-Type": "application/json",
            }
            conn.request(
                method, path, body=b"{}" if method == "POST" else None, headers=headers
            )
            resp = conn.getresponse()
            resp.read()
            conn.close()
            return resp.status

        self.assertEqual(call("GET", "/api/v2/agents/wA:p1/peek"), 401)
        self.assertEqual(call("GET", "/api/v2/herd/agents/wA:p1/peek"), 401)
        self.assertEqual(call("POST", "/api/v2/agents/wA:p1/prompt"), 401)


if __name__ == "__main__":
    unittest.main()
