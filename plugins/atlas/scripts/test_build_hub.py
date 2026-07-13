import json
import os
import sys
import tempfile
import unittest
from unittest import mock

import build_hub

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
AUVIK_GRAPH = os.path.join(
    REPO, "mcp_servers", "auvik-mcp", "graphify-out", "graph.json"
)
SRC = os.path.join(os.path.dirname(__file__), "build_hub.py")


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


class BuildHubUnitTests(unittest.TestCase):
    """Unit-level coverage for the previously-uncovered source paths."""

    def _graph_file(self, nodes):
        """Write a temp graph.json with the given node list, return its path."""
        fh = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, dir=tempfile.mkdtemp()
        )
        json.dump({"nodes": nodes}, fh)
        fh.close()
        return fh.name

    # _index_file_nodes: bad graph path is skipped (except -> continue)
    def test_index_file_nodes_bad_graph_skipped(self):
        by_file = build_hub._index_file_nodes(["/no/such/graph_xyz.json"])
        self.assertEqual(by_file, {})
        # a malformed JSON file is also skipped, valid graph still indexed
        bad = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, dir=tempfile.mkdtemp()
        )
        bad.write("{not json")
        bad.close()
        good = self._graph_file([{"id": "n1", "source_file": "src/a.py"}])
        result = build_hub._index_file_nodes([bad.name, good])
        self.assertEqual(result, {"src/a.py": "n1"})

    # _match_node: empty/None file path -> (None, "none")
    def test_match_node_empty_path(self):
        self.assertEqual(build_hub._match_node("", {"a.py": "n1"}), (None, "none"))
        self.assertEqual(build_hub._match_node(None, {"a.py": "n1"}), (None, "none"))

    # _match_node: file-suffix match (finding path is a superset of a graph path)
    def test_match_node_file_suffix(self):
        by_file = {"src/a.ts": "a_ts"}
        nid, kind = build_hub._match_node("repo/src/a.ts", by_file)
        self.assertEqual((nid, kind), ("a_ts", "file-suffix"))
        # bare basename is rejected (no multi-segment suffix) -> none
        self.assertEqual(build_hub._match_node("a.ts", by_file), (None, "none"))

    # _summarize: no meaningful line -> "(no summary)"
    def test_summarize_no_summary(self):
        self.assertEqual(build_hub._summarize("\n  \n```\n```\n"), "(no summary)")
        # a normal line is still returned, truncated to 160
        self.assertEqual(build_hub._summarize("# Fix bug"), "Fix bug")

    # _parse_handoff: missing file -> empty text, LOW severity, no file/line
    def test_parse_handoff_missing_file(self):
        parsed = build_hub._parse_handoff("/no/such/handoff_xyz.md")
        self.assertIsNone(parsed["file"])
        self.assertIsNone(parsed["line"])
        self.assertEqual(parsed["severity"], "LOW")
        self.assertEqual(parsed["prompt_summary"], "(no summary)")

    # build_manifest: non-.md files in handoffs/ are skipped (continue)
    def test_build_manifest_skips_non_md(self):
        run_dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(run_dir, "handoffs"))
        with open(os.path.join(run_dir, "handoffs", "real.md"), "w") as fh:
            fh.write("# Bug\nHIGH in `a.py:4`\n")
        with open(os.path.join(run_dir, "handoffs", "notes.txt"), "w") as fh:
            fh.write("ignore me")
        with open(os.path.join(run_dir, "handoffs", ".hidden"), "w") as fh:
            fh.write("ignore me")
        entries = build_hub.build_manifest(run_dir, [])
        self.assertEqual([e["id"] for e in entries], ["real"])

    # build_manifest: missing handoffs dir -> empty list
    def test_build_manifest_no_handoffs_dir(self):
        run_dir = tempfile.mkdtemp()
        self.assertEqual(build_hub.build_manifest(run_dir, []), [])

    # _count_communities: bad graph path skipped (except -> continue)
    def test_count_communities_bad_graph_skipped(self):
        self.assertEqual(build_hub._count_communities(["/no/such/graph_xyz.json"]), 0)
        good = self._graph_file(
            [{"id": "n1", "community": 0}, {"id": "n2", "community": 1}]
        )
        self.assertEqual(build_hub._count_communities([good]), 2)

    # render_html: empty entries -> the "No actionable nodes" empty state
    def test_render_html_empty(self):
        doc = build_hub.render_html("run-x", [], 0)
        self.assertIn("No actionable nodes in this run.", doc)
        self.assertIn("communities charted", doc)
        self.assertIn("No actionable nodes in this run.", doc)

    # _discover_graphs: .git root with a graphify-out found, node_modules pruned
    def test_discover_graphs_finds_graph_and_prunes_node_modules(self):
        repo = tempfile.mkdtemp()
        os.makedirs(os.path.join(repo, ".git"))
        os.makedirs(os.path.join(repo, "sub", "graphify-out"))
        with open(os.path.join(repo, "sub", "graphify-out", "graph.json"), "w") as fh:
            fh.write("{}")
        os.makedirs(os.path.join(repo, "node_modules", "graphify-out"))
        with open(
            os.path.join(repo, "node_modules", "graphify-out", "graph.json"), "w"
        ) as fh:
            fh.write("{}")
        found = build_hub._discover_graphs(repo)
        self.assertIn(
            os.path.join(repo, "sub", "graphify-out", "graph.json"), found
        )
        self.assertNotIn(
            os.path.join(repo, "node_modules", "graphify-out", "graph.json"), found
        )

    # _discover_graphs: no .git up the tree -> climbs to root, walks nothing
    def test_discover_graphs_no_git_root(self):
        d = tempfile.mkdtemp()
        # patch os.walk to avoid walking the filesystem root; isdir False forces
        # the loop to climb until parent == root (covers the no-.git break branch)
        with mock.patch("os.walk", return_value=iter([])), mock.patch(
            "os.path.isdir", return_value=False
        ):
            self.assertEqual(build_hub._discover_graphs(d), [])

    # __main__ block: no args -> usage + exit 2
    def test_main_no_args_exits_2(self):
        with open(SRC) as fh:
            source = fh.read()
        with mock.patch.object(sys, "argv", ["build_hub.py"]):
            with self.assertRaises(SystemExit) as cm:
                exec(compile(source, SRC, "exec"), {"__name__": "__main__"})
            self.assertEqual(cm.exception.code, 2)

    # __main__ block: run_dir arg -> hub built, summary printed
    def test_main_with_run_dir(self):
        run_dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(run_dir, ".git"))  # scopes _discover_graphs walk
        os.makedirs(os.path.join(run_dir, "handoffs"))
        with open(os.path.join(run_dir, "handoffs", "f1.md"), "w") as fh:
            fh.write("# Bug\nHIGH in `a.py:4`\n")
        with open(SRC) as fh:
            source = fh.read()
        with mock.patch.object(sys, "argv", ["build_hub.py", run_dir]):
            exec(compile(source, SRC, "exec"), {"__name__": "__main__"})
        self.assertTrue(
            os.path.exists(os.path.join(run_dir, "hub", "manifest.json"))
        )
        self.assertTrue(os.path.exists(os.path.join(run_dir, "hub", "index.html")))

    # __main__ block: explicit graph arg short-circuits _discover_graphs
    def test_main_with_explicit_graph(self):
        run_dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(run_dir, "handoffs"))
        with open(os.path.join(run_dir, "handoffs", "f1.md"), "w") as fh:
            fh.write("# Bug\nHIGH in `a.py:4`\n")
        graph = self._graph_file([{"id": "a_py", "source_file": "a.py"}])
        with open(SRC) as fh:
            source = fh.read()
        with mock.patch.object(sys, "argv", ["build_hub.py", run_dir, graph]):
            exec(compile(source, SRC, "exec"), {"__name__": "__main__"})
        with open(os.path.join(run_dir, "hub", "manifest.json")) as fh:
            data = json.load(fh)
        self.assertEqual(data[0]["node_id"], "a_py")


if __name__ == "__main__":
    unittest.main()
