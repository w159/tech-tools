"""Collaboration protocol: path claims (claim-paths/claims/release-paths/conflicts)
and handoff/blocked/conflict notes surfaced by the worker inbox.

Run: python3 -m pytest plugins/atlas/scripts/test_atlas_collab.py -q
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "hooks")))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_todo  # noqa: E402
import worker_inbox  # noqa: E402

CLI = os.path.join(HERE, "atlas_todo.py")


class CollabBase(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for k in (
            "ATLAS_CHANNEL",
            "ATLAS_LEAD_NAME",
            "ATLAS_WORKER_NAME",
            "ATLAS_PROJECT_ROOT",
        ):
            os.environ.pop(k, None)
        self.tmp = tempfile.mkdtemp()
        self.root = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.root, ".atlas", ".run"))
        self.chan = "main@t"

    def cli(self, *args):
        return subprocess.run(
            [sys.executable, CLI, "--root", self.root, *args],
            capture_output=True,
            text=True,
            cwd=self.tmp,
        )

    def cli_json(self, *args):
        r = self.cli(*args)
        self.assertEqual(r.returncode, 0, (r.stdout or "") + (r.stderr or ""))
        return json.loads(r.stdout)

    def claim(self, owner, paths, channel=None):
        return self.cli_json(
            "claim-paths",
            "--channel",
            channel or self.chan,
            "--owner",
            owner,
            "--paths",
            paths,
        )

    def claims(self):
        return {
            c["owner"]: c["paths"]
            for c in self.cli_json("claims", "--channel", self.chan, "--json")["claims"]
        }

    def exit_note(self, owner):
        # the mux report note: text ends with an `exit <code>` line
        return atlas_todo.note(
            self.root,
            owner,
            "report body\nexit 0",
            to="lead",
            channel=self.chan,
            kind="report",
        )


class TestClaims(CollabBase):
    def test_claim_posts_kind_claim_note_with_paths(self):
        out = self.claim("Alice", "src/a.py, docs")
        self.assertTrue(out["ok"])
        rec = out["note"]
        self.assertEqual(rec["kind"], "claim")
        self.assertEqual(rec["paths"], ["src/a.py", "docs"])
        self.assertEqual(rec["channel"], self.chan)
        self.assertEqual(rec["owner"], "Alice")

    def test_claims_lists_latest_per_owner(self):
        self.claim("Alice", "src/a.py")
        self.claim("Bob", "src/b.py")
        self.claim("Alice", "src/c.py")  # replaces her earlier claim
        self.assertEqual(self.claims(), {"Alice": ["src/c.py"], "Bob": ["src/b.py"]})

    def test_claims_human_output(self):
        self.claim("Alice", "src/a.py")
        r = self.cli("claims", "--channel", self.chan)
        self.assertEqual(r.returncode, 0)
        self.assertIn("Alice: src/a.py", r.stdout)

    def test_release_paths_drops_named_then_all(self):
        self.claim("Alice", "src/a.py,src/b.py")
        self.cli_json(
            "release-paths",
            "--channel",
            self.chan,
            "--owner",
            "Alice",
            "--paths",
            "src/a.py",
        )
        self.assertEqual(self.claims(), {"Alice": ["src/b.py"]})
        self.cli_json("release-paths", "--channel", self.chan, "--owner", "Alice")
        self.assertEqual(self.claims(), {})

    def test_exit_note_clears_claim(self):
        self.claim("Alice", "src/a.py")
        self.claim("Bob", "src/b.py")
        self.exit_note("Alice")
        self.assertEqual(self.claims(), {"Bob": ["src/b.py"]})

    def test_release_by_other_owner_does_not_clear(self):
        self.claim("Alice", "src/a.py")
        self.cli_json("release-paths", "--channel", self.chan, "--owner", "Bob")
        self.assertEqual(self.claims(), {"Alice": ["src/a.py"]})


class TestConflicts(CollabBase):
    def conflicts(self, owner, paths):
        r = self.cli(
            "conflicts", "--channel", self.chan, "--owner", owner, "--paths", paths
        )
        return r, json.loads(r.stdout) if r.stdout else {}

    def test_overlap_file_under_claimed_dir(self):
        self.claim("Alice", "src/mod")
        r, out = self.conflicts("Bob", "src/mod/x.py")
        self.assertEqual(r.returncode, 1)
        self.assertFalse(out["ok"])
        self.assertEqual(out["conflicts"][0]["owner"], "Alice")
        self.assertEqual(out["conflicts"][0]["paths"], ["src/mod/x.py"])

    def test_overlap_reverse_prefix(self):
        self.claim("Alice", "src/deep/a.py")
        r, out = self.conflicts("Bob", "src/deep")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(out["conflicts"][0]["paths"], ["src/deep"])

    def test_non_overlap_is_ok(self):
        self.claim("Alice", "src/a")
        r, out = self.conflicts("Bob", "src/b")
        self.assertEqual(r.returncode, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["conflicts"], [])

    def test_same_owner_is_not_a_conflict(self):
        self.claim("Alice", "src/a")
        r, out = self.conflicts("Alice", "src/a/sub.py")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(out["conflicts"], [])

    def test_segment_boundary_not_a_conflict(self):
        self.claim("Alice", "mod/a")
        r, out = self.conflicts("Bob", "mod/aa")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(out["conflicts"], [])

    def test_conflict_posts_conflict_note_to_owner(self):
        self.claim("Alice", "src/mod")
        self.conflicts("Bob", "src/mod/x.py")
        notes = atlas_todo.notes(self.root, channel=self.chan)
        hits = [n for n in notes if n.get("kind") == "conflict"]
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["to"], "Alice")
        self.assertEqual(hits[0]["owner"], "Bob")


class TestInboxSurfacing(CollabBase):
    def post(self, owner, text, to="Worker", kind="note", item=None):
        main = atlas_todo.main_channel(atlas_todo._resolve_base(self.root))
        return atlas_todo.note(
            self.root, owner, text, to=to, item=item, channel=main, kind=kind
        )

    def test_handoff_blocked_conflict_surface_at_top_with_labels(self):
        self.post("Bob", "fyi status update")  # ordinary chatter, posted first
        self.post("Bob", "grid slice done, take it", kind="handoff", item="t9")
        self.post("Bob", "need the API spec", kind="blocked")
        self.post("Carol", "src/mod/x.py overlaps your claim", kind="conflict")
        text = worker_inbox.drain(self.root, "Worker")
        for label in ("[HANDOFF]", "[BLOCKED]", "[CONFLICT]"):
            self.assertIn(label, text)
        self.assertIn("from Bob: fyi status update", text)  # plain notes unchanged
        # collaboration kinds come before the ordinary note that arrived earlier
        self.assertLess(text.index("[HANDOFF]"), text.index("fyi status update"))

    def test_note_cli_accepts_handoff_kind(self):
        out = self.cli_json(
            "note",
            "--channel",
            self.chan,
            "--owner",
            "Alice",
            "--kind",
            "handoff",
            "--item",
            "t9",
            "--to",
            "Bob",
            "slice done",
        )
        rec = out["note"]
        self.assertEqual(rec["kind"], "handoff")
        self.assertEqual(rec["item"], "t9")
        self.assertEqual(rec["to"], "Bob")


if __name__ == "__main__":
    unittest.main()
