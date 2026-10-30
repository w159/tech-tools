import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_statusline as sl  # noqa: E402

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def jload(path):
    with open(path) as f:
        return json.load(f)


def full_fixture(rate_limits=True):
    d = {
        "model": {"display_name": "Claude Opus 5.5", "id": "claude-opus-5-5-20260101"},
        "workspace": {"current_dir": "/work/proj"},
        "effort": {"level": "high"},
        "cost": {
            "total_cost_usd": 10.26,
            "total_duration_ms": 134000,
            "total_lines_added": 12,
            "total_lines_removed": 3,
        },
        "context_window": {
            "context_window_size": 1_000_000,
            "total_input_tokens": 300000,
            "total_output_tokens": 91700,
            "current_usage": {
                "input_tokens": 3,
                "output_tokens": 10,
                "cache_creation_input_tokens": 10000,
                "cache_read_input_tokens": 500000,
            },
        },
    }
    if rate_limits:
        now = time.time()
        d["rate_limits"] = {
            "five_hour": {"used_percentage": 62, "resets_at": now + 4 * 3600 + 40 * 60},
            "seven_day": {
                "used_percentage": 30,
                "resets_at": now + 6 * 86400 + 15 * 3600,
            },
        }
    return d


class StatuslineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        env = mock.patch.dict(
            os.environ, {"ATLAS_STATUSLINE_CONFIG": os.path.join(self.tmp, "none.json")}
        )
        env.start()
        self.addCleanup(env.stop)
        w = mock.patch("shutil.which", return_value=None)
        w.start()
        self.addCleanup(w.stop)

    def run_main(self, argv, stdin=""):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(sl.main(argv, io.StringIO(stdin)), 0)
        return out.getvalue()

    def rows(self, data, width=120):
        raw = self.run_main(
            ["--width", str(width), "--home", self.tmp],
            json.dumps(data) if data is not None else "",
        )
        return [ANSI.sub("", r) for r in raw.split("\n") if r != ""]

    def test_full_fixture(self):
        text = "\n".join(self.rows(full_fixture()))
        for want in (
            "proj",
            "Claude Opus 5.5",
            "high",
            "ctx",
            "51%",
            "5h",
            "7d",
            "session",
            "plan",
            "anthropic",
            "cache",
            "2m14s",
            "+12/-3 lines",
        ):
            self.assertIn(want, text)

    def test_rule_column_aligned(self):
        cols = {sl.vw(r.split("│")[0]) for r in self.rows(full_fixture()) if "│" in r}
        self.assertEqual(len(cols), 1)
        self.assertEqual(sum("│" in r for r in self.rows(full_fixture())), 3)

    def test_api_key_user(self):
        rows = self.rows(full_fixture(rate_limits=False))
        text = "\n".join(rows)
        self.assertIn("$10.26", text)
        self.assertNotIn("plan", text)
        for label in ("5h", "7d"):
            self.assertTrue(any(label in r and "--%" in r for r in rows), label)

    def test_empty_and_invalid_stdin(self):
        for stdin in ("", "not json", "[1]"):
            raw = self.run_main(["--width", "120", "--home", self.tmp], stdin)
            text = ANSI.sub("", raw)
            self.assertIn("ready", text)
            self.assertIn("--%", text)

    def test_narrow_drops_right_column(self):
        rows = self.rows(full_fixture(), width=70)
        self.assertFalse(any("│" in r for r in rows))
        self.assertTrue(any("ctx" in r for r in rows))

    def test_install_uninstall_round_trip(self):
        settings = os.path.join(self.tmp, "sub", "settings.json")
        os.makedirs(os.path.dirname(settings))
        old = {"type": "command", "command": "echo old"}
        with open(settings, "w") as f:
            json.dump({"statusLine": old, "theme": "dark"}, f)
        args = ["--settings", settings, "--home", self.tmp]
        self.assertIn("installed", self.run_main(["install"] + args))
        cfg = jload(settings)
        self.assertIn("atlas_statusline.py", cfg["statusLine"]["command"])
        self.assertEqual(cfg["theme"], "dark")
        # second install must keep the first saved value
        self.run_main(["install"] + args)
        prev = os.path.join(self.tmp, ".atlas", "statusline.previous.json")
        self.assertEqual(jload(prev)["statusLine"], old)
        self.assertIn("uninstalled", self.run_main(["uninstall"] + args))
        self.assertEqual(
            jload(settings), {"statusLine": old, "theme": "dark"}
        )
        self.assertFalse(os.path.exists(prev))

    def test_uninstall_without_previous_removes_key(self):
        settings = os.path.join(self.tmp, "settings.json")
        args = ["--settings", settings, "--home", self.tmp]
        self.run_main(["install"] + args)
        self.run_main(["uninstall"] + args)
        self.assertNotIn("statusLine", jload(settings))

    def project(self, running, shown, age_ms=1000, raw=None):
        proj = os.path.join(self.tmp, "proj")
        run = os.path.join(proj, ".atlas", ".run")
        os.makedirs(run, exist_ok=True)
        with open(os.path.join(run, "agents-running.json"), "w") as f:
            if raw is not None:
                f.write(raw)
            else:
                json.dump(
                    {
                        "ts": time.time() * 1000 - age_ms,
                        "running": [
                            {"name": n, "role": "explorer", "model": ""} for n in running
                        ],
                        "hudRowsShown": shown,
                    },
                    f,
                )
        d = full_fixture()
        d["workspace"] = {"current_dir": proj}
        return d

    def test_fresh_uncovered_shows_segment(self):
        rows = self.rows(self.project(["explorer-a", "explorer-b"], 0))
        self.assertTrue(
            any("agents 2 running: explorer-a, explorer-b" in r for r in rows), rows
        )

    def test_hud_covers_all_shows_nothing(self):
        rows = self.rows(self.project(["explorer-a", "explorer-b"], 2))
        self.assertFalse(any("agents " in r and "running" in r for r in rows), rows)

    def test_stale_shows_nothing(self):
        rows = self.rows(self.project(["explorer-a"], 0, age_ms=16000))
        self.assertFalse(any("running:" in r for r in rows), rows)

    def test_malformed_shows_nothing(self):
        rows = self.rows(self.project([], 0, raw="{not json"))
        self.assertFalse(any("running:" in r for r in rows), rows)
        self.assertTrue(any("proj" in r for r in rows))

    def test_empty_running_shows_nothing(self):
        rows = self.rows(self.project([], 0))
        self.assertFalse(any("running:" in r for r in rows), rows)

    def test_narrow_width_clipped(self):
        names = ["explorer-%02d" % i for i in range(12)]
        for width in (60, 70, 120):
            rows = self.rows(self.project(names, 0), width=width)
            seg = [r for r in rows if "running:" in r]
            self.assertEqual(len(seg), 1, (width, rows))
            self.assertLess(sl.vw(seg[0]), width)


if __name__ == "__main__":
    unittest.main()
