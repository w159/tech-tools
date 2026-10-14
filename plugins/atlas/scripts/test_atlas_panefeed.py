import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import atlas_panefeed as pf  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "claude_stream.jsonl"
ANSI = __import__("re").compile(r"\x1b\[[0-9;]*m")


def plain(s: str) -> str:
    return ANSI.sub("", s)


class PaneFeedTests(unittest.TestCase):
    def events(self):
        return [json.loads(l) for l in FIXTURE.read_text().splitlines() if l.strip()]

    def test_header_has_pill_and_fields(self):
        h = plain(pf.header("w1", "auditor", "t9", "chan", "Do the thing\nmore"))
        self.assertIn(" ATLAS ", h)
        for want in ("w1", "auditor", "team t9", "#chan", "Do the thing"):
            self.assertIn(want, h)
        self.assertNotIn("more", h)
        self.assertIn("\x1b[", pf.header("w1", "a", "t", "c", "g"))

    def test_fixture_renders_tool_lines_and_status(self):
        out = []
        for ev in self.events():
            out += [plain(x) for x in pf.render_event(ev)]
        joined = "\n".join(out)
        self.assertIn("Bash", joined)
        self.assertIn("echo hi", joined)
        self.assertRegex(joined, r"STATUS .*exit 0")

    def test_result_text_matches_final_result(self):
        res = [e for e in self.events() if e["type"] == "result"][-1]
        self.assertEqual(pf.result_text(res), res["result"])

    def test_peer_note_line(self):
        ev = {"type": "assistant", "message": {"content": [{
            "type": "tool_use", "name": "Bash",
            "input": {"command": "python3 atlas_todo.py note --to sib hello"}}]}}
        self.assertIn("note", plain(pf.render_event(ev)[0]))

    def test_non_event_is_ignored(self):
        self.assertEqual(pf.render_event({"type": "system", "subtype": "hook_started"}), [])

    def test_mux_feed_keeps_report_text(self):
        import contextlib, io
        import atlas_mux
        lines = []
        with contextlib.redirect_stdout(io.StringIO()):
            for raw in FIXTURE.read_text().splitlines():
                lines += atlas_mux._feed_line(raw)
        res = [e for e in self.events() if e["type"] == "result"][-1]["result"]
        self.assertEqual(lines, [t for t in res.splitlines() if t.strip()])


if __name__ == "__main__":
    unittest.main()
