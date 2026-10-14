import io
import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _test_isolation  # noqa: F401,E402
import atlas_panefeed as pf  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "claude_stream.jsonl"
ANSI = __import__("re").compile(r"\x1b\[[0-9;?]*[A-Za-z]")
# the shape a live worker sent (osprey cache path, $S/$A env prefix, several notes in one call)
LIVE_CMD = (
    "S=/Users/jerry/MEGA/Projects/Agentic/osprey/assets/plugins/cache/tech-tools/atlas/12.2.0/scripts/atlas_todo.py; "
    'A="--root /Users/jerry/MEGA/Projects/Agentic/tech-tools --channel tech-tools@main/lead-a47cc5 --owner explorer-9eb2"; '
    "python3 $S note $A --to lead-a47cc5 'start: sleep x2 then peer-sync'; sleep 5; sleep 5; "
    "python3 $S note $A --to explorer-4fdc peer-sync"
)


def plain(s: str) -> str:
    return ANSI.sub("", s)


def tool(name, **inp):
    return {
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "name": name, "input": inp}]},
    }


class UnwrapTests(unittest.TestCase):
    def test_live_env_prefix_form(self):
        first, notes = pf.unwrap_shell(LIVE_CMD)
        self.assertEqual(first, "python3 atlas_todo.py note --to lead-a47cc5")
        self.assertEqual(
            notes,
            [
                ("lead-a47cc5", "start: sleep x2 then peer-sync"),
                ("explorer-4fdc", "peer-sync"),
            ],
        )

    def test_lean_ctx_wrapper_is_stripped(self):
        first, notes = pf.unwrap_shell(
            "/opt/homebrew/bin/lean-ctx -c 'S=/a/b; cd /tmp/x && git status --short'"
        )
        self.assertEqual((first, notes), ("g" + "it status --short", []))
        self.assertEqual(pf.unwrap_shell("cd /tmp/x")[0], "cd x")
        self.assertEqual(
            pf.unwrap_shell("cd /tmp && python3 /a/atlas_todo.py note --to b hi")[0],
            "python3 atlas_todo.py note --to b",
        )
        self.assertEqual(
            pf.unwrap_shell("/opt/homebrew/bin/lean-ctx -c 'sleep 3'")[0], "sleep 3"
        )

    def test_loop_and_quoted_path_note(self):
        cmd = "S=/x/scripts/atlas_todo.py\nfor p in a b; do python3 \"$S\" note --root /r --to $p 'hi there' 2>&1 | head -3; done"
        first, notes = pf.unwrap_shell(cmd)
        self.assertEqual(first, "python3 atlas_todo.py note --to a,b")
        self.assertEqual(notes, [("a", "hi there"), ("b", "hi there")])

    def test_shared_fixtures_match_omp_cmd_unwrap(self):
        # same literal cases as plugins/atlas/omp/cmd-unwrap.test.ts: both sides must unwrap identically
        loop_cmd = "S=/x/scripts/atlas_todo.py\nfor p in a b; do python3 \"$S\" note --root /r --to $p 'hi there' 2>&1 | head -3; done"
        cases = [
            (
                LIVE_CMD,
                "python3 atlas_todo.py note --to lead-a47cc5",
                [
                    ("lead-a47cc5", "start: sleep x2 then peer-sync"),
                    ("explorer-4fdc", "peer-sync"),
                ],
            ),
            (
                "/opt/homebrew/bin/lean-ctx -c 'S=/a/b; cd /tmp/x && git status --short'",
                "git status --short",
                [],
            ),
            ("cd /tmp/x", "cd x", []),
            (
                "cd /tmp && python3 /a/atlas_todo.py note --to b hi",
                "python3 atlas_todo.py note --to b",
                [("b", "hi")],
            ),
            ("/opt/homebrew/bin/lean-ctx -c 'sleep 3'", "sleep 3", []),
            (
                loop_cmd,
                "python3 atlas_todo.py note --to a,b",
                [("a", "hi there"), ("b", "hi there")],
            ),
            (
                "python3 /x/atlas_todo.py note --help",
                "python3 atlas_todo.py note --help",
                [],
            ),
        ]
        for cmd, first, notes in cases:
            self.assertEqual(pf.unwrap_shell(cmd), (first, notes), cmd)

    def test_note_help_is_not_a_note(self):
        self.assertEqual(pf.unwrap_shell("python3 /x/atlas_todo.py note --help")[1], [])

    def test_file_tools_show_basename_and_range(self):
        self.assertEqual(
            pf.tool_arg("Read", {"file_path": "/etc/hosts", "offset": 10, "limit": 20}),
            "hosts:10-30",
        )
        self.assertEqual(
            pf.tool_arg(
                "mcp__lean-ctx__ctx_read",
                {"path": "/a/band.tsx", "mode": "lines:96-140"},
            ),
            "band.tsx:96-140",
        )
        self.assertEqual(
            pf.tool_arg("Edit", {"file_path": "/a/b/c.py", "old_string": "x"}), "c.py"
        )
        self.assertEqual(
            pf.tool_arg("Grep", {"pattern": "planRows", "path": "/r/plugins/atlas"}),
            "planRows  in plugins/atlas",
        )


