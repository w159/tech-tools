import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_faults  # noqa: E402


class TruncateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "f.jsonl")

    def test_keeps_newest_half_from_a_line_boundary(self):
        data = b"aaaa\nbbbb\ncccc\ndddd\n"  # 20 bytes; the kept half starts at offset 10
        open(self.path, "wb").write(data)
        atlas_faults._truncate(self.path)
        # data[10:] = "cccc\ndddd\n"; leading partial line (here "cccc") is dropped
        self.assertEqual(open(self.path, "rb").read(), b"dddd\n")

    def test_half_without_newline_leaves_empty_file(self):
        open(self.path, "wb").write(b"aaaaaaaaaa\nbbbbbbbbbbbb")  # half has no \n
        atlas_faults._truncate(self.path)
        self.assertEqual(open(self.path, "rb").read(), b"")

    def test_boundary_aligned_half_drops_whole_first_kept_line(self):
        open(self.path, "wb").write(b"aaaa\nbbbbb\ncc\nd\n")
        atlas_faults._truncate(self.path)
        out = open(self.path, "rb").read()
        self.assertTrue(out.endswith(b"d\n"))
        self.assertNotIn(b"aaaa", out)


class PluginVersionTest(unittest.TestCase):
    def _version(self, payload):
        with mock.patch("json.load", return_value=payload):
            return atlas_faults._plugin_version()

    def test_string_version_returned(self):
        self.assertEqual(self._version({"version": "1.2.3"}), "1.2.3")

    def test_non_string_or_empty_version_is_none(self):
        for bad in (5, ["1"], "", None):
            self.assertIsNone(self._version({"version": bad}), bad)


class LiveFaultsTest(unittest.TestCase):
    def f(self, error="boom", **kw):
        return {"error": error, **kw}

    def test_other_tagged_rows_dropped_same_tag_untagged_and_no_version_kept(self):
        same = self.f(plugin_version="2.0.0")
        other = self.f(plugin_version="1.0.0")
        untagged = self.f()
        self.assertEqual(atlas_faults.live_faults([same, other, untagged], "2.0.0"), [same, untagged])
        self.assertEqual(atlas_faults.live_faults([same, other, untagged], None), [same, other, untagged])

    def test_install_path_in_error_acts_as_tag(self):
        keep = self.f("crash in /x/atlas/2.0.0/hooks/a.py")
        drop = self.f("crash in /x/atlas___1.0.0/hooks/a.py")
        self.assertEqual(atlas_faults.live_faults([keep, drop], "2.0.0"), [keep])

    def test_explicit_tag_beats_path_tag(self):
        r = self.f("in atlas/1.0.0/x", plugin_version="2.0.0")
        self.assertEqual(atlas_faults.live_faults([r], "2.0.0"), [r])

    def test_quiet_formatter_skips_dropped(self):
        skips = [self.f("formatter skipped: missing for a.py"), self.f("formatter skipped: parse for b")]
        crash = self.f("formatter skipped: crash for c")
        self.assertEqual(atlas_faults.live_faults(skips + [crash], None), [crash])

    def test_breaker_bypass_rows_are_not_live_faults(self):
        bypass = {"hook": "completion_gate", "type": "BreakerBypass", "error": "breaker open"}
        crash = {"hook": "nudge", "type": "ValueError", "error": "boom"}
        self.assertEqual(atlas_faults.live_faults([bypass] * 9 + [crash], None), [crash])


if __name__ == "__main__":
    unittest.main()
