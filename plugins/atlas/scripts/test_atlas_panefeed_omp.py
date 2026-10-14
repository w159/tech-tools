import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _test_isolation  # noqa: F401,E402
import atlas_mux  # noqa: E402
import atlas_panefeed as pf  # noqa: E402

OMP_FIXTURE = Path(__file__).parent / "fixtures" / "omp_stream.jsonl"
ANSI = __import__("re").compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def plain(s: str) -> str:
    return ANSI.sub("", s)


def tool(name, **inp):
    return {
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "name": name, "input": inp}]},
    }


class OmpFeedTests(unittest.TestCase):
    def events(self):
        return [
            json.loads(l) for l in OMP_FIXTURE.read_text().splitlines() if l.strip()
        ]

    def test_omp_json_mode_renders_tool_rows_and_think_text(self):
        joined = "\n".join(
            plain(x) for ev in self.events() for x in pf.render_event(ev, 120)
        )
        self.assertRegex(joined, r"todo ")
        self.assertRegex(joined, r"bash .*echo hi")
        self.assertIn("The command printed", joined)

    def test_omp_feed_counts_tool_executions_and_tokens(self):
        feed = pf.Feed("w1", out=io.StringIO(), live=False)
        for ev in self.events():
            feed.event(ev)
        self.assertEqual(feed.tools, 2)
        self.assertIn("24 tok", plain(feed._status(120)))

    def test_mux_feed_keeps_omp_report_from_agent_end(self):
        lines = []
        with contextlib.redirect_stdout(io.StringIO()):
            for raw in OMP_FIXTURE.read_text().splitlines():
                lines += atlas_mux._feed_line(raw)
        self.assertEqual(lines, ["The command printed `hi`. Done."])

    def test_omp_argv_uses_json_mode(self):
        argv = atlas_mux.harness_argv(
            "omp", "explorer", "go", None, None, "", "default"
        )
        self.assertEqual(argv[argv.index("--mode") + 1], "json")


class CallTimestampTests(unittest.TestCase):
    def test_claude_tool_use_records_call_times_for_the_lane_sparkline(self):
        calls = Path(tempfile.mkdtemp()) / "w1.tool.json"
        feed = pf.Feed("w1", out=io.StringIO(), live=False, calls_file=calls)
        feed.event(tool("Read", file_path="/a"))
        feed.event(
            {
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": "hm"}]},
            }
        )
        feed.event(tool("Bash", command="ls"))
        rec = json.loads(calls.read_text())
        self.assertEqual(len(rec["calls"]), 2)
        self.assertNotIn(
            "tool", rec
        )  # the lane tool still comes from the stream log tail

    def test_existing_record_keys_survive_and_history_is_capped(self):
        calls = Path(tempfile.mkdtemp()) / "w1.tool.json"
        calls.write_text(json.dumps({"tool": "x", "calls": list(range(100))}))
        feed = pf.Feed("w1", out=io.StringIO(), live=False, calls_file=calls)
        feed.event(tool("Read", file_path="/a"))
        rec = json.loads(calls.read_text())
        self.assertEqual(rec["tool"], "x")
        self.assertEqual(len(rec["calls"]), pf.MAX_CALLS)

    def test_unwritable_calls_file_never_breaks_the_feed(self):
        feed = pf.Feed(
            "w1",
            out=io.StringIO(),
            live=False,
            calls_file=Path("/nonexistent-dir/x/w1.tool.json"),
        )
        feed.event(tool("Read", file_path="/a"))
        self.assertEqual(feed.tools, 1)


if __name__ == "__main__":
    unittest.main()
