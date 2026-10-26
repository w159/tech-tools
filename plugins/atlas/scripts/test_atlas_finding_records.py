"""Durable per-finding records: atlas_finding stamp -> <root>/.atlas/findings/.

Every test runs in a temp project with HOME, ATLAS_HOME, ATLAS_DB and
CLAUDE_PROJECT_DIR pointed at temp paths; one test proves the real home and the
checkout's own .atlas/findings are untouched.
"""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))

import atlas_doctor
import atlas_finding
import doctor_layout

SCRIPT = os.path.join(os.path.dirname(__file__), "atlas_finding.py")
REPO_FINDINGS = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", ".atlas", "findings"
)


def snapshot(path):
    out = {}
    for cur, _dirs, files in os.walk(path):
        for f in files:
            p = os.path.join(cur, f)
            out[p] = os.stat(p).st_mtime_ns
    return out


def sample_entries():
    t = "2026-10-01T00:00:00+00:00"
    return [
        {"id": "A", "status": "needs-evidence", "title": "a0", "verified_at": t},
        {
            "id": "A",
            "status": "verified",
            "title": "a1",
            "verified_at": "2026-10-02T00:00:00+00:00",
        },
        {
            "id": "B",
            "status": "rejected",
            "title": "b",
            "verified_at": t,
            "evidence": "str-ev",
        },
        {"id": "C", "status": "open", "title": "c", "verified_at": t},
        {"status": "verified", "claim": "no id", "evidence": "x"},
    ]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.home = os.path.join(self.tmp, "home")
        self.ah = os.path.join(self.home, ".atlas")
        os.makedirs(self.ah)
        self.root = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.root, ".git"))
        self.env = {
            "HOME": self.home,
            "ATLAS_HOME": self.ah,
            "ATLAS_DB": os.path.join(self.ah, "atlas.db"),
            "CLAUDE_PROJECT_DIR": self.root,
        }
        p = mock.patch.dict(os.environ, self.env)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.before_real = (
            snapshot(os.path.join(_test_isolation.REAL_HOME, ".atlas", "memory")),
            snapshot(REPO_FINDINGS),
        )

    def tearDown(self):
        after = (
            snapshot(os.path.join(_test_isolation.REAL_HOME, ".atlas", "memory")),
            snapshot(REPO_FINDINGS),
        )
        self.assertEqual(self.before_real, after, "real paths were touched")

    def stamp(self, fid, status, title="t"):
        env = {**os.environ, **self.env}
        r = subprocess.run(
            [
                sys.executable,
                SCRIPT,
                "--id",
                fid,
                "--status",
                status,
                "--title",
                title,
                "--evidence",
                "ev-" + status,
                "--root",
                self.root,
            ],
            capture_output=True,
            text=True,
            env=env,
        )
        return r

    def fdir(self):
        return os.path.join(self.root, ".atlas", "findings")

    def records(self):
        d = self.fdir()
        return (
            sorted(f for f in os.listdir(d) if f != "INDEX.md")
            if os.path.isdir(d)
            else []
        )

    def seed(self, entries):
        p = os.path.join(self.root, ".atlas", ".run", "findings.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as fh:
            json.dump(entries, fh)


class StampTest(Base):
    def test_terminal_stamp_writes_one_record_and_index_row(self):
        r = self.stamp("S1", "verified", "budget sums")
        self.assertEqual(r.returncode, 0, r.stderr)
        recs = self.records()
        self.assertEqual(len(recs), 1)
        self.assertRegex(recs[0], r"^\d{4}-\d\d-\d\d_s1\.md$")
        body = open(os.path.join(self.fdir(), recs[0])).read()
        for want in ("- status: verified", "ev-verified", "## History"):
            self.assertIn(want, body)
        idx = open(os.path.join(self.fdir(), "INDEX.md")).read()
        self.assertEqual(idx.count(recs[0]), 2)  # link text + target, one row

    def test_restamp_updates_same_file(self):
        self.stamp("S1", "rejected", "first")
        self.stamp("S1", "verified", "second")
        recs = self.records()
        self.assertEqual(len(recs), 1)  # one file per id
        body = open(os.path.join(self.fdir(), recs[0])).read()
        self.assertIn("- status: verified", body)
        self.assertIn("rejected by", body)  # prior verdict kept as history
        rows = [
            l
            for l in open(os.path.join(self.fdir(), "INDEX.md"))
            if l.startswith("| 20")
        ]
        self.assertEqual(len(rows), 1)

    def test_open_stamp_writes_nothing(self):
        r = self.stamp("S1", "open")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.records(), [])
        self.assertFalse(os.path.exists(os.path.join(self.fdir(), "INDEX.md")))

    def test_existing_index_text_is_kept(self):
        os.makedirs(self.fdir())
        with open(os.path.join(self.fdir(), "INDEX.md"), "w") as fh:
            fh.write("# Findings index\n\nhand header\n\n| old | row |\n")
        self.stamp("S1", "verified")
        idx = open(os.path.join(self.fdir(), "INDEX.md")).read()
        self.assertIn("hand header", idx)
        self.assertIn("| old | row |", idx)

    def test_write_failure_does_not_fail_stamp(self):
        os.makedirs(os.path.join(self.root, ".atlas"))
        with open(self.fdir(), "w") as fh:  # a file where the dir must go
            fh.write("x")
        r = self.stamp("S1", "verified")
        self.assertEqual(r.returncode, 0)
        self.assertIn("record not written", r.stderr)
        ledger = json.load(
            open(os.path.join(self.root, ".atlas", ".run", "findings.json"))
        )
        self.assertEqual(ledger[0]["id"], "S1")

    def test_recent_cli_lists_newest(self):
        self.stamp("A1", "verified", "alpha")
        r = subprocess.run(
            [sys.executable, SCRIPT, "recent", "-n", "3", "--root", self.root],
            capture_output=True,
            text=True,
            env={**os.environ, **self.env},
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("A1 [verified] alpha", r.stdout)
        self.assertEqual(atlas_finding.recent(self.root, 1)[0]["id"], "A1")


class BackfillTest(Base):
    def test_dry_run_then_apply_then_idempotent(self):
        self.seed(sample_entries())
        dry = atlas_finding.backfill_findings(self.root)
        self.assertEqual(
            dry, {"would_write": 2, "already_recorded": 0, "no_id_skipped": 1}
        )
        self.assertEqual(self.records(), [])
        atlas_finding.backfill_findings(self.root, apply=True)
        self.assertEqual(len(self.records()), 2)
        a = [r for r in self.records() if r.endswith("_a.md")][0]
        self.assertTrue(a.startswith("2026-10-02"))  # first TERMINAL verdict date
        self.assertIn("needs-evidence by", open(os.path.join(self.fdir(), a)).read())
        again = atlas_finding.backfill_findings(self.root, apply=True)
        self.assertEqual((again["wrote"], again["already_recorded"]), (0, 2))
        self.assertEqual(len(self.records()), 2)

    def test_ids_with_same_slug_get_separate_files(self):
        t = "2026-10-01T00:00:00+00:00"
        self.seed(
            [
                {"id": "S 1", "status": "verified", "verified_at": t, "title": "x"},
                {"id": "s-1", "status": "verified", "verified_at": t, "title": "y"},
            ]
        )
        atlas_finding.backfill_findings(self.root, apply=True)
        self.assertEqual(len(self.records()), 2)


class DoctorTest(Base):
    def test_check_reports_then_fix_backfills(self):
        self.seed(sample_entries())
        res = {r["check"]: r for r in atlas_doctor.layout_checks(self.root)}
        self.assertFalse(res["project-memory"]["ok"])
        self.assertIn("2 terminal finding(s)", res["project-memory"]["detail"])
        self.assertEqual(self.records(), [])  # check is read-only
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            atlas_doctor.fix_layout_all(self.root)
        self.assertIn("FIX: findings records", buf.getvalue())
        self.assertEqual(len(self.records()), 2)
        res = {r["check"]: r for r in atlas_doctor.layout_checks(self.root)}
        self.assertTrue(res["project-memory"]["ok"], res["project-memory"])

    def test_hook_is_report_only_one_line(self):
        self.seed(sample_entries())
        lines = [
            l
            for l in atlas_doctor.hook_layout_notes(self.root)
            if "project memory" in l
        ]
        self.assertEqual(len(lines), 1)
        self.assertEqual(self.records(), [])

    def test_fix_runs_migration_when_present(self):
        import atlas_memory

        calls = []
        fake = lambda root=None, apply=False: calls.append((root, apply)) or "ok"  # noqa: E731
        with mock.patch.object(
            atlas_memory, "migrate_global_to_projects", fake, create=True
        ):
            out = doctor_layout.fix_project_memory(self.root)
        self.assertEqual(calls, [(self.root, True)])
        self.assertTrue(any("memory migration: ok" in l for l in out))

    def test_fix_tolerates_missing_migration(self):
        import atlas_memory

        with mock.patch.object(
            atlas_memory, "migrate_global_to_projects", None, create=True
        ):
            out = doctor_layout.fix_project_memory(self.root)
        self.assertTrue(any("not available" in l for l in out))


if __name__ == "__main__":
    unittest.main()
