import json
import os
import tempfile
import unittest

import build_hub

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
AUVIK_GRAPH = os.path.join(
    REPO, "mcp_servers", "auvik-mcp", "graphify-out", "graph.json"
)


class BuildHubTest(unittest.TestCase):
    def setUp(self):
        self.run_dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.run_dir, "handoffs"))
        # one handoff whose file exists in the auvik graph (package.json is a known node),
        # one whose file does not, to exercise both match and no-match.
        with open(os.path.join(self.run_dir, "handoffs", "finding-1.md"), "w") as fh:
            fh.write(
                "# Fix unsafe parse\nHIGH severity in `package.json:12`.\nAcceptance: ...\n"
            )
        with open(os.path.join(self.run_dir, "handoffs", "finding-2.md"), "w") as fh:
            fh.write("# Tidy logger\nLOW in `src/nonexistent_xyz.ts:3`.\n")

    def _graphs(self):
        return [AUVIK_GRAPH] if os.path.exists(AUVIK_GRAPH) else []

    def test_manifest_one_entry_per_handoff(self):
        entries = build_hub.build_manifest(self.run_dir, self._graphs())
        self.assertEqual({e["id"] for e in entries}, {"finding-1", "finding-2"})
        e1 = next(e for e in entries if e["id"] == "finding-1")
        self.assertEqual(e1["file"], "package.json")
        self.assertEqual(e1["line"], 12)
        self.assertEqual(e1["severity"], "HIGH")

    def test_node_match_resolves_or_marks_none(self):
        if not self._graphs():
            self.skipTest("auvik graph fixture absent")
        entries = build_hub.build_manifest(self.run_dir, self._graphs())
        e1 = next(e for e in entries if e["id"] == "finding-1")
        e2 = next(e for e in entries if e["id"] == "finding-2")
        # package.json is a real file in the auvik graph -> resolves to its container node
        self.assertIsNotNone(e1["node_id"])
        self.assertIn(e1["node_match"], ("file", "file-suffix"))
        # first-wins index picks the file-container node, not an arbitrary sub-node
        self.assertEqual(e1["node_id"], "package_json")
        # the made-up file is absent -> explicit none, never a wrong guess
        self.assertIsNone(e2["node_id"])
        self.assertEqual(e2["node_match"], "none")

    def test_build_hub_writes_manifest_and_html(self):
        build_hub.build_hub(self.run_dir, self._graphs())
        man = os.path.join(self.run_dir, "hub", "manifest.json")
        idx = os.path.join(self.run_dir, "hub", "index.html")
        self.assertTrue(os.path.exists(man))
        self.assertTrue(os.path.exists(idx))
        with open(man) as fh:
            data = json.load(fh)
        self.assertEqual(len(data), 2)
        with open(idx) as fh:
            htmldoc = fh.read()
        self.assertIn("Atlas Expedition Map", htmldoc)
        self.assertIn("atlas-launch finding-1", htmldoc)
        # HIGH sorts before LOW
        self.assertLess(htmldoc.index("finding-1"), htmldoc.index("finding-2"))


if __name__ == "__main__":
    unittest.main()
