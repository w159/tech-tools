#!/usr/bin/env python3
"""Tests for atlas_dash_work: the Work board (todos) routes.

Hermetic: temp project root + temp sqlite db. Starting a todo's agent
(`atlas_launch.launch`) is not exercised here; see test_atlas_launch.py.
"""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import atlas_db  # noqa: E402
import atlas_dash_work as work  # noqa: E402
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


class WorkTestBase(unittest.TestCase):
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
        work._BASE_CACHE.clear()

    def ctx(self, query=None, body=None):
        q = {"project": self.root}
        q.update(query or {})
        b = dict(body or {})
        b.setdefault("project", self.root)
        return Ctx(self.db_path, self.root, q, b)

    def call(self, route_method, route_path, query=None, body=None):
        for method, pattern, fn in work.ROUTES:
            if method == route_method and pattern == route_path:
                return fn(self.ctx(query, body))
        raise AssertionError(f"no route {route_method} {route_path}")


class RouteTableTest(unittest.TestCase):
    def test_contract_routes_exist(self):
        got = {(m, p) for m, p, _ in work.ROUTES}
        self.assertEqual(got, {("GET", "/api/v2/todos"), ("POST", "/api/v2/todos")})

    def test_handlers_are_callable_and_patterns_compile(self):
        import re

        for _m, pattern, fn in work.ROUTES:
            re.compile(pattern)
            self.assertTrue(callable(fn))


class TodosTest(WorkTestBase):
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
        with mock.patch.object(work, "_file_lock", wraps=atlas_todo._file_lock) as lock:
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
        status, body = work.h_todos_get(ctx)
        self.assertEqual(status, 400)
        self.assertFalse(body["ok"])

    def test_junk_root_covers_temp_worktrees_and_plugin_cache(self):
        home = os.path.expanduser("~")
        for p in (
            "/tmp/x",
            "/private/var/folders/ab/T/x",
            "/var/folders/ab/T/x",
            home + "/.atlas/worktrees/repo-selffix-1",
            home + "/.claude/plugins/cache/a/b/hooks",
            home + "/.omp/plugins/cache/a",
        ):
            self.assertTrue(work._junk_root(p), p)
        self.assertFalse(work._junk_root(home + "/MEGA/Projects/x"))

    def test_get_without_project_or_all_merges_known_boards(self):
        # the fixture root lives in a tempdir, which is otherwise junk
        patcher = mock.patch.object(work, "_junk_root", return_value=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.call("POST", "/api/v2/todos", body={"op": "add", "content": "alpha"})
        for query in ({"project": "all"}, {"project": ""}):
            ctx = Ctx(self.db_path, self.root, query)
            status, body = work.h_todos_get(ctx)
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
        work._BASE_CACHE.clear()
        status, body = work.h_todos_get(Ctx(self.db_path, self.root, {}))
        self.assertEqual(status, 200, body)
        self.assertEqual(body["phases"], [])


if __name__ == "__main__":
    unittest.main()
