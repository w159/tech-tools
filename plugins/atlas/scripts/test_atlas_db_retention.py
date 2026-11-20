import os
import sqlite3
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_db  # noqa: E402

DAY = 86400


def fresh():
    d = tempfile.mkdtemp()
    conn = sqlite3.connect(os.path.join(d, "t.db"))
    atlas_db.init(conn, backfill=False)
    return conn


def add_run(conn, sid, started):
    conn.execute("INSERT INTO runs(project_id,session_id,started_at) VALUES(1,?,?)", (sid, started))


def add_msg(conn, sid, uuid, side, ts=None):
    conn.execute(
        "INSERT INTO messages(session_id,uuid,ts,is_sidechain) VALUES(?,?,?,?)",
        (sid, uuid, ts, side),
    )


def kind(conn, sid):
    return conn.execute("SELECT kind FROM runs WHERE session_id=?", (sid,)).fetchone()[0]


class BackfillSince(unittest.TestCase):
    def test_since_scopes(self):
        c = fresh()
        now = time.time()
        add_run(c, "new", now - 3600)
        add_run(c, "old", now - 30 * DAY)
        add_msg(c, "new", "n1", 1)
        add_msg(c, "old", "o1", 1)
        c.commit()
        atlas_db.backfill_run_kinds(c, since=now - 2 * DAY)
        self.assertEqual(kind(c, "new"), "worker")
        self.assertEqual(kind(c, "old"), "orchestrator")
        atlas_db.backfill_run_kinds(c)
        self.assertEqual(kind(c, "old"), "worker")

    def test_orchestrator_flip(self):
        c = fresh()
        now = time.time()
        add_run(c, "s", now)
        c.execute("UPDATE runs SET kind='worker'")
        add_msg(c, "s", "m1", 0)
        c.commit()
        atlas_db.backfill_run_kinds(c, since=now - DAY)
        self.assertEqual(kind(c, "s"), "orchestrator")

    def test_init_fast_on_large_db(self):
        c = fresh()
        now = time.time()
        add_run(c, "recent", now)
        c.executemany(
            "INSERT INTO messages(session_id,uuid,ts,is_sidechain) VALUES(?,?,?,1)",
            [("s%d" % (i % 2000), "u%d" % i, now) for i in range(200000)],
        )
        add_msg(c, "recent", "r1", 1)
        c.commit()
        t0 = time.time()
        atlas_db.init(c)
        self.assertLess(time.time() - t0, 0.5)
        self.assertEqual(kind(c, "recent"), "worker")


class Prune(unittest.TestCase):
    def setUp(self):
        self.c = fresh()
        now = time.time()
        for i, ts in enumerate((now - 100 * DAY, now - DAY)):
            self.c.execute("INSERT INTO messages(session_id,uuid,ts) VALUES('s',?,?)", ("m%d" % i, ts))
            self.c.execute("INSERT INTO tool_calls(session_id,tool_use_id,ts) VALUES('s',?,?)", ("t%d" % i, ts))
            self.c.execute("INSERT INTO user_prompts(session_id,uuid,ts) VALUES('s',?,?)", ("p%d" % i, ts))
            self.c.execute(
                "INSERT INTO turn_scores(session_id,message_uuid,judgment,ts) VALUES('s',?,'j',?)",
                ("x%d" % i, ts),
            )
            self.c.execute(
                "INSERT INTO signals(session_id,message_uuid,signal_type,ts) VALUES('s',?,'a',?)",
                ("g%d" % i, ts),
            )
        self.c.execute("INSERT INTO runs(project_id,session_id,started_at) VALUES(1,'s',?)", (now - 200 * DAY,))
        self.c.execute("INSERT INTO friction_events(session_id,ts) VALUES('s',?)", (now - 200 * DAY,))
        self.c.commit()

    def count(self, t):
        return self.c.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]

    def test_prune(self):
        res = atlas_db.prune_old(self.c, 90)
        for t in atlas_db.PRUNE_TABLES:
            self.assertEqual(res[t], 1)
            self.assertEqual(self.count(t), 1)
        self.assertEqual(self.count("runs"), 1)
        self.assertEqual(self.count("friction_events"), 1)
        self.assertEqual(sum(atlas_db.prune_old(self.c, 90).values()), 0)

    def test_disabled(self):
        self.assertEqual(atlas_db.prune_old(self.c, 0), {})
        self.assertEqual(self.count("messages"), 2)

    def test_batches(self):
        old = time.time() - 100 * DAY
        self.c.executemany(
            "INSERT INTO messages(session_id,uuid,ts) VALUES('s',?,?)",
            [("b%d" % i, old) for i in range(atlas_db.PRUNE_BATCH + 5)],
        )
        self.c.commit()
        self.assertEqual(atlas_db.prune_old(self.c, 90)["messages"], atlas_db.PRUNE_BATCH + 6)

    def test_iso_text_ts(self):
        c = sqlite3.connect(":memory:")
        c.execute("CREATE TABLE messages(id INTEGER PRIMARY KEY, ts TEXT)")
        c.execute("INSERT INTO messages(ts) VALUES('2000-01-01T00:00:00')")
        c.execute("INSERT INTO messages(ts) VALUES(?)", (time.strftime("%Y-%m-%dT%H:%M:%S"),))
        self.assertEqual(atlas_db.prune_old(c, 90), {"messages": 1})
        self.assertEqual(c.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 1)

    def test_retention_env(self):
        old = os.environ.get("ATLAS_DB_RETENTION_DAYS")
        try:
            os.environ.pop("ATLAS_DB_RETENTION_DAYS", None)
            self.assertEqual(atlas_db.retention_days(), 90)
            for v, want in (("0", 0), ("off", 0), ("30", 30), ("junk", 90)):
                os.environ["ATLAS_DB_RETENTION_DAYS"] = v
                self.assertEqual(atlas_db.retention_days(), want)
        finally:
            if old is None:
                os.environ.pop("ATLAS_DB_RETENTION_DAYS", None)
            else:
                os.environ["ATLAS_DB_RETENTION_DAYS"] = old

    def test_vacuum(self):
        atlas_db.vacuum(self.c)


if __name__ == "__main__":
    unittest.main()
