"""Tests for scripts/telemetry_report.py (no network)."""
from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import telemetry_report as tr  # noqa: E402

WEEK = "2026-W44"
ALLOWED = {
    "schema": 2,
    "max_count": 10000,
    "min_installs_published": 3,
    "keys": ["skill.atlas-plan", "skill.atlas-review", "agent.planner", "hook.git_guard.deny",
             "gate.a.block", "gate.pass", "team.outcome.done"],
}


def _submission(counts: dict, **over) -> dict:
    base = {
        "schema": 2, "atlas_version": "16.12.0", "os": "linux", "python": "3.12",
        "week": WEEK, "nonce": str(uuid.uuid4()), "counts": counts,
    }
    base.update(over)
    return base


def _setup(tmp_path: Path, subs: list[dict]) -> tuple[Path, Path]:
    tdir = tmp_path / "telemetry"
    tdir.mkdir()
    (tdir / "allowed-keys.json").write_text(json.dumps(ALLOWED), encoding="utf-8")
    raw = tmp_path / "raw" / WEEK
    raw.mkdir(parents=True)
    for s in subs:
        (raw / f"{s['nonce']}.json").write_text(json.dumps(s), encoding="utf-8")
    return tdir, tmp_path / "raw"


def _run(tdir: Path, raw: Path) -> int:
    return tr.main(["--from-dir", str(raw), "--week", WEEK, "--telemetry-dir", str(tdir)])


def test_three_installs_publish_and_two_hide(tmp_path: Path) -> None:
    subs = [
        _submission({"skill.atlas-plan": 1, "skill.atlas-review": 5, "gate.pass": 2}),
        _submission({"skill.atlas-plan": 2, "skill.atlas-review": 7}),
        _submission({"skill.atlas-plan": 4, "hook.git_guard.deny": 1}),
    ]
    tdir, raw = _setup(tmp_path, subs)
    assert _run(tdir, raw) == 0
    rep = json.loads((tdir / "reports" / f"{WEEK}.json").read_text(encoding="utf-8"))
    assert rep["submissions"] == 3
    assert rep["counts"] == {"skill.atlas-plan": {"installs": 3, "total": 7}}
    md = (tdir / "REPORT.md").read_text(encoding="utf-8")
    assert "Latest week: 2026-W44" in md and "atlas-plan" in md and "atlas-review" not in md


def test_two_installs_publish_only_the_count(tmp_path: Path) -> None:
    tdir, raw = _setup(tmp_path, [_submission({"skill.atlas-plan": 1}) for _ in range(2)])
    assert _run(tdir, raw) == 0
    rep = json.loads((tdir / "reports" / f"{WEEK}.json").read_text(encoding="utf-8"))
    assert rep == {"week": WEEK, "submissions": 2}
    assert "no details are published" in (tdir / "REPORT.md").read_text(encoding="utf-8")


def test_invalid_and_duplicate_submissions_are_skipped(tmp_path: Path) -> None:
    good = _submission({"skill.atlas-plan": 1})
    subs = [
        good,
        _submission({"skill.atlas-plan": 1}),
        _submission({"skill.atlas-plan": 1}),
        _submission({"skill.unknown": 1}),
        _submission({"skill.atlas-plan": 0}),
        _submission({"skill.atlas-plan": 1}, os="freebsd"),
        _submission({"skill.atlas-plan": 1}, extra=1),
    ]
    tdir, raw = _setup(tmp_path, subs)
    dup = dict(good)
    (raw / WEEK / "dup.json").write_text(json.dumps(dup), encoding="utf-8")
    assert _run(tdir, raw) == 0
    rep = json.loads((tdir / "reports" / f"{WEEK}.json").read_text(encoding="utf-8"))
    assert rep["submissions"] == 3


def test_empty_or_unreachable_url_changes_nothing(tmp_path: Path, capsys) -> None:
    tdir, _ = _setup(tmp_path, [])
    assert tr.main(["--url", "", "--week", WEEK, "--telemetry-dir", str(tdir)]) == 0
    assert "nothing to do" in capsys.readouterr().out
    assert tr.main(["--url", "http://127.0.0.1:9", "--week", WEEK, "--telemetry-dir", str(tdir)]) == 0
    assert "unreachable" in capsys.readouterr().out
    assert not (tdir / "reports").exists() and not (tdir / "REPORT.md").exists()


def test_trend_table_lists_every_week(tmp_path: Path) -> None:
    tdir, raw = _setup(tmp_path, [_submission({"skill.atlas-plan": 1}) for _ in range(3)])
    (tdir / "reports").mkdir()
    (tdir / "reports" / "2026-W43.json").write_text(
        json.dumps({"week": "2026-W43", "submissions": 1}), encoding="utf-8"
    )
    assert _run(tdir, raw) == 0
    md = (tdir / "REPORT.md").read_text(encoding="utf-8")
    assert "| 2026-W43 | 1 |" in md and "| 2026-W44 | 3 |" in md
    assert md.index("2026-W44 | 3") < md.index("2026-W43 | 1")