class RowTests(unittest.TestCase):
    def test_peer_note_renders_bash_then_pink_peer_chip(self):
        rows = pf.event_rows(tool("Bash", command=LIVE_CMD), now=0)
        texts = [plain(pf.paint(r, 200)) for r in rows]
        self.assertIn(" Bash ", texts[0])
        self.assertIn("python3 atlas_todo.py note --to lead-a47cc5", texts[0])
        self.assertIn(" peer ", texts[1])
        self.assertIn("→ lead-a47cc5: start: sleep x2 then peer-sync", texts[1])
        self.assertEqual(rows[1][1][2], pf.PINK)  # the chip background
        self.assertNotIn("S=/Users", "".join(texts))

    def test_text_block_is_a_think_row(self):
        ev = {
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "plan A\nmore"}]},
        }
        row = plain(pf.paint(pf.event_rows(ev)[0], 120))
        self.assertIn(" think ", row)
        self.assertIn("plan A", row)
        self.assertNotIn("more", row)

    def test_rows_fill_the_exact_width_never_wrapped(self):
        """Every cell is painted explicitly (capture-pane drops EL-cleared cells, so EL-filled bars
        looked short); the feed positions each row with CUP, so a full row never wraps."""
        long = tool("Bash", command="echo " + "x" * 500)
        for width in (20, 40, 77):
            for line in pf.render_event(long, width) + [
                pf.paint([pf.seg("short")], width)
            ]:
                self.assertEqual(len(plain(line)), width)
                self.assertNotIn("\n", line)

    def test_header_spans_the_pane_width(self):
        for width in (60, 96, 158):
            rows = pf.header(
                "explorer-a324",
                "explorer",
                "t3",
                "x@main/lead-a47cc5",
                "Map callers\nmore",
                width,
                ["b", "c"],
            ).split("\n")
            bar = plain(rows[0])
            self.assertEqual(len(bar), width)
            self.assertTrue(all(len(plain(r)) == width for r in rows))
            self.assertTrue(bar.startswith(" ◢◤ ATLAS  ◔_◔ explorer-a324"))
            self.assertTrue(bar.endswith("explorer · wave t3 "))
            self.assertIn("goal Map callers", plain(rows[1]))
            self.assertIn("#lead-a47cc5  peers: b · c", plain(rows[2]))
        self.assertIn("38;2;", rows[0])

    def test_header_wears_the_role_character_and_animates(self):
        bar = lambda role, tick=0, state="run": plain(
            pf.header("w-1", role, "t", "", "g", 80, (), tick, state).split("\n")[0]
        )
        self.assertIn("◔_◔ w-1", bar("explorer"))
        self.assertIn("◔o◔ w-1", bar("explorer", 1))
        self.assertNotEqual(bar("explorer", 0), bar("explorer", 1))
        self.assertIn("•_• w-1", bar("implementer"))
        self.assertIn("◔‿◔ w-1", bar("explorer", 2, "done"))
        self.assertIn("◔n◔ w-1", bar("explorer", 2, "fail"))
        self.assertIn("·_· w-1", bar("armada-sales"))
        for state in ("run", "done", "fail"):
            self.assertEqual(len(bar("critic", 3, state)), 80)

    def test_feed_header_follows_the_ticker(self):
        feed = pf.Feed(
            "w-1", "verifier", "t", "", "# Task\ng", out=io.StringIO(), live=False
        )
        first = plain(feed._header(80))
        feed.tick = 1
        self.assertNotEqual(first, plain(feed._header(80)))
        feed.state = "done"
        self.assertIn("◉‿◉ w-1", plain(feed._header(80)))

    def test_character_table_matches_mod_roles_ts(self):
        src = (Path(__file__).parent.parent / "mod" / "roles.ts").read_text()
        block = src.split("export const ROLE_EYES")[1].split("};")[0]
        eyes = {
            k: (left, right)
            for k, left, right in re.findall(r"'?([\w-]+)'?: \['(.)', '(.)'\]", block)
        }
        self.assertEqual(pf.ROLE_EYES, eyes)
        mouths = {
            k: tuple(re.findall(r"'(.)'", v))
            for k, v in re.findall(
                r"(\w+): \[([^\]]*)\]",
                src.split("export const MOUTHS")[1].split("};")[0],
            )
        }
        self.assertEqual(pf.MOUTHS, mouths)

    def test_status_line_run_done_failed(self):
        self.assertIn("working", plain(pf.status_row("run", 0, 72, 9, 3100, 96)))
        self.assertIn(
            "1m12s · 9 tools · 3.1k tok",
            plain(pf.status_row("run", 0, 72, 9, 3100, 96)),
        )
        self.assertIn(
            "✔ DONE · 35s · 9 tools", plain(pf.status_row("done", 0, 35, 9, 0, 96))
        )
        self.assertIn("✖ FAILED", plain(pf.status_row("fail", 0, 35, 9, 0, 96)))
        for width in (30, 77, 200):
            for state in ("run", "done", "fail"):
                self.assertEqual(
                    len(plain(pf.status_row(state, 3, 5, 1, 0, width))), width
                )

    def test_header_gradient_takes_the_role_color(self):
        for role, color in (
            ("explorer", pf.TEAL),
            ("implementer", pf.PEACH),
            ("verifier", pf.GREEN),
            ("completeness-critic", pf.VIOLET),
        ):
            bar = pf.header("w", role, "t", "", "g", 80).split("\n")[0]
            self.assertTrue(bar.startswith(pf.bg(color)), role)

    def test_brief_goal_and_peers(self):
        brief = "You are w (x), one of 3.\nPeers: a-1, b-2.\n\n# Task\nRead 3 files.\nmore\n"
        self.assertEqual(pf.goal_of(brief), "Read 3 files.")
        self.assertEqual(pf.peers_of(brief), ["a-1", "b-2"])
        self.assertEqual(pf.peers_of("Peers: (none)."), [])


