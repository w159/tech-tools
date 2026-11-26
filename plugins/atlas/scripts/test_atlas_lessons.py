"""The crew's self-improving loop (atlas_lessons): capture only verified check failures, inject them into the
next run's worker prompts, and let the checks score each lesson.

Run: python3 -m pytest plugins/atlas/scripts/test_atlas_lessons.py -q
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "hooks")))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_crew  # noqa: E402
import atlas_irc  # noqa: E402
import atlas_lessons as L  # noqa: E402

TEST_SRC = '''
import pytest
from kit.slug import slugify


def test_sep():
    assert slugify("Hello World") == "hello_world"


def test_pad():
    out = slugify("a b")
    assert out == (
        "a_b"
        "  "
    )


def test_ok():
    assert slugify("x") == "x"


def test_raises():
    for bad in ("", "!!"):
        with pytest.raises(ValueError):
            slugify(bad)


def test_type():
    with pytest.raises(TypeError):
        slugify(1)
'''

PLAN = {
    "check": "pytest",
    "workers": [
        {"name": "slug", "owns": ["kit/slug.py"], "tests": ["tests/test_slug.py"]},
        {"name": "money", "owns": ["kit/money.py"], "tests": ["tests/test_money.py"]},
    ],
}


def _impl(sep: str) -> str:
    return f'def slugify(t):\n    return "{sep}".join(t.lower().split())\n'


def _project(tmp: str, impl: str = _impl("-")) -> str:
    root = os.path.join(tmp, "proj")
    os.makedirs(os.path.join(root, "kit"))
    os.makedirs(os.path.join(root, "tests"))
    Path(root, "kit", "__init__.py").write_text("")
    Path(root, "kit", "slug.py").write_text(impl)
    Path(root, "tests", "test_slug.py").write_text(TEST_SRC)
    return root


def _pytest(root: str) -> str:
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"],
        cwd=root,
        capture_output=True,
        text=True,
        env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),  # a same-size rewrite inside one second reuses a stale .pyc
    )
    return r.stdout + r.stderr


class _Env(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.root = _project(self.tmp)
        self.rundir = Path(self.root, ".atlas", ".run", "crew", "r1")
        self.rundir.mkdir(parents=True)
        p = mock.patch.dict(os.environ, {"ATLAS_CREW_LEARN": "on"})
        p.start()
        self.addCleanup(p.stop)

    def tearDown(self):
        self._tmp.cleanup()


class ParseTest(_Env):
    def test_real_pytest_output(self):
        got = {f["test"]: f["text"] for f in L.parse_failures(_pytest(self.root), self.root)}
        self.assertEqual(
            sorted(got),
            [f"tests/test_slug.py::{t}" for t in ("test_pad", "test_raises", "test_sep", "test_type")],
        )
        # the loop line before a raises block is kept; the ^^^ position markers are not
        self.assertIn('for bad in ("", "!!"):', got["tests/test_slug.py::test_raises"])
        self.assertIn("DID NOT RAISE", got["tests/test_slug.py::test_raises"])
        self.assertNotIn("^^^", got["tests/test_slug.py::test_raises"])
        self.assertIn('slugify("Hello World") == "hello_world"', got["tests/test_slug.py::test_sep"])
        self.assertIn("'hello-world' == 'hello_world'", got["tests/test_slug.py::test_sep"])
        # the continuation of a multi-line assert is kept, and runs of spaces inside it survive
        self.assertIn('"a_b" "  "', got["tests/test_slug.py::test_pad"])
        self.assertNotIn("\n", got["tests/test_slug.py::test_pad"])
        # an error raised inside the called function: the test's own line, then the callee's error, and none of
        # the frame separator, the file line or the callee's source in between
        typ = got["tests/test_slug.py::test_type"]
        self.assertTrue(typ.endswith("-> AttributeError: 'int' object has no attribute 'lower'"), typ)
        self.assertIn("> slugify(1)", typ)
        self.assertNotIn("_ _ _", typ)
        self.assertNotIn("test_slug.py:", typ)
        self.assertNotIn("def slugify", typ)

    def test_not_pytest(self):
        self.assertEqual(L.parse_failures("make: *** [all] Error 2\n"), [])
        self.assertEqual(L.parse_failures(""), [])

    def test_secret_redacted(self):
        out = "FAILED tests/test_a.py::test_k - AssertionError: password=hunter2secret\n"
        (f,) = L.parse_failures(out)
        self.assertNotIn("hunter2secret", f["text"])


class LoopTest(_Env):
    def _run(self, output: str, who: str = "slug", shown: dict | None = None) -> dict:
        L.note_failure(self.rundir, who, output)
        if shown:
            L.record_shown(self.rundir, shown)
        return L.learn(self.rundir, PLAN, self.root)

    def _fresh_run(self, name: str) -> None:
        self.rundir = Path(self.root, ".atlas", ".run", "crew", name)
        self.rundir.mkdir(parents=True)

    def test_capture_inject_and_judge(self):
        counts = self._run(_pytest(self.root))
        self.assertEqual(counts["captured"], 4)
        rows = L.load(self.root)
        self.assertEqual({r["status"] for r in rows}, {"candidate"})
        self.assertEqual(rows[0]["files"], ["kit/slug.py"])

        slug, money = PLAN["workers"]
        block, ids = L.prompt_block(self.root, slug)
        self.assertEqual(len(ids), 4)
        self.assertIn('<recalled-memory untrusted="true">', block)
        self.assertIn("hello_world", block)
        self.assertLessEqual(len(block), L.INJECT_CAP_CHARS + 600)
        self.assertEqual(L.prompt_block(self.root, money), ("", []))  # another worker's files: zero bytes

        # run 2: the lessons were shown and the worker's code now passes -> both win and are proven
        self._fresh_run("r2")
        L.record_shown(self.rundir, {"slug": ids})
        counts = L.learn(self.rundir, PLAN, self.root)
        self.assertEqual((counts["shown"], counts["wins"], counts["losses"]), (4, 4, 0))
        self.assertEqual({r["status"] for r in L.load(self.root)}, {"proven"})

    def _set_impl(self, sep: str) -> str:
        Path(self.root, "kit", "slug.py").write_text(_impl(sep))
        return _pytest(self.root)

    def test_same_failure_again_is_a_repeat_not_a_loss(self):
        out = _pytest(self.root)
        self._run(out)
        ids = L.prompt_block(self.root, PLAN["workers"][0])[1]
        for n in ("r2", "r3"):  # shown twice, and the worker made the same mistakes both times
            self._fresh_run(n)
            counts = self._run(out, shown={"slug": ids})
            self.assertEqual((counts["repeats"], counts["losses"], counts["retired"]), (4, 0, 0))
        rows = L.load(self.root)
        self.assertEqual({r["status"] for r in rows}, {"candidate"})  # still true: kept, never retired
        self.assertEqual({r["repeats"] for r in rows}, {2})
        block, ids2 = L.prompt_block(self.root, PLAN["workers"][0])
        self.assertEqual(sorted(ids2), sorted(ids))
        self.assertIn("failed the same way again in 2 later runs", block)

    def test_new_failures_are_losses_and_two_retire_then_revive(self):
        self._run(self._set_impl("-"))
        ids = L.prompt_block(self.root, PLAN["workers"][0])[1]
        for n, sep in (("r2", "__"), ("r3", "___")):  # the failure moves each run: the note was stale
            self._fresh_run(n)
            counts = self._run(self._set_impl(sep), shown={"slug": ids})
            # test_sep and test_pad fail in a new way; test_raises and test_type fail the same way
            self.assertEqual((counts["losses"], counts["repeats"]), (2, 2))
        by = {r["test"].split("::")[1]: r for r in L.load(self.root)}
        self.assertEqual(by["test_sep"]["status"], "retired")
        self.assertEqual(by["test_raises"]["status"], "candidate")
        self.assertEqual(len(L.prompt_block(self.root, PLAN["workers"][0])[1]), 2)
        # retired before this run, now failing in yet another way: back as a candidate with the new text
        self._fresh_run("r4")
        counts = self._run(self._set_impl("-_-"))
        self.assertEqual(counts["revived"], 2)
        by = {r["test"].split("::")[1]: r for r in L.load(self.root)}
        self.assertEqual((by["test_sep"]["status"], by["test_sep"]["losses"]), ("candidate", 0))
        self.assertIn("hello-_-world", by["test_sep"]["text"])

    def test_forget_is_for_good(self):
        self._run(self._set_impl("-"))
        with mock.patch("builtins.print"):
            self.assertEqual(L.main(["forget", "tests/test_slug.py::test_sep", "--root", self.root]), 0)
        self._fresh_run("r2")
        self._run(self._set_impl("__"))
        by = {r["test"].split("::")[1]: r for r in L.load(self.root)}
        self.assertEqual(by["test_sep"]["status"], "forgotten")
        self.assertNotIn(by["test_sep"]["id"], L.prompt_block(self.root, PLAN["workers"][0])[1])

    def test_shown_lesson_for_a_deleted_test_retires(self):
        self._run(_pytest(self.root))
        ids = L.prompt_block(self.root, PLAN["workers"][0])[1]
        os.remove(os.path.join(self.root, "tests", "test_slug.py"))
        self._fresh_run("r2")
        L.record_shown(self.rundir, {"slug": ids})
        counts = L.learn(self.rundir, PLAN, self.root)
        self.assertEqual((counts["retired"], counts["wins"]), (4, 0))
        self.assertEqual(L.prompt_block(self.root, PLAN["workers"][0]), ("", []))

    def test_global_failure_routes_by_test_path(self):
        counts = self._run(_pytest(self.root), who="global")
        self.assertEqual(counts["captured"], 4)
        self.assertTrue(L.prompt_block(self.root, PLAN["workers"][0])[1])
        self.assertFalse(L.prompt_block(self.root, PLAN["workers"][1])[1])

    def test_green_run_writes_nothing(self):
        counts = L.learn(self.rundir, PLAN, self.root)
        self.assertEqual(counts["captured"], 0)
        self.assertFalse(L.store_path(self.root).parent.exists())  # not even the lock file or the memory dir

    def test_switch_off(self):
        with mock.patch.dict(os.environ, {"ATLAS_CREW_LEARN": "off"}):
            L.note_failure(self.rundir, "slug", _pytest(self.root))
            self.assertFalse((self.rundir / "learn").exists())
            self.assertIsNone(L.learn(self.rundir, PLAN, self.root))
            self.assertEqual(L.prompt_block(self.root, PLAN["workers"][0]), ("", []))

    def test_broken_store_never_blocks(self):
        p = L.store_path(self.root)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("{not json")
        self.assertEqual(L.prompt_block(self.root, PLAN["workers"][0]), ("", []))
        self.assertEqual(L.learn(self.rundir, PLAN, self.root)["captured"], 0)


class WiringTest(_Env):
    def test_unit_check_failure_is_noted(self):
        irc = self.rundir / "irc"
        irc.mkdir()
        env = {
            "ATLAS_CREW_UNIT_CHECK": f"{sys.executable} -m pytest -q -p no:cacheprovider tests",
            "ATLAS_CREW_ROOT": self.root,
        }
        with mock.patch.dict(os.environ, env), mock.patch.object(atlas_irc, "post"), mock.patch("builtins.print"):
            code = atlas_irc._run_unit_check(str(irc), "slug")
        self.assertEqual(code, 1)
        (block,) = L._read_fails(self.rundir / "learn" / "slug.fails")
        self.assertIn("test_sep", block)

    def test_worker_prompt_block(self):
        w = dict(PLAN["workers"][0], task="Implement kit/slug.py.", check="irc check")
        plain = atlas_crew.worker_prompt(PLAN, w, "r1", self.root)
        lessons = "## Lessons from earlier verified check failures\nX\n\n"
        withl = atlas_crew.worker_prompt(PLAN, w, "r1", self.root, lessons)
        self.assertNotIn("Lessons", plain)
        self.assertEqual(len(withl) - len(plain), len(lessons))
        self.assertLess(withl.index("## Lessons"), withl.index("## Context"))

    def test_lead_view_counts_only(self):
        obj = {"run": "r1", "check_exit": 0, "workers": [], "lessons": {"shown": 0, "captured": 3, "store": 3}}
        self.assertEqual(atlas_crew.lead_view(obj, self.rundir)["lessons"], {"captured": 3})
        obj["lessons"] = {"shown": 0, "captured": 0, "store": 3}
        self.assertNotIn("lessons", atlas_crew.lead_view(obj, self.rundir))


if __name__ == "__main__":
    unittest.main()
