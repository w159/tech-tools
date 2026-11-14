"""What the crew hands back to the lead so the lead needs no extra turn: one pass count for the whole check
(worker DONEs carry their own count) and the CHANGELOG line, written by the supervisor only on a green check."""

import json
import os
import sys
from pathlib import Path

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _test_isolation  # noqa: F401,E402
import atlas_crew  # noqa: E402
import atlas_irc as irc  # noqa: E402


@pytest.mark.parametrize(
    "text,n",
    [("434 passed in 0.23s", 434), ("1 failed, 12 passed, 2 skipped", 12), ("no tests ran", None), ("", None),
     ("3 passed\n... 7 passed in 1s", 7)],
)
def test_passed_count(text, n):
    assert irc.passed_count(text) == n


@pytest.mark.parametrize(
    "before,after",
    [
        ("# Changelog\n\n## Unreleased\n", "# Changelog\n\n## Unreleased\n\n- did x\n"),
        ("# Changelog\n\n## Unreleased\n\n- old\n", "# Changelog\n\n## Unreleased\n\n- did x\n- old\n"),
        ("# C\n\n## [Unreleased]\n\n## 1.0 - 2026-01-01\n\n- a\n", "# C\n\n## [Unreleased]\n\n- did x\n\n## 1.0 - 2026-01-01\n\n- a\n"),
        ("# C\n\n## 1.0\n\n- a\n", "# C\n\n## Unreleased\n\n- did x\n\n## 1.0\n\n- a\n"),
        ("# C", "# C\n\n## Unreleased\n\n- did x\n"),
    ],
)
def test_write_changelog_puts_one_bullet_under_unreleased(tmp_path, before, after):
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "CHANGELOG.md").write_text(before)
    assert atlas_crew.write_changelog(tmp_path, "did   x") == "docs/CHANGELOG.md"
    assert (tmp_path / "docs" / "CHANGELOG.md").read_text() == after
    atlas_crew.write_changelog(tmp_path, "- did x")  # the same line twice is written once
    assert (tmp_path / "docs" / "CHANGELOG.md").read_text() == after


def test_write_changelog_root_file_no_changelog_and_blank(tmp_path):
    (tmp_path / "CHANGELOG.md").write_text("# C\n\n## Unreleased\n")
    assert atlas_crew.write_changelog(tmp_path, "y") == "CHANGELOG.md"
    assert "- y\n" in (tmp_path / "CHANGELOG.md").read_text()
    other = tmp_path / "new"
    other.mkdir()
    assert atlas_crew.write_changelog(other, "z") is None  # no changelog kept: none created, no docs/ armed
    assert not (other / "docs").exists()
    assert atlas_crew.write_changelog(other, "  \n ") is None


def _done(bus, nick, passed):
    irc.post(bus, nick, "#run", f"DONE {nick}: check passes", kind="done", extra={} if passed is None else {"passed": passed})


def test_done_passed_sums_only_when_every_cached_file_has_one_counted_done(tmp_path):
    for f in ("test_a.py", "test_b.py"):
        (tmp_path / f).write_text("def test_x():\n    pass\n")
    plan = {"workers": [{"name": "a", "owns": ["a.py"], "tests": ["test_a.py"]},
                        {"name": "b", "owns": ["b.py"], "tests": ["test_b.py"]}]}
    bus = irc.init_bus(tmp_path / "bus", "#run", ["a", "b"], "lead")
    _done(bus, "a", 3)
    _done(bus, "b", None)
    assert atlas_crew.done_passed(plan, tmp_path, bus, ["test_a.py", "test_b.py"]) is None  # b gave no count
    assert atlas_crew.done_passed(plan, tmp_path, bus, ["test_a.py"]) == 3
    assert atlas_crew.done_passed(plan, tmp_path, bus, []) == 0
    _done(bus, "b", 4)
    assert atlas_crew.done_passed(plan, tmp_path, bus, ["test_a.py", "test_b.py"]) == 7


def test_sharded_check_prints_one_total(tmp_path):
    for f, n in (("test_a.py", 2), ("test_b.py", 3), ("test_c.py", 1)):
        (tmp_path / f).write_text("".join(f"def test_{i}():\n    pass\n" for i in range(n)))
    py = f"{sys.executable} -m pytest -q -p no:cacheprovider"
    code, out = atlas_crew.sharded_check(py, tmp_path, ["test_a.py", "test_b.py", "test_c.py"], 2,
                                         skip=["test_a.py"], skip_passed=2)
    assert code == 0, out
    assert "1 test files verified by worker DONE on the same bytes, 2 passed; skipped" in out
    assert out.rstrip().endswith("crew total: 6 passed (2 verified by worker DONE, 4 run here)")
    code, out = atlas_crew.sharded_check(py, tmp_path, ["test_a.py", "test_b.py", "test_c.py"], 2,
                                         skip=["test_a.py"], skip_passed=None)
    assert "crew total" not in out  # an uncounted skip claims no total


def test_done_carries_the_unit_checks_pass_count(tmp_path, monkeypatch):
    bus = irc.init_bus(tmp_path / "bus", "#run", ["a"], "lead")
    (tmp_path / "test_a.py").write_text("def test_1():\n    pass\n\ndef test_2():\n    pass\n")
    for k, v in {"ATLAS_IRC_DIR": str(bus), "ATLAS_IRC_NICK": "a", "ATLAS_CREW_ROOT": str(tmp_path),
                 "ATLAS_CREW_OWNS": json.dumps([]),
                 "ATLAS_CREW_UNIT_CHECK": f"{sys.executable} -m pytest -q -p no:cacheprovider test_a.py"}.items():
        monkeypatch.setenv(k, v)
    assert irc._run_unit_check(bus, "a") == 0
    irc._announce_done(bus, "a", "check passes")
    assert irc.latest_done_record(bus, "a")["passed"] == 2