class PaneFeedTests(unittest.TestCase):
    def events(self):
        return [json.loads(l) for l in FIXTURE.read_text().splitlines() if l.strip()]

    def test_fixture_renders_tool_lines_and_result(self):
        out = []
        for ev in self.events():
            out += [plain(x) for x in pf.render_event(ev, 120)]
        joined = "\n".join(out)
        self.assertIn("Bash", joined)
        self.assertIn("echo hi", joined)
        self.assertRegex(joined, r"result .*exit 0")

    def test_feed_counts_tools_and_prints_final_status(self):
        buf = io.StringIO()
        feed = pf.Feed(
            "w1", "explorer", "t9", "c/lead-x", "# Task\ngo", out=buf, live=False
        )
        feed.start()
        for ev in self.events():
            feed.event(ev)
        feed.finish(0)
        text = plain(buf.getvalue())
        self.assertIn("◢◤ ATLAS  ◔_◔ w1", text)
        self.assertRegex(text, r"✔ DONE · \d+s · [1-9]\d* tools")

    def test_tokens_count_new_work_once_per_message_and_cache_reads_apart(self):
        feed = pf.Feed("w1", out=io.StringIO(), live=False)
        usage = {
            "input_tokens": 3,
            "cache_creation_input_tokens": 2000,
            "cache_read_input_tokens": 142000,
            "output_tokens": 400,
        }
        for block in (
            {"type": "text", "text": "x"},
            {"type": "tool_use", "name": "Read", "input": {}},
        ):
            # stream-json repeats the message (and its usage) once per content block
            feed.event(
                {
                    "type": "assistant",
                    "message": {"id": "m1", "usage": usage, "content": [block]},
                }
            )
        self.assertIn("· 2.4k tok · 142.0k cached", plain(feed._status(120)))
        self.assertNotIn("144", plain(feed._status(120)))

    def test_small_cache_reads_are_not_shown(self):
        row = plain(pf.status_row("done", 0, 35, 2, 2403, 96, cached=4000))
        self.assertIn("2 tools · 2.4k tok", row)
        self.assertNotIn("cached", row)

    def test_tool_count_matches_the_tool_and_peer_rows(self):
        feed = pf.Feed("w1", out=io.StringIO(), live=False)
        feed.event(tool("Bash", command=LIVE_CMD))  # one Bash row and two peer rows
        feed.event(tool("ToolSearch", query="select:x"))
        feed.event(
            {
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": "thinking"}]},
            }
        )
        self.assertEqual(feed.tools, 4)
        self.assertIn(" 4 tools ", plain(feed._status(120)))

    def test_live_feed_spacer_then_status_on_the_last_row(self):
        from unittest import mock

        buf = io.StringIO()
        feed = pf.Feed("w1", "explorer", "t", "", "# Task\ngo", out=buf, live=True)
        with mock.patch.object(pf.Feed, "_size", return_value=(60, 14)):
            feed.event(tool("Read", file_path="/etc/hosts"))
        frame = buf.getvalue().rsplit("\x1b[2J", 1)[-1]
        rows = {
            int(m.group(1)): plain(m.group(2))
            for m in __import__("re").finditer(
                r"\x1b\[(\d+);1H(.*?)(?=\x1b\[\d+;1H|$)", frame
            )
        }
        self.assertEqual(sorted(rows), list(range(1, 15)))
        self.assertTrue(all(len(r) == 60 for r in rows.values()))
        self.assertIn("hosts", rows[5])
        self.assertEqual(rows[6].strip(), "· · ·")
        self.assertTrue(all(not rows[i].strip() for i in range(7, 14)))
        self.assertIn("working", rows[14])

    def test_result_text_matches_final_result(self):
        res = [e for e in self.events() if e["type"] == "result"][-1]
        self.assertEqual(pf.result_text(res), res["result"])

    def test_non_event_is_ignored(self):
        self.assertEqual(
            pf.render_event({"type": "system", "subtype": "hook_started"}), []
        )

    def test_mux_feed_keeps_report_text(self):
        import contextlib
        import atlas_mux

        lines = []
        with contextlib.redirect_stdout(io.StringIO()):
            for raw in FIXTURE.read_text().splitlines():
                lines += atlas_mux._feed_line(raw)
        res = [e for e in self.events() if e["type"] == "result"][-1]["result"]
        self.assertEqual(lines, [t for t in res.splitlines() if t.strip()])


if __name__ == "__main__":
    unittest.main()
