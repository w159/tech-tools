"""Tests for atlas_tui: text frames from a contract-shaped fixture snapshot (no live model)."""

import contextlib
import io
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_tui as T  # noqa: E402
import time  # noqa: E402

EV = {
    "ts": 1792181090,
    "seq": 7,
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
        f = frame(T.new_ui(colony="lead-01"), 180, 50)
        for s in (
            "[ TABLE ]  RECENT    OVERVIEW    GRAPH    HEALTH     colony lead-01",
            "▪ CONFIG · colony settings  (open ▸)",
            "HEALTH  ATTENTION · impl-1 blocked",
            "/ filter agents…",
            "POD         SEAT            RT   MODEL             CTX STATE         Q WORK            NOW ",
            "━━━━━━━━",
            "┈┈┈┈┈┈┈┈",
            "explorer    ● ex-1",
            "! impl-1",
            "· impl-2",
            "[ msg ] [ view ] [ term ] [ stop ]",
            "[ msg ] [ view ]",
            "3 seats · 1 working · 1 need attention · 3 open rows",
            "── RECENT · colony lead-01 ──",
            "▪ 2026-10-16 ",
            "· #7  (open ▸)",
            "impl-1 → lead · blocked",
        ):
            self.assertIn(s, f)
        self.assertEqual(f.count("explorer    ●"), 1)

    def test_recent_header_uses_colony_name_and_finished_is_marked(self):
        snap = {**SNAP, "colonies": [{**c, "name": "my-colony", "finished": True} if c["id"] == "lead-01" else c for c in SNAP["colonies"]]}
        f = "\n".join(T.render(snap, T.new_ui(colony="lead-01"), 180, 50))
        self.assertIn("── RECENT · colony my-colony ──", f)
        self.assertIn("HEALTH  ✓ finished · ", f)
        self.assertIn("▦ my-colony ✓ finished", f)

    def test_table_fits_long_seat_labels_at_150(self):
        snap = dict(SNAP, seats=[dict(SNAP["seats"][0], name="completeness-critic", address="completeness-critic@c", pod="explorer-1")])
        for w in (80, 150, 180):
            f = "\n".join(T.render(snap, T.new_ui(colony="lead-01"), w, 40))
            if w >= 150:
                self.assertIn("completeness-critic", f)
                self.assertIn("explorer-1", f)
            self.assertTrue(all(len(r) <= w for r in T.render(snap, T.new_ui(colony="lead-01"), w, 40)))

    def test_now_keeps_changing_range(self):
        snap = dict(SNAP, seats=[dict(SNAP["seats"][0], now="ctx_read /a/very/long/path/to/atlas_dashboard.py:1501-1750")])
        for w, want in ((150, "ctx_read atlas_dashboard.py:1501-1750"), (80, "01-1750")):
            f = "\n".join(T.render(snap, T.new_ui(colony="lead-01"), w, 40))
            self.assertIn(want, f)

    def test_default_opens_live_colony_table(self):
        ui = T.new_ui()
        T.focus_first_live(SNAP, ui)
        f = frame(ui, 180, 50)
        self.assertIn("▶   ┣━ ▦ lead-01", f)
        self.assertIn("[ TABLE ]", f)
        self.assertIn("POD         SEAT", f)

    def test_no_live_colony_keeps_topology(self):
        snap = dict(SNAP, seats=[])
        ui = T.new_ui()
        T.focus_first_live(snap, ui)
        self.assertIsNone(ui["colony"])
        self.assertIn("2 colonies · select one in Explorer", "\n".join(T.render(snap, ui, 140, 40)))

    def test_graph_boxes(self):
        f = frame(T.new_ui(colony="lead-01", tab="graph"))
        for s in (
            "[ GRAPH ]",
            "╔═ ▦ COLONY lead-01",
            "┌ ≡ explorer",
            "│ ● ex-1",
            "│ >_ —",
            "─┼────┼▸│",
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


class LaunchWindow(unittest.TestCase):
    OPENERS = {
        "iTerm.app": 'tell application "iTerm"',
        "Apple_Terminal": 'tell application "Terminal"',
        "ghostty": "Ghostty",
    }

    def test_attach_open_argv_per_term_program(self):
        self.assertIsNone(T._attach_open_argv({}))
        self.assertIsNone(T._attach_open_argv({"TERM_PROGRAM": "vscode"}))
        for tp, marker in self.OPENERS.items():
            with self.subTest(term_program=tp):
                res = T._attach_open_argv({"TERM_PROGRAM": tp})
                assert res is not None
                argv, label = res
                self.assertEqual(argv[0], "open" if tp == "ghostty" else "osascript")
                self.assertIn(marker, " ".join(argv))
                self.assertIn("atlas-tui", " ".join(argv))

    def _launch(self, env, opener_rc=0, has_session=1):
        a = mock.Mock(project="/p", all=False, fixture=None)
        calls, out = [], io.StringIO()

        def fake(cmd, **kw):
            calls.append(list(cmd))
            r = mock.Mock()
            r.returncode = has_session if cmd[:2] == ["tmux", "has-session"] else opener_rc
            r.stdout = ""
            return r

        with mock.patch.dict(T.os.environ, env, clear=True), \
                mock.patch("sys.platform", "darwin"), \
                mock.patch.object(T.subprocess, "run", side_effect=fake), \
                mock.patch.object(T, "once", return_value=0), \
                contextlib.redirect_stdout(out):
            T.launch(a)
        return calls, out.getvalue()

    def test_launch_opens_visible_window_per_term_program(self):
        for tp, marker in self.OPENERS.items():
            with self.subTest(term_program=tp):
                calls, out = self._launch({"TERM_PROGRAM": tp})
                self.assertEqual(calls[0][:2], ["tmux", "has-session"])
                self.assertTrue(any("new-session" in " ".join(c) for c in calls))
                self.assertTrue(any(marker in " ".join(c) for c in calls))
                self.assertIn("opened a new", out)

    def test_launch_reuses_existing_detached_session(self):
        calls, out = self._launch({"TERM_PROGRAM": "vscode"}, has_session=0)
        self.assertTrue(any("has-session" in " ".join(c) for c in calls))
        self.assertFalse(any("new-session" in " ".join(c) for c in calls))
        self.assertIn("reusing detached tmux session 'atlas-tui'", out)

    def test_launch_falls_back_to_attach_command(self):
        calls, out = self._launch({"TERM_PROGRAM": "vscode"})
        self.assertFalse(any("osascript" in c or c[:1] == ["open"] for c in calls if c))
        self.assertIn("attach with: tmux attach -t atlas-tui", out)
        self.assertNotIn("inside omp:", out)

    def test_launch_failed_opener_falls_back(self):
        calls, out = self._launch({"TERM_PROGRAM": "iTerm.app"}, opener_rc=1)
        self.assertTrue(any("osascript" in " ".join(c) for c in calls))
        self.assertIn("attach with: tmux attach -t atlas-tui", out)
        self.assertNotIn("opened a new", out)

    def test_launch_prints_omp_hint(self):
        _, out = self._launch({"TERM_PROGRAM": "vscode", "OMPCODE": "1"})
        self.assertIn("inside omp: type /atlas-tui to open it in this session", out)


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


class FirstPaint(unittest.TestCase):
    def test_first_frame_is_drawn_before_slow_snapshot_finishes(self):
        import curses
        import threading

        gate, finished, frames, cur = threading.Event(), threading.Event(), [], []

        def slow_snapshot(root, all_projects):
            gate.wait(5)
            finished.set()
            return SNAP

        class Done(Exception):
            pass

        scr = mock.Mock()
        scr.getmaxyx.return_value = (40, 120)
        scr.erase.side_effect = cur.clear
        scr.addstr.side_effect = lambda y, x, s, *a: cur.append(s)
        scr.refresh.side_effect = lambda: frames.append((finished.is_set(), "\n".join(cur)))

        def getch():
            if len(frames) == 1:
                gate.set()  # first frame is out; only now let the snapshot complete
            if finished.is_set() and any("lead-01" in f for _, f in frames):
                raise Done
            time.sleep(0.01)
            return -1

        scr.getch.side_effect = getch
        model = mock.Mock(snapshot=slow_snapshot)
        args = mock.Mock(project="/p", all=False)
        with mock.patch.multiple(curses, curs_set=mock.DEFAULT, start_color=mock.DEFAULT, use_default_colors=mock.DEFAULT), \
                mock.patch.object(T, "_model", return_value=model), self.assertRaises(Done):
            T.loop(scr, args)
        done_before, first = frames[0]
        self.assertFalse(done_before)
        self.assertIn("EXPLORER", first)
        self.assertIn("loading colonies…", first)
        self.assertTrue(any("lead-01" in f for _, f in frames[1:]))


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


class Mouse(unittest.TestCase):
    W, H = 140, 40

    def hits(self, ui, snap=SNAP):
        return T.hitmap(snap, ui, self.W, self.H)

    def find(self, hits, kind, pred=lambda a: True):
        return next((r, x0, a) for r, x0, _x1, a in hits if a[0] == kind and pred(a))

    def test_one_click_explorer_opens(self):
        ui = T.new_ui()
        rows = T.explorer_rows(SNAP, ui)
        i = next(k for k, r in enumerate(rows) if r[1] == "colony" and r[2] == "ops")
        r, x, _ = self.find(self.hits(ui), "explorer", lambda a: a[1] == i)
        self.assertIn("ops", T.render(SNAP, ui, self.W, self.H)[r])
        T.handle_click(SNAP, ui, self.hits(ui), x + 2, r)
        self.assertEqual((ui["cursor"], ui["colony"]), (i, "ops"))

    def test_two_quick_clicks_open_even_when_selection_moved(self):
        ui = T.new_ui()
        rows = T.explorer_rows(SNAP, ui)
        i = next(k for k, r in enumerate(rows) if r[1] == "colony" and r[2] == "ops")
        r, x, _ = self.find(self.hits(ui), "explorer", lambda a: a[1] == i)
        with mock.patch.object(T.time, "monotonic", side_effect=[10.0, 10.2, 20.0]):
            T.handle_click(SNAP, ui, self.hits(ui), x + 2, r)
            ui["cursor"] = 0  # selection moved away between the clicks
            T.handle_click(SNAP, ui, self.hits(ui), x + 2, r)
            self.assertEqual(ui["colony"], "ops")

    def test_click_tab_switches(self):
        ui = T.new_ui()
        T.run_command(SNAP, ui, "colony lead-01")
        r, x, _ = self.find(self.hits(ui), "tab", lambda a: a[1] == "graph")
        self.assertTrue(T.render(SNAP, ui, self.W, self.H)[r][x:].startswith("  GRAPH"))
        T.handle_click(SNAP, ui, self.hits(ui), x + 3, r)
        self.assertEqual(ui["tab"], "graph")

    def test_click_term_button_and_seat_row_opens(self):
        ui = T.new_ui()
        T.run_command(SNAP, ui, "colony lead-01")
        r, x, a = self.find(self.hits(ui), "button", lambda a: a[1] == "term")
        self.assertEqual(T.render(SNAP, ui, self.W, self.H)[r][x : x + 8], "[ term ]")
        self.assertEqual(T.handle_click(SNAP, ui, self.hits(ui), x + 2, r), ("term", a[2]))
        r, x, a = self.find(self.hits(ui), "seatrow", lambda a: a[1] == 1)
        T.handle_click(SNAP, ui, self.hits(ui), x + 1, r)
        self.assertEqual((ui["row"], ui["seat"]), (1, "impl-1"))

    def test_open_link_and_wheel(self):
        ui = T.new_ui()
        T.run_command(SNAP, ui, "colony lead-01")
        r, x, _ = self.find(self.hits(ui), "open", lambda a: a[1] == "config")
        T.handle_click(SNAP, ui, self.hits(ui), x, r)
        self.assertEqual(ui["tab"], "overview")
        T.scroll(ui, 1)
        self.assertEqual(ui["pane_scroll"], 3)


class Buttons(unittest.TestCase):
    """Bracketed on-screen buttons: one click fires, all registered in hitmap."""

    W, H = 140, 40

    def btn(self, ui, label, seat="__any__", snap=None):
        hits = T.hitmap(snap or SNAP, ui, self.W, self.H)
        return next(
            (r, x0, a)
            for r, x0, _x1, a in hits
            if a[0] == "button" and a[1] == label and (seat == "__any__" or a[2] == seat)
        )

    def click(self, snap, ui, r, x):
        return T.handle_click(snap, ui, T.hitmap(snap, ui, self.W, self.H), x, r)

    def test_seat_row_buttons_fire(self):
        ui = T.new_ui(colony="lead-01")
        r, x, _ = self.btn(ui, "msg", "ex-1")
        self.assertIsNone(self.click(SNAP, ui, r, x + 2))
        self.assertEqual((ui["mode"], ui["buf"]), ("cmd", "send ex-1 "))
        r, x, _ = self.btn(ui, "view", "impl-1")
        self.click(SNAP, ui, r, x + 2)
        self.assertEqual(ui["seat"], "impl-1")
        ui = T.new_ui(colony="lead-01")
        r, x, _ = self.btn(ui, "term", "ex-1")
        self.assertEqual(self.click(SNAP, ui, r, x + 2), ("term", "ex-1"))

    def test_stop_needs_confirm(self):
        ui = T.new_ui(colony="lead-01")
        r, x, _ = self.btn(ui, "stop", "ex-1")
        self.assertIsNone(self.click(SNAP, ui, r, x + 2))
        self.assertEqual((ui["mode"], ui["confirm"]), ("confirm", "ex-1"))
        T.handle_key(SNAP, ui, "k")  # anything but y/n waits at the gate
        self.assertEqual(ui["mode"], "confirm")
        T.handle_key(SNAP, ui, "n")
        self.assertEqual((ui["mode"], ui["confirm"]), ("", None))
        T.handle_key(SNAP, ui, "y")  # cancelled already: no stray stop
        self.assertEqual(ui["mode"], "")

        ui = T.new_ui(colony="lead-01")
        r, x, _ = self.btn(ui, "stop", "ex-1")
        self.click(SNAP, ui, r, x + 2)
        self.assertEqual(T.handle_key(SNAP, ui, "y"), ("stop", "ex-1"))

    def test_no_stop_for_pane_less_seat(self):
        ui = T.new_ui(colony="lead-01")
        with self.assertRaises(StopIteration):
            self.btn(ui, "stop", "impl-2")  # in-process subagents are out of reach
        f = "\n".join(T.render(SNAP, ui, self.W, self.H))
        self.assertIn("[ msg ] [ view ]", f)
        self.assertIsNone(T.run_command(SNAP, ui, "stop impl-2"))
        self.assertIn("not stoppable", ui["status"])

    def test_msg_prefill_and_broadcast(self):
        ui = T.new_ui(colony="lead-01")
        self.assertIsNone(T.run_command(SNAP, ui, "msg impl-1"))
        self.assertEqual((ui["mode"], ui["buf"]), ("cmd", "send impl-1 "))
        self.assertEqual(T.run_command(SNAP, ui, "broadcast stand down"), ("broadcast", "stand down"))
        ui = T.new_ui()
        self.assertIsNone(T.run_command(SNAP, ui, "broadcast x"))
        self.assertEqual(ui["status"], "no colony selected")

    def test_colony_header_buttons(self):
        ui = T.new_ui(colony="lead-01")
        r, x, _ = self.btn(ui, "refresh")
        self.assertEqual(self.click(SNAP, ui, r, x + 2), ("refresh",))
        r, x, _ = self.btn(ui, "msg all")
        self.assertIsNone(self.click(SNAP, ui, r, x + 2))
        self.assertEqual((ui["mode"], ui["buf"]), ("cmd", "broadcast "))

    def test_footer_help_quit_clickable(self):
        ui = T.new_ui(colony="lead-01")
        r, x, _ = self.btn(ui, "? help")
        self.assertEqual(r, self.H - 2)
        self.click(SNAP, ui, r, x + 2)
        self.assertEqual(ui["mode"], "help")
        ui = T.new_ui(colony="lead-01")
        r, x, _ = self.btn(ui, "q quit")
        self.assertEqual(self.click(SNAP, ui, r, x + 2), ("quit",))

    def test_seat_view_header_buttons_incl_back(self):
        ui = T.new_ui(colony="lead-01", seat="impl-1")
        r, x, _ = self.btn(ui, "back", "impl-1")
        self.click(SNAP, ui, r, x + 2)
        self.assertIsNone(ui["seat"])
        ui = T.new_ui(colony="lead-01", seat="impl-1")
        r, x, _ = self.btn(ui, "msg", "impl-1")
        self.click(SNAP, ui, r, x + 2)
        self.assertEqual(ui["buf"], "send impl-1 ")

    def test_keyboard_equivalents(self):
        ui = T.new_ui(colony="lead-01", focus="pane")
        T.handle_key(SNAP, ui, "m")
        self.assertEqual((ui["mode"], ui["buf"]), ("cmd", "send ex-1 "))
        ui = T.new_ui(colony="lead-01", focus="pane", row=2)
        T.handle_key(SNAP, ui, "x")
        self.assertIn("not stoppable", ui["status"])
        ui = T.new_ui(colony="lead-01", focus="pane")
        T.handle_key(SNAP, ui, "v")
        self.assertEqual(ui["seat"], "ex-1")
        ui = T.new_ui(colony="lead-01", seat="impl-1")
        self.assertIsNone(T.handle_key(SNAP, ui, "x"))
        self.assertEqual(ui["mode"], "confirm")
        self.assertEqual(T.handle_key(SNAP, ui, "y"), ("stop", "impl-1"))

    def test_transcript_view_uses_model_tail(self):
        snap = dict(
            SNAP,
            seats=[
                dict(
                    SNAP["seats"][2],
                    runtime="omp",
                    target="",
                    log_path="",
                    transcript="/t.jsonl",
                )
            ],
        )
        m = mock.Mock(transcript_tail=mock.Mock(return_value=["▸ user task", "→ ctx_search", "  ← hits"]))
        with mock.patch.object(T, "_model", return_value=m):
            f = "\n".join(T.render(snap, T.new_ui(colony="lead-01", seat="impl-2"), self.W, self.H))
        m.transcript_tail.assert_called_once_with("/t.jsonl", 200)
        self.assertIn("▸ user task", f)
        self.assertNotIn("no tmux pane", f)


class Bridge(unittest.TestCase):
    def emit(self, ui, env):
        import io

        out = io.StringIO()
        T.emit_bridge(ui, out, env)
        return out.getvalue()

    def test_osc_only_with_env(self):
        ui = T.new_ui()
        T.run_command(SNAP, ui, "colony lead-01")
        self.assertEqual(self.emit(dict(ui), {"ATLAS_TUI_BRIDGE": "1"}), "\x1b]7717;open;lead-01\x07")
        self.assertEqual(self.emit(ui, {}), "")
        T.run_command(SNAP, ui, "seat impl-1")
        self.assertEqual(self.emit(ui, {"ATLAS_TUI_BRIDGE": "1"}), "\x1b]7717;open;lead-01;impl-1\x07")
        self.assertEqual(self.emit(ui, {"ATLAS_TUI_BRIDGE": "1"}), "")

    def test_autofocus_does_not_emit(self):
        ui = T.new_ui()
        T.focus_first_live(SNAP, ui)
        self.assertEqual(self.emit(ui, {"ATLAS_TUI_BRIDGE": "1"}), "")


class Names(unittest.TestCase):
    def test_falls_back_to_ids(self):
        ui = T.new_ui()
        T.run_command(SNAP, ui, "colony lead-01")
        f = "\n".join(T.render(SNAP, ui, 140, 40))
        self.assertIn("▦ lead-01", f)
        self.assertIn("colony lead-01", f)

    def test_human_names(self):
        import copy

        s = copy.deepcopy(SNAP)
        s["colonies"][0].update(name="read-atlas-tui", source={"project": "tt", "lead": "lead-01", "harness": "omp", "session": "S1"})
        s["seats"][0].update(address="explorer-1@read-atlas-tui", role_title="Maps code")
        ui = T.new_ui()
        T.run_command(s, ui, "colony read-atlas-tui")
        self.assertEqual(ui["colony"], "lead-01")
        f = "\n".join(T.render(s, ui, 140, 40))
        self.assertIn("▦ read-atlas-tui", f)
        self.assertIn("colony read-atlas-tui", f)
        self.assertIn("→ read-atlas-tui", f)
        self.assertIn("explorer-1", f)
        ui["tab"] = "overview"
        self.assertIn("from omp session S1 · lead lead-01 · project tt", "\n".join(T.render(s, ui, 140, 40)))
        T.run_command(s, ui, "seat ex-1")
        self.assertIn("Maps code", "\n".join(T.render(s, ui, 140, 40)))


if __name__ == "__main__":
    unittest.main()
