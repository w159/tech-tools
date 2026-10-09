#!/usr/bin/env python3
"""Tests for atlas_dash_irc: board-note IRC, delivery status and herdr hand-over.

Hermetic: temp project root + temp sqlite db, and the herdr socket is replaced by a fake
(`atlas_herdr.agents` / `send_prompt` patched), so no herdr server is ever touched.
"""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import atlas_db  # noqa: E402
import atlas_dash_irc as irc  # noqa: E402
import atlas_herdr  # noqa: E402
import atlas_todo  # noqa: E402


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


class FakeHerdr:
    """Scriptable replacement for atlas_herdr.agents / atlas_herdr.send_prompt."""

    def __init__(self):
        self.reachable = True
        self.panes = []  # agents() rows
        self.sent = []  # (pane_id, text)

    def add(self, pane_id, title, agent="claude", status="idle", workspace=""):
        self.panes.append(
            {
                "pane_id": pane_id,
                "title": title,
                "agent": agent,
                "status": status,
                "workspace": workspace,
            }
        )

    def agents(self):
        return {
            "reachable": self.reachable,
            "reason": None if self.reachable else "socket_missing",
            "workspaces": [],
            "agents": list(self.panes),
        }

    def send_prompt(self, pane_id, text):
        row = next((p for p in self.panes if p["pane_id"] == pane_id), None)
        if row is None:
            raise atlas_herdr.PromptRefused(404, "no such agent pane")
        if row["status"] != "idle":
            raise atlas_herdr.PromptRefused(
                409, "agent is not idle", f"status is {row['status']}"
            )
        self.sent.append((pane_id, text))
        return {"ok": True}


class IrcTestBase(unittest.TestCase):
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
        self.herdr = FakeHerdr()
        for patcher in (
            mock.patch.object(atlas_herdr, "agents", self.herdr.agents),
            mock.patch.object(atlas_herdr, "send_prompt", self.herdr.send_prompt),
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
        for method, pattern, fn in irc.ROUTES:
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
        self.assertEqual(
            {(m, p) for m, p, _ in irc.ROUTES},
            {
                ("GET", "/api/v2/irc"),
                ("POST", "/api/v2/irc"),
                ("GET", "/api/v2/channels"),
                ("POST", "/api/v2/channels"),
                ("GET", "/api/v2/channels/([^/?#]+)"),
            },
        )

    def test_handlers_are_callable_and_patterns_compile(self):
        import re

        for _m, pattern, fn in irc.ROUTES:
            re.compile(pattern)
            self.assertTrue(callable(fn))

    def test_sanitize_keys_collapses_control_characters(self):
        self.assertEqual(irc.sanitize_keys("a\nb\tc\x1bd\x7fe"), "a b c d e")


class IrcTest(IrcTestBase):
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

    def test_post_to_idle_herdr_agent_delivers_over_the_socket(self):
        self.herdr.add("p1", "w1")
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w1", "body": "status?"}
        )
        self.assertEqual(status, 200, body)
        self.assertTrue(body["delivered"])
        self.assertEqual(body["message"]["status"], "delivered")
        ((pane, text),) = self.herdr.sent
        self.assertEqual(pane, "p1")
        self.assertIn("From: human", text.replace(" | ", "\n"))
        self.assertIn("To: w1", text)
        self.assertIn("status?", text)
        self.assertNotIn("\n", text)

    def test_control_characters_never_reach_the_pane(self):
        self.herdr.add("p1", "w1")
        self.call("POST", "/api/v2/irc", body={"to": "w1", "body": "a\x1b[31m\rb\tc"})
        ((_, text),) = self.herdr.sent
        self.assertFalse(irc.CONTROL_RE.search(text), repr(text))

    def test_post_to_busy_agent_is_recorded_not_typed(self):
        self.herdr.add("p1", "w1", status="working")
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w1", "body": "yes"}
        )
        self.assertEqual(status, 409)
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"], "agent_busy")
        self.assertEqual(self.herdr.sent, [])
        _, got = self.call("GET", "/api/v2/irc")
        self.assertIn("yes", [m["body"] for m in got["messages"]])

    def test_post_with_herdr_down_is_queued_on_the_board(self):
        self.herdr.reachable = False
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w1", "body": "hello"}
        )
        self.assertEqual((status, body["delivered"]), (200, False), body)
        self.assertEqual(body["message"]["status"], "queued")
        self.assertEqual(self.herdr.sent, [])

    def test_agent_is_matched_by_title_workspace_or_pane_id(self):
        self.herdr.add("p1", "other", workspace="w-flat")
        self.herdr.add("p2", "w-title")
        for to, pane in (("w-flat", "p1"), ("w-title", "p2"), ("p1", "p1")):
            self.herdr.sent.clear()
            status, _ = self.call("POST", "/api/v2/irc", body={"to": to, "body": "x"})
            self.assertEqual(status, 200, to)
            self.assertEqual([p for p, _ in self.herdr.sent], [pane], to)

    def test_real_herdr_pane_id_with_colon_is_addressable(self):
        self.herdr.add("wA:p1", "somebody")
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "wA:p1", "body": "x"}
        )
        self.assertEqual((status, body["delivered"]), (200, True), body)
        self.assertEqual([p for p, _ in self.herdr.sent], ["wA:p1"])

    def test_plain_shell_pane_is_not_an_agent_so_the_note_stays_queued(self):
        # herdr's agent list never holds a plain shell: nothing matches, nothing is typed, nothing is refused
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "wA:p9", "body": "ls"}
        )
        self.assertEqual((status, body["delivered"]), (200, False), body)
        self.assertEqual(body["message"]["status"], "queued")
        self.assertEqual(self.herdr.sent, [])


