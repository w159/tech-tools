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
            "[ TABLE ]  WALL    RECENT    OVERVIEW    GRAPH    HEALTH     colony lead-01",
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
            "tab <table|wall|recent|overview|graph|health>",
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

    def _launch(self, env, opener_rc=0, has_session=1, wins=""):
        a = mock.Mock(project="/p", all=False, fixture=None)
        calls, out = [], io.StringIO()

        def fake(cmd, **kw):
            calls.append(list(cmd))
            r = mock.Mock()
            r.returncode = has_session if cmd[:2] == ["tmux", "has-session"] else opener_rc
            r.stdout = (wins + "\n") if cmd[:2] == ["tmux", "list-windows"] else ""
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

    def test_launch_respawns_existing_detached_session(self):
        calls, out = self._launch({"TERM_PROGRAM": "vscode"}, has_session=0, wins="atlas-tui")
        self.assertTrue(any("has-session" in " ".join(c) for c in calls))
        self.assertTrue(
            any(
                c[:2] == ["tmux", "respawn-window"]
                and "-k" in c
                and "-t" in c
                and "atlas-tui:atlas-tui" in c
                and "atlas_tui.py" in c[-1]
                for c in calls
            )
        )
        self.assertFalse(any("new-session" in " ".join(c) for c in calls))
        self.assertTrue(
            any(c[:4] == ["tmux", "set-option", "-t", "atlas-tui"] and c[-2:] == ["mouse", "on"] for c in calls)
        )
        self.assertIn("restarted the atlas-tui session with", out)
        self.assertNotIn("reusing", out)

    def test_launch_creates_window_when_missing(self):
        calls, out = self._launch({"TERM_PROGRAM": "vscode"}, has_session=0, wins="zsh")
        self.assertTrue(
            any(
                c[:2] == ["tmux", "new-window"]
                and "-d" in c
                and "-t" in c
                and "atlas-tui" in c
                for c in calls
            )
        )
        self.assertFalse(any("new-session" in " ".join(c) for c in calls))
        self.assertIn("restarted the atlas-tui session with", out)

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


EMPTY = {
    "ok": True,
    "host": "h",
    "clock": "c",
    "project": "/w/proj",
    "colonies": [],
    "seats": [],
    "feed": [],
    "needs": [],
    "projects": [
        {"root": "/w/proj", "name": "proj", "channels": 1},
        {"root": "/w/other", "name": "other", "channels": 0},
    ],
}


class EmptyStates(unittest.TestCase):
    W, H = 160, 48

    def test_topology_zero_colonies_guides(self):
        ui = T.new_ui(section="topology")
        f = "\n".join(T.render(EMPTY, ui, self.W, self.H))
        self.assertIn("no colonies · watching /w/proj", f)
        self.assertIn("dispatches subagents (omp `task`, Claude `Agent`) or `atlas_mux spawn-team`", f)
        self.assertIn("`a` toggles all projects", f)
        self.assertIn("Enter/click a PROJECTS row to switch the watched project", f)

    def test_topology_nonempty_keeps_colony_line(self):
        ui = T.new_ui(section="topology")
        f = "\n".join(T.render(SNAP, ui, self.W, self.H))
        self.assertIn("2 colonies · select one in Explorer", f)

    def test_specs_empty_removed_install_message(self):
        ui = T.new_ui(section="specs")
        f = "\n".join(T.render(EMPTY, ui, self.W, self.H))
        self.assertIn("no agent specs found under", f)
        self.assertIn(f"{T._model().PLUGIN_DIR / 'agents'}", f)
        self.assertIn("this TUI process may be from a removed install; relaunch it", f)

    def test_specs_empty_respects_filter(self):
        ui = T.new_ui(section="specs")
        ui["filter"] = "zzz"
        f = "\n".join(T.render(EMPTY, ui, self.W, self.H))
        self.assertNotIn("removed install", f)


