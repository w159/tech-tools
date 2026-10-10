import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import atlas_status  # noqa: E402


class VersionTagTest(unittest.TestCase):
    def test_version_tag_picked_over_ref_orca(self):
        tags = ["ref-orca", "v10.4.2", "experimental"]
        self.assertEqual(atlas_status._version_tag(tags), "v10.4.2")

    def test_no_version_tag_returns_none(self):
        self.assertIsNone(atlas_status._version_tag(["ref-orca", "main"]))
        self.assertIsNone(atlas_status._version_tag([]))

    def test_release_tag_uses_merged_git_tags(self):
        with tempfile.TemporaryDirectory() as tmp:

            def git(*args):
                subprocess.run(
                    ("git", "-C", tmp) + args, check=True, capture_output=True
                )

            git("init", "-q")
            git("config", "user.email", "t@t")
            git("config", "user.name", "t")
            git("commit", "--allow-empty", "-qm", "c1")
            git("tag", "ref-orca")
            git("commit", "--allow-empty", "-qm", "c2")
            git("tag", "v1.2.3")
            self.assertEqual(atlas_status._release_tag(tmp), "v1.2.3")
            # only non-release tags -> no anchor
            git("tag", "-d", "v1.2.3")
            self.assertIsNone(atlas_status._release_tag(tmp))


if __name__ == "__main__":
    unittest.main()
