"""atlas_packs.py -- the trust boundary between declared pack roots and agent context.

Two failure modes this file pins, both of which would be security or silence
bugs if the resolver only asserted them in prose:

  1. A repo-relative source that resolves outside the repository (or inside
     `.git`) must be rejected. The boundary is what pack content can never leave.
  2. A pack whose tree carries a symlink escaping its source must be rejected as
    a WHOLE pack. Consumers feed pack text into agent context; trimming one
    file at a time would publish the rest of a hostile pack.

Everything else here defends the documented shape: README is description-only,
subdirectories are storage, empty/missing frontmatter skips with a warning,
absent `packs:` is zero side effects, and the git path really clones into
`.atlas/.run/packs-cache/`.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_packs  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "atlas_packs.py"

RULE = """---
title: Pages receive server data as Inertia props, never from a parallel JSON endpoint
applies_when:
  - adding a page that needs server data
  - adding or changing an API endpoint consumed by the app's own pages
tags: [inertia, props]
---
Controllers own routes and props. Never add a JSON endpoint for page-owned data.
"""

NOT_A_RULE = """# Team pack notes

No frontmatter here, so this file is skipped with a warning, never published.
"""


def write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def make_repo(*, with_config=None) -> Path:
    """A throwaway repo root; `.git` is a plain directory, which is all the
    resolver needs (it never shells to git for path sources)."""
    repo = Path(tempfile.mkdtemp(prefix="atlas-packs-test-"))
    (repo / ".git").mkdir()
    if with_config is not None:
        (repo / ".claude").mkdir(exist_ok=True)
        (repo / ".claude" / "atlas.local.md").write_text(with_config, encoding="utf-8")
    return repo


def ids(packs: list) -> list:
    return [p["id"] for p in packs]


class AbsentPacksKey(unittest.TestCase):
    def test_no_config_file_is_empty_and_side_effect_free(self):
        repo = make_repo()
        try:
            self.assertEqual(atlas_packs.resolve_packs(str(repo)), [])
            self.assertFalse((repo / ".atlas").exists(), "no git source, no cache dir")
        finally:
            shutil.rmtree(repo)

    def test_config_without_packs_key_is_empty(self):
        repo = make_repo(with_config="---\nstack: [python]\n---\nNotes.\n")
        try:
            self.assertEqual(atlas_packs.resolve_packs(str(repo)), [])
        finally:
            shutil.rmtree(repo)

    def test_frontmatter_ending_is_respected(self):
        """A `packs:`-looking line in the markdown BODY is not a declaration."""
        repo = make_repo(with_config="---\nstack: [python]\n---\n\npacks:\n  - source: /etc\n")
        try:
            self.assertEqual(atlas_packs.resolve_packs(str(repo)), [])
        finally:
            shutil.rmtree(repo)


class PathContainment(unittest.TestCase):
    """Bug 1. The boundary is the repository; nothing outside it publishes."""

    def test_repo_relative_escape_is_rejected(self):
        outside = Path(tempfile.mkdtemp(prefix="atlas-packs-outside-"))
        outside_pack = outside / "team-rules"
        write(outside_pack / "rule.md", RULE)
        repo = make_repo(with_config="---\npacks:\n  - source: ../team-rules\n---\n")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual(len(packs), 1)
            self.assertIsNone(packs[0]["rootPath"])
            self.assertIn("resolves outside the repository", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)
            shutil.rmtree(outside)

    def test_source_inside_dot_git_is_rejected(self):
        repo = make_repo(with_config="---\npacks:\n  - source: .git/hooks\n---\n")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual([p["rootPath"] for p in packs], [None])
            self.assertIn("outside the repository", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)

    def test_legitimate_repo_relative_source_publishes(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs/team\n---\n")
        write(repo / "packs" / "team" / "rule.md", RULE)
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual(len(packs), 1)
            self.assertEqual(packs[0]["id"], "team")
            self.assertEqual(packs[0]["rootPath"], os.path.realpath(repo / "packs" / "team"))
            self.assertEqual(packs[0]["errors"], [])
        finally:
            shutil.rmtree(repo)

    def test_missing_source_directory_is_a_loud_error(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs/ghost\n---\n")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertIsNone(packs[0]["rootPath"])
            self.assertIn("does not exist", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)


class SymlinkEscape(unittest.TestCase):
    """Bug 2. One escaping link rejects the WHOLE pack -- the prompt-injection /
    data-exfiltration boundary. Never trimmed a file at a time."""

    def test_escaping_symlink_rejects_the_whole_pack(self):
        secret = Path(tempfile.mkdtemp(prefix="atlas-packs-secret-"))
        (secret / "id_rsa").write_text("pretend key material", encoding="utf-8")
        repo = make_repo(with_config="---\npacks:\n  - source: packs/evil\n---\n")
        write(repo / "packs" / "evil" / "legit-rule.md", RULE)
        os.symlink(secret / "id_rsa", repo / "packs" / "evil" / "leak.md")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual(len(packs), 1)
            self.assertIsNone(packs[0]["rootPath"], "a pack with an escaping link must not publish")
            self.assertIn("link(s) outside the source", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)
            shutil.rmtree(secret)

    def test_escaping_symlink_in_a_subdirectory_rejects_the_whole_pack(self):
        outside = Path(tempfile.mkdtemp(prefix="atlas-packs-outside-"))
        repo = make_repo(with_config="---\npacks:\n  - source: packs/evil\n---\n")
        write(repo / "packs" / "evil" / "rule.md", RULE)
        (repo / "packs" / "evil" / "sub").mkdir()
        os.symlink(outside, repo / "packs" / "evil" / "sub" / "escape-dir")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual(len(packs), 1)
            self.assertIsNone(packs[0]["rootPath"])
            self.assertIn("outside the source", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)
            shutil.rmtree(outside)

    def test_escaped_publisher_child_is_skipped_and_others_publish(self):
        """A child directory that links outside the source is skipped at
        enumeration (warning), while its siblings still publish."""
        outside = Path(tempfile.mkdtemp(prefix="atlas-packs-outside-"))
        repo = make_repo(with_config="---\npacks:\n  - source: packs\n---\n")
        write(repo / "packs" / "good" / "rule.md", RULE)
        os.symlink(outside, repo / "packs" / "thief")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual([p["id"] for p in packs], ["good"])
            self.assertTrue(any("links outside the source" in w for w in packs[0]["warnings"]))
        finally:
            shutil.rmtree(repo)
            shutil.rmtree(outside)

    def test_top_level_escaping_link_rejects_the_whole_pack(self):
        """Even a top-level escaped file (already named as skipped during
        enumeration) refuses the whole pack -- never trimmed a file at a time."""
        outside = Path(tempfile.mkdtemp(prefix="atlas-packs-outside-"))
        repo = make_repo(with_config="---\npacks:\n  - source: packs/mixed\n---\n")
        write(repo / "packs" / "mixed" / "rule.md", RULE)
        os.symlink(outside / "nope.md", repo / "packs" / "mixed" / "leak.md")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual(len(packs), 1)
            self.assertIsNone(packs[0]["rootPath"])
            self.assertIn("link(s) outside the source", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)
            shutil.rmtree(outside)

    def test_symlink_inside_the_boundary_is_ordinary_content(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs/team\n---\n")
        write(repo / "packs" / "team" / "real-rule.md", RULE)
        write(repo / "packs" / "team" / "other-rule.md", RULE)
        (repo / "packs" / "team" / "other-rule.md").unlink()
        write(repo / "shared" / "other-rule.md", RULE)
        os.symlink(repo / "shared" / "other-rule.md", repo / "packs" / "team" / "other-rule.md")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual([p["id"] for p in packs], ["team"])
            self.assertEqual(packs[0]["errors"], [])
        finally:
            shutil.rmtree(repo)


class RuleShape(unittest.TestCase):
    def test_readme_is_description_only_even_with_valid_frontmatter(self):
        """A README carrying rule frontmatter must not publish by itself."""
        repo = make_repo(with_config="---\npacks:\n  - source: packs/notes\n---\n")
        write(repo / "packs" / "notes" / "README.md", RULE)
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertIsNone(packs[0]["rootPath"])
            self.assertIn("publishes no packs", " ".join(packs[0]["warnings"]))
        finally:
            shutil.rmtree(repo)

    def test_subdirectory_rules_are_storage_never_rules(self):
        """A child with no top-level rules never publishes; when its rules sit
        one level too deep, the author gets told why nothing published."""
        repo = make_repo(with_config="---\npacks:\n  - source: packs\n---\n")
        write(repo / "packs" / "team" / "deep" / "rule.md", RULE)
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual(len(packs), 1)
            self.assertIsNone(packs[0]["rootPath"])
            joined = " ".join(packs[0]["warnings"])
            self.assertIn("publishes no packs", joined)
            self.assertIn("discovery never reads", joined)
        finally:
            shutil.rmtree(repo)

    def test_missing_frontmatter_and_empty_applies_when_are_skipped_with_warnings(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs/team\n---\n")
        write(repo / "packs" / "team" / "rule.md", RULE)
        write(repo / "packs" / "team" / "notes.md", NOT_A_RULE)
        write(
            repo / "packs" / "team" / "empty.md",
            "---\ntitle: Matches nothing\napplies_when: []\n---\nbody\n",
        )
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual([p["id"] for p in packs], ["team"])
            warnings = " ".join(packs[0]["warnings"])
            self.assertIn("notes.md", warnings)
            self.assertIn("empty.md", warnings)
        finally:
            shutil.rmtree(repo)

    def test_rule_frontmatter_requires_nonempty_title_and_applies_when(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp) / "good.md"
            good.write_text(RULE, encoding="utf-8")
            meta = atlas_packs.rule_frontmatter(str(good))
            self.assertIsNotNone(meta)
            self.assertEqual(meta["title"], RULE.splitlines()[1].split("title: ")[1])
            self.assertEqual(len(meta["applies_when"]), 2)
            self.assertIsNone(atlas_packs.rule_frontmatter(str(Path(tmp) / "missing.md")))


class PublisherDiscovery(unittest.TestCase):
    def test_child_dirs_become_packs_named_after_the_directory(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs\n---\n")
        write(repo / "packs" / "rails" / "rule.md", RULE)
        write(repo / "packs" / "inertia" / "rule.md", RULE)
        write(repo / "packs" / ".hidden" / "rule.md", RULE)
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual(sorted(p["id"] for p in packs), ["inertia", "rails"])
            self.assertEqual(len(packs), 2)
        finally:
            shutil.rmtree(repo)

    def test_selection_and_rename(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs\n    pack: rails\n    id: core\n---\n")
        write(repo / "packs" / "rails" / "rule.md", RULE)
        write(repo / "packs" / "inertia" / "rule.md", RULE)
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual([(p["id"], os.path.basename(p["rootPath"])) for p in packs], [("core", "rails")])
        finally:
            shutil.rmtree(repo)

    def test_selection_naming_an_unpublished_id_is_an_error(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs\n    pack: [ghost]\n---\n")
        write(repo / "packs" / "rails" / "rule.md", RULE)
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertIsNone(packs[0]["rootPath"])
            self.assertIn("not published", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)

    def test_duplicate_pack_id_first_declaration_wins(self):
        config = "---\npacks:\n  - source: packs/one\n  - source: packs/two\n    id: one\n---\n"
        repo = make_repo(with_config=config)
        write(repo / "packs" / "one" / "rule.md", RULE)
        write(repo / "packs" / "two" / "rule.md", RULE)
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            kept = [p for p in packs if p["id"] == "one"]
            self.assertEqual(len(kept), 1, "output ids stay unique")
            self.assertEqual(kept[0]["rootPath"], os.path.realpath(repo / "packs" / "one"))
            dropped = [p for p in packs if p["rootPath"] is None]
            self.assertTrue(any("first declaration wins" in e for p in dropped for e in p["errors"]))
        finally:
            shutil.rmtree(repo)


class Declarations(unittest.TestCase):
    def test_git_source_requires_ref(self):
        repo = make_repo(with_config="---\npacks:\n  - source: https://github.com/o/r\n---\n")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertIsNone(packs[0]["rootPath"])
            self.assertIn("requires `ref:`", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)

    def test_ref_on_path_source_is_rejected(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs/team\n    ref: v1\n---\n")
        write(repo / "packs" / "team" / "rule.md", RULE)
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertIsNone(packs[0]["rootPath"])
            self.assertIn("only valid on git sources", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)

    def test_unknown_key_is_a_loud_error(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs/team\n    stages: [plan]\n---\n")
        write(repo / "packs" / "team" / "rule.md", RULE)
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertIsNone(packs[0]["rootPath"])
            self.assertIn("unknown packs entry key", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)

    def test_malformed_packs_block_is_surfaced_not_silent(self):
        repo = make_repo(with_config="---\npacks: just-a-string\n---\n")
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual(len(packs), 1)
            self.assertIsNone(packs[0]["id"])
            self.assertIn("must be a block list", " ".join(packs[0]["errors"]))
        finally:
            shutil.rmtree(repo)


class GitSource(unittest.TestCase):
    """The git path really shallow-clones into .atlas/.run/packs-cache/, keyed
    by sha256(url + newline + ref). Uses a local file:// remote so no network
    is touched; skipped only if git itself is unavailable."""

    def setUp(self):
        if shutil.which("git") is None:
            self.skipTest("git not on PATH")
        self.remote = Path(tempfile.mkdtemp(prefix="atlas-packs-remote-"))
        self.remote_pack = self.remote / "packs" / "published"
        write(self.remote_pack / "rule.md", RULE)
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        for args in (
            ["init", "--quiet", "-b", "main", str(self.remote)],
            ["-C", str(self.remote), "add", "."],
            ["-C", str(self.remote), "commit", "--quiet", "-m", "pack"],
        ):
            subprocess.run(["git", *args], env=env, check=True, capture_output=True)

    def tearDown(self):
        shutil.rmtree(self.remote)

    def test_shallow_clone_lands_in_the_packs_cache(self):
        repo = make_repo(
            with_config=f"---\npacks:\n  - source: file://{self.remote}\n    ref: main\n    path: packs\n---\n"
        )
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertEqual(len(packs), 1)
            self.assertEqual(packs[0]["id"], "published")
            self.assertEqual(packs[0]["errors"], [])
            root = Path(packs[0]["rootPath"])
            self.assertTrue((root / "rule.md").is_file())
            self.assertEqual(root.parents[2].name, "packs-cache")
            self.assertEqual(len(root.parents[1].name), 64, "cache dirs are sha256(url\\nref)")
            self.assertEqual(str(root.parents[2]), os.path.realpath(repo / ".atlas" / ".run" / "packs-cache"))
        finally:
            shutil.rmtree(repo)

    def test_unreachable_git_source_warns_and_continues(self):
        repo = make_repo(
            with_config="---\npacks:\n  - source: https://example.invalid/o/r.git\n    ref: main\n---\n"
        )
        try:
            packs = atlas_packs.resolve_packs(str(repo))
            self.assertIsNone(packs[0]["rootPath"])
            self.assertEqual(packs[0]["errors"], [], "unreachable git is warn-and-continue, not an error")
            self.assertTrue(packs[0]["warnings"])
        finally:
            shutil.rmtree(repo)


class Cli(unittest.TestCase):
    def test_cli_prints_valid_json_and_exits_zero(self):
        repo = make_repo(with_config="---\npacks:\n  - source: packs/team\n---\n")
        write(repo / "packs" / "team" / "rule.md", RULE)
        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--repo", str(repo)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual([p["id"] for p in payload["packs"]], ["team"])
        finally:
            shutil.rmtree(repo)

    def test_cli_stays_json_on_a_nonexistent_repo(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--repo", "/nonexistent/atlas-packs-repo"],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["packs"], [])


if __name__ == "__main__":
    unittest.main()