class WatchControls(unittest.TestCase):
    W, H = 160, 48

    def test_a_key_toggles_all_projects(self):
        ui = T.new_ui(section="topology")
        self.assertEqual(T.handle_key(EMPTY, ui, "a"), ("all",))
        self.assertEqual(T.handle_key(SNAP, ui, "a"), ("all",))

    def test_projects_enter_switches_root(self):
        ui = T.new_ui(section="projects", focus="pane")
        self.assertEqual(T.handle_key(EMPTY, ui, "enter"), ("project", "/w/proj"))
        T.handle_key(EMPTY, ui, "down")
        self.assertEqual(T.handle_key(EMPTY, ui, "enter"), ("project", "/w/other"))
        T.handle_key(EMPTY, ui, "up")
        T.handle_key(EMPTY, ui, "up")  # clamp at 0
        self.assertEqual(T.handle_key(EMPTY, ui, "enter"), ("project", "/w/proj"))

    def test_projects_click_switches_root(self):
        ui = T.new_ui(section="projects")
        hits = T.hitmap(EMPTY, ui, self.W, self.H)
        row_hits = [a for *_, a in hits if a[0] == "project"]
        self.assertIn(("project", "/w/proj"), row_hits)
        self.assertIn(("project", "/w/other"), row_hits)
        j = hits.index(next(h for h in hits if h[3][0] == "project" and h[3][1] == "/w/other"))
        self.assertEqual(T.handle_click(EMPTY, ui, hits, T.LEFT + 10, hits[j][0]), ("project", "/w/other"))

    def test_projects_rows_filterable_and_not_clickable_when_filtered(self):
        ui = T.new_ui(section="projects")
        ui["filter"] = "other"
        hits = T.hitmap(EMPTY, ui, self.W, self.H)
        self.assertFalse([a for *_, a in hits if a[0] == "project"])


class LeadSeatUi(unittest.TestCase):
    """A lead seat is never stoppable and has no msg button: worker_inbox never drains tui->lead notes."""

    W, H = 160, 48

    def lead(self, **kw):
        return seat("lead-abc123", "lead", "omp", "working", target="", lead=True, **kw)

    def snap_with_lead(self, s):
        snap = {**SNAP, "seats": SNAP["seats"] + [s]}
        snap["colonies"][0]["pods"] = snap["colonies"][0]["pods"] + [{"id": "lead", "seats": ["lead-abc123"]}]
        return snap

    def test_no_msg_or_stop_buttons_for_lead(self):
        s = self.lead()
        snap = self.snap_with_lead(s)
        f = "\n".join(T.render(snap, T.new_ui(colony="lead-01", seat="lead-abc123"), self.W, self.H))
        self.assertIn("[ view ]", f)
        self.assertNotIn("[ msg ]", f)
        self.assertNotIn("[ stop ]", f)

    def test_msg_guard_reports_lead(self):
        ui = T.new_ui(colony="lead-01", row=3)
        snap = self.snap_with_lead(self.lead())
        self.assertIsNone(T._button_effect(snap, ui, "msg", "lead-abc123"))
        self.assertIn("is the lead", ui["status"])
        ui = T.new_ui(colony="lead-01", seat="lead-abc123")
        self.assertIsNone(T.run_command(snap, ui, "send lead-abc123 hi"))
        self.assertIn("is the lead", ui["status"])

    def test_stops_still_work_for_workers(self):
        ui = T.new_ui(colony="lead-01")
        f = "\n".join(T.render(SNAP, ui, self.W, self.H))
        self.assertIn("[ msg ] [ view ]", f)


class TreeSeats(unittest.TestCase):
    """Pods list their seats in the tree; a seat row opens the seat."""

    W, H = 140, 40

    def test_tree_lists_seats_under_pods(self):
        ui = T.new_ui()
        f = "\n".join(T.render(SNAP, ui, self.W, self.H))
        for s in ("┣━ › explorer", "● ex-1 ·1", "! impl-1 ·1", "· impl-2"):
            self.assertIn(s, f)
        kinds = [r[1] for r in T.explorer_rows(SNAP, ui)]
        self.assertIn("seat", kinds)

    def test_click_and_enter_on_seat_row_opens_seat(self):
        ui = T.new_ui()
        hits = T.hitmap(SNAP, ui, self.W, self.H)
        rows = T.explorer_rows(SNAP, ui)
        i = next(k for k, r in enumerate(rows) if r[1] == "seat" and r[2] == "impl-1")
        r, x0, _x1, a = next(h for h in hits if h[3][0] == "explorer" and h[3][1] == i)
        T.handle_click(SNAP, ui, hits, x0 + 5, r)
        self.assertEqual(ui["seat"], "impl-1")
        ui = T.new_ui()
        ui["cursor"] = i
        ui["focus"] = "explorer"
        T.handle_key(SNAP, ui, "enter")
        self.assertEqual(ui["seat"], "impl-1")