class IrcDeliveryStatusTest(IrcTestBase):
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
        atlas_todo.note(self.root, irc.HUMAN, "please report", to="w")
        self.assertEqual(self.one("please report")["status"], "queued")
        out = self.inbox.context_for_post_tool_use(self.env)
        self.assertIn("please report", out)
        self.assertEqual(self.one("please report")["status"], "read")

    def test_only_the_drained_message_flips(self):
        base = time.time() - 100
        self.note(irc.HUMAN, "first", to="w", ts=base)
        self.inbox.context_for_post_tool_use(self.env)
        self.note(irc.HUMAN, "second", to="w", ts=base + 5)
        self.assertEqual(self.one("first")["status"], "read")
        self.assertEqual(self.one("second")["status"], "queued")

    def test_each_workers_cursor_is_its_own(self):
        atlas_todo.note(self.root, irc.HUMAN, "for w", to="w")
        atlas_todo.note(self.root, irc.HUMAN, "for v", to="v")
        self.inbox.context_for_post_tool_use(self.env)
        self.assertEqual(self.one("for w")["status"], "read")
        self.assertEqual(self.one("for v")["status"], "queued")

    def test_lines_nobody_is_waiting_for_are_never_queued(self):
        atlas_todo.note(self.root, "w", "compiling", to="lead")  # mux stdout mirror
        atlas_todo.note(self.root, "w", "exit 0", to="lead")
        atlas_todo.note(self.root, irc.HUMAN, "everyone", to="all")
        atlas_todo.note(self.root, "board", "todos reset", to="w")
        for text in (
            "compiling",
            "exit 0",
            "everyone",
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

    def test_missing_hook_module_means_queued_never_a_crash(self):
        atlas_todo.note(self.root, irc.HUMAN, "no hooks dir", to="w")
        with mock.patch.object(irc, "worker_inbox", None):
            self.assertEqual(self.one("no hooks dir")["status"], "queued")

    def test_same_worker_name_in_two_projects_does_not_bleed(self):
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        other_root = os.path.realpath(other.name)
        (Path(other_root) / ".atlas" / ".run").mkdir(parents=True)
        atlas_todo.note(self.root, irc.HUMAN, "same name", to="w")
        atlas_todo.note(other_root, irc.HUMAN, "same name", to="w")
        self.inbox.context_for_post_tool_use(self.env)  # drains only self.root
        by_project = {
            m["project"]: m["status"]
            for m in irc.read_messages([self.root, other_root])[0]
            if m["body"] == "same name"
        }
        self.assertEqual(by_project, {self.root: "read", other_root: "queued"})

    # --- delivered / refused -------------------------------------------------------------

    def test_delivery_outcome_is_ignored_for_lines_nobody_waits_on(self):
        atlas_todo.note(self.root, "w", "mirror", to="lead", delivery="refused")
        atlas_todo.note(self.root, irc.HUMAN, "to all", to="all", delivery="delivered")
        self.assertEqual(self.one("mirror")["status"], "read")
        self.assertEqual(self.one("to all")["status"], "read")

    def test_delivered_and_refused_survive_a_missing_hook_module(self):
        atlas_todo.note(self.root, irc.HUMAN, "typed", to="w", delivery="delivered")
        atlas_todo.note(self.root, irc.HUMAN, "bounced", to="w", delivery="refused")
        with mock.patch.object(irc, "worker_inbox", None):
            self.assertEqual(self.one("typed")["status"], "delivered")
            self.assertEqual(self.one("bounced")["status"], "refused")

    def test_typed_message_is_not_injected_by_the_hook_and_stays_delivered(self):
        # Audit F1: 13/13 messages typed into an interactive pane were also drained by the hook.
        atlas_todo.note(
            self.root, irc.HUMAN, "typed once", to="w", delivery="delivered"
        )
        atlas_todo.note(self.root, irc.HUMAN, "bounced", to="w", delivery="refused")
        self.assertEqual(self.inbox.context_for_post_tool_use(self.env), "")
        self.assertEqual(self.one("typed once")["status"], "delivered")
        self.assertEqual(self.one("bounced")["status"], "refused")

    def test_agent_to_agent_notes_are_tracked_to_read(self):
        # Audit F9: any non-human sender was labelled "read" with no reader.
        atlas_todo.note(self.root, "a", "ping b", to="w")
        msg = self.one("ping b")
        self.assertEqual((msg["status"], msg["tracked"]), ("queued", True))
        self.inbox.context_for_post_tool_use(self.env)
        self.assertEqual(self.one("ping b")["status"], "read")

    def test_mirrors_and_broadcasts_are_untracked(self):
        atlas_todo.note(self.root, "w", "compiling", to="lead")
        atlas_todo.note(self.root, irc.HUMAN, "everyone", to="all")
        self.assertEqual(
            [self.one("compiling")["tracked"], self.one("everyone")["tracked"]],
            [False, False],
        )

    def test_a_message_nobody_drains_becomes_undeliverable(self):
        # Audit F8: paneless/unknown agents left messages "queued" forever.
        atlas_todo.note(self.root, irc.HUMAN, "to a ghost", to="ghost")
        self.assertEqual(self.one("to a ghost")["status"], "queued")
        with mock.patch("time.time", return_value=time.time() + irc.QUEUED_TTL_S + 5):
            self.assertEqual(self.one("to a ghost")["status"], "undeliverable")
        # a drain after the TTL still wins: read beats undeliverable
        ghost = {"ATLAS_WORKER_NAME": "ghost", "ATLAS_PROJECT_ROOT": self.root}
        with mock.patch("time.time", return_value=time.time() + irc.QUEUED_TTL_S + 5):
            self.inbox.context_for_post_tool_use(ghost)
            self.assertEqual(self.one("to a ghost")["status"], "read")

    def test_typed_into_an_idle_herdr_agent_is_delivered_not_queued_forever(self):
        self.herdr.add("p1", "w")
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "typed in"}
        )
        self.assertEqual(
            (status, body["ok"], body["delivered"]), (200, True, True), body
        )
        self.assertEqual(body["message"]["status"], "delivered")
        self.assertEqual(self.one("typed in")["status"], "delivered")
        # the dashboard handed it over, so the worker's hook must not inject it a second time
        self.assertEqual(self.inbox.context_for_post_tool_use(self.env), "")
        self.assertEqual(self.one("typed in")["status"], "delivered")

    def test_non_harness_pane_is_refused_never_prompted(self):
        self.herdr.add("p1", "w", agent="unknown")  # a plain shell
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "ls -la"}
        )
        self.assertEqual(status, 409, body)
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"], "pane_not_steerable")
        self.assertEqual(body["message"]["status"], "refused")
        self.assertEqual(self.herdr.sent, [])
        self.assertEqual(self.one("ls -la")["status"], "refused")
        # refused is terminal: a hook drain never turns it into read
        self.inbox.context_for_post_tool_use(self.env)
        self.assertEqual(self.one("ls -la")["status"], "refused")

    def test_busy_agent_message_stays_queued_then_read_by_the_hook(self):
        self.herdr.add("p1", "w", status="working")
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "for later"}
        )
        self.assertEqual((status, body["error"]), (409, "agent_busy"), body)
        self.assertEqual(body["message"]["status"], "queued")
        self.assertEqual(self.one("for later")["status"], "queued")
        self.inbox.context_for_post_tool_use(self.env)
        self.assertEqual(self.one("for later")["status"], "read")

    def test_no_pane_note_stays_queued_not_delivered(self):
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "w", "body": "nobody home"}
        )
        self.assertEqual((status, body["delivered"]), (200, False), body)
        self.assertEqual(self.one("nobody home")["status"], "queued")

    def test_busy_post_is_not_a_success_and_ends_undeliverable(self):
        self.herdr.add("p1", "w", status="blocked")
        status, body = self.call("POST", "/api/v2/irc", body={"to": "w", "body": "yes"})
        self.assertEqual(
            (status, body["ok"], body["error"]), (409, False, "agent_busy")
        )
        self.assertEqual(body["message"]["status"], "queued")
        with mock.patch("time.time", return_value=time.time() + irc.QUEUED_TTL_S + 5):
            self.assertEqual(self.one("yes")["status"], "undeliverable")


