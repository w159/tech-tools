"""Dashboard battery cost: no autostart by default, no background work while the tab is hidden."""

import _test_isolation  # noqa: F401  (must be first)

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "hooks"))

import atlas_control  # noqa: E402
import session_boot  # noqa: E402

JS = HERE / "dashboard_ui" / "js"


def _knob_default():
    return next(
        k for k in atlas_control.BEHAVIOR_KNOBS if k["key"] == "ATLAS_DASHBOARD"
    )["default"]


class AutostartDefault(unittest.TestCase):
    def test_knob_default_is_off(self):
        self.assertEqual(_knob_default(), "off")

    def test_hook_does_not_spawn_with_no_env(self):
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_DASHBOARD"}
        env["ATLAS_DASHBOARD_PORT"] = (
            "7495"  # non-shared: the temp-root guard must not mask the knob
        )
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch("subprocess.run") as run,
        ):
            self.assertIsNone(session_boot.ensure_dashboard())
        run.assert_not_called()

    def test_hook_default_matches_knob_default(self):
        # Both sites resolve the default independently; they must agree.
        src = (HERE.parent / "hooks" / "session_boot_core.py").read_text()
        self.assertIn('os.environ.get("ATLAS_DASHBOARD", "%s")' % _knob_default(), src)


class HiddenTabGuards(unittest.TestCase):
    """Source contract: each loop checks document.hidden and resumes on visibilitychange."""

    def src(self, rel):
        return (JS / rel).read_text()

    def test_terminal_snapshot(self):
        s = self.src("pages/terminal.js")
        self.assertIn("document.hidden", s)
        self.assertIn("visibilitychange", s)

    def test_activity_live_tail(self):
        s = self.src("pages/activity.js")
        self.assertIn("document.hidden", s)
        self.assertIn("visibilitychange", s)

    def test_api_polling_and_stream(self):
        s = self.src("api.js")
        self.assertIn("document.hidden", s)
        self.assertIn("visibilitychange", s)

    def test_projects_timer(self):
        s = self.src("agents-store.js")
        self.assertIn(
            "projectsTimer = setInterval(() => { if (document.hidden) return;", s
        )


if __name__ == "__main__":
    unittest.main()