class SeatDetail(unittest.TestCase):
    """AGENT DETAIL sections from data we have, for pane and in-process seats."""

    W, H = 140, 48

    def test_pane_seat_sections(self):
        ui = T.new_ui(colony="lead-01", seat="impl-1", seat_text="pane-line-1\npane-line-2")
        snap = dict(SNAP, seats=[dict(SNAP["seats"][1], open_items=[{"id": "t9", "title": "Build the panel", "status": "in_progress"}])]
        )
        f = "\n".join(T.render(snap, ui, self.W, self.H))
        for s in (
            "SEAT impl-1 · omp",
            "CONTEXT",
            "runtime omp · model m-omp",
            "terminal term ▸ implementer (%2 [ term ]) · t = attach",
            "CURRENT ACTIVITY",
            "blocked · doing impl-1 · active 1970-01-01 00:00:01 UTC",
            "CURRENT WORK · 1",
            "#t9 Build the panel · in_progress",
            "QUEUE",
            "pending 0 · in progress 1 · blocked 0 · open 1",
            "NEEDS YOU · 1",
            "SEAT",
            "host macbook-pro · colony lead-01 · pod implementer",
            "COMMUNICATION · 1",
            "OUTPUT",
            "pane-line-1",
        ):
            self.assertIn(s, f)

    def test_in_process_seat_sections(self):
        snap = dict(
            SNAP,
            seats=[
                dict(SNAP["seats"][2], target="", log_path="", transcript="/t.jsonl")
            ],
        )
        m = mock.Mock(transcript_tail=mock.Mock(return_value=["▸ dispatch", "→ done"]))
        ui = T.new_ui(colony="lead-01", seat="impl-2")
        with mock.patch.object(T, "_model", return_value=m):
            f = "\n".join(T.render(snap, ui, self.W, self.H))
        m.transcript_tail.assert_called_with("/t.jsonl", 200)
        for s in (
            "terminal in-process",
            "CURRENT WORK · 0",
            "OUTPUT",
            "▸ dispatch",
        ):
            self.assertIn(s, f)


class Wall(unittest.TestCase):
    """WALL tab: 2-col grid, lead first, tiles open seats, footer counts."""

    W, H = 140, 48

    def ui(self, **kw):
        return T.new_ui(colony="lead-01", tab="wall", wall_text={"ex-1": "wall-out-1\nwall-out-2"}, **kw)

    def snap_with_lead(self):
        lead = seat("lead-abc123", "lead", "omp", "working", target="", lead=True, address="lead-abc123@lead-01")
        snap = {**SNAP, "seats": SNAP["seats"] + [lead]}
        snap["colonies"][0]["pods"] = snap["colonies"][0]["pods"] + [{"id": "lead", "seats": ["lead-abc123"]}]
        return snap

    def test_wall_renders_tiles_and_footer(self):
        f = "\n".join(T.render(SNAP, self.ui(), self.W, self.H))
        for s in (
            "[ WALL ]",
            "Claude Code ex-1@lead-01",
            "omp impl-1@lead-01",
            "Codex CLI impl-2@lead-01",
            "wall-out-1",
            "3 agents in lead-01",
        ):
            self.assertIn(s, f)

    def test_wall_lead_first_and_selection_moves(self):
        snap = self.snap_with_lead()
        ui = self.ui(focus="pane")
        lines, tiles = T._wall_layout(snap, ui, 106)
        self.assertEqual(tiles[0][4]["name"], "lead-abc123")
        self.assertIn("lead-abc123", lines[0])
        T.handle_key(snap, ui, "down")
        self.assertEqual(ui["row"], 2)
        T.handle_key(snap, ui, "right")
        self.assertEqual(ui["row"], 3)

    def test_wall_enter_and_click_open_seat(self):
        ui = self.ui(focus="pane")
        T.handle_key(SNAP, ui, "enter")
        self.assertEqual(ui["seat"], "ex-1")
        ui = self.ui(focus="pane")
        hits = T.hitmap(SNAP, ui, self.W, self.H)
        r, x0, _x1, a = next(h for h in hits if h[3][0] == "walltile" and h[3][2] == "impl-1")
        T.handle_click(SNAP, ui, hits, x0 + 3, r)
        self.assertEqual((ui["row"], ui["seat"]), (a[1], "impl-1"))

    def test_wall_read_cadence_uses_model_once_per_refresh(self):
        m = mock.Mock(capture=mock.Mock(return_value="cap"), transcript_tail=mock.Mock(return_value=["tail"]))
        ui = self.ui(focus="pane")
        snap = self.snap_with_lead()
        snap["seats"] = [
            s if s["name"] != "impl-2" else dict(s, transcript="/t.jsonl") for s in snap["seats"]
        ]
        T.refresh_wall(snap, ui, m)
        self.assertEqual(ui["wall_text"]["ex-1"], "cap")
        self.assertEqual(ui["wall_text"]["impl-2"], "tail")
        self.assertEqual(m.capture.call_count, 2)  # pane seats only