class PagingTest(IrcTestBase):
    """Audit F6: a burst larger than one page left the oldest messages invisible (100 of 300)."""

    def test_burst_is_paged_oldest_first_and_every_message_arrives(self):
        for i in range(5):
            self.note("w", f"pre-{i}")
        first, more = irc.read_messages([self.root], limit=200)
        self.assertEqual((len(first), more), (5, False))
        since, got, pages = first[-1]["id"], [], 0
        for i in range(300):
            self.note("w", f"burst-{i:03d}")
        while True:
            page, more = irc.read_messages([self.root], since=since, limit=200)
            pages += 1
            got += [m["body"] for m in page]
            if not more:
                break
            since = page[-1]["id"]
        self.assertEqual([f"burst-{i:03d}" for i in range(300)], got)
        self.assertEqual(2, pages)

    def test_epoch_since_also_pages_oldest_first(self):
        for i in range(10):
            self.note("w", f"m{i}", ts=100.0 + i)
        page, more = irc.read_messages([self.root], since="100", limit=4)
        self.assertEqual(
            (["m1", "m2", "m3", "m4"], True), ([m["body"] for m in page], more)
        )

    def test_without_since_or_with_an_unknown_id_it_is_the_newest_page(self):
        for i in range(10):
            self.note("w", f"m{i}", ts=100.0 + i)
        page, more = irc.read_messages([self.root], limit=3)
        self.assertEqual((["m7", "m8", "m9"], False), ([m["body"] for m in page], more))
        page, more = irc.read_messages([self.root], since="mdeadbeef0000", limit=3)
        self.assertEqual((["m7", "m8", "m9"], False), ([m["body"] for m in page], more))

    def test_irc_route_reports_more(self):
        for i in range(6):
            self.note("w", f"m{i}", ts=100.0 + i)
        _, body = self.call("GET", "/api/v2/irc", query={"since": "100", "limit": "2"})
        self.assertEqual(
            ([m["body"] for m in body["messages"]], body["more"]), (["m1", "m2"], True)
        )


