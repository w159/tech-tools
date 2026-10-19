"""Tests for atlas_tui: text frames from a contract-shaped fixture snapshot (no live model)."""

import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_tui as T  # noqa: E402

EV = {
    "ts": 1792181090,
    "from": "impl-1",
    "to": "lead",
    "kind": "blocked",
    "text": "need contract",
    "channel": "ch1",
}


def seat(name, pod, rt, state, target="%1", **kw):
    d = {
        "name": name,
        "colony": "lead-01",
        "pod": pod,
        "role": pod,
        "runtime": rt,
        "model": "m-" + rt,
        "state": state,
        "exit_code": None,
        "target": target,
        "pid": 1,
        "queue": 1,
        "work": "t1",
        "now": "doing " + name,
        "log_path": "/l",
        "last_active": 1,
        "lead": False,
    }
    d.update(kw)
    return d


SNAP = {
    "ok": True,
    "host": "macbook-pro",
    "clock": "2026-09-02 11:00:00 UTC",
    "project": "/p",
    "colonies": [
        {
            "id": "lead-01",
            "label": "lead-01 · implement/high",
            "session": "atlas-lead-01",
            "transport": "tmux",
            "task": "Make colony real",
            "channel": "ch1",
            "created": 1,
            "pods": [
                {"id": "explorer", "seats": ["ex-1"]},
                {"id": "implementer", "seats": ["impl-1", "impl-2"]},
            ],
        },
        {
            "id": "ops",
            "label": "ops",
            "session": "atlas-ops",
            "transport": "tmux",
            "task": "t",
            "channel": "ch2",
            "created": 2,
            "pods": [],
        },
    ],
    "seats": [
        seat("ex-1", "explorer", "claude", "working"),
        seat("impl-1", "implementer", "omp", "blocked", "%2"),
        seat("impl-2", "implementer", "codex", "idle", ""),
    ],
    "feed": [EV, dict(EV, kind="note", text="go", **{"from": "lead", "to": "all"})],
    "needs": [EV],
    "specs": [
        {"kind": "agent", "name": "explorer", "description": "maps code"},
        {"kind": "team", "name": "implement", "efforts": ["low", "high"]},
    ],
    "projects": [{"root": "/p", "name": "p", "channels": 2}],
    "terminals": [
        {"session": "atlas-lead-01", "windows": 3, "panes": 3, "attached": 1}
    ],
    "system": {
        "tmux": {"ok": True, "version": "3.5"},
        "dashboard": {"ok": True, "url": "http://x"},
        "herdr": {"ok": False},
        "rig": {"ok": False},
        "harnesses": {"claude": True, "omp": True, "codex": False},
    },
}


def frame(ui, w=140, h=40):
    return "\n".join(T.render(SNAP, ui, w, h))