class Terminals(unittest.TestCase):
    """TERMINALS rows attach and kill (guarded) atlas sessions."""

    W, H = 140, 40

    def snap_nonatlas(self):
        return dict(SNAP, terminals=SNAP["terminals"] + [{"session": "work", "windows": 1, "panes": 1, "attached": 0}])

    def test_rows_show_seat_names(self):
        f = "\n".join(T.render(SNAP, T.new_ui(section="terminals"), self.W, self.H))
        self.assertIn("atlas-lead-01", f)
        self.assertIn("ex-1", f)

    def test_click_and_enter_attach(self):
        ui = T.new_ui(section="terminals", focus="pane")
        self.assertEqual(T.handle_key(SNAP, ui, "enter"), ("attach", "atlas-lead-01"))
        hits = T.hitmap(SNAP, ui, self.W, self.H)
        r, x0, _x1, a = next(h for h in hits if h[3][0] == "termsess")
        self.assertEqual(T.handle_click(SNAP, ui, hits, x0 + 2, r), ("attach", "atlas-lead-01"))

    def test_kill_gate_confirms_and_refuses(self):
        ui = T.new_ui(section="terminals", focus="pane")
        self.assertIsNone(T.handle_key(SNAP, ui, "x"))
        self.assertEqual((ui["mode"], ui["confirm_sess"]), ("confirm", "atlas-lead-01"))
        self.assertEqual(T.handle_key(SNAP, ui, "y"), ("kill", "atlas-lead-01"))
        # atlas-tui is refused outright
        snap = dict(SNAP, terminals=[{"session": "atlas-tui", "windows": 1, "panes": 1, "attached": 1}])
        ui = T.new_ui(section="terminals", focus="pane")
        self.assertIsNone(T.handle_key(snap, ui, "x"))
        self.assertIn("refusing to kill atlas-tui", ui["status"])
        # so are non-atlas sessions
        ui = T.new_ui(section="terminals", focus="pane")
        self.assertIsNone(T.handle_key(self.snap_nonatlas(), ui, "down"))
        self.assertIsNone(T.handle_key(self.snap_nonatlas(), ui, "x"))
        self.assertIn("not an atlas-* session", ui["status"])
        self.assertIsNone(ui["confirm_sess"])

    def test_own_session_refused(self):
        with mock.patch.dict(T.os.environ, {"TMUX": "sock,1,0"}), mock.patch.object(
            T, "_run_tmux", return_value=mock.Mock(returncode=0, stdout="atlas-lead-01\n")
        ):
            self.assertEqual(T._kill_refusal("atlas-lead-01", T.os.environ), "refusing to kill atlas-lead-01: this TUI runs there")
            self.assertEqual(T._kill_refusal("atlas-other", T.os.environ), "")
        self.assertEqual(T._kill_refusal("atlas-other", {}), "")

    def test_attach_target_runs_setup_argv_cleanup(self):
        m = mock.Mock()
        m.attach_argv.return_value = ([["tmux", "new-session"]], ["tmux", "attach", "-t", "v"])
        with mock.patch.object(T.subprocess, "run") as run:
            self.assertEqual(T.attach_target("atlas-lead-01", m), "")
        self.assertEqual([c.args[0][:2] for c in run.call_args_list], [["tmux", "new-session"], ["tmux", "attach"]])
        m.cleanup_view.assert_called_once()


if __name__ == "__main__":
    unittest.main()