class ChannelsTest(IrcTestBase):
    """/api/v2/channels over a fake atlas_todo channel registry (storage is IrcChannelCore's)."""

    MAIN = "proj@main"
    LEAD = "proj@main/lead-a"

    def setUp(self):
        super().setUp()
        self.store = []
        self.chans = {
            self.MAIN: {
                "name": self.MAIN,
                "kind": "main",
                "parent": None,
                "lead": None,
                "members": [{"name": "lead-a", "role": "lead", "parent": None}],
                "project_root": self.root,
                "branch": "main",
                "created": 1.0,
                "last_activity": None,
            },
            self.LEAD: {
                "name": self.LEAD,
                "kind": "lead",
                "parent": self.MAIN,
                "lead": "lead-a",
                "members": [
                    {"name": "lead-a", "role": "lead", "parent": None},
                    {"name": "sub-1", "role": "subagent", "parent": "lead-a", "joined": time.time()},
                ],
                "project_root": self.root,
                "branch": "main",
                "created": 2.0,
                "last_activity": None,
            },
        }

        def fake_note(
            root, owner, text, to="all", item=None, delivery=None, channel=None
        ):
            rec = {
                "ts": time.time() + len(self.store),
                "owner": owner,
                "text": text,
                "to": to,
                "delivery": delivery,
                "channel": channel,
            }
            self.store.append(rec)
            return dict(rec)

        def board(root, name):
            return {
                "channel": name,
                "members": [
                    {
                        "name": "sub-1",
                        "role": "subagent",
                        "parent": "lead-a",
                        "counts": {"pending": 1, "in_progress": 0, "completed": 0},
                        "items": [
                            {"id": "t1", "content": "write tests", "status": "pending"}
                        ],
                        "last_note": None,
                    },
                ],
                "counts": {"pending": 1, "in_progress": 0, "completed": 0},
            }

        mains = lambda root: [  # noqa: E731
            {**self.chans[self.MAIN], "children": [self.chans[self.LEAD]]}
        ]
        for patcher in (
            mock.patch.object(atlas_todo, "channels", mains, create=True),
            mock.patch.object(
                atlas_todo,
                "get_channel",
                lambda root, n: self.chans.get(n),
                create=True,
            ),
            mock.patch.object(atlas_todo, "channel_board", board, create=True),
            mock.patch.object(atlas_todo, "note", fake_note),
            mock.patch.object(atlas_todo, "notes", lambda root, **kw: list(self.store)),
            mock.patch.object(atlas_herdr, "list_panes", lambda run=None: []),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def get_channel(self, name, **q):
        from urllib.parse import quote

        ctx = self.ctx(q)
        ctx.groups = (quote(name, safe=""),)  # the UI sends one encoded segment
        return irc.h_channel_get(ctx)

    def test_tree_lists_main_then_lead_with_members_and_presence(self):
        self.herdr.add("wA:p2", "sub-1", agent="omp", status="working")
        status, body = self.call("GET", "/api/v2/channels")
        self.assertEqual(status, 200)
        by = {c["name"]: c for c in body["channels"]}
        self.assertEqual([c["name"] for c in body["channels"]], [self.MAIN, self.LEAD])
        self.assertEqual(by[self.LEAD]["parent"], self.MAIN)
        self.assertEqual(by[self.LEAD]["lead"], "lead-a")
        self.assertEqual(by[self.MAIN]["kind"], "main")
        sub = {m["name"]: m for m in by[self.LEAD]["members"]}["sub-1"]
        self.assertEqual((sub["kind"], sub["parent"]), ("subagent", "lead-a"))
        self.assertEqual((sub["pane_id"], sub["state"]), ("wA:p2", "working"))
        lead = {m["name"]: m for m in by[self.LEAD]["members"]}["lead-a"]
        self.assertIsNone(lead["pane_id"])  # no live pane: still listed, not invented

    def test_detail_keeps_channels_apart_and_main_owns_legacy_notes(self):
        self.store += [
            {"ts": 10.0, "owner": "old", "text": "legacy note", "to": "all"},
            {
                "ts": 11.0,
                "owner": "lead-a",
                "text": "to main",
                "to": "all",
                "channel": self.MAIN,
            },
            {
                "ts": 12.0,
                "owner": "sub-1",
                "text": "in sub",
                "to": "all",
                "channel": self.LEAD,
            },
        ]
        _, main = self.get_channel(self.MAIN)
        self.assertEqual(
            [m["body"] for m in main["messages"]], ["legacy note", "to main"]
        )
        _, lead = self.get_channel(self.LEAD)
        self.assertEqual([m["body"] for m in lead["messages"]], ["in sub"])
        self.assertEqual(lead["messages"][0]["channel_name"], self.LEAD)
        self.assertEqual(lead["channel"]["parent"], self.MAIN)
        seen = {m["name"]: m["last_seen"] for m in lead["channel"]["members"]}
        self.assertIsNotNone(seen["sub-1"])
        self.assertIsNone(seen["lead-a"])

    def test_detail_board_groups_todos_by_owner(self):
        _, lead = self.get_channel(self.LEAD)
        owners = lead["board"]["owners"]
        self.assertEqual([o["owner"] for o in owners], ["sub-1"])
        self.assertEqual(owners[0]["items"][0]["content"], "write tests")
        self.assertEqual(owners[0]["items"][0]["status"], "open")
        self.assertEqual(lead["board"]["counts"]["pending"], 1)

    def test_unknown_channel_is_404(self):
        self.assertEqual(self.get_channel("nope@x")[0], 404)
        status, body = self.call(
            "POST", "/api/v2/channels", body={"channel": "nope@x", "body": "hi"}
        )
        self.assertEqual(status, 404)
        self.assertEqual(self.store, [])
        self.assertEqual(
            self.call("POST", "/api/v2/channels", body={"body": "hi"})[0], 400
        )

    def test_human_posts_into_a_subchannel_and_reaches_an_idle_pane(self):
        self.herdr.add("wA:p2", "sub-1", agent="omp", status="idle")
        status, body = self.call(
            "POST",
            "/api/v2/channels",
            body={"channel": self.LEAD, "to": "sub-1", "body": "status?"},
        )
        self.assertEqual(status, 200, body)
        self.assertTrue(body["delivered"])
        self.assertEqual(self.store[-1]["channel"], self.LEAD)
        self.assertEqual(self.store[-1]["owner"], "human")
        self.assertEqual(len(self.herdr.sent), 1)
        # a plain post to the whole channel is recorded, nothing is typed anywhere
        status, body = self.call(
            "POST", "/api/v2/channels", body={"channel": self.MAIN, "body": "hello all"}
        )
        self.assertEqual((status, body["delivered"]), (200, False))
        self.assertEqual(self.store[-1]["channel"], self.MAIN)
        self.assertEqual(len(self.herdr.sent), 1)

    def test_subagent_can_post_to_main(self):
        status, _ = self.call(
            "POST",
            "/api/v2/channels",
            body={
                "channel": self.MAIN,
                "from": "sub-1",
                "to": "lead-a",
                "body": "done",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            (self.store[-1]["owner"], self.store[-1]["channel"]), ("sub-1", self.MAIN)
        )

    def test_irc_route_is_unchanged_for_legacy_callers(self):
        status, body = self.call(
            "POST", "/api/v2/irc", body={"to": "all", "body": "legacy"}
        )
        self.assertEqual(status, 200)
        self.assertIsNone(self.store[-1]["channel"])
        _, msgs = self.call("GET", "/api/v2/irc")
        self.assertEqual([m["body"] for m in msgs["messages"]], ["legacy"])


class ChannelsRealRegistryTest(IrcTestBase):
    """End to end over the real atlas_todo registry in a temp git repo on branch feature/x."""

    def setUp(self):
        super().setUp()
        import subprocess

        for cmd in (
            ["git", "init", "-q"],
            ["git", "checkout", "-q", "-b", "feature/x"],
            [
                "git",
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "i",
            ],
        ):
            subprocess.run(cmd, cwd=self.root, check=True, capture_output=True)
        self.main = f"{os.path.basename(self.root)}@feature/x"

    def test_main_lead_subchannel_messages_and_board(self):
        from urllib.parse import quote

        self.assertEqual(atlas_todo.main_channel(self.root), self.main)
        atlas_todo.ensure_main(self.root)
        lead = atlas_todo.open_lead_channel(self.root, "lead-a", subagents=["sub-1"])
        sub = lead["name"]
        self.assertEqual(sub, f"{self.main}/lead-a")
        _, tree = self.call("GET", "/api/v2/channels")
        by = {c["name"]: c for c in tree["channels"]}
        self.assertEqual(by[self.main]["kind"], "main")
        self.assertEqual((by[sub]["kind"], by[sub]["parent"]), ("lead", self.main))
        self.assertIn("sub-1", [m["name"] for m in by[sub]["members"]])
        for ch, who in ((sub, "sub-1"), (self.main, "lead-a")):
            status, _ = self.call(
                "POST",
                "/api/v2/channels",
                body={"channel": ch, "from": who, "body": "hi " + ch},
            )
            self.assertEqual(status, 200)
        for ch in (self.main, sub):
            ctx = self.ctx()
            ctx.groups = (quote(ch, safe=""),)
            _, body = irc.h_channel_get(ctx)
            self.assertEqual([m["body"] for m in body["messages"]], ["hi " + ch])
            self.assertFalse(body["more"])
            self.assertIn("owners", body["board"])


if __name__ == "__main__":
    unittest.main()