class Render(unittest.TestCase):
    def test_frame_shape(self):
        lines = T.render(SNAP, T.new_ui(), 120, 30)
        self.assertEqual(len(lines), 30)
        self.assertTrue(all(len(x) == 120 for x in lines))
        self.assertTrue(
            lines[0].startswith("cmd ▸ ▊  Tab complete · ? help · last 2026-09-02")
        )
        self.assertTrue(
            lines[1].startswith("━ { EXPLORER } ━") and "╋━ TOPOLOGY ━" in lines[1]
        )

    def test_compact_frames_keep_explorer_and_footer(self):
        for w, h in ((60, 18), (70, 20)):
            lines = T.render(SNAP, T.new_ui(), w, h)
            self.assertEqual(len(lines), h)
            self.assertTrue(all(len(x) == w for x in lines))
            self.assertTrue(lines[1].startswith("━ { EXPLORER } ━"))
            self.assertEqual(lines[1].index("╋"), T.COMPACT_LEFT)
            self.assertIn("TOPOLOGY", "\n".join(lines))
            self.assertTrue(lines[-2].strip() and lines[-1].strip())

    def test_topology_tree(self):
        f = frame(T.new_ui())
        for s in (
            "▶TOPOLOGY",
            "┗━ ⊕ macbook-pro",
            "┣━ ▦ lead-01",
            "┃ ┣━ › explorer",
            "┃ ┗━ › implementer",
            "┗━ ▦ ops",
            "2 colonies · select one in Explorer",
        ):
            self.assertIn(s, f)

    def test_table(self):
        f = frame(T.new_ui(colony="lead-01"))
        for s in (
            "[ TABLE ]",
            "colony lead-01",
            "POD",
            "SEAT",
            "MODEL",
            "ACTIONS",
            "● working",
            "! blocked",
            "· idle",
            "term ▸",
            "3 seats · 1 working · 1 need attention · 3 open rows",
            "RECENT",
            "▪ [blocked]",
        ):
            self.assertIn(s, f)

    def test_graph_boxes(self):
        f = frame(T.new_ui(colony="lead-01", tab="graph"))
        for s in (
            "[ GRAPH ]",
            "╔═ ▦ COLONY lead-01",
            "┌ ≡ explorer",
            "│ ● ex-1",
            "│ >_ m-omp",
            "▾",
            "╚",
        ):
            self.assertIn(s, f)

    def test_overview_and_health_tabs(self):
        self.assertIn(
            "task       Make colony real",
            frame(T.new_ui(colony="lead-01", tab="overview")),
        )
        self.assertIn("DEGRADED", frame(T.new_ui(colony="lead-01", tab="health")))

    def test_sections(self):
        self.assertIn("agent  explorer", frame(T.new_ui(section="specs")))
        self.assertIn(
            "p                        2 channels", frame(T.new_ui(section="projects"))
        )
        self.assertIn("atlas-lead-01", frame(T.new_ui(section="terminals")))
        f = frame(T.new_ui(section="feed"))
        self.assertIn("Needs attention", f)
        self.assertIn("▪ [blocked]", f)
        self.assertIn("HEALTH", frame(T.new_ui(section="system")))
        self.assertIn("SYSTEM · HEALTH", frame(T.new_ui(section="system")))

    def test_seat_view(self):
        ui = T.new_ui(
            colony="lead-01", seat="impl-1", seat_text="line1\n\x1b[31mred\x1b[0m\nlast"
        )
        f = frame(ui)
        self.assertIn("SEAT impl-1 · omp", f)
        self.assertIn("red", f)
        self.assertNotIn("\x1b", f)
        self.assertIn("t = attach", f)

    def test_help_and_filter(self):
        f = frame(T.new_ui(mode="help"))
        for s in (
            "help ▸ ▊  · type to find a command",
            "colony <id>",
            "seat <name>",
            "term <seat>",
            "send <seat> <text>",
            "tab <table|recent|overview|graph|health>",
            "refresh",
            "quit",
            "› colony <id>",
        ):
            self.assertIn(s, f)
        f = frame(T.new_ui(colony="lead-01", filter="impl-2"))
        self.assertIn("impl-2", f)
        self.assertNotIn("ex-1  ", f.split("RECENT")[0])
        self.assertTrue(
            frame(T.new_ui(mode="filter", buf="data")).startswith("cmd ▸ /data▊")
        )


