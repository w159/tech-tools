"""session_boot.update_notice: the boot path never touches the network and never runs a subprocess itself.
It reads two small JSON files and, at most once per 24 h, starts the detached `atlas_doctor.py --update-check`
(Popen is faked here, so nothing is spawned)."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import session_boot  # noqa: E402

DAY = 24 * 3600


def own_version():
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(session_boot.__file__))),
        ".claude-plugin",
        "plugin.json",
    )
    with open(path) as f:
        return json.load(f)["version"]


class UpdateNoticeTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        env = mock.patch.dict(
            os.environ, {"ATLAS_HOME": self.home, "ATLAS_UPDATE_CHECK": "on"}
        )
        env.start()
        self.addCleanup(env.stop)
        self.popen = mock.Mock()

    def write(self, name, data):
        with open(os.path.join(self.home, name), "w") as f:
            json.dump(data, f)

    def notice(self, now=1_000_000.0):
        return session_boot.update_notice(now=now, popen=self.popen)

    def test_first_boot_starts_one_detached_check_and_shows_nothing(self):
        self.assertIsNone(self.notice())
        self.assertEqual(self.popen.call_count, 1)
        argv = self.popen.call_args.args[0]
        self.assertTrue(argv[1].endswith("atlas_doctor.py"))
        self.assertEqual(argv[2], "--update-check")
        self.assertTrue(self.popen.call_args.kwargs["start_new_session"])
        with open(os.path.join(self.home, "update-check-state.json")) as f:
            self.assertEqual(json.load(f), {"last_start": 1_000_000.0})

    def test_second_boot_inside_24h_does_not_spawn(self):
        self.notice(now=1_000_000.0)
        self.popen.reset_mock()
        self.notice(now=1_000_000.0 + DAY - 1)
        self.popen.assert_not_called()

    def test_boot_after_24h_spawns_again(self):
        self.notice(now=1_000_000.0)
        self.popen.reset_mock()
        self.notice(now=1_000_000.0 + DAY + 1)
        self.assertEqual(self.popen.call_count, 1)

    def test_no_network_and_no_subprocess_on_the_boot_path(self):
        with (
            mock.patch.object(subprocess, "run") as run,
            mock.patch.object(subprocess, "check_output") as co,
            mock.patch.object(urllib.request, "urlopen") as net,
            mock.patch("socket.socket") as sock,
        ):
            session_boot.update_notice(now=1_000_000.0, popen=self.popen)
        for m in (run, co, net, sock):
            m.assert_not_called()

    def test_notice_shown_when_published_is_newer(self):
        self.write("update-check-state.json", {"last_start": 1_000_000.0})
        self.write("update-check.json", {"published": "999.0.0", "marketplace": "tech-tools"})
        line = self.notice()
        self.assertEqual(
            line,
            f"atlas 999.0.0 is published (installed {own_version()}): "
            "claude plugin marketplace update tech-tools && claude plugin update atlas@tech-tools",
        )

    def test_notice_not_shown_when_installed_is_current(self):
        self.write("update-check-state.json", {"last_start": 1_000_000.0})
        self.write("update-check.json", {"published": own_version(), "marketplace": "tech-tools"})
        self.assertIsNone(self.notice())

    def test_notice_not_shown_without_result_or_with_junk(self):
        self.write("update-check-state.json", {"last_start": 1_000_000.0})
        self.assertIsNone(self.notice())
        self.write("update-check.json", {"published": "1.0; rm -rf /", "marketplace": "x y"})
        self.assertIsNone(self.notice())

    def test_hostile_marketplace_name_falls_back_to_default(self):
        self.write("update-check-state.json", {"last_start": 1_000_000.0})
        self.write("update-check.json", {"published": "999.0.0", "marketplace": "a; curl evil"})
        self.assertIn("marketplace update tech-tools &&", self.notice())

    def test_huge_unicode_marketplace_name_gives_short_default_line(self):
        self.write("update-check-state.json", {"last_start": 1_000_000.0})
        self.write("update-check.json", {"published": "999.0.0", "marketplace": "a" * 100000 + "\u00e9"})
        line = self.notice()
        self.assertLess(len(line), 200)
        self.assertIn("marketplace update tech-tools &&", line)

    def test_overlong_ascii_marketplace_name_falls_back(self):
        self.write("update-check-state.json", {"last_start": 1_000_000.0})
        self.write("update-check.json", {"published": "999.0.0", "marketplace": "a" * 33})
        self.assertIn("marketplace update tech-tools &&", self.notice())

    def test_non_ascii_digit_versions_print_nothing(self):
        self.write("update-check-state.json", {"last_start": 1_000_000.0})
        for v in ("\u0669\u0669.0.0", "9" * 7 + ".0.0"):
            self.write("update-check.json", {"published": v, "marketplace": "tech-tools"})
            self.assertIsNone(self.notice())

    def test_printed_notice_is_short(self):
        self.write("update-check-state.json", {"last_start": 1_000_000.0})
        self.write("update-check.json", {"published": "999999.999999.999999", "marketplace": "m" * 32})
        self.assertLess(len(self.notice()), 200)

    def test_off_switch_disables_spawn_and_notice(self):
        self.write("update-check.json", {"published": "999.0.0", "marketplace": "tech-tools"})
        with mock.patch.dict(os.environ, {"ATLAS_UPDATE_CHECK": "off"}):
            self.assertIsNone(self.notice())
        self.popen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
