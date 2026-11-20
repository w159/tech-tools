import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_finding as af  # noqa: E402


def old_backfill(root, apply=False):
    root = Path(root)
    findings = af.load(root.joinpath(*af.RELPATH))
    ids = list(dict.fromkeys(e["id"] for e in findings if isinstance(e, dict) and e.get("id")))
    no_id = sum(1 for e in findings if isinstance(e, dict) and not e.get("id") and e.get("status") in af.TERMINAL)
    todo, have = [], 0
    for fid in ids:
        if not any(e.get("id") == fid and e.get("status") in af.TERMINAL for e in findings if isinstance(e, dict)):
            continue
        if af._find_record(root / ".atlas" / "findings", fid):
            have += 1
        else:
            todo.append(fid)
    return {"would_write": len(todo), "already_recorded": have, "no_id_skipped": no_id}


def make(root, entries):
    p = Path(root).joinpath(*af.RELPATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(entries))


class BackfillTest(unittest.TestCase):
    def test_equivalence(self):
        with tempfile.TemporaryDirectory() as d:
            ents = [
                {"id": "A-1", "status": "verified", "verified_at": "2026-01-01T00:00:00"},
                {"id": "A 1", "status": "verified", "verified_at": "2026-01-01T00:00:00"},
                {"id": "B", "status": "verified"},
                {"id": "C", "status": "open"},
                {"id": "D", "status": "rejected"},
                {"status": "verified"},
                "junk",
            ]
            make(d, ents)
            af.sync_record(Path(d), ents, "A-1")
            af.sync_record(Path(d), ents, "A 1")  # collides, lands as -2
            fdir = Path(d) / ".atlas" / "findings"
            self.assertEqual(len(list(fdir.glob("*.md"))), 2)
            r = af.backfill_findings(d)
            self.assertEqual(r, {"would_write": 2, "already_recorded": 2, "no_id_skipped": 1})
            self.assertEqual(r, old_backfill(d))
            self.assertEqual(af.backfill_findings(d, apply=True)["wrote"], 2)
            self.assertEqual(af.missing_records(d), 0)

    def test_scale(self):
        with tempfile.TemporaryDirectory() as d:
            ents = [{"id": "F%d" % i, "status": "verified", "verified_at": "2026-01-01T00:00:00"} for i in range(800)]
            make(d, ents)
            fdir = Path(d) / ".atlas" / "findings"
            fdir.mkdir(parents=True)
            for i in range(600):
                (fdir / ("2026-01-01_f%d.md" % i)).write_text("# x\n\n- id: F%d\n" % i)
            t = time.perf_counter()
            r = af.backfill_findings(d)
            dt = time.perf_counter() - t
            self.assertEqual((r["would_write"], r["already_recorded"]), (200, 600))
            self.assertLess(dt, 0.15)


if __name__ == "__main__":
    unittest.main()