class Input(unittest.TestCase):
    def keys(self, ui, *ks):
        eff = None
        for k in ks:
            eff = T.handle_key(SNAP, ui, k) or eff
        return eff

    def test_navigate_open_seat_and_back(self):
        ui = T.new_ui()
        self.keys(ui, "down", "down", "enter")  # topology rows: TOPOLOGY, host, lead-01
        self.assertEqual(ui["colony"], "lead-01")
        self.keys(ui, "right", "down", "enter")
        self.assertEqual(ui["seat"], "impl-1")
        self.keys(ui, "esc")
        self.assertIsNone(ui["seat"])
        self.keys(ui, "esc")
        self.assertIsNone(ui["colony"])

    def test_t_and_term(self):
        ui = T.new_ui(colony="lead-01", seat="impl-1")
        self.assertEqual(self.keys(ui, "t"), ("term", "impl-1"))
        ui = T.new_ui(colony="lead-01", seat="impl-2")
        self.assertIsNone(self.keys(ui, "t"))
        self.assertIn("no tmux pane", ui["status"])

    def test_commands(self):
        ui = T.new_ui()
        self.assertEqual(self.keys(ui, ":", *"colony ops", "enter"), None)
        self.assertEqual(ui["colony"], "ops")
        self.assertEqual(
            self.keys(ui, ":", *"send ex-1 hello there", "enter"),
            ("send", "ex-1", "hello there"),
        )
        self.assertEqual(
            self.keys(ui, ":", *"term impl-1", "enter"), ("term", "impl-1")
        )
        self.keys(ui, ":", *"tab graph", "enter")
        self.assertEqual(ui["tab"], "graph")
        self.keys(ui, ":", *":feed", "enter")
        self.assertEqual(ui["section"], "feed")
        self.assertEqual(self.keys(ui, ":", *"quit", "enter"), ("quit",))
        self.assertEqual(self.keys(T.new_ui(), "q"), ("quit",))
        self.assertEqual(self.keys(T.new_ui(), "r"), ("refresh",))

    def test_tab_completion_help_and_filter(self):
        ui = T.new_ui()
        self.keys(ui, ":", *"ref", "tab")
        self.assertEqual(ui["buf"], "refresh ")
        self.keys(ui, "esc", "?")
        self.assertEqual(ui["mode"], "help")
        self.keys(ui, "esc")
        self.assertEqual(ui["mode"], "")
        self.keys(ui, "/", *"abc")
        self.assertEqual(ui["filter"], "abc")
        self.keys(ui, "esc")
        self.assertEqual(ui["filter"], "")


class Start(unittest.TestCase):
    def test_cursor_on_first_live_colony_and_enter_reaches_seat(self):
        ui = T.new_ui()
        T.focus_first_live(SNAP, ui)
        f = frame(ui)
        self.assertIn("▶  ┣━ ▦ lead-01", f.replace("▶    ", "▶  ").replace("▶   ", "▶  "))
        T.handle_key(SNAP, ui, "enter")
        self.assertEqual(ui["colony"], "lead-01")
        T.handle_key(SNAP, ui, "enter")
        self.assertEqual(ui["seat"], "ex-1")

    def test_launch_names_window(self):
        a = mock.Mock(project="/p", all=False, fixture=None)
        with mock.patch.dict(T.os.environ, {"TMUX": "1"}), mock.patch.object(T.subprocess, "run") as run, \
                mock.patch.object(T, "once", return_value=0):
            run.return_value.stdout = "@7\n"
            T.launch(a)
        argvs = [c.args[0] for c in run.call_args_list]
        self.assertIn("atlas-tui", argvs[0])
        self.assertEqual(argvs[1][-2:], ["automatic-rename", "off"])


class Attach(unittest.TestCase):
    def test_attach_runs_setup_argv_cleanup(self):
        m = mock.Mock()
        m.attach_argv.return_value = (
            [["tmux", "new-session"], ["tmux", "select-pane"]],
            ["tmux", "attach", "-t", "v"],
        )
        with mock.patch.object(T.subprocess, "run") as run:
            self.assertEqual(T.attach(SNAP, "impl-1", m), "")
        self.assertEqual(
            [c.args[0][:2] for c in run.call_args_list],
            [["tmux", "new-session"], ["tmux", "select-pane"], ["tmux", "attach"]],
        )
        m.cleanup_view.assert_called_once()
        self.assertEqual(T.attach(SNAP, "impl-2", m), "no tmux pane")

    def test_send_posts_board_note(self):
        with mock.patch.dict(sys.modules, {"atlas_todo": mock.Mock()}) as _:
            T.send("/r", "ex-1", "hi", SNAP)
            sys.modules["atlas_todo"].note.assert_called_once_with(
                "/r", "tui", "hi", to="ex-1"
            )


class Cli(unittest.TestCase):
    def test_once_fixture(self):
        import json
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump(SNAP, fh)
        out = subprocess.run(
            [
                sys.executable,
                str(Path(T.__file__)),
                "--fixture",
                fh.name,
                "--width",
                "120",
                "--height",
                "30",
                "--colony",
                "lead-01",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("[ TABLE ]", out.stdout)
        self.assertEqual(len(out.stdout.rstrip("\n").split("\n")), 30)


if __name__ == "__main__":
    unittest.main()
