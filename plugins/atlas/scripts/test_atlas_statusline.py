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

    def project(self, wanted, shown, age_ms=1000, raw=None, starved=None):
        proj = os.path.join(self.tmp, "proj")
        run = os.path.join(proj, ".atlas", ".run")
        os.makedirs(run, exist_ok=True)
        with open(os.path.join(run, "hud-state.json"), "w") as f:
            if raw is not None:
                f.write(raw)
            else:
                json.dump(
                    {
                        "ts": time.time() * 1000 - age_ms,
                        "maxRows": 2,
                        "wanted": wanted,
                        "shown": shown,
                        "fullscreen": True,
                        **({} if starved is None else {"starved": starved}),
                    },
                    f,
                )
        d = full_fixture()
        d["workspace"] = {"current_dir": proj}
        return d

    def test_starved_and_fresh_prints_one_row_with_ctx(self):
        rows = self.rows(self.project(8, 2))
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("proj", rows[0])
        self.assertIn("Claude Opus 5.5", rows[0])
        self.assertRegex(rows[0], r"\u00b7 ctx 51%")

    def test_published_starved_flag_wins_over_shown_vs_wanted(self):
        # the loop: line compact -> HUD fits (shown == wanted) but the mod says starved at full height
        self.assertEqual(len(self.rows(self.project(8, 8, starved=True))), 1)
        self.assertGreater(len(self.rows(self.project(8, 0, starved=False))), 3)

    def test_render_writes_statusline_rows_file(self):
        data = self.project(8, 8, starved=False)
        self.rows(data)
        path = os.path.join(self.tmp, "proj", ".atlas", ".run", "statusline-rows.json")
        doc = jload(path)
        full = doc["fullRows"]
        self.assertGreater(full, 3)
        self.assertEqual(doc["rows"], full)
        self.assertLess(abs(time.time() * 1000 - doc["ts"]), 5000)
        self.assertFalse(os.path.exists(path + ".tmp"))
        self.project(8, 8, starved=True)
        self.assertEqual(len(self.rows(data)), 1)
        doc = jload(path)
        self.assertEqual((doc["rows"], doc["fullRows"]), (1, full))

    def test_git_repo_binds_before_ancestor_stray_atlas(self):
        # repo with .git and (once the hooks create it) its own .atlas/.run, under a parent with a stray .atlas
        stray = os.path.join(self.tmp, "stray")
        repo = os.path.join(stray, "repo")
        os.makedirs(os.path.join(stray, ".atlas", ".run"))
        os.makedirs(os.path.join(repo, ".git"))
        stray_rows = os.path.join(stray, ".atlas", ".run", "statusline-rows.json")
        sl.write_rows(repo, 3, 9)  # repo has no .atlas yet: must not leak into the ancestor's
        self.assertFalse(os.path.exists(stray_rows))
        os.makedirs(os.path.join(repo, ".atlas", ".run"))
        with open(os.path.join(repo, ".atlas", ".run", "hud-state.json"), "w") as f:
            json.dump({"ts": int(time.time() * 1000), "wanted": 8, "shown": 0, "starved": True}, f)
        self.assertTrue(sl.hud_starved(repo))
        sl.write_rows(repo, 3, 9)
        self.assertTrue(os.path.exists(os.path.join(repo, ".atlas", ".run", "statusline-rows.json")))
        self.assertFalse(os.path.exists(stray_rows))

    def test_no_atlas_dir_writes_nothing(self):
        self.rows(full_fixture())
        self.assertFalse(os.path.exists(os.path.join(self.tmp, ".atlas")))

    def test_compact_row_clipped_to_width(self):
        for width in (40, 60, 120):
            rows = self.rows(self.project(8, 0), width=width)
            self.assertEqual(len(rows), 1, (width, rows))
            self.assertLess(sl.vw(rows[0]), width)

    def test_not_starved_prints_full_grid(self):
        rows = self.rows(self.project(8, 8))
        self.assertGreater(len(rows), 3, rows)
        self.assertFalse(any("\u00b7 ctx" in r for r in rows), rows)

    def test_stale_state_prints_full_grid(self):
        self.assertGreater(len(self.rows(self.project(8, 0, age_ms=16000))), 3)

    def test_malformed_or_missing_state_prints_full_grid(self):
        self.assertGreater(len(self.rows(self.project(8, 0, raw="{not json"))), 3)
        self.assertGreater(len(self.rows(self.project(8, 0, raw='{"ts": 1}'))), 3)
        self.assertGreater(len(self.rows(full_fixture())), 3)

    def test_install_writes_refresh_interval_and_keeps_user_keys(self):
        settings = os.path.join(self.tmp, "settings.json")
        with open(settings, "w") as f:
            json.dump({"statusLine": {"type": "command", "command": "x", "padding": 3}}, f)
        self.run_main(["install", "--settings", settings, "--home", self.tmp])
        sl_cfg = jload(settings)["statusLine"]
        self.assertEqual(sl_cfg["refreshInterval"], 5)
        self.assertEqual(sl_cfg["padding"], 3)
        self.assertIn("atlas_statusline.py", sl_cfg["command"])


if __name__ == "__main__":
    unittest.main()